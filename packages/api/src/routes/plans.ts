import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { plans, planEdits, chatThreads, eq, and, desc } from "@lasagna/core";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const plansRouter = new Hono<AuthEnv>();
plansRouter.use("*", requireAuth);

// Validation schemas
const uuidSchema = z.string().uuid();

const createPlanSchema = z.object({
  type: z.enum(["net_worth", "retirement", "custom"]),
  title: z.string().min(1).max(255),
});

const updatePlanSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
});

const restoreSchema = z.object({
  editId: z.string().uuid(),
});

// Safe JSON parse helper
function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

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

  const uuidResult = uuidSchema.safeParse(planId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  return c.json({
    ...plan,
    content: safeJsonParse(plan.content, null),
    inputs: safeJsonParse(plan.inputs, null),
  });
});

// Create plan
plansRouter.post("/", async (c) => {
  const { tenantId } = c.get("session");
  const rawBody = await c.req.json();

  const parseResult = createPlanSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request body", details: parseResult.error.issues }, 400);
  }
  const body = parseResult.data;

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

  const uuidResult = uuidSchema.safeParse(planId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const rawBody = await c.req.json();
  const parseResult = updatePlanSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request body", details: parseResult.error.issues }, 400);
  }
  const body = parseResult.data;

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

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  await db
    .update(plans)
    .set(updates)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  return c.json({ success: true });
});

// Delete plan (soft delete)
plansRouter.delete("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(planId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const [plan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  await db
    .update(plans)
    .set({ status: "archived" })
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  return c.json({ success: true });
});

// Get plan history
plansRouter.get("/:id/history", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(planId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const history = await db
    .select()
    .from(planEdits)
    .where(and(eq(planEdits.planId, planId), eq(planEdits.tenantId, tenantId)))
    .orderBy(desc(planEdits.createdAt))
    .limit(50);

  return c.json({
    history: history.map((h) => ({
      ...h,
      previousContent: safeJsonParse(h.previousContent, null),
    })),
  });
});

// Clone plan
plansRouter.post("/:id/clone", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(planId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  const clonedTitle = plan.title.length > 245 ? `${plan.title.slice(0, 245)}... (Copy)` : `${plan.title} (Copy)`;

  const [newPlan] = await db
    .insert(plans)
    .values({
      tenantId,
      type: plan.type,
      title: clonedTitle,
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

  const uuidResult = uuidSchema.safeParse(planId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const rawBody = await c.req.json();
  const parseResult = restoreSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request body", details: parseResult.error.issues }, 400);
  }
  const body = parseResult.data;

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

  // Get current content for history (with tenant verification)
  const [currentPlan] = await db
    .select({ content: plans.content })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

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
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  return c.json({ success: true });
});
