/**
 * Resolves a Financial Plan's STORED document.sections into a COMPACT, grounded
 * shape for the chat agent. Both the `get_financial_plan` tool and the chat
 * route's context prepend use this single resolver so the numbers the model
 * sees always reconcile with what the plan's detail page rendered.
 *
 * It reads ONLY the already-computed section snapshot (verdict, success rate,
 * ages, blended return, drawdown order, allocation, snapshot totals) and DROPS
 * the big growth/percentile arrays — those are large and never needed to answer
 * "am I on track?". Nothing is recomputed here; the stored numbers are canonical.
 *
 * Scoped by tenantId + userId — a plan is per-user, so a caller can never read
 * another user's plan through this path.
 */

import { db } from "../lib/db.js";
import {
  financialPlans,
  goals as goalsTable,
  taxDocuments,
  eq,
  and,
  ne,
  desc,
  parsePropertyMetadata,
} from "@lasagna/core";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import { readResolvedProfile } from "../lib/profile-resolver.js";
import { defaultSpendingWindow, topSpendingCategories } from "../lib/spending.js";
import type { FinancialSnapshotSection } from "./financial-snapshot.js";
import type { PortfolioSection } from "./portfolio-section.js";
import type { RetirementReadinessSection } from "./retirement-readiness.js";
import type { GoalsSection } from "./goals-section.js";
import {
  deriveSimOverrides,
  computePropertySaleAdjustment,
  type PlanAssumptions,
} from "./plan-assumptions-overrides.js";
import type { ScheduleSection, ScheduleRow, ScheduleFlags } from "./retirement-schedule.js";
import type { PathView } from "../routes/financial-path.js";

export interface StoredSections {
  snapshot?: FinancialSnapshotSection;
  portfolio?: PortfolioSection;
  retirement?: RetirementReadinessSection;
  goals?: GoalsSection;
}

/** A curated schedule row for the LLM: full year figures plus a SLIM per-account
 *  breakdown (name/bucket/withdrawal/end only) so the model can prescribe draws
 *  by account name without the token weight of every flow field. */
/** A curated schedule row holds ONLY the figures the report displays (end-of-
 *  year balances, that year's flows) — no start/growth internals. Every number
 *  the strategist can cite is therefore a number the reader can find in the
 *  rendered table, which is what makes prose-vs-table reconciliation checkable. */
export type CuratedScheduleRow = {
  age: number;
  phase: ScheduleRow["phase"];
  buckets: Record<string, { end: number; withdrawal: number }>;
  accounts: { name: string; bucket: string; withdrawal: number; end: number; earmarked?: boolean }[];
  realEstate: { equity: number; netRentalIncome: number } | null;
  spendTarget: number;
  guaranteedIncome: ScheduleRow["guaranteedIncome"];
  portfolioWithdrawal: number;
  ltcgRealized: number;
  estimatedTax: number;
  taxFreeWithdrawal: number;
  totalPortfolio: number;
  netWorth: number;
  shortfall: number;
};

export interface ScheduleGrounding {
  flags: ScheduleFlags;
  assumptions: ScheduleSection["assumptions"];
  rows: CuratedScheduleRow[]; // CURATED subset only
}

/**
 * Curate the schedule for the LLM: key rows only (never all ~50) plus flags.
 * Returns null when the schedule is not computed or has no rows.
 */
