/**
 * Deterministic, tax-aware retirement drawdown schedule — the pure core of the
 * planning engine. Uses a single expected (blended) return with NO randomness,
 * so it is fully reproducible and reconciles to the dollar.
 *
 * RECONCILIATION RULE: the engine operates on individual ACCOUNTS. For every
 * account, `end` is derived by summation of its rounded components
 * (`start + growth + contribution - withdrawal`), never assigned independently.
 * Each tax bucket's fields are the SUM of its accounts' fields, `totalPortfolio`
 * is the sum of bucket ends and `portfolioWithdrawal` is the sum of bucket
 * withdrawals — invariants hold at both levels by construction.
 *
 * DRAW ORDER (documented advisor default): buckets in tax-smart order
 * (taxable → deferred → Roth → HSA, age-gated), and within a bucket cash
 * (depository) accounts first, then investment accounts largest-first — spend
 * cash before selling shares. Cash draws are pure basis (no capital-gains
 * realization); only investment-account taxable draws split basis/LTCG via the
 * cost-basis ratio.
 *
 * NOT tax advice. Federal-only estimates via tax-model.ts (no state, NIIT, AMT).
 *
 * TAX SIMPLIFICATIONS (v1, documented on purpose):
 *  - Estimates are federal-only.
 *  - Net rental income and `otherMonthly` (pension/annuity) are NOT included in
 *    taxable income or in SS provisional income. Net rental already excludes
 *    depreciation/interest, so it is a reasonable proxy for taxable rental; the
 *    pension omission is a known gap.
 *  - SS taxability is driven by the tax-deferred draw only (the sole ordinary
 *    income the model recognizes beyond SS itself).
 */

import { BUCKET_ORDER, BUCKET_LABELS, bucketBalances, bucketFor, isEarmarked, type Bucket } from "./account-buckets.js";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import { resolveSimInputs } from "./resolve-sim-inputs.js";
import type { SimInputs } from "./retirement-sim.js";
import { blendedExpectedReturn, blendedVolatility, MARKET_MODEL } from "./market-assumptions.js";
import { RE_APPRECIATION, DIVIDEND_YIELD, DEFAULT_COST_BASIS_RATIO } from "./plan-constants.js";
import type { PersonContext } from "./plan-grounding.js";
import {
  type FilingStatus,
  standardDeduction,
  ordinaryTax,
  ltcgTax,
  zeroLtcgCeiling,
  taxableSocialSecurity,
  toFilingStatus,
  TAX_YEAR,
  DEFERRED_401K_LIMIT,
  PENALTY_FREE_AGE,
  HSA_NONMEDICAL_AGE,
} from "./tax-model.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** "depository" = cash (checking/savings/MM) — drawn first within its bucket,
 *  and its draws are pure basis (no capital-gains realization). */
export type ScheduleAccountKind = "depository" | "investment";

/** One real account fed into the engine. */
export interface ScheduleAccountInput {
  id: string;
  name: string;
  bucket: Bucket;
  kind: ScheduleAccountKind;
  balance: number;
  /** Earmarked for someone else (529/custodial/UTMA): grown and tracked, but
   *  never drawn and never receiving contributions. */
  earmarked?: boolean;
}

/** One account's flow through one year. end = start + growth + contribution - withdrawal. */
export interface ScheduleAccountFlow {
  id: string;
  name: string;
  bucket: Bucket;
  kind: ScheduleAccountKind;
  earmarked?: boolean;
  start: number; growth: number; contribution: number; withdrawal: number; end: number;
}

