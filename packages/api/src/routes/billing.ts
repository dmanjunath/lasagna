import { Hono } from "hono";
import { eq, countFn as count, tenants, users, accounts, maxAccounts, allowedModelLevels } from "@lasagna/core";
import { db } from "../lib/db.js";
import { getStripe, setPlanByStripeCustomer } from "../lib/stripe.js";
import { resolveTenantPlan } from "../lib/billing.js";
import { MODEL_LEVELS } from "../agent/index.js";
import { env } from "../lib/env.js";
import { type AuthEnv } from "../middleware/auth.js";

export const billingRoutes = new Hono<AuthEnv>();

billingRoutes.get("/status", async (c) => {
  const session = c.get("session");
  const plan = await resolveTenantPlan(session.tenantId);
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, session.tenantId),
    columns: { subscriptionStatus: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
  });
  const [{ value: accountCount }] = await db
    .select({ value: count() })
    .from(accounts)
    .where(eq(accounts.tenantId, session.tenantId));

  return c.json({
    plan,
    subscriptionStatus: tenant?.subscriptionStatus ?? null,
    currentPeriodEnd: tenant?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: tenant?.cancelAtPeriodEnd ?? false,
    usage: { accounts: Number(accountCount), maxAccounts: maxAccounts(plan) },
    models: {
      allowed: allowedModelLevels(plan, MODEL_LEVELS as readonly string[]),
      all: MODEL_LEVELS as readonly string[],
    },
  });
});

billingRoutes.post("/checkout", async (c) => {
  const session = c.get("session");
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_PRO_MONTHLY) {
    return c.json({ error: "Billing is not configured" }, 503);
  }

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, session.tenantId) });
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  try {
    const stripe = getStripe();
    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
        columns: { email: true },
      });
      const customer = await stripe.customers.create(
        { email: user?.email, metadata: { tenantId: session.tenantId } },
        // Idempotency key dedupes the create if two checkouts race for a tenant
        // that has no customer yet (within Stripe's 24h key window).
        { idempotencyKey: `customer-${session.tenantId}` },
      );
      customerId = customer.id;
      await db.update(tenants).set({ stripeCustomerId: customerId }).where(eq(tenants.id, session.tenantId));
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: env.STRIPE_PRICE_PRO_MONTHLY, quantity: 1 }],
      success_url: `${env.APP_URL}/profile?upgraded=1`,
      cancel_url: `${env.APP_URL}/profile`,
    });
    return c.json({ url: checkout.url });
  } catch (e) {
    console.error("[Stripe] checkout create failed:", e instanceof Error ? e.message : e);
    return c.json({ error: "Could not start checkout. Please try again." }, 502);
  }
});

billingRoutes.post("/portal", async (c) => {
  const session = c.get("session");
  if (!env.STRIPE_SECRET_KEY) return c.json({ error: "Billing is not configured" }, 503);

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, session.tenantId),
    columns: { stripeCustomerId: true },
  });
  if (!tenant?.stripeCustomerId) return c.json({ error: "No subscription found" }, 400);

  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${env.APP_URL}/profile`,
    });
    return c.json({ url: portal.url });
  } catch (e) {
    console.error("[Stripe] portal create failed:", e instanceof Error ? e.message : e);
    return c.json({ error: "Could not open the billing portal. Please try again." }, 502);
  }
});

billingRoutes.post("/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig || !env.STRIPE_WEBHOOK_SECRET) return c.json({ error: "Missing signature" }, 400);

  const raw = await c.req.text(); // RAW body — required for signature verification
  let event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[Stripe] Webhook signature verification failed:", e instanceof Error ? e.message : e);
    return c.json({ error: "Invalid signature" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as any;
      if (s.customer) {
        await setPlanByStripeCustomer(String(s.customer), "pro", {
          subscriptionId: s.subscription ? String(s.subscription) : null,
        });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as any;
      // Keep Pro entitlement through dunning (`past_due`) — Stripe is still
      // retrying payment. Only terminal statuses (canceled/unpaid/incomplete_
      // expired) downgrade here; full cancellation also arrives as `deleted`.
      const ENTITLED = ["active", "trialing", "past_due"];
      const entitled = ENTITLED.includes(sub.status);
      // current_period_end is top-level on older Stripe API versions and on the
      // subscription item on newer ones — read both.
      const periodEndUnix = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
      // Newer Stripe uses `cancel_at` (a timestamp) instead of the
      // `cancel_at_period_end` boolean — treat either as "scheduled to cancel".
      const cancelAtPeriodEnd = sub.cancel_at_period_end === true || sub.cancel_at != null;
      // NOTE: Stripe does not guarantee event ordering. A stale entitled
      // `updated` arriving after a `deleted` could resurrect Pro. Acceptable
      // for now; a hard guard would require persisting the last event timestamp.
      await setPlanByStripeCustomer(String(sub.customer), entitled ? "pro" : "free", {
        subscriptionId: String(sub.id),
        status: String(sub.status),
        periodEndUnix,
        cancelAtPeriodEnd,
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as any;
      await setPlanByStripeCustomer(String(sub.customer), "free", {
        subscriptionId: String(sub.id),
        status: "canceled",
      });
      break;
    }
  }

  return c.json({ received: true });
});