export function buildScheduleGrounding(schedule: ScheduleSection): ScheduleGrounding | null {
  if (!schedule.computed || schedule.rows.length === 0) return null;
  const retire = schedule.rows.find((r) => r.phase === "retirement")?.age ?? schedule.rows[0].age;
  const rmdAge = schedule.flags.rmd?.firstAge ?? 73;
  const wantAges = [retire, retire + 5, retire + 10, 59, rmdAge, schedule.rows[schedule.rows.length - 1].age];
  const seen = new Set<number>();
  const rows = schedule.rows
    .filter((r) => wantAges.includes(r.age) && !seen.has(r.age) && seen.add(r.age))
    .map((r): CuratedScheduleRow => ({
      age: r.age,
      phase: r.phase,
      // END-of-year balances + that year's withdrawal only — the exact figures
      // the rendered table shows (no start/growth internals to mis-cite).
      buckets: Object.fromEntries(
        Object.entries(r.buckets).map(([b, f]) => [b, { end: f.end, withdrawal: f.withdrawal }]),
      ),
      // Slim the per-account detail to what the model needs to name draws.
      // Defensive: schedule sections stored before per-account tracking have
      // no accounts on their rows — treat as empty rather than crashing.
      accounts: (r.accounts ?? [])
        .filter((f) => f.withdrawal > 0 || f.end > 0)
        .map((f) => ({
          name: f.name,
          bucket: f.bucket,
          withdrawal: f.withdrawal,
          end: f.end,
          ...(f.earmarked ? { earmarked: true } : {}),
        })),
      realEstate: r.realEstate
        ? { equity: r.realEstate.equity, netRentalIncome: r.realEstate.netRentalIncome }
        : null,
      spendTarget: r.spendTarget,
      guaranteedIncome: r.guaranteedIncome,
      portfolioWithdrawal: r.portfolioWithdrawal,
      ltcgRealized: r.ltcgRealized,
      estimatedTax: r.estimatedTax,
      taxFreeWithdrawal: r.taxFreeWithdrawal,
      totalPortfolio: r.totalPortfolio,
      netWorth: r.netWorth,
      shortfall: r.shortfall,
    }));
  return { flags: schedule.flags, assumptions: schedule.assumptions, rows };
}

/**
 * Everything we already KNOW about the person that the stored plan sections
 * don't carry — resolved live from existing data (no schema change, nothing
 * persisted). Threaded into the grounding so the suggestions section (and, next,
 * the editorial narrative) sees the full picture: real estate + equity, the
 * already-computed Social Security estimate, derivable guaranteed income,
 * demographics, and a few cheap extras (top spend categories, structured goals,
 * latest tax-doc summary, portfolio cost basis / unrealized gain).
 *
 * Every field is null-safe: many are empty for a bare tenant.
 */
export interface PersonContext {
  realEstate: {
    properties: {
      /** The property's account id, so the agent can pass it as sellPropertyAccountId. */
      id: string;
      name: string;
      /** Property market value (its account balance). */
      value: number;
      /** Balance on the linked mortgage (0 when none linked). */
      mortgage: number;
      /** value − mortgage. */
      equity: number;
      monthlyRent: number | null;
      annualInsurance: number | null;
      annualMaintenance: number | null;
      /** monthlyRent × 12 (null when no rent on file). Pre-computed so the narrative cites it. */
      annualRent: number | null;
      /** annualInsurance + annualMaintenance (0 when neither on file). */
      annualCarryingCosts: number;
      /** annualRent − annualCarryingCosts (null when no rent on file). */
      netAnnualRent: number | null;
    }[];
    totalValue: number;
    totalMortgage: number;
    totalEquity: number;
    /** Sum of every property's monthlyRent (only those that have it). */
    totalMonthlyRent: number;
    /** Sum of every property's annualRent. */
    totalAnnualRent: number;
    /** Sum of every property's annualCarryingCosts. */
    totalAnnualCarryingCosts: number;
    /** totalAnnualRent − totalAnnualCarryingCosts. */
    totalNetAnnualRent: number;
    /**
     * Balance of mortgage-type debts NOT linked to any property via
     * propertyAccountId. `totalEquity` already nets these out; surfaced so the
     * narrative can see the linkage gap. 0 when every mortgage is linked.
     */
    unlinkedMortgageTotal: number;
  } | null;
  /**
   * The Social Security figure the retirement sim already derived from income —
   * surfaced (never recomputed) so the report can explain it.
   */
  socialSecurity: { monthlyBenefit: number; claimAge: number } | null;
  /**
   * Guaranteed / recurring income sources visible to the generator but NOT fed
   * into the sim. Rental income is derivable today (sum of property rents).
   */
  guaranteedIncome: { source: string; monthly: number }[];
  demographics: {
    filingStatus: string | null;
    stateOfResidence: string | null;
    dependentCount: number | null;
    riskTolerance: string | null;
    employmentType: string | null;
  };
  /** Top spending categories (previous calendar month), largest first. */
  topSpendingCategories: { name: string; total: number }[];
  /** Structured goals-table rows (distinct from the free-form goals section). */
  goals: {
    name: string;
    targetAmount: number;
    currentAmount: number;
    monthlyContribution: number | null;
    deadline: string | null;
    status: string;
  }[];
  /** Most recent uploaded tax document's LLM summary, if any. */
  taxDocumentSummary: string | null;
  /** Portfolio cost basis + unrealized gain, when holdings carry cost basis. */
  portfolioBasis: {
    costBasis: number;
    marketValue: number;
    unrealizedGain: number;
  } | null;
  /**
   * Properties the reader hypothetically SOLD (name + net equity), resolved from
   * the plan's assumptions so both the narrative and the applied-assumptions
   * summary can cite them from one source. Empty when none sold.
   */
  soldProperties: { name: string; netEquity: number }[];
  /**
   * The reader's OWN financial path: the steps of their plan in the order that
   * was settled for them, sized, and the step they are standing on.
   *
   * Here so the report cannot prescribe a sequence that contradicts the one the
   * reader already has in front of them. Two orders for one household is one
   * order too many, and the one they can see is the one that wins.
   *
   * Read, never generated: a report must not reshuffle somebody's path as a side
   * effect of being written. Null when they have no path.
   */
  financialPath: PathView | null;
}

