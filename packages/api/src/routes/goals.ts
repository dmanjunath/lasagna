import { Hono } from "hono";
import {
  eq, and, sql, inArray, goals, goalAccounts, goalSnapshots, accounts, balanceSnapshots,
  parseGoalDetails, resolveGoalTarget, resolveGoalDeadline, type GoalDetails,
} from "@lasagna/core";
import { db } from "../lib/db.js";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import { buildGoalAccountMap, resolveGoalAmount } from "../lib/goal-progress.js";
import { readMonthlySpend, STABLE_SPEND_MONTHS } from "../lib/monthly-spend.js";
import { readUserPersonalProfile } from "../lib/profile-resolver.js";
import { type AuthEnv } from "../middleware/auth.js";

export const goalRoutes = new Hono<AuthEnv>();

const NO_BIRTH_DATE_ERROR =
  "Add your date of birth in Settings to set a goal by age, or give the goal a target date";

/** The age a home or car goal pins its date to, if it is dated that way. */
function byAgeOf(details: GoalDetails | null | undefined): number | null {
  return details && (details.kind === "home_purchase" || details.kind === "car")
    ? details.byAge ?? null
    : null;
}

/**
 * The deadline a described goal implies. A goal that describes itself decides
 * its own date the same way it decides its own target, so the client's deadline
 * is never consulted — otherwise a goal could be stored "by age 30" and dated
 * 2099, and the detail page would show both.
 *
 * An age only becomes a date with a birth date on file. Without one we refuse
 * rather than invent a date or keep the client's, which is what the form does
 * by not offering "By age" until a birth date exists.
 */
async function deriveDeadline(
  tenantId: string,
  userId: string,
  details: GoalDetails,
): Promise<{ ok: true; deadline: Date | null } | { ok: false; error: string }> {
  const personal = await readUserPersonalProfile(tenantId, userId);
  const dob = personal?.dateOfBirth ? personal.dateOfBirth.toISOString().slice(0, 10) : null;
  const resolved = resolveGoalDeadline(details, dob);
  if (resolved === null && byAgeOf(details) != null) {
    return { ok: false, error: NO_BIRTH_DATE_ERROR };
  }
  return { ok: true, deadline: resolved ? new Date(resolved) : null };
}

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

  const resolvedCategory = category || "savings";
  // Details are validated against the goal's own category before anything is
  // written, so a mismatch is a 400 that leaves the database untouched.
  const parsedDetails = parseGoalDetails(resolvedCategory, body.details);
  if (!parsedDetails.ok) {
    return c.json({ error: parsedDetails.error }, 400);
  }
  // When a goal describes itself, its target is computed, never taken on trust
  // from the client — so every existing reader of targetAmount stays correct.
  const computed = resolveGoalTarget(resolvedCategory, parsedDetails.details);
  const effectiveTarget = computed ? computed.target : targetAmount;

  if (!name || !effectiveTarget) {
    return c.json({ error: "name and targetAmount are required" }, 400);
  }
  if (!(Number(effectiveTarget) > 0)) {
    return c.json({ error: "targetAmount must be greater than zero" }, 400);
  }

  // Same for the date: a described goal's deadline comes from the description,
  // so it can never contradict the age or date stored beside it.
  let effectiveDeadline = deadline ? new Date(deadline) : undefined;
  if (parsedDetails.details) {
    const derived = await deriveDeadline(session.tenantId, session.userId, parsedDetails.details);
    if (!derived.ok) {
      return c.json({ error: derived.error }, 400);
    }
    effectiveDeadline = derived.deadline ?? undefined;
  }

  const [goal] = await db
    .insert(goals)
    .values({
      tenantId: session.tenantId,
      name,
      description: description ?? null,
      targetAmount: String(effectiveTarget),
      details: parsedDetails.details,
      monthlyContribution:
        Number(monthlyContribution) > 0 ? String(monthlyContribution) : undefined,
      deadline: effectiveDeadline,
      category: resolvedCategory,
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

// GET /spend-baseline - The monthly spend an emergency-fund goal is priced from.
// Reads the one shared definition the priorities ladder uses, so the months the
// user picks here and the months the ladder shows can never disagree.
goalRoutes.get("/spend-baseline", async (c) => {
  const session = c.get("session");
  const { stableMonthlyExpenses } = await readMonthlySpend(session.tenantId);
  return c.json({
    monthlySpend: stableMonthlyExpenses,
    windowMonths: STABLE_SPEND_MONTHS,
  });
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

  // Details are validated against this goal's category and rejected with a 400
  // before anything is written.
  let nextDetails: ReturnType<typeof parseGoalDetails> | null = null;
  let computed: ReturnType<typeof resolveGoalTarget> = null;
  // Whether this goal now describes itself, and the date that description
  // implies. `undefined` while described means "keep the date already stored".
  let describesItself = false;
  let derivedDeadline: Date | null | undefined;
  if (body.details !== undefined) {
    const parsedDetails = parseGoalDetails(existing.category, body.details);
    if (!parsedDetails.ok) {
      return c.json({ error: parsedDetails.error }, 400);
    }
    nextDetails = parsedDetails;
    computed = resolveGoalTarget(existing.category, parsedDetails.details);
    if (parsedDetails.details) {
      describesItself = true;
      const derived = await deriveDeadline(session.tenantId, session.userId, parsedDetails.details);
      if (derived.ok) {
        derivedDeadline = derived.deadline;
      } else if (byAgeOf(parsedDetails.details) !== byAgeOf(existing.details)) {
        return c.json({ error: derived.error }, 400);
      }
      // Otherwise the goal was already saved at this age and the date it was
      // saved with still describes it, so a birth date removed since must not
      // make the goal unsaveable. Only a changed age needs one.
    }
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
  if (nextDetails?.ok) updates.details = nextDetails.details;
  // A described goal's target is always recomputed, so it can't drift from the
  // description that justifies it.
  if (computed) updates.targetAmount = String(computed.target);
  else if (body.targetAmount !== undefined) updates.targetAmount = String(body.targetAmount);
  if (body.monthlyContribution !== undefined)
    updates.monthlyContribution =
      Number(body.monthlyContribution) > 0 ? String(body.monthlyContribution) : null;
  if (body.currentAmount !== undefined && !isAutoTracked)
    updates.currentAmount = String(body.currentAmount);
  if (describesItself) {
    if (derivedDeadline !== undefined) updates.deadline = derivedDeadline;
  } else if (body.deadline !== undefined) {
    updates.deadline = body.deadline ? new Date(body.deadline) : null;
  }
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
