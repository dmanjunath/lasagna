import { Hono } from "hono";
import { eq, sql, desc, users, tenants, accounts, activityEvents, plaidItems, balanceSnapshots } from "@lasagna/core";
import { db } from "../lib/db.js";
import { resolveTenantPlan, classifyPlanSource, type PlanSource } from "../lib/billing.js";
import { recomputeFrozenAccounts } from "../lib/account-limits.js";
import { type AuthEnv } from "../middleware/auth.js";
import * as workos from "../lib/auth/workos.js";
import { authMode } from "../lib/auth/mode.js";
import { env } from "../lib/env.js";

export const adminRoutes = new Hono<AuthEnv>();

// Admin gate: the session must carry isAdmin AND must not be a demo session.
// (The global demo guard passes GETs through, so admin routes enforce the
// demo exclusion themselves rather than assuming it.)
adminRoutes.use("*", async (c, next) => {
  const session = c.get("session");
  if (!session || session.isDemo) {
    return c.json({ error: "Forbidden" }, 403);
  }
  // isAdmin lives in the DB, not the stateless token, so grants and
  // revocations take effect immediately instead of at the next login.
  const me = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { isAdmin: true, isDemo: true },
  });
  if (!me?.isAdmin || me.isDemo) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return next();
});

// Malformed ids would otherwise 500 on the postgres uuid cast.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Operator metrics: every user with signup/last-login, effective plan +
// source, and connected-account count. Small dataset — computed on demand.
// Deliberately NO Stripe details (billing is managed in Stripe directly).
adminRoutes.get("/users", async (c) => {
  const rows = await db
    .select({
      userId: users.id,
      tenantId: users.tenantId,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      isDemo: users.isDemo,
      isAdmin: users.isAdmin,
      plan: tenants.plan,
      compedUntil: tenants.compedUntil,
      disabledAt: tenants.disabledAt,
      accountCount: sql<number>`(select count(*)::int from ${accounts} a where a.tenant_id = ${users.tenantId})`,
      tenantHasDemoUser: sql<boolean>`exists(select 1 from ${users} u2 where u2.tenant_id = ${users.tenantId} and u2.is_demo)`,
    })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .orderBy(desc(users.createdAt));

  // 30d spend per tenant, so cost is visible without opening each detail page.
  const spendRows = await db
    .select({
      tenantId: activityEvents.tenantId,
      cost: sql<string>`coalesce(sum(${activityEvents.costUsd}), 0)`,
    })
    .from(activityEvents)
    .where(sql`${activityEvents.createdAt} >= now() - interval '30 days' and ${activityEvents.tenantId} is not null`)
    .groupBy(activityEvents.tenantId);
  const spendByTenant = new Map(spendRows.map((r) => [r.tenantId, r.cost]));

  const userRows = rows.map((r) => {
    const planSource: PlanSource = classifyPlanSource({
      plan: r.plan,
      compedUntil: r.compedUntil,
      hasDemoUser: r.tenantHasDemoUser,
    });
    return {
      userId: r.userId,
      tenantId: r.tenantId,
      email: r.email,
      name: r.name,
      createdAt: r.createdAt,
      lastLoginAt: r.lastLoginAt,
      isDemo: r.isDemo,
      isAdmin: r.isAdmin,
      effectivePlan: planSource === "free" ? "free" : "pro",
      planSource,
      compedUntil: r.compedUntil,
      disabledAt: r.disabledAt,
      accountCount: r.accountCount,
      spend30d: spendByTenant.get(r.tenantId) ?? "0",
    };
  });

  // Totals classify each TENANT once (a multi-user tenant shouldn't double
  // its plan or its account count), by the same precedence as the resolver.
  const byTenant = new Map<string, (typeof userRows)[number]>();
  for (const r of userRows) if (!byTenant.has(r.tenantId)) byTenant.set(r.tenantId, r);
  const tenantRows = [...byTenant.values()];
  const totals = {
    users: userRows.length,
    paid: tenantRows.filter((r) => r.planSource === "paid").length,
    comped: tenantRows.filter((r) => r.planSource === "comped").length,
    demo: tenantRows.filter((r) => r.planSource === "demo").length,
    free: tenantRows.filter((r) => r.planSource === "free").length,
    connectedAccounts: tenantRows.reduce((s, r) => s + r.accountCount, 0),
  };

  return c.json({ totals, users: userRows });
});