export interface CompactPlanGrounding {
  planId: string;
  title: string;
  snapshot: {
    netWorth: number;
    totalAssets: number;
    totalDebt: number;
    monthlySpend: number;
    age: number | null;
    annualIncome: number | null;
  } | null;
  portfolio: {
    totalValue: number;
    /** Top-level asset-class allocation: name + weight (percent) + value. */
    allocation: { name: string; weight: number; value: number }[];
  } | null;
  retirement: {
    computed: boolean;
    verdict: RetirementReadinessSection["verdict"];
    successRate: number;
    targetSuccess: number;
    retirementAge: number;
    planThroughAge: number;
    medianLastsToAge: number | null;
    blendedExpectedReturn: number;
    /**
     * Social Security estimate the sim derived from income (monthly benefit +
     * claim age). Surfaced here so the report can explain SS; null when the sim
     * inputs couldn't be resolved.
     */
    socialSecurity: { monthlyBenefit: number; claimAge: number } | null;
    recommendedStrategy: RetirementReadinessSection["recommendedStrategy"];
    /** Withdrawal-method comparison, minus any large arrays. */
    methods: {
      strategy: string;
      label: string;
      successRate: number;
      medianLastsToAge: number | null;
      recommended: boolean;
    }[];
    /** Tax-treatment spend order: bucket + label + balance. */
    drawdownOrder: { bucket: string; label: string; balance: number }[];
  } | null;
  /**
   * The user's STATED goals (retirement age, plan-end age, target annual
   * retirement income, named goals). Present only if any goal is filled — so
   * the agent knows what's already captured and only asks for the rest.
   */
  goals: GoalsSection | null;
  /**
   * Full picture of what we already know about the person, resolved live from
   * existing data. Null on the pure in-memory compaction path (the caller passes
   * it in when it has DB scope); populated for every DB-backed grounding read.
   */
  person: PersonContext | null;
  /**
   * The scalar assumptions the reader applied to THIS plan (a chosen scenario),
   * summarized so the narrative frames them correctly — e.g. Social Security has
   * been EXCLUDED at the reader's request, not "not on file". Null when the plan
   * has no assumptions applied (its derived defaults stand).
   */
  appliedAssumptions: AppliedAssumptions | null;
  /**
   * Curated schedule grounding: key rows + flags from the deterministic schedule.
   * Null when no schedule has been computed (no balances on file, or the schedule
   * section was not passed to toCompactGrounding).
   */
  schedule: ScheduleGrounding | null;
}

