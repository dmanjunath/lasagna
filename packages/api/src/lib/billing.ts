import { db } from "./db.js";
import { eq, and, tenants, users, type Plan } from "@lasagna/core";

/**
 * The canonical effective-plan resolver used by every gate.
 * Demo tenants (any user with isDemo) always resolve to "pro" so demos
 * exercise the full product. Otherwise the stored tenants.plan is authoritative.
 */
export async function resolveTenantPlan(tenantId: string): Promise<Plan> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { plan: true },
  });
  const plan = (tenant?.plan ?? "free") as Plan;
  if (plan === "pro") return "pro";

  const demoUser = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.isDemo, true)),
    columns: { id: true },
  });
  return demoUser ? "pro" : "free";
}
