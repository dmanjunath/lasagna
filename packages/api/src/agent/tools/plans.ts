import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { plans, planEdits, financialPlans } from "@lasagna/core";
import { eq, and, ne } from "@lasagna/core";
import { uiPayloadSchema } from "../types.js";
import { resolvePlanGrounding } from "../../services/plan-grounding.js";
import type { GoalsSection, NamedGoal } from "../../services/goals-section.js";

// Read-only tool for the NEW Financial Plans (financial_plans table). Grounds
// the agent in a plan's already-computed sections so its answers reconcile with
// the plan's Retirement Readiness section. Scoped by tenantId + userId (a plan
// is per-user), so a caller can never read another user's plan. Separate from
// createPlanTools, which serves the LEGACY `plans` table.
export function createFinancialPlanTools(
  tenantId: string,
  userId: string,
  financialPlanId: string,
) {
  return {
    get_financial_plan: tool({
      description:
        "Returns THIS plan's stored figures (success rate, verdict, retirement age, drawdown, allocation, net worth). Call this FIRST for any question about the plan and use ONLY these numbers — never recompute or invent.",
      // No-arg tool: the plan id is bound server-side to the thread's plan, so
      // the model never supplies (and can't request) a plan id. AI SDK v6 still
      // requires an inputSchema; an empty object is valid.
      inputSchema: z.object({}),
      // @ts-ignore
      execute: async () => {
        const grounding = await resolvePlanGrounding(tenantId, userId, financialPlanId);
        if (!grounding) return { error: "Plan not found" };
        return grounding;
      },
    }),

    update_financial_plan_goals: tool({
      description:
        "Save the user's stated plan GOALS onto THIS plan. Call this as the user answers, once per field or in batches — you only need to pass the fields you learned, and any field you omit keeps its current value (a merge, never a clobber). Use it for: retirement age, plan-end age (the age money should last through), desired ANNUAL pre-tax retirement income, and named goals (e.g. kids' college, travel, charity). Named goals REPLACE the existing named-goals list, so include every named goal you want kept.",
      // Only the goal fields — the plan id is bound server-side to the thread's
      // plan, so the model never supplies (and can't request) a plan id.
      inputSchema: z.object({
        retirementAge: z.number().int().min(30).max(100).optional(),
        planEndAge: z.number().int().min(50).max(120).optional(),
        retirementIncome: z.number().min(0).optional(),
        namedGoals: z
          .array(
            z.object({
              label: z.string().min(1).max(80),
              targetAmount: z.number().min(0).optional(),
              targetYear: z.number().int().min(1900).max(2200).optional(),
              note: z.string().max(500).optional(),
            }),
          )
          .optional(),
      }),
      // @ts-ignore
      execute: async (input: {
        retirementAge?: number;
        planEndAge?: number;
        retirementIncome?: number;
        namedGoals?: NamedGoal[];
      }) => {
        // Load the bound plan, scoped to this tenant + user + non-archived, so
        // the agent can never write to another user's (or a deleted) plan.
        const [plan] = await db
          .select({ id: financialPlans.id, document: financialPlans.document })
          .from(financialPlans)
          .where(
            and(
              eq(financialPlans.id, financialPlanId),
              eq(financialPlans.tenantId, tenantId),
              eq(financialPlans.userId, userId),
              ne(financialPlans.status, "archived"),
            ),
          );

        if (!plan) return { error: "Plan not found" };

        let document: { sections?: Record<string, unknown> };
        try {
          document = plan.document ? JSON.parse(plan.document) : {};
        } catch {
          document = {};
        }
        const sections = document.sections ?? {};
        const existing = (sections.goals as GoalsSection | undefined) ?? {
          section: "goals" as const,
        };

        // Merge: only overwrite a field the model actually supplied. namedGoals
        // is treated as a full replacement (the tool description tells the model
        // to send the complete list).
        const merged: GoalsSection = {
          ...existing,
          section: "goals",
          ...(input.retirementAge !== undefined ? { retirementAge: input.retirementAge } : {}),
          ...(input.planEndAge !== undefined ? { planEndAge: input.planEndAge } : {}),
          ...(input.retirementIncome !== undefined
            ? { retirementIncome: input.retirementIncome }
            : {}),
          ...(input.namedGoals !== undefined ? { namedGoals: input.namedGoals } : {}),
          generatedAt: new Date().toISOString(),
        };

        const nextDocument = { ...document, sections: { ...sections, goals: merged } };

        await db
          .update(financialPlans)
          .set({ document: JSON.stringify(nextDocument) })
          .where(
            and(
              eq(financialPlans.id, financialPlanId),
              eq(financialPlans.tenantId, tenantId),
              eq(financialPlans.userId, userId),
              ne(financialPlans.status, "archived"),
            ),
          );

        return { success: true, goals: merged };
      },
    }),
  };
}

export function createPlanTools(tenantId: string) {
  return {
    get_plan: tool({
      description: "Get a plan's current content",
      parameters: z.object({
        planId: z.string().uuid(),
      }),
      // @ts-ignore
      execute: async ({ planId }) => {
        const [plan] = await db
          .select()
          .from(plans)
          .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

        if (!plan) {
          return { error: "Plan not found" };
        }

        return {
          id: plan.id,
          type: plan.type,
          title: plan.title,
          status: plan.status,
          content: plan.content ? JSON.parse(plan.content) : null,
          inputs: plan.inputs ? JSON.parse(plan.inputs) : null,
        };
      },
    }),

    update_plan_content: tool({
      description:
        "Update a plan's content with new UI blocks. Creates edit history.",
      parameters: z.object({
        planId: z.string().uuid(),
        content: uiPayloadSchema,
        changeDescription: z.string().optional(),
      }),
      // @ts-ignore
      execute: async ({ planId, content, changeDescription }) => {
        // Get current plan
        const [plan] = await db
          .select()
          .from(plans)
          .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

        if (!plan) {
          return { error: "Plan not found" };
        }

        // Save edit history
        if (plan.content) {
          await db.insert(planEdits).values({
            planId,
            tenantId,
            editedBy: "agent",
            previousContent: plan.content,
            changeDescription,
          });
        }

        // Update plan (include tenant scope for defense-in-depth)
        await db
          .update(plans)
          .set({ content: JSON.stringify(content) })
          .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

        return { success: true, planId };
      },
    }),

    create_plan: tool({
      description: "Create a new plan",
      parameters: z.object({
        type: z.enum(["net_worth", "retirement", "debt_payoff", "custom"]),
        title: z.string(),
      }),
      // @ts-ignore
      execute: async ({ type, title }) => {
        const [newPlan] = await db
          .insert(plans)
          .values({
            tenantId,
            type,
            title,
            status: "draft",
          })
          .returning({ id: plans.id });

        return { planId: newPlan.id };
      },
    }),
  };
}