export interface ScheduleInputs {
  currentAge: number; retirementAge: number; planThroughAge: number;
  buckets: Record<Bucket, number>;              // starting balances (used only when `accounts` is absent)
  /** Individual accounts. When present, these are the source of truth and the
   *  engine tracks each through every year; `buckets` is ignored. When absent,
   *  one pseudo-account per non-empty bucket is synthesized (bucket-level
   *  behavior, identical to the pre-account engine). */
  accounts?: ScheduleAccountInput[];
  monthlySavings: number; monthlySpend: number;
  blendedReturn: number;                         // decimal, e.g. 0.06 — SAME rate for every account (the blend already reflects the portfolio's cash share)
  inflationRate: number;                         // decimal, e.g. 0.03
  ssMonthly: number; ssClaimAge: number; otherMonthly: number; otherStartAge: number;
  realEstate: { value: number; mortgage: number; netAnnualRent: number } | null;
  reAppreciation: number;                        // decimal, e.g. 0.03
  dividendYield: number;                          // decimal, e.g. 0.018 (carried through for grounding; not required in the tax path for v1)
  costBasisRatio: number;                         // taxable basis / value, 0..1
  filingStatus: FilingStatus;
}

export interface ScheduleRow {
  age: number; year: number; phase: "accumulation" | "retirement";
  buckets: Record<Bucket, { start: number; growth: number; contribution: number; withdrawal: number; end: number }>;
  /** Per-account flows this year, in draw order. Bucket fields above are the
   *  sums of these; totals below are the sums of the buckets. */
  accounts: ScheduleAccountFlow[];
  realEstate: { value: number; mortgage: number; equity: number; netRentalIncome: number } | null;
  spendTarget: number;
  guaranteedIncome: { socialSecurity: number; rental: number; other: number };
  portfolioWithdrawal: number;
  ordinaryIncome: number; ltcgRealized: number; estimatedTax: number; taxFreeWithdrawal: number;
  totalPortfolio: number; netWorth: number; shortfall: number;
}

export interface ScheduleFlags {
  bridge: { fromAge: number; toAge: number; covered: boolean; shortfallTotal: number } | null;
  firstShortfallAge: number | null;
  coastFi: { deferredPlusRothAt59: number; deferredPlusRothAtEnd: number };
  taxFreeCapacityAtRetirement: number;
  realEstateEquityAtRetirement: number;
  rmd: { firstAge: number; firstAmount: number } | null;
  endingPortfolio: number; endingNetWorth: number; depleted: boolean;
}

// ---------------------------------------------------------------------------
// Pure engine
// ---------------------------------------------------------------------------

// Penalty-free access to tax-deferred/Roth begins at 59.5 (mid-year). With
// integer ages, treat age 59 as eligible — the half-year gate would otherwise
// invent a phantom one-year "bridge" gap at 59.
const PENALTY_FREE_INT_AGE = Math.floor(PENALTY_FREE_AGE); // 59

/** Eligibility of a bucket as a drawdown source at a given age. */
function eligibleAt(bucket: Bucket, age: number): boolean {
  if (bucket === "taxable") return true;
  if (bucket === "deferred" || bucket === "roth") return age >= PENALTY_FREE_INT_AGE;
  return age >= HSA_NONMEDICAL_AGE; // hsa
}

/** An account as the engine iterates it (balances live in a parallel array). */
interface EngineAccount {
  id: string;
  name: string;
  bucket: Bucket;
  kind: ScheduleAccountKind;
  earmarked?: boolean;
}

/** Result of drawing `target` net dollars across eligible accounts in order. */
interface DrawResult {
  /** Per-account draw, aligned by index with the engine's account array. */
  perAccount: number[];
  withdrawal: Record<Bucket, number>;
  deferredDraw: number;   // ordinary income from tax-deferred
  taxableGain: number;    // LTCG realized from taxable INVESTMENT draws only
  taxableBasis: number;   // tax-free portion of taxable draw (all cash + investment basis)
  rothDraw: number;
  hsaDraw: number;
  unmet: number;          // target not covered because accounts exhausted
}

/**
 * Draw `target` net dollars from eligible accounts in order (the account array
 * is pre-sorted: bucket order, cash before investments, largest-first),
 * skipping age-ineligible buckets and respecting each account's available
 * balance. Cash (depository) draws realize NO capital gains — they are pure
 * basis; only investment taxable draws split basis/gain via costBasisRatio.
 * Pure: reads `available` but does not mutate.
 */