// Comp a tenant to Pro for `days` (365 = 1 year). days=0 revokes. The stored
// tenants.plan is never touched — comps only set comped_until, which
// resolveTenantPlan reads and which lapses on its own.
adminRoutes.post("/tenants/:tenantId/comp", async (c) => {
  const tenantId = c.req.param("tenantId");
  if (!UUID_RE.test(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const body = await c.req.json<{ days?: number }>().catch(() => ({}) as { days?: number });
  const days = body.days;

  if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 3650) {
    return c.json({ error: "days must be an integer between 0 and 3650" }, 400);
  }

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  const compedUntil = days === 0 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await db.update(tenants).set({ compedUntil }).where(eq(tenants.id, tenantId));

  // Unfreeze immediately on grant / refreeze on revoke. (Natural expiry
  // refreezes lazily at the tenant's next sync, which also recomputes.)
  const effectivePlan = await resolveTenantPlan(tenantId);
  await recomputeFrozenAccounts(tenantId, effectivePlan);

  return c.json({ ok: true, tenantId, compedUntil, effectivePlan });
});

// Pause / resume a tenant. While disabled, account sync and insights
// generation are skipped (gated in syncItem + generateInsights). Login and
// read access still work.
adminRoutes.post("/tenants/:tenantId/disable", async (c) => {
  const session = c.get("session");
  const tenantId = c.req.param("tenantId");
  if (!UUID_RE.test(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const body = await c.req.json<{ disabled?: boolean }>().catch(() => ({}) as { disabled?: boolean });

  if (typeof body.disabled !== "boolean") {
    return c.json({ error: "disabled must be a boolean" }, 400);
  }
  if (tenantId === session.tenantId && body.disabled) {
    return c.json({ error: "You cannot disable your own tenant" }, 400);
  }
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  const disabledAt = body.disabled ? new Date() : null;
  await db.update(tenants).set({ disabledAt }).where(eq(tenants.id, tenantId));
  return c.json({ ok: true, tenantId, disabledAt });
});

// ── Edit a user (name / email / admin status) ───────────────────────────────
adminRoutes.patch("/users/:userId", async (c) => {
  const session = c.get("session");
  const userId = c.req.param("userId");
  if (!UUID_RE.test(userId)) return c.json({ error: "User not found" }, 404);
  const body = await c.req
    .json<{ name?: string | null; email?: string; isAdmin?: boolean }>()
    .catch(() => ({}) as { name?: string | null; email?: string; isAdmin?: boolean });

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  const patch: { name?: string | null; email?: string; isAdmin?: boolean } = {};

  if (body.name !== undefined) {
    const trimmed = typeof body.name === "string" ? body.name.trim() : "";
    patch.name = trimmed || null;
  }

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: "Invalid email address" }, 400);
    }
    // WorkOS-linked identities are matched by email as a fallback — changing
    // the local email would fork a duplicate user on their next login.
    if (user.workosUserId && email !== user.email) {
      return c.json({ error: "This user signs in via WorkOS/Google — change their email there, not here" }, 400);
    }
    if (email !== user.email) {
      const taken = await db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true } });
      if (taken) return c.json({ error: "That email is already in use" }, 409);
    }
    patch.email = email;
  }

  if (body.isAdmin !== undefined) {
    if (userId === session.userId) {
      return c.json({ error: "You cannot change your own admin status" }, 400);
    }
    if (body.isAdmin && user.isDemo) {
      return c.json({ error: "Demo users cannot be admins" }, 400);
    }
    patch.isAdmin = body.isAdmin;
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "Nothing to update" }, 400);
  }

  const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  return c.json({
    ok: true,
    user: { id: updated.id, email: updated.email, name: updated.name, isAdmin: updated.isAdmin },
  });
});

// ── Auth actions ─────────────────────────────────────────────────────────────
// Send a WorkOS password-reset email. Only meaningful for WorkOS-linked users.
adminRoutes.post("/users/:userId/password-reset", async (c) => {
  const userId = c.req.param("userId");
  if (!UUID_RE.test(userId)) return c.json({ error: "User not found" }, 404);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: "User not found" }, 404);
  if (authMode() !== "workos") {
    return c.json({ error: "Password reset requires WorkOS auth mode, which is not configured on this server" }, 400);
  }
  if (!user.workosUserId) {
    return c.json({ error: "This user is not WorkOS-linked — no reset email can be sent" }, 400);
  }
  try {
    await workos.sendPasswordReset({ email: user.email });
  } catch (err) {
    return c.json({ error: workos.friendlyError(err, "Could not send the reset email") }, 400);
  }
  return c.json({ ok: true });
});

