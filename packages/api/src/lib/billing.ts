import { db } from "./db.js";
import { eq, and, tenants, users, type Plan } from "@lasagna/core";

/**
 * The canonical effective-plan resolver used by every gate.
 * Precedence: paid (stored plan) > comped (comped_until in the future) >
 * demo > free. Comps auto-expire at read time — no cron. Demo tenants (any
 * user with isDemo) resolve to "pro" so demos exercise the full product.
 * The stored tenants.plan stays Stripe-authoritative; comps never touch it.
 */
export async function resolveTenantPlan(tenantId: string): Promise<Plan> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { plan: true, compedUntil: true },
  });
  const plan = (tenant?.plan ?? "free") as Plan;
  if (plan === "pro") return "pro";
  if (tenant?.compedUntil && tenant.compedUntil.getTime() > Date.now()) return "pro";

  const demoUser = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.isDemo, true)),
    columns: { id: true },
  });
  return demoUser ? "pro" : "free";
}

/**
 * Admin pause: while tenants.disabled_at is set, account sync and insights
 * generation are skipped (login and read access still work). Checked at the
 * two choke points every sync/insight path funnels through.
 */
export async function isTenantDisabled(tenantId: string): Promise<boolean> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { disabledAt: true },
  });
  return tenant?.disabledAt != null;
}

/**
 * Why the tenant resolves to its effective plan — for admin display and
 * totals classification. Same precedence as resolveTenantPlan.
 */
export type PlanSource = "paid" | "comped" | "demo" | "free";

export function classifyPlanSource(row: {
  plan: string;
  compedUntil: Date | null;
  hasDemoUser: boolean;
}): PlanSource {
  if (row.plan === "pro") return "paid";
  if (row.compedUntil && row.compedUntil.getTime() > Date.now()) return "comped";
  if (row.hasDemoUser) return "demo";
  return "free";
}

/**
 * Checkout return URLs. Native (Capacitor) checkouts land on /billing/success —
 * a universal link that reopens the app; web checkouts keep the original
 * /profile round-trip.
 */
export function checkoutReturnUrls(appUrl: string, native: boolean): { successUrl: string; cancelUrl: string } {
  if (native) {
    return {
      successUrl: `${appUrl}/billing/success`,
      cancelUrl: `${appUrl}/billing/success?canceled=1`,
    };
  }
  return {
    successUrl: `${appUrl}/profile?upgraded=1`,
    cancelUrl: `${appUrl}/profile`,
  };
}