function drawFor(
  target: number,
  age: number,
  accounts: EngineAccount[],
  available: number[],
  costBasisRatio: number,
): DrawResult {
  const perAccount = accounts.map(() => 0);
  let remaining = Math.max(0, target);
  for (let i = 0; i < accounts.length && remaining > 0; i++) {
    if (accounts[i].earmarked) continue; // someone else's money — never a source
    if (!eligibleAt(accounts[i].bucket, age)) continue;
    const draw = Math.min(remaining, Math.max(0, available[i]));
    perAccount[i] = draw;
    remaining -= draw;
  }

  const withdrawal: Record<Bucket, number> = { taxable: 0, deferred: 0, roth: 0, hsa: 0 };
  let cashDraw = 0;
  let investmentTaxableDraw = 0;
  for (let i = 0; i < accounts.length; i++) {
    const d = perAccount[i];
    if (d <= 0) continue;
    const a = accounts[i];
    withdrawal[a.bucket] += d;
    if (a.bucket === "taxable") {
      if (a.kind === "depository") cashDraw += d;
      else investmentTaxableDraw += d;
    }
  }
  return {
    perAccount,
    withdrawal,
    deferredDraw: withdrawal.deferred,
    taxableGain: investmentTaxableDraw * (1 - costBasisRatio),
    taxableBasis: cashDraw + investmentTaxableDraw * costBasisRatio,
    rothDraw: withdrawal.roth,
    hsaDraw: withdrawal.hsa,
    unmet: remaining,
  };
}

/** Federal tax + income composition for a given draw against the year's income. */
function taxFor(
  draw: DrawResult,
  socialSecurity: number,
  fs: FilingStatus,
): { ordinaryIncome: number; ordinaryTaxable: number; ltcgRealized: number; tax: number } {
  // Ordinary income = tax-deferred distributions + taxable portion of SS
  // (SS taxability is driven by the other ordinary income, i.e. the deferred draw).
  const ordinaryIncome = draw.deferredDraw + taxableSocialSecurity(socialSecurity, draw.deferredDraw, fs);
  const ordinaryTaxable = Math.max(0, ordinaryIncome - standardDeduction(fs));
  const ltcgRealized = draw.taxableGain;
  const ordTax = ordinaryTax(ordinaryTaxable, fs);
  const capGainsTax = ltcgTax(ltcgRealized, ordinaryTaxable, fs);
  return { ordinaryIncome, ordinaryTaxable, ltcgRealized, tax: Math.round(ordTax + capGainsTax) };
}

