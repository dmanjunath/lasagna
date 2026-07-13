import { Hono } from "hono";
import { eq, and, sql, inArray, goals, goalAccounts, goalSnapshots, accounts, balanceSnapshots } from "@lasagna/core";
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

  const { name, targetAmount, deadline, category, icon, description, accountIds, monthlyContribution } = body;

  if (!name || !targetAmount) {
    return c.json({ error: "name and targetAmount are required" }, 400);
  }
  if (!(Number(targetAmount) > 0)) {
    return c.json({ error: "targetAmount must be greater than zero" }, 400);
  }

  const [goal] = await db
    .insert(goals)
    .values({
      tenantId: session.tenantId,
      name,
      description: description ?? null,
      targetAmount: String(targetAmount),
      monthlyContribution:
        Number(monthlyContribution) > 0 ? String(monthlyContribution) : undefined,
      deadline: deadline ? new Date(deadline) : undefined,
      category: category || "savings",
      icon: icon || undefined,
    })
    .returning();

  let linkedCount = 0;
  if (Array.isArray(accountIds)) {
    const valid = await validTenantAccountIds(session.tenantId, accountIds);
    await reconcileGoalAccounts(session.tenantId, goal.id, valid);
    linkedCount = valid.length;
  }

  // Manual goals get an initial history point; auto-tracked goals derive
  // history from their accounts' balance snapshots instead.
  if (linkedCount === 0) {
    await db.insert(goalSnapshots).values({
      tenantId: session.tenantId,
      goalId: goal.id,
      value: goal.currentAmount,
    });
  }

  return c.json({ goal }, 201);
});

// GET /:id/history - Goal value over time.
// Auto-tracked goals: derived from the linked accounts' balance snapshots
// (latest per account per day, carry-forward, summed) — retroactive by nature.
// Manual goals: the goal_snapshots rows written on each manual amount change.
goalRoutes.get("/:id/history", async (c) => {
  const session = c.get("session");
  const goalId = c.req.param("id");

  const goal = await db.query.goals.findFirst({
    where: and(eq(goals.id, goalId), eq(goals.tenantId, session.tenantId)),
    columns: { id: true },
  });
  if (!goal) return c.json({ error: "Goal not found" }, 404);

  const links = await db.query.goalAccounts.findMany({
    where: eq(goalAccounts.goalId, goalId),
    columns: { accountId: true },
  });
  const accountIds = links.map((l) => l.accountId);

  if (accountIds.length === 0) {
    const snaps = await db.query.goalSnapshots.findMany({
      where: eq(goalSnapshots.goalId, goalId),
      orderBy: [sql`${goalSnapshots.snapshotAt} ASC`],
    });
    // Last value per day — several same-day edits are one chart point.
    const byDay = new Map<string, number>();
    for (const s of snaps) {
      byDay.set(s.snapshotAt.toISOString().slice(0, 10), parseFloat(s.value));
    }
    return c.json({
      history: [...byDay.entries()].map(([date, value]) => ({ date, value })),
    });
  }

  // Mirror /accounts/net-worth/history, restricted to the linked accounts.
  // invertBalance applies (it feeds effectiveBalance, which currentAmount
  // uses); excludeFromNetWorth does not — goals ignore it.
  const acctRows = await db.query.accounts.findMany({
    where: and(eq(accounts.tenantId, session.tenantId), inArray(accounts.id, accountIds)),
    columns: { id: true, invertBalance: true },
  });
  const invertById = new Map(acctRows.map((a) => [a.id, a.invertBalance]));

  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', ${balanceSnapshots.snapshotAt})::date`.as("date"),
      accountId: balanceSnapshots.accountId,
      balance: sql<string>`(array_agg(${balanceSnapshots.balance} ORDER BY ${balanceSnapshots.snapshotAt} DESC))[1]`.as("balance"),
    })
    .from(balanceSnapshots)
    .where(
      and(
        eq(balanceSnapshots.tenantId, session.tenantId),
        inArray(balanceSnapshots.accountId, accountIds),
      ),
    )
    .groupBy(sql`date_trunc('day', ${balanceSnapshots.snapshotAt})::date`, balanceSnapshots.accountId)
    .orderBy(sql`date_trunc('day', ${balanceSnapshots.snapshotAt})::date`);

  const byAccount = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const raw = parseFloat(row.balance ?? "0");
    const value = invertById.get(row.accountId) ? -raw : raw;
    let series = byAccount.get(row.accountId);
    if (!series) byAccount.set(row.accountId, (series = new Map()));
    series.set(String(row.date), value);
  }

  const allDates = [...new Set(rows.map((r) => String(r.date)))].sort();
  const last = new Map<string, number>();
  const history = allDates.map((date) => {
    for (const [accountId, series] of byAccount) {
      const v = series.get(date);
      if (v !== undefined) last.set(accountId, v);
    }
    let total = 0;
    for (const v of last.values()) total += v;
    return { date, value: Math.round(total * 100) / 100 };
  });

  return c.json({ history });
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
  if (body.monthlyContribution !== undefined)
    updates.monthlyContribution =
      Number(body.monthlyContribution) > 0 ? String(body.monthlyContribution) : null;
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

  // Manual amount changes are the only history events a manual goal has —
  // record one so the progress chart has real points.
  if (updates.currentAmount !== undefined) {
    await db.insert(goalSnapshots).values({
      tenantId: session.tenantId,
      goalId,
      value: String(updates.currentAmount),
    });
  }

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