// "Sign out everywhere": tokens issued before this moment die at the next
// request (checked in requireAuth). Self-targeting is allowed — the UI warns.
adminRoutes.post("/users/:userId/revoke-sessions", async (c) => {
  const userId = c.req.param("userId");
  if (!UUID_RE.test(userId)) return c.json({ error: "User not found" }, 404);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true } });
  if (!user) return c.json({ error: "User not found" }, 404);
  const sessionsRevokedAt = new Date();
  await db.update(users).set({ sessionsRevokedAt }).where(eq(users.id, userId));
  return c.json({ ok: true, sessionsRevokedAt });
});

// ── Spend reporting ──────────────────────────────────────────────────────────
// Aggregates activity_events over a window: totals, a daily series, and
// breakdowns by source, model, and tenant. Estimated $ (see lib/activity.ts).
adminRoutes.get("/spend", async (c) => {
  const days = Math.min(365, Math.max(1, parseInt(c.req.query("days") ?? "30", 10) || 30));
  // ISO string, not a Date: raw sql`` params must be driver-serializable.
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [totalsRow] = await db
    .select({
      llmCost: sql<string>`coalesce(sum(${activityEvents.costUsd}) filter (where ${activityEvents.kind} = 'llm'), 0)`,
      plaidCost: sql<string>`coalesce(sum(${activityEvents.costUsd}) filter (where ${activityEvents.kind} = 'plaid'), 0)`,
      llmCalls: sql<number>`count(*) filter (where ${activityEvents.kind} = 'llm')::int`,
      plaidEvents: sql<number>`count(*) filter (where ${activityEvents.kind} = 'plaid')::int`,
      inputTokens: sql<number>`coalesce(sum(${activityEvents.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${activityEvents.outputTokens}), 0)::int`,
    })
    .from(activityEvents)
    .where(sql`${activityEvents.createdAt} >= ${since}`);

  const series = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${activityEvents.createdAt} at time zone 'utc'), 'YYYY-MM-DD')`,
      llmCost: sql<string>`coalesce(sum(${activityEvents.costUsd}) filter (where ${activityEvents.kind} = 'llm'), 0)`,
      plaidCost: sql<string>`coalesce(sum(${activityEvents.costUsd}) filter (where ${activityEvents.kind} = 'plaid'), 0)`,
      events: sql<number>`count(*)::int`,
    })
    .from(activityEvents)
    .where(sql`${activityEvents.createdAt} >= ${since}`)
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const bySource = await db
    .select({
      kind: activityEvents.kind,
      source: activityEvents.source,
      cost: sql<string>`sum(${activityEvents.costUsd})`,
      events: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${activityEvents.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${activityEvents.outputTokens}), 0)::int`,
    })
    .from(activityEvents)
    .where(sql`${activityEvents.createdAt} >= ${since}`)
    .groupBy(activityEvents.kind, activityEvents.source)
    .orderBy(sql`3 desc`);

  const byModel = await db
    .select({
      model: activityEvents.model,
      cost: sql<string>`sum(${activityEvents.costUsd})`,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${activityEvents.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${activityEvents.outputTokens}), 0)::int`,
    })
    .from(activityEvents)
    .where(sql`${activityEvents.createdAt} >= ${since} and ${activityEvents.kind} = 'llm'`)
    .groupBy(activityEvents.model)
    .orderBy(sql`2 desc`);

  // Cost per tenant — the "cost per account" view. Deleted tenants show as null.
  const byTenant = await db
    .select({
      tenantId: activityEvents.tenantId,
      tenantName: sql<string | null>`min(${tenants.name})`,
      email: sql<string | null>`(select min(u.email) from ${users} u where u.tenant_id = ${activityEvents.tenantId})`,
      llmCost: sql<string>`coalesce(sum(${activityEvents.costUsd}) filter (where ${activityEvents.kind} = 'llm'), 0)`,
      plaidCost: sql<string>`coalesce(sum(${activityEvents.costUsd}) filter (where ${activityEvents.kind} = 'plaid'), 0)`,
      events: sql<number>`count(*)::int`,
    })
    .from(activityEvents)
    .leftJoin(tenants, eq(activityEvents.tenantId, tenants.id))
    .where(sql`${activityEvents.createdAt} >= ${since}`)
    .groupBy(activityEvents.tenantId)
    .orderBy(sql`sum(${activityEvents.costUsd}) desc`)
    .limit(50);

  return c.json({ days, totals: totalsRow, series, bySource, byModel, byTenant });
});

// ── Tenant detail (drawer) ───────────────────────────────────────────────────
adminRoutes.get("/tenants/:tenantId/detail", async (c) => {
  const session = c.get("session");
  const tenantId = c.req.param("tenantId");
  if (!UUID_RE.test(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  const tenantUsers = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      isDemo: users.isDemo,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      // Email edits are blocked for WorkOS-linked identities (matched by email
      // fallback at login — a local change would fork a duplicate user).
      hasWorkosIdentity: sql<boolean>`${users.workosUserId} is not null`,
    })
    .from(users)
    .where(eq(users.tenantId, tenantId));

  const items = await db
    .select({ id: plaidItems.id, institutionName: plaidItems.institutionName, status: plaidItems.status, lastSyncedAt: plaidItems.lastSyncedAt })
    .from(plaidItems)
    .where(eq(plaidItems.tenantId, tenantId));

  const accts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      frozen: accounts.frozen,
      balance: sql<string | null>`(select bs.balance from ${balanceSnapshots} bs where bs.account_id = ${accounts.id} order by bs.snapshot_at desc limit 1)`,
    })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId));

  const recentActivity = await db
    .select({ kind: activityEvents.kind, source: activityEvents.source, model: activityEvents.model, costUsd: activityEvents.costUsd, createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(eq(activityEvents.tenantId, tenantId))
    .orderBy(desc(activityEvents.createdAt))
    .limit(20);

  const [spend30d] = await db
    .select({
      llmCost: sql<string>`coalesce(sum(${activityEvents.costUsd}) filter (where ${activityEvents.kind} = 'llm'), 0)`,
      plaidCost: sql<string>`coalesce(sum(${activityEvents.costUsd}) filter (where ${activityEvents.kind} = 'plaid'), 0)`,
    })
    .from(activityEvents)
    .where(sql`${activityEvents.tenantId} = ${tenantId} and ${activityEvents.createdAt} >= now() - interval '30 days'`);

  // Same plan classification as the list page, so the chips can't disagree.
  const planSource = classifyPlanSource({
    plan: tenant.plan,
    compedUntil: tenant.compedUntil,
    hasDemoUser: tenantUsers.some((u) => u.isDemo),
  });

  // Deep-link into the Stripe dashboard; null when Stripe isn't configured or
  // the tenant never started checkout.
  const stripe =
    tenant.stripeCustomerId && env.STRIPE_SECRET_KEY
      ? {
          customerId: tenant.stripeCustomerId,
          subscriptionId: tenant.stripeSubscriptionId,
          dashboardUrl: env.STRIPE_SECRET_KEY.startsWith("sk_test_")
            ? "https://dashboard.stripe.com/test"
            : "https://dashboard.stripe.com",
        }
      : null;

  return c.json({
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, planSource, compedUntil: tenant.compedUntil, disabledAt: tenant.disabledAt, createdAt: tenant.createdAt },
    isSelf: tenantId === session.tenantId,
    stripe,
    authMode: authMode(),
    users: tenantUsers,
    plaidItems: items,
    accounts: accts,
    recentActivity,
    spend30d,
  });
});

// ── Delete tenant (destructive; cascades all data) ──────────────────────────
adminRoutes.delete("/tenants/:tenantId", async (c) => {
  const session = c.get("session");
  const tenantId = c.req.param("tenantId");
  if (!UUID_RE.test(tenantId)) return c.json({ error: "Tenant not found" }, 404);

  if (tenantId === session.tenantId) {
    return c.json({ error: "You cannot delete your own tenant" }, 400);
  }
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  // Refuse to delete operators — clear the admin flag first if truly intended.
  const adminUser = await db.query.users.findFirst({
    where: sql`${users.tenantId} = ${tenantId} and ${users.isAdmin} = true`,
    columns: { id: true },
  });
  if (adminUser) {
    return c.json({ error: "Tenant has an admin user — cannot delete" }, 400);
  }

  // Cascades users/accounts/etc. activity_events keep their rows (tenant_id
  // SET NULL) so spend history survives.
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  return c.json({ ok: true, deleted: tenantId });
});
