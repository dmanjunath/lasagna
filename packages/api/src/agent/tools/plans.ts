import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { plans, planEdits } from "@lasagna/core";
import { eq, and } from "@lasagna/core";
import { uiPayloadSchema } from "../types.js";

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
        type: z.enum(["net_worth", "retirement", "custom"]),
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
