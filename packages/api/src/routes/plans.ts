import { Hono } from "hono";
import { db } from "../lib/db.js";
import { plans, planEdits, chatThreads, eq, and, desc } from "@lasagna/core";
import type { AuthEnv } from "../middleware/auth.js";

export const plansRouter = new Hono<AuthEnv>();

// List all plans
plansRouter.get("/", async (c) => {
  const { tenantId } = c.get("session");

  const results = await db
    .select({
      id: plans.id,
      type: plans.type,
      title: plans.title,
      status: plans.status,
      createdAt: plans.createdAt,
      updatedAt: plans.updatedAt,
    })
    .from(plans)
    .where(eq(plans.tenantId, tenantId))
    .orderBy(desc(plans.updatedAt));

  return c.json({ plans: results });
});

// Get single plan
plansRouter.get("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  return c.json({
    ...plan,
    content: plan.content ? JSON.parse(plan.content) : null,
    inputs: plan.inputs ? JSON.parse(plan.inputs) : null,
  });
});

// Create plan
plansRouter.post("/", async (c) => {
  const { tenantId } = c.get("session");
  const body = await c.req.json<{
    type: "net_worth" | "retirement" | "custom";
    title: string;
  }>();

  const [newPlan] = await db
    .insert(plans)
    .values({
      tenantId,
      type: body.type,
      title: body.title,
      status: "draft",
    })
    .returning();

  // Create default chat thread for plan
  await db.insert(chatThreads).values({
    tenantId,
    planId: newPlan.id,
    title: "Plan Chat",
  });

  return c.json({ plan: newPlan }, 201);
});

// Update plan
plansRouter.patch("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    status?: "draft" | "active" | "archived";
    inputs?: Record<string, unknown>;
  }>();

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  const updates: Partial<typeof plans.$inferInsert> = {};
  if (body.title) updates.title = body.title;
  if (body.status) updates.status = body.status;
  if (body.inputs) updates.inputs = JSON.stringify(body.inputs);

  await db.update(plans).set(updates).where(eq(plans.id, planId));

  return c.json({ success: true });
});

// Delete plan
plansRouter.delete("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");

  const [plan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  await db.delete(plans).where(eq(plans.id, planId));

  return c.json({ success: true });
});

// Get plan history
plansRouter.get("/:id/history", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");

  const history = await db
    .select()
    .from(planEdits)
    .where(and(eq(planEdits.planId, planId), eq(planEdits.tenantId, tenantId)))
    .orderBy(desc(planEdits.createdAt))
    .limit(50);

  return c.json({
    history: history.map((h) => ({
      ...h,
      previousContent: JSON.parse(h.previousContent),
    })),
  });
});

// Clone plan
plansRouter.post("/:id/clone", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  const [newPlan] = await db
    .insert(plans)
    .values({
      tenantId,
      type: plan.type,
      title: `${plan.title} (Copy)`,
      content: plan.content,
      inputs: plan.inputs,
      status: "draft",
    })
    .returning();

  // Create chat thread for cloned plan
  await db.insert(chatThreads).values({
    tenantId,
    planId: newPlan.id,
    title: "Plan Chat",
  });

  return c.json({ plan: newPlan }, 201);
});

// Restore from history
plansRouter.post("/:id/restore", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");
  const body = await c.req.json<{ editId: string }>();

  const [edit] = await db
    .select()
    .from(planEdits)
    .where(
      and(
        eq(planEdits.id, body.editId),
        eq(planEdits.planId, planId),
        eq(planEdits.tenantId, tenantId)
      )
    );

  if (!edit) {
    return c.json({ error: "Edit not found" }, 404);
  }

  // Get current content for history
  const [currentPlan] = await db
    .select({ content: plans.content })
    .from(plans)
    .where(eq(plans.id, planId));

  // Save current as edit
  if (currentPlan?.content) {
    await db.insert(planEdits).values({
      planId,
      tenantId,
      editedBy: "user",
      previousContent: currentPlan.content,
      changeDescription: "Before restore",
    });
  }

  // Restore
  await db
    .update(plans)
    .set({ content: edit.previousContent })
    .where(eq(plans.id, planId));

  return c.json({ success: true });
});