/**
 * A reader-chosen scenario, summarized from the plan's `assumptions` for the
 * narrative. Only the fields the reader actually overrode are present, so the
 * narrative frames exactly what was changed and nothing else.
 */
export interface AppliedAssumptions {
  /** true → Social Security was EXCLUDED from the projection at the reader's request. */
  socialSecurityExcluded?: boolean;
  /** The retirement age the reader pinned for this scenario. */
  retirementAgeOverride?: number;
  /** The flat expected return (decimal, e.g. 0.06) the reader assumed. */
  expectedReturnOverride?: number;
  /** The monthly retirement spend (dollars) the reader assumed. */
  monthlySpendOverride?: number;
  /**
   * Properties the reader hypothetically SOLD, with the net equity reinvested at
   * the current allocation. Present so the narrative frames the sale plainly ("we
   * assume the primary residence is sold and ~$X is reinvested") instead of citing
   * an asset the reader has removed. Empty/absent when nothing was sold.
   */
  soldProperties?: { name: string; netEquity: number }[];
  /** Total net equity reinvested from all sold properties (sum of the above). */
  reinvestedFromSales?: number;
}

/**
 * Summarize a plan's assumptions into the narrative-facing scenario, or null when
 * none apply. `saleSummary` (the sold-property display info the person context
 * resolved) is threaded in so the narrative can name each sold property and cite
 * the reinvested equity, without re-deriving the linkage math.
 */
function summarizeAppliedAssumptions(
  assumptions: PlanAssumptions | null,
  saleSummary?: { name: string; netEquity: number }[],
): AppliedAssumptions | null {
  if (!assumptions) return null;
  const applied: AppliedAssumptions = {};
  if (assumptions.includeSocialSecurity === false) applied.socialSecurityExcluded = true;
  if (assumptions.retirementAge !== undefined) applied.retirementAgeOverride = assumptions.retirementAge;
  if (assumptions.expectedReturn !== undefined) applied.expectedReturnOverride = assumptions.expectedReturn;
  if (assumptions.monthlySpend !== undefined) applied.monthlySpendOverride = assumptions.monthlySpend;
  if (saleSummary && saleSummary.length > 0) {
    applied.soldProperties = saleSummary;
    applied.reinvestedFromSales = saleSummary.reduce((s, p) => s + p.netEquity, 0);
  }
  return Object.keys(applied).length > 0 ? applied : null;
}

function safeParse(str: string | null): { sections?: StoredSections } | null {
  if (!str) return null;
  try {
    return JSON.parse(str) as { sections?: StoredSections };
  } catch {
    return null;
  }
}

/**
 * Turn a plan's sections into the compact grounding shape. Exported so plan-
 * create can ground the suggestions call on the SAME compaction it will read
 * back later, without re-querying the row it just assembled in memory.
 */
export function toCompactGrounding(
  planId: string,
  title: string,
  sections: StoredSections,
  person: PersonContext | null = null,
  // The plan's active assumptions, if any. Summarized into `appliedAssumptions`
  // so the narrative frames the reader's chosen scenario (e.g. Social Security
  // EXCLUDED at their request) rather than speculating about missing data.
  assumptions: PlanAssumptions | null = null,
  // The deterministic schedule, if available. Curated into key rows + flags for
  // the strategy section. Existing callers that don't pass this get schedule:null.
  schedule?: ScheduleSection | null,
): CompactPlanGrounding {
  const s = sections.snapshot;
  const p = sections.portfolio;
  const r = sections.retirement;
  const g = sections.goals;
  return {
    planId,
    title,
    snapshot: s
      ? {
          netWorth: s.netWorth,
          totalAssets: s.totalAssets,
          totalDebt: s.totalDebt,
          monthlySpend: s.monthlySpend,
          age: s.age,
          annualIncome: s.annualIncome,
        }
      : null,
    portfolio: p
      ? {
          totalValue: p.totalValue,
          allocation: p.classes.map((c) => ({ name: c.name, weight: c.weight, value: c.value })),
        }
      : null,
    retirement: r
      ? {
          computed: r.computed,
          verdict: r.verdict,
          successRate: r.successRate,
          targetSuccess: r.targetSuccess,
          retirementAge: r.retirementAge,
          planThroughAge: r.planThroughAge,
          medianLastsToAge: r.medianLastsToAge,
          blendedExpectedReturn: r.blendedExpectedReturn,
          socialSecurity: person?.socialSecurity ?? null,
          recommendedStrategy: r.recommendedStrategy,
          methods: r.methods.map((m) => ({
            strategy: m.strategy,
            label: m.label,
            successRate: m.successRate,
            medianLastsToAge: m.medianLastsToAge,
            recommended: m.recommended,
          })),
          drawdownOrder: r.drawdownOrder.map((d) => ({
            bucket: d.bucket,
            label: d.label,
            balance: d.balance,
          })),
        }
      : null,
    goals: g ?? null,
    person,
    appliedAssumptions: summarizeAppliedAssumptions(assumptions, person?.soldProperties),
    schedule: schedule && schedule.computed ? buildScheduleGrounding(schedule) : null,
  };
}