export function runSchedule(inputs: ScheduleInputs): { rows: ScheduleRow[]; flags: ScheduleFlags } {
  const {
    currentAge, retirementAge, planThroughAge, monthlySavings, monthlySpend,
    blendedReturn, inflationRate, ssMonthly, ssClaimAge, otherMonthly, otherStartAge,
    reAppreciation, filingStatus: fs,
  } = inputs;
  // Clamp taxable-basis ratio into [0,1] once at entry — used everywhere below.
  const costBasisRatio = Math.min(1, Math.max(0, inputs.costBasisRatio));

  // Degenerate range: nothing to project. Return empty rows with zeroed flags
  // so callers never index an empty rows array downstream.
  if (planThroughAge < currentAge) {
    return { rows: [], flags: zeroedFlags(fs) };
  }

  const rows: ScheduleRow[] = [];

  // ── Account set ─────────────────────────────────────────────────────────────
  // Source of truth when provided; else synthesize one pseudo-account per
  // non-empty bucket (kind "investment" → identical math to the bucket engine).
  const provided = (inputs.accounts ?? []).filter((a) => a.balance > 0);
  const seed: ScheduleAccountInput[] =
    provided.length > 0
      ? provided
      : BUCKET_ORDER.filter((b) => inputs.buckets[b] > 0).map((b) => ({
          id: b,
          name: BUCKET_LABELS[b],
          bucket: b,
          kind: "investment" as const,
          balance: inputs.buckets[b],
        }));

  // Draw/display order: bucket order (taxable → deferred → roth → hsa), cash
  // (depository) before investments within a bucket, then largest-first.
  // Earmarked accounts (never drawn) sort last within their bucket so display
  // de-prioritizes them.
  const kindRank = (k: ScheduleAccountKind) => (k === "depository" ? 0 : 1);
  seed.sort(
    (a, b) =>
      BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) ||
      Number(a.earmarked ?? false) - Number(b.earmarked ?? false) ||
      kindRank(a.kind) - kindRank(b.kind) ||
      b.balance - a.balance,
  );

  // Contribution routing targets. Deferred savings land on the largest deferred
  // account (their 401(k)); the taxable remainder on the largest taxable
  // INVESTMENT account (new savings get invested, not parked in checking) or,
  // failing that, the first taxable account. If a target bucket has no account
  // at all, append a zero-balance synthetic so contributions have somewhere to
  // accrue.
  const annualSavings = Math.round(monthlySavings * 12);
  const hasAccumulation = currentAge < retirementAge && annualSavings > 0;
  if (hasAccumulation) {
    if (!seed.some((a) => a.bucket === "deferred" && !a.earmarked)) {
      seed.push({ id: "new-deferred-savings", name: "New retirement savings", bucket: "deferred", kind: "investment", balance: 0 });
    }
    if (annualSavings > DEFERRED_401K_LIMIT && !seed.some((a) => a.bucket === "taxable" && !a.earmarked)) {
      seed.push({ id: "new-taxable-savings", name: "New taxable savings", bucket: "taxable", kind: "investment", balance: 0 });
    }
  }

  const accounts: EngineAccount[] = seed.map(({ id, name, bucket, kind, earmarked }) => ({ id, name, bucket, kind, earmarked }));
  // Running per-account balance carried across years (start = previous end).
  const balances: number[] = seed.map((a) => a.balance);
  // Contributions never land on earmarked accounts — they belong to someone else.
  const deferredContribIdx = accounts.findIndex((a) => a.bucket === "deferred" && !a.earmarked);
  const taxableContribIdx = (() => {
    const inv = accounts.findIndex((a) => a.bucket === "taxable" && a.kind === "investment" && !a.earmarked);
    return inv >= 0 ? inv : accounts.findIndex((a) => a.bucket === "taxable" && !a.earmarked);
  })();

  // Real estate value grows; mortgage held constant (v1 simplification — a
  // linear paydown is out of scope; RE is a net-worth/strategy lever, not a
  // drawdown source).
  let reValue = inputs.realEstate?.value ?? 0;
  const reMortgage = inputs.realEstate?.mortgage ?? 0;

  for (let age = currentAge; age <= planThroughAge; age++) {
    const year = age - currentAge;
    const phase: ScheduleRow["phase"] = age < retirementAge ? "accumulation" : "retirement";

    // 1 & 2: start + growth per ACCOUNT (same blended rate for every account —
    // the blend already reflects the portfolio's cash share).
    const startArr = balances.slice();
    const growthArr = startArr.map((s) => Math.round(s * blendedReturn));
    const contribArr = accounts.map(() => 0);
    const wdArr = accounts.map(() => 0);

    let spendTarget = 0;
    let ssIncome = 0, rentalIncome = 0, otherIncome = 0;
    let ordinaryIncome = 0, ltcgRealized = 0, estimatedTax = 0, taxFreeWithdrawal = 0;
    let shortfall = 0;

    if (phase === "accumulation") {
      // 4: route savings — deferred first up to the 401k limit (into the largest
      // deferred account), remainder into the taxable investment target.
      const toDeferred = Math.min(annualSavings, DEFERRED_401K_LIMIT);
      const toTaxable = annualSavings - toDeferred; // sums to annualSavings exactly
      if (toDeferred > 0 && deferredContribIdx >= 0) contribArr[deferredContribIdx] = toDeferred;
      if (toTaxable > 0 && taxableContribIdx >= 0) contribArr[taxableContribIdx] = toTaxable;
    } else {
      // 5: retirement — spend target, guaranteed income, drawdown, tax gross-up.
      const yearsInto = age - retirementAge;
      const inflFactor = Math.pow(1 + inflationRate, yearsInto);
      spendTarget = Math.round(monthlySpend * 12 * inflFactor);
      ssIncome = age >= ssClaimAge ? Math.round(ssMonthly * 12 * inflFactor) : 0;
      // Rents track inflation like spend/SS; fixed annuity (otherIncome) stays flat nominal.
      rentalIncome = inputs.realEstate ? Math.round(inputs.realEstate.netAnnualRent * inflFactor) : 0;
      otherIncome = age >= otherStartAge ? Math.round(otherMonthly * 12) : 0;

      const netNeed = Math.max(0, spendTarget - (ssIncome + rentalIncome + otherIncome));

      // Available balance per account = start + growth (this year's cash to draw).
      const available = startArr.map((s, i) => s + growthArr[i]);

      // Gross-up: solve W - tax(W) = netNeed by fixed-point iteration on the
      // gross withdrawal target. Converges because tax(W) is monotone with a
      // marginal slope < 1; a fixed 2-pass under-delivers net (up to ~12%) when
      // the grossed-up amount jumps a tax bracket. The `<= 1` step is the
      // intended terminal condition; the cap is only a safety bound. At very
      // high spend the residual shrinks by the top marginal rate each pass, so
      // 8 passes is not enough to converge — a too-small cap would leave a ~$100
      // rounding residual that the shortfall formula below would misreport as a
      // phantom funding gap (flipping a healthy plan to depleted). 40 always
      // reaches the sub-dollar exit given slope < 1.
      let target = netNeed;
      let draw = drawFor(target, age, accounts, available, costBasisRatio);
      let tx = taxFor(draw, ssIncome, fs);
      for (let iter = 0; iter < 40; iter++) {
        draw = drawFor(target, age, accounts, available, costBasisRatio);
        tx = taxFor(draw, ssIncome, fs);
        // Accounts exhausted — cannot reach target; the unmet net is a real shortfall.
        if (draw.unmet > 0.5) break;
        const nextTarget = netNeed + tx.tax;
        if (Math.abs(nextTarget - target) <= 1) {
          target = nextTarget;
          draw = drawFor(target, age, accounts, available, costBasisRatio);
          tx = taxFor(draw, ssIncome, fs);
          break;
        }
        target = nextTarget;
      }

      for (let i = 0; i < accounts.length; i++) wdArr[i] = Math.round(draw.perAccount[i]);
      ordinaryIncome = Math.round(tx.ordinaryIncome);
      ltcgRealized = Math.round(tx.ltcgRealized);
      estimatedTax = tx.tax;

      // True shortfall = unmet NET spend (after-tax), not just unmet gross. If
      // accounts are exhausted OR spend+tax couldn't be funded, this reflects the
      // real gap in after-tax spending power.
      const drawnTotal = draw.perAccount.reduce((s, d) => s + d, 0);
      shortfall = Math.round(Math.max(0, netNeed - (drawnTotal - tx.tax)));

      // Tax-free withdrawal = portion of gross withdrawals incurring no federal tax:
      // taxable basis + roth + hsa + deferred draw sheltered by std deduction + LTCG in the 0% band.
      // Std-deduction room is consumed by taxable SS first, then credited to the
      // deferred draw — never double-counting the room SS already used.
      const ssTaxablePortion = taxableSocialSecurity(ssIncome, draw.deferredDraw, fs);
      const stdRoomForWithdrawals = Math.max(0, standardDeduction(fs) - ssTaxablePortion);
      const ordinaryUnderStdDeduction = Math.min(draw.deferredDraw, stdRoomForWithdrawals);
      const ltcgIn0Band = Math.min(tx.ltcgRealized, zeroLtcgCeiling(tx.ordinaryTaxable, fs));
      taxFreeWithdrawal = Math.round(
        draw.taxableBasis + draw.rothDraw + draw.hsaDraw + ordinaryUnderStdDeduction + ltcgIn0Band,
      );
    }

    // Derive each ACCOUNT's end by summation of rounded components, floored at
    // 0; bucket fields are then the SUMS of their accounts, so the identity
    // holds at both levels by construction.
    const accountFlows: ScheduleAccountFlow[] = accounts.map((a, i) => {
      const s = Math.round(startArr[i]);
      const g = growthArr[i];
      const c = contribArr[i];
      let w = wdArr[i];
      let e = s + g + c - w;
      if (e < 0) { w += e; e = 0; } // floor at 0, keeping the summation identity
      balances[i] = e; // carry forward
      return { id: a.id, name: a.name, bucket: a.bucket, kind: a.kind, ...(a.earmarked ? { earmarked: true } : {}), start: s, growth: g, contribution: c, withdrawal: w, end: e };
    });

    const bucketRows: ScheduleRow["buckets"] = {
      taxable: { start: 0, growth: 0, contribution: 0, withdrawal: 0, end: 0 },
      deferred: { start: 0, growth: 0, contribution: 0, withdrawal: 0, end: 0 },
      roth: { start: 0, growth: 0, contribution: 0, withdrawal: 0, end: 0 },
      hsa: { start: 0, growth: 0, contribution: 0, withdrawal: 0, end: 0 },
    };
    for (const f of accountFlows) {
      const b = bucketRows[f.bucket];
      b.start += f.start; b.growth += f.growth; b.contribution += f.contribution;
      b.withdrawal += f.withdrawal; b.end += f.end;
    }

    const portfolioWithdrawal = accountFlows.reduce((sum, f) => sum + f.withdrawal, 0);
    const totalPortfolio = accountFlows.reduce((sum, f) => sum + f.end, 0);
    // Clamp taxFreeWithdrawal to the actual gross withdrawal (invariant).
    if (taxFreeWithdrawal > portfolioWithdrawal) taxFreeWithdrawal = portfolioWithdrawal;

    // 3: real estate — appreciate value, mortgage constant.
    reValue = inputs.realEstate ? Math.round(reValue * (1 + reAppreciation)) : 0;
    const realEstate = inputs.realEstate
      ? {
          value: reValue,
          mortgage: Math.round(reMortgage),
          equity: reValue - Math.round(reMortgage),
          netRentalIncome: rentalIncome, // inflated like guaranteedIncome.rental (0 pre-retirement)
        }
      : null;
    const netWorth = totalPortfolio + (realEstate?.equity ?? 0);

    rows.push({
      age, year, phase,
      buckets: bucketRows,
      accounts: accountFlows,
      realEstate,
      spendTarget,
      guaranteedIncome: { socialSecurity: ssIncome, rental: rentalIncome, other: otherIncome },
      portfolioWithdrawal,
      ordinaryIncome, ltcgRealized, estimatedTax, taxFreeWithdrawal,
      totalPortfolio, netWorth, shortfall,
    });
  }

  // -------------------------------------------------------------------------
  // Flags
  // -------------------------------------------------------------------------
  const retirementRows = rows.filter((r) => r.phase === "retirement");

  // Bridge: gap between retirement and penalty-free access. Integer age 59 is
  // already eligible (59.5 mid-year), so the bridge is the taxable-only span of
  // rows with age < 59 and its last year is 58.
  let bridge: ScheduleFlags["bridge"] = null;
  if (retirementAge < PENALTY_FREE_INT_AGE) {
    const span = rows.filter((r) => r.age >= retirementAge && r.age < PENALTY_FREE_INT_AGE);
    const shortfallTotal = span.reduce((s, r) => s + r.shortfall, 0);
    bridge = {
      fromAge: retirementAge,
      toAge: PENALTY_FREE_INT_AGE - 1, // 58 — last taxable-only year
      covered: shortfallTotal === 0,
      shortfallTotal,
    };
  }

  const firstShortfallRow = rows.find((r) => r.shortfall > 0);
  const firstShortfallAge = firstShortfallRow ? firstShortfallRow.age : null;

  const rowAt59 = rows.find((r) => r.age >= PENALTY_FREE_INT_AGE);
  const lastRow = rows[rows.length - 1];
  const coastFi = {
    deferredPlusRothAt59: rowAt59 ? rowAt59.buckets.deferred.end + rowAt59.buckets.roth.end : 0,
    deferredPlusRothAtEnd: lastRow.buckets.deferred.end + lastRow.buckets.roth.end,
  };

  const taxFreeCapacityAtRetirement = standardDeduction(fs) + zeroLtcgCeiling(0, fs);

  const retirementYearRow = rows.find((r) => r.age === retirementAge);
  const realEstateEquityAtRetirement = retirementYearRow?.realEstate?.equity ?? 0;

  // RMD: if tax-deferred remains at the person's RMD start age, estimate the
  // first required distribution. SECURE 2.0: RMDs begin at 73 for those born
  // 1951-1959 and 75 for those born 1960 or later (birth year approximated
  // from current age and the tax year). Uniform Lifetime divisors: 26.5 at 73,
  // 24.6 at 75.
  const birthYear = TAX_YEAR - currentAge;
  const rmdAge = birthYear >= 1960 ? 75 : 73;
  const rmdDivisor = rmdAge === 75 ? 24.6 : 26.5;
  const rmdRow = rows.find((r) => r.age === rmdAge);
  const rmd =
    rmdRow && rmdRow.buckets.deferred.end > 0
      ? { firstAge: rmdAge, firstAmount: Math.round(rmdRow.buckets.deferred.end / rmdDivisor) }
      : null;

  const depleted =
    retirementRows.some((r) => r.totalPortfolio <= 0) || rows.some((r) => r.shortfall > 0);

  const flags: ScheduleFlags = {
    bridge,
    firstShortfallAge,
    coastFi,
    taxFreeCapacityAtRetirement,
    realEstateEquityAtRetirement,
    rmd,
    endingPortfolio: lastRow.totalPortfolio,
    endingNetWorth: lastRow.netWorth,
    depleted,
  };

  return { rows, flags };
}

