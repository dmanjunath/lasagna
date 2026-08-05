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
import { financialPlans, eq, and, ne } from "@lasagna/core";
import type { FinancialSnapshotSection } from "./financial-snapshot.js";
import type { PortfolioSection } from "./portfolio-section.js";
import type { RetirementReadinessSection } from "./retirement-readiness.js";
import type { GoalsSection } from "./goals-section.js";

interface StoredSections {
  snapshot?: FinancialSnapshotSection;
  portfolio?: PortfolioSection;
  retirement?: RetirementReadinessSection;
  goals?: GoalsSection;
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
}

function safeParse(str: string | null): { sections?: StoredSections } | null {
  if (!str) return null;
  try {
    return JSON.parse(str) as { sections?: StoredSections };
  } catch {
    return null;
  }
}

/** Turn a plan's stored sections into the compact grounding shape. */
function toCompact(
  planId: string,
  title: string,
  sections: StoredSections,
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
  return toCompact(plan.id, plan.title, parsed?.sections ?? {});
}