/**
 * Resolve everything we already know about the person into the compact
 * `PersonContext` — real estate + equity, the sim's Social Security estimate,
 * derivable guaranteed income, demographics, and cheap extras. Reuses existing
 * resolvers/helpers; recomputes no property/mortgage/portfolio math. Scoped by
 * (tenantId, userId) exactly like `resolvePlanGrounding`. Resilient: any block
 * that fails to resolve degrades to null/empty rather than throwing, so a
 * grounding read never fails on a partial data set.
 */
export async function resolvePersonContext(
  tenantId: string,
  userId: string,
  // The plan's active assumptions, if any. Threaded into the resolved sim inputs
  // (ssMonthly:0 for a Social Security exclusion, retirement-age / spend / flat
  // expected-return overrides) so the person context the narrative sees reflects
  // the change — e.g. socialSecurity nulls out rather than reporting a benefit
  // the plan no longer counts.
  assumptions?: PlanAssumptions | null,
): Promise<PersonContext> {
  const { overrides, flatReturn } = deriveSimOverrides(assumptions ?? null);

  // The sim needs the property-sale reclassification (reinvested net equity) to
  // land in its starting balance, but that adjustment needs the accounts we fetch
  // below. So fetch accounts first, compute the adjustment, THEN resolve the sim
  // inputs with the extra investable folded in — keeping the person context's
  // socialSecurity/verdict inputs in lockstep with the snapshot and readiness.
  const accts = await fetchAccountsWithBalances(tenantId);
  const saleAdjustment = computePropertySaleAdjustment(accts, assumptions?.soldPropertyAccountIds);

  // resolveSimInputs (and getHoldingsInput below) are imported lazily: they pull
  // in portfolio.ts → security-classifier.ts, which reads @lasagna/core exports
  // at module load. A static import would eagerly drag that graph into unrelated
  // test suites that only partially mock @lasagna/core.
  const simInputsP = import("./resolve-sim-inputs.js")
    .then((m) =>
      m.resolveSimInputs(tenantId, userId, overrides, flatReturn, saleAdjustment.netEquity),
    )
    .catch(() => null);

  // The reader's own path, as it stands. Lazily imported for the same reason as
  // the sim inputs above, and read-only by construction: `readStoredPath`
  // answers null rather than generating, so writing a report never reshuffles
  // the plan the reader is walking.
  const pathP = import("../routes/financial-path.js")
    .then((m) => m.readStoredPath(tenantId, userId))
    .catch(() => null);

  const [profile, simInputs, goalRows, taxDoc, financialPath] = await Promise.all([
    readResolvedProfile(tenantId, userId).catch(() => null),
    simInputsP,
    db.query.goals
      .findMany({ where: eq(goalsTable.tenantId, tenantId), orderBy: [desc(goalsTable.createdAt)] })
      .catch(() => []),
    db.query.taxDocuments
      .findFirst({
        where: eq(taxDocuments.tenantId, tenantId),
        orderBy: [desc(taxDocuments.createdAt)],
      })
      .catch(() => undefined),
    pathP,
  ]);

  // ── Real estate + linked mortgages (via accounts.propertyAccountId FK) ───────
  // A hypothetically SOLD property (and its linked mortgage) drops out entirely,
  // so the narrative never cites an asset the reader removed; its net equity is
  // already folded into the sim's investable via extraInvestable above.
  const excludedIds = new Set(saleAdjustment.excludedAccountIds);

  // Sum every debt account's balance that points at a given property, so a
  // property with more than one linked loan still nets correctly. Skip debts on
  // sold properties (their mortgage is gone with the sale).
  const mortgageByProperty = new Map<string, number>();
  for (const a of accts) {
    if (!a.propertyAccountId) continue;
    if (excludedIds.has(a.id)) continue;
    mortgageByProperty.set(
      a.propertyAccountId,
      (mortgageByProperty.get(a.propertyAccountId) ?? 0) + Math.abs(a.rawBalance),
    );
  }

  const propertyRows = accts.filter((a) => a.type === "real_estate" && !excludedIds.has(a.id));
  const properties = propertyRows.map((a) => {
    const meta = parsePropertyMetadata(a.metadata);
    const value = a.rawBalance;
    const mortgage = mortgageByProperty.get(a.id) ?? 0;
    const monthlyRent = meta?.monthlyRent ?? null;
    const annualInsurance = meta?.annualInsurance ?? null;
    const annualMaintenance = meta?.annualMaintenance ?? null;
    // Pre-compute the derived figures so the narrative cites them rather than
    // doing (and mis-doing) its own arithmetic on the grounding.
    const annualRent = monthlyRent != null ? monthlyRent * 12 : null;
    const annualCarryingCosts = (annualInsurance ?? 0) + (annualMaintenance ?? 0);
    const netAnnualRent = annualRent != null ? annualRent - annualCarryingCosts : null;
    return {
      id: a.id,
      name: a.name,
      value,
      mortgage,
      equity: value - mortgage,
      monthlyRent,
      annualInsurance,
      annualMaintenance,
      annualRent,
      annualCarryingCosts,
      netAnnualRent,
    };
  });

  // Total real-estate equity must net out ALL property-secured debt, including
  // a mortgage that isn't linked to its property via propertyAccountId (a data-
  // linkage gap that otherwise overstates equity). subtype === "mortgage" is a
  // reliable signal (seeded that way; Plaid marks mortgages likewise), so we can
  // identify unlinked mortgages cleanly rather than guessing.
  const propertyIds = new Set(propertyRows.map((a) => a.id));
  const unlinkedMortgageTotal = accts
    .filter(
      (a) =>
        a.subtype === "mortgage" &&
        // A sold property's linked mortgage is excluded, not "unlinked" — skip it
        // so it isn't wrongly netted out of the remaining properties' equity.
        !excludedIds.has(a.id) &&
        (!a.propertyAccountId || !propertyIds.has(a.propertyAccountId)),
    )
    .reduce((s, a) => s + Math.abs(a.rawBalance), 0);

  const realEstate =
    properties.length > 0
      ? {
          properties,
          totalValue: properties.reduce((s, p) => s + p.value, 0),
          totalMortgage: properties.reduce((s, p) => s + p.mortgage, 0),
          // Per-property equity nets only LINKED mortgages; the total also nets
          // out unlinked mortgage-type debt so it isn't overstated.
          totalEquity:
            properties.reduce((s, p) => s + p.equity, 0) - unlinkedMortgageTotal,
          totalMonthlyRent: properties.reduce((s, p) => s + (p.monthlyRent ?? 0), 0),
          totalAnnualRent: properties.reduce((s, p) => s + (p.annualRent ?? 0), 0),
          totalAnnualCarryingCosts: properties.reduce(
            (s, p) => s + p.annualCarryingCosts,
            0,
          ),
          totalNetAnnualRent: properties.reduce((s, p) => s + (p.netAnnualRent ?? 0), 0),
          unlinkedMortgageTotal,
        }
      : null;

  // ── Social Security (already computed by the sim; never recomputed here) ─────
  const socialSecurity =
    simInputs && simInputs.ssMonthly > 0
      ? { monthlyBenefit: simInputs.ssMonthly, claimAge: simInputs.ssClaimAge }
      : null;

  // ── Guaranteed income (derivable now: rental income) — visible, not simulated ─
  const guaranteedIncome: { source: string; monthly: number }[] = [];
  if (realEstate && realEstate.totalMonthlyRent > 0) {
    guaranteedIncome.push({ source: "Rental income", monthly: realEstate.totalMonthlyRent });
  }

  // ── Top spending categories (previous calendar month) ────────────────────────
  const { startDate, endDate } = defaultSpendingWindow();
  const topCats = await topSpendingCategories(tenantId, startDate, endDate).catch(() => []);

  // ── Portfolio cost basis + unrealized gain (only holdings that carry basis) ──
  let costBasis = 0;
  let marketValue = 0;
  let anyBasis = false;
  try {
    const { getHoldingsInput } = await import("../routes/portfolio.js");
    for (const h of await getHoldingsInput(tenantId)) {
      if (h.costBasis == null) continue;
      anyBasis = true;
      costBasis += h.costBasis;
      marketValue += h.value;
    }
  } catch {
    anyBasis = false;
  }
  const portfolioBasis = anyBasis
    ? {
        costBasis: Math.round(costBasis),
        marketValue: Math.round(marketValue),
        unrealizedGain: Math.round(marketValue - costBasis),
      }
    : null;

  return {
    realEstate,
    socialSecurity,
    guaranteedIncome,
    demographics: {
      filingStatus: profile?.filingStatus ?? null,
      stateOfResidence: profile?.stateOfResidence ?? null,
      dependentCount: profile?.dependentCount ?? null,
      riskTolerance: profile?.riskTolerance ?? null,
      employmentType: profile?.employmentType ?? null,
    },
    topSpendingCategories: topCats,
    goals: goalRows.map((goal) => ({
      name: goal.name,
      targetAmount: parseFloat(goal.targetAmount),
      currentAmount: parseFloat(goal.currentAmount),
      monthlyContribution:
        goal.monthlyContribution != null ? parseFloat(goal.monthlyContribution) : null,
      deadline: goal.deadline ? goal.deadline.toISOString() : null,
      status: goal.status,
    })),
    taxDocumentSummary: taxDoc?.llmSummary ?? null,
    portfolioBasis,
    soldProperties: saleAdjustment.soldProperties.map((p) => ({
      name: p.name,
      netEquity: p.netEquity,
    })),
    financialPath,
  };
}