// ---------------------------------------------------------------------------
// ScheduleSection — DB-backed wrapper output
// ---------------------------------------------------------------------------

export interface ScheduleSection {
  section: "schedule";
  computed: boolean;
  rows: ScheduleRow[];
  flags: ScheduleFlags;
  assumptions: {
    blendedReturn: number;
    reAppreciation: number;
    dividendYield: number;
    costBasisRatio: number;
    filingStatus: FilingStatus;
    taxYear: number;
  };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Pure helper — derive schedule-specific inputs from a PersonContext
// ---------------------------------------------------------------------------

/** Derive (costBasisRatio, realEstate, filingStatus) for the schedule from a PersonContext. */
export function deriveScheduleContext(person: PersonContext | null): {
  costBasisRatio: number;
  realEstate: ScheduleInputs["realEstate"];
  filingStatus: FilingStatus;
} {
  const basis = person?.portfolioBasis;
  const costBasisRatio =
    basis && basis.marketValue > 0
      ? Math.min(1, Math.max(0, basis.costBasis / basis.marketValue))
      : DEFAULT_COST_BASIS_RATIO;
  const re = person?.realEstate;
  // Net ALL property-secured debt, including mortgages not linked to their
  // property via propertyAccountId — otherwise the schedule's equity sits on a
  // different (higher) base than the person context's netted total and the two
  // figures can never be cited together coherently.
  const realEstate =
    re && re.totalValue > 0
      ? {
          value: re.totalValue,
          mortgage: re.totalMortgage + (re.unlinkedMortgageTotal ?? 0),
          netAnnualRent: re.totalNetAnnualRent,
        }
      : null;
  const filingStatus = toFilingStatus(person?.demographics?.filingStatus ?? null);
  return { costBasisRatio, realEstate, filingStatus };
}

// ---------------------------------------------------------------------------
// Local helper — zeroed flags for the empty-state / degenerate-range paths
// ---------------------------------------------------------------------------

function zeroedFlags(fs: FilingStatus): ScheduleFlags {
  return {
    bridge: null,
    firstShortfallAge: null,
    coastFi: { deferredPlusRothAt59: 0, deferredPlusRothAtEnd: 0 },
    taxFreeCapacityAtRetirement: standardDeduction(fs) + zeroLtcgCeiling(0, fs),
    realEstateEquityAtRetirement: 0,
    rmd: null,
    endingPortfolio: 0,
    endingNetWorth: 0,
    depleted: false,
  };
}

// ---------------------------------------------------------------------------
// DB-backed wrapper — resolves real user data, produces a ScheduleSection
// ---------------------------------------------------------------------------

export async function buildRetirementSchedule(
  tenantId: string,
  userId: string,
  opts?: {
    overrides?: Partial<SimInputs>;
    flatReturn?: number;
    extraInvestable?: number;
    person?: PersonContext | null;
  },
): Promise<ScheduleSection> {
  const { overrides, flatReturn, extraInvestable, person = null } = opts ?? {};
  const inputs = await resolveSimInputs(tenantId, userId, overrides, flatReturn, extraInvestable);
  const accts = await fetchAccountsWithBalances(tenantId);
  const buckets = bucketBalances(accts);
  if (extraInvestable) buckets.taxable += Math.round(extraInvestable);

  // Individual investable accounts — the engine tracks each by name so the
  // schedule can say exactly which account funds each year. A hypothetical
  // property sale's reinvested net equity rides along as its own taxable line.
  const INVESTABLE_TYPES = new Set(["investment", "depository"]);
  const accountInputs: ScheduleAccountInput[] = accts
    .filter((a) => INVESTABLE_TYPES.has(a.type) && a.rawBalance > 0)
    .map((a) => ({
      id: a.id,
      name: a.name,
      bucket: bucketFor(a.type, a.subtype),
      kind: (a.type === "depository" ? "depository" : "investment") as ScheduleAccountKind,
      balance: a.rawBalance,
      earmarked: isEarmarked(a.name, a.subtype),
    }));
  if (extraInvestable) {
    accountInputs.push({
      id: "property-sale-proceeds",
      name: "Property sale proceeds (reinvested)",
      bucket: "taxable",
      kind: "investment",
      balance: Math.round(extraInvestable),
    });
  }
  // The DETERMINISTIC expected path must reconcile with the Monte-Carlo MEDIAN
  // (which the readiness chart shows) rather than the arithmetic mean. The median
  // of a compounding return series tracks the GEOMETRIC mean, i.e. the arithmetic
  // blended return minus the volatility drag (~sigma^2/2). Growing at the plain
  // arithmetic mean overstates the path badly over a long horizon (a single asset
  // at ~10%/18% overshoots its own median by well over 2x across 50+ years). Apply
  // the drag so the schedule's ending balance lands near the MC median. A flat
  // expected-return override is the reader's chosen scenario, so it is used as-is.
  const arithmeticReturn = blendedExpectedReturn(inputs.allocation, inputs.assetClassReturns);
  const vol = blendedVolatility(inputs.allocation);
  const blendedReturn = flatReturn ?? Math.max(0, arithmeticReturn - (vol * vol) / 2);
  const inflationRate = MARKET_MODEL.inflation.mean;
  const { costBasisRatio, realEstate, filingStatus } = deriveScheduleContext(person);
  const generatedAt = new Date().toISOString();
  const assumptions = {
    blendedReturn,
    reAppreciation: RE_APPRECIATION,
    dividendYield: DIVIDEND_YIELD,
    costBasisRatio,
    filingStatus,
    taxYear: TAX_YEAR,
  };

  const computed = Object.values(buckets).some((v) => v > 0);
  if (!computed) {
    return {
      section: "schedule",
      computed: false,
      rows: [],
      flags: zeroedFlags(filingStatus),
      assumptions,
      generatedAt,
    };
  }

  const { rows, flags } = runSchedule({
    currentAge: inputs.currentAge,
    retirementAge: inputs.retirementAge,
    planThroughAge: inputs.planThroughAge,
    buckets,
    accounts: accountInputs,
    monthlySavings: inputs.monthlySavings,
    monthlySpend: inputs.monthlySpend,
    blendedReturn,
    inflationRate,
    ssMonthly: inputs.ssMonthly,
    ssClaimAge: inputs.ssClaimAge,
    otherMonthly: inputs.otherMonthly,
    otherStartAge: inputs.otherStartAge,
    realEstate,
    reAppreciation: RE_APPRECIATION,
    dividendYield: DIVIDEND_YIELD,
    costBasisRatio,
    filingStatus,
  });

  return { section: "schedule", computed: true, rows, flags, assumptions, generatedAt };
}
