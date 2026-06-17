import { Hono } from "hono";
import { eq, and, sql, inArray, goals, goalAccounts, accounts } from "@lasagna/core";
import { db } from "../lib/db.js";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import { buildGoalAccountMap, resolveGoalAmount } from "../lib/goal-progress.js";
import { type AuthEnv } from "../middleware/auth.js";

export const goalRoutes = new Hono<AuthEnv>();

/** Validate that all accountIds belong to the tenant; returns the valid subset. */
async function validTenantAccountIds(
  tenantId: string,
  accountIds: string[],
): Promise<string[]> {
  if (accountIds.length === 0) return [];
  const rows = await db.query.accounts.findMany({
    where: and(eq(accounts.tenantId, tenantId), inArray(accounts.id, accountIds)),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Make goal_accounts for a goal exactly match accountIds (already validated). */
async function reconcileGoalAccounts(
  tenantId: string,
  goalId: string,
  accountIds: string[],
) {
  await db.delete(goalAccounts).where(eq(goalAccounts.goalId, goalId));
  if (accountIds.length > 0) {
    await db.insert(goalAccounts).values(
      accountIds.map((accountId) => ({ tenantId, goalId, accountId })),
    );
  }
}

// GET / - List all active goals
goalRoutes.get("/", async (c) => {
  const session = c.get("session");

  const [result, links, accts] = await Promise.all([
    db.query.goals.findMany({
      where: eq(goals.tenantId, session.tenantId),
      orderBy: [sql`${goals.createdAt} ASC`],
    }),
    db.query.goalAccounts.findMany({
      where: eq(goalAccounts.tenantId, session.tenantId),
    }),
    fetchAccountsWithBalances(session.tenantId),
  ]);

  const accountMap = buildGoalAccountMap(links);
  const balanceById = new Map(accts.map((a) => [a.id, a.effectiveBalance]));

  const goalsOut = result.map((g) => {
    const accountIds = accountMap.get(g.id) ?? [];
    const { amount, isAutoTracked } = resolveGoalAmount(
      g.currentAmount,
      accountIds,
      balanceById,
    );
    return {
      ...g,
      currentAmount: amount.toFixed(2),
      accountIds,
      isAutoTracked,
    };
  });

  return c.json({ goals: goalsOut });
});

// POST / - Create a goal
goalRoutes.post("/", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();

  const { name, targetAmount, deadline, category, icon, description, accountIds } = body;

  if (!name || !targetAmount) {
    return c.json({ error: "name and targetAmount are required" }, 400);
  }

  const [goal] = await db
    .insert(goals)
    .values({
      tenantId: session.tenantId,
      name,
      description: description ?? null,
      targetAmount: String(targetAmount),
      deadline: deadline ? new Date(deadline) : undefined,
      category: category || "savings",
      icon: icon || undefined,
    })
    .returning();

  if (Array.isArray(accountIds)) {
    const valid = await validTenantAccountIds(session.tenantId, accountIds);
    await reconcileGoalAccounts(session.tenantId, goal.id, valid);
  }

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

  // Reconcile linked accounts first so we know if the goal is auto-tracked.
  let isAutoTracked: boolean;
  if (Array.isArray(body.accountIds)) {
    const valid = await validTenantAccountIds(session.tenantId, body.accountIds);
    await reconcileGoalAccounts(session.tenantId, goalId, valid);
    isAutoTracked = valid.length > 0;
  } else {
    const existingLinks = await db.query.goalAccounts.findMany({
      where: eq(goalAccounts.goalId, goalId),
      columns: { id: true },
    });
    isAutoTracked = existingLinks.length > 0;
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.targetAmount !== undefined) updates.targetAmount = String(body.targetAmount);
  if (body.currentAmount !== undefined && !isAutoTracked)
    updates.currentAmount = String(body.currentAmount);
  if (body.deadline !== undefined) updates.deadline = body.deadline ? new Date(body.deadline) : null;
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === "completed" && !existing.completedAt) {
      updates.completedAt = new Date();
    } else if (body.status === "active") {
      // Reactivating a completed goal — clear the completion timestamp.
      updates.completedAt = null;
    }
  }

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