/**
 * Load a plan owned by (tenantId, userId) and return its compact grounding, or
 * null if the plan does not exist / is archived / belongs to someone else.
 */
export async function resolvePlanGrounding(
  tenantId: string,
  userId: string,
  planId: string,
): Promise<CompactPlanGrounding | null> {
  const [plan] = await db
    .select({
      id: financialPlans.id,
      title: financialPlans.title,
      document: financialPlans.document,
      assumptions: financialPlans.assumptions,
    })
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
      ),
    );

  if (!plan) return null;

  const parsed = safeParse(plan.document);
  // Reflect the plan's active assumptions in the person context (e.g. a Social
  // Security exclusion nulls socialSecurity), so the agent's grounding matches
  // the regenerated document rather than reporting a benefit the plan dropped.
  const assumptions = parseAssumptions(plan.assumptions);
  const person = await resolvePersonContext(tenantId, userId, assumptions);
  // The stored schedule (typed off StoredSections, which doesn't declare it) is
  // read defensively and passed so the plan CHAT grounds on the same curated
  // schedule the detail page shows.
  const schedule = (parsed?.sections as { schedule?: ScheduleSection } | undefined)?.schedule ?? null;
  return toCompactGrounding(plan.id, plan.title, parsed?.sections ?? {}, person, assumptions, schedule);
}

/** Parse the plan's stored `assumptions` JSON column; null on absent/invalid. */
export function parseAssumptions(str: string | null): PlanAssumptions | null {
  if (!str) return null;
  try {
    return JSON.parse(str) as PlanAssumptions;
  } catch {
    return null;
  }
}
