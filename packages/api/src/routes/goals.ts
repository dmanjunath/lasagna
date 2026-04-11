import { Hono } from "hono";
import { eq, and, sql, goals } from "@lasagna/core";
import { db } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const goalRoutes = new Hono<AuthEnv>();
goalRoutes.use("*", requireAuth);

// GET / - List all active goals
goalRoutes.get("/", async (c) => {
  const session = c.get("session");

  const result = await db.query.goals.findMany({
    where: eq(goals.tenantId, session.tenantId),
    orderBy: [sql`${goals.createdAt} ASC`],
  });

  return c.json({ goals: result });
});

// POST / - Create a goal
goalRoutes.post("/", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();

  const { name, targetAmount, deadline, category, icon } = body;

  if (!name || !targetAmount) {
    return c.json({ error: "name and targetAmount are required" }, 400);
  }

  const [goal] = await db
    .insert(goals)
    .values({
      tenantId: session.tenantId,
      name,
      targetAmount: String(targetAmount),
      deadline: deadline ? new Date(deadline) : undefined,
      category: category || "savings",
      icon: icon || undefined,
    })
    .returning();

  return c.json({ goal }, 201);
});

// PATCH /:id - Update a goal
goalRoutes.patch("/:id", async (c) => {
  const session = c.get("session");
  const goalId = c.req.param("id");
  const body = await c.req.json();

  // Verify ownership
  const existing = await db.query.goals.findFirst({
    where: and(eq(goals.id, goalId), eq(goals.tenantId, session.tenantId)),
  });

  if (!existing) {
    return c.json({ error: "Goal not found" }, 404);
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.targetAmount !== undefined) updates.targetAmount = String(body.targetAmount);
  if (body.currentAmount !== undefined) updates.currentAmount = String(body.currentAmount);
  if (body.deadline !== undefined) updates.deadline = body.deadline ? new Date(body.deadline) : null;
  if (body.status !== undefined) updates.status = body.status;

  if (Object.keys(updates).length === 0) {
    return c.json({ goal: existing });
  }

  const [updated] = await db
    .update(goals)
    .set(updates)
    .where(and(eq(goals.id, goalId), eq(goals.tenantId, session.tenantId)))
    .returning();

  return c.json({ goal: updated });
});

// DELETE /:id - Delete a goal
goalRoutes.delete("/:id", async (c) => {
  const session = c.get("session");
  const goalId = c.req.param("id");

  const existing = await db.query.goals.findFirst({
    where: and(eq(goals.id, goalId), eq(goals.tenantId, session.tenantId)),
  });

  if (!existing) {
    return c.json({ error: "Goal not found" }, 404);
  }

  await db
    .delete(goals)
    .where(and(eq(goals.id, goalId), eq(goals.tenantId, session.tenantId)));

  return c.json({ ok: true });
});
