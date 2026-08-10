import Stripe from "stripe";
import { db } from "./db.js";
import { eq, tenants, type Plan } from "@lasagna/core";
import { resolveTenantPlan } from "./billing.js";
import { recomputeFrozenAccounts } from "./account-limits.js";
import { env } from "./env.js";

// Lazily constructed so the server can boot without STRIPE_SECRET_KEY (the
// billing routes return 503 when unconfigured). `new Stripe("")` throws, so we
// must NOT construct at module load.
let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

/**
 * Apply a Stripe-driven plan change to the tenant identified by its Stripe
 * customer id, then recompute account freezes (downgrade freezes, upgrade
 * unfreezes). Idempotent — safe for redelivered webhooks.
 */
export async function setPlanByStripeCustomer(
  customerId: string,
  plan: Plan,
  extra: { subscriptionId?: string | null; status?: string | null; periodEndUnix?: number | null; cancelAtPeriodEnd?: boolean } = {},
): Promise<void> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.stripeCustomerId, customerId),
    columns: { id: true, stripeSubscriptionId: true, currentPeriodEnd: true },
  });
  if (!tenant) {
    console.warn(`[Stripe] No tenant for customer ${customerId}`);
    return;
  }

  await db
    .update(tenants)
    .set({
      plan,
      subscriptionStatus: extra.status ?? (plan === "pro" ? "active" : "canceled"),
      stripeSubscriptionId: extra.subscriptionId ?? tenant.stripeSubscriptionId,
      currentPeriodEnd: extra.periodEndUnix
        ? new Date(extra.periodEndUnix * 1000)
        : tenant.currentPeriodEnd,
      cancelAtPeriodEnd: extra.cancelAtPeriodEnd ?? false,
    })
    .where(eq(tenants.id, tenant.id));

  const effective = await resolveTenantPlan(tenant.id);
  await recomputeFrozenAccounts(tenant.id, effective);
}
