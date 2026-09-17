/**
 * The two brakes on plan regeneration, which is the most expensive thing this
 * product does: a full strategy section, including two frontier-tier
 * verification calls, plus the whole deterministic engine underneath it.
 *
 *  1. A BUDGET of two attempts per tenant per rolling 24 hours, counted in
 *     Postgres so it survives a restart and holds across instances.
 *  2. An IN-FLIGHT claim per plan, so two overlapping requests for the same
 *     plan do the work once instead of twice.
 *
 * Both are claimed by the callers that reach the generation path, before the
 * work starts, rather than inside the generators. The caller is the only place
 * that knows how to answer a refusal: an HTTP route returns a status, and the
 * chat tool returns a sentence for the model to relay.
 */

import {
  and,
  eq,
  gte,
  lte,
  ne,
  or,
  isNull,
  desc,
  sql,
  financialPlans,
  planRegenerationAttempts,
} from "@lasagna/core";
import { db } from "./db.js";

/** Attempts a tenant may spend inside the window. */
export const PLAN_REGEN_LIMIT = 2;

/**
 * Rolling, not calendar. A calendar day would hand everyone a fresh budget at
 * midnight, so the cheapest way to get four runs would be to wait for it.
 */
export const PLAN_REGEN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How long an in-flight structured regeneration may run before a later request
 * treats it as dead. Mirrors FREEFORM_STALE_MS on the freeform side: without it
 * a process that dies mid-run would lock the plan behind the guard forever.
 */
export const STRUCTURED_RUN_STALE_MS = 25 * 60 * 1000;

/**
 * Every caller that reaches the expensive generation path. Recorded on the
 * attempt row so an operator can see what spent a locked-out tenant's budget.
 */
export type PlanRegenSource =
  | "plan-create"
  | "plan-assumptions"
  | "chat-assumptions"
  | "freeform-create"
  | "freeform-feedback"
  | "freeform-regenerate";

export interface PlanRegenDenial {
  /** What the user is shown. */
  error: string;
  code: "rate_limited";
  /** When the budget next frees up, for a client that wants to format its own. */
  retryAfter: string;
}

/** "September 18 at 9:05 AM", the format the path copy already uses. */
function formatRetryAt(at: Date): string {
  return at.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * What the user reads. It has to carry three things, because a rate limit that
 * withholds any of them reads as a bug: what the rule is, that a FAILED run
 * spent an attempt (otherwise being locked out by two failures looks like the
 * product losing their money), and a real time rather than "later".
 */
function denialMessage(retryAt: Date): string {
  return (
    `Your household can build or update a plan twice every 24 hours, and both attempts have been used. ` +
    `A failed attempt still counts, because the work runs either way. ` +
    `You can try again after ${formatRetryAt(retryAt)} UTC.`
  );
}

/**
 * Spend one of this tenant's attempts, or refuse.
 *
 * Returns null when the attempt was claimed (and recorded), or a denial to
 * hand back to the user. The row is written BEFORE the caller does the work,
 * which is the whole design: an attempt that then fails has still been spent,
 * because the tokens were still bought.
 *
 * Claim and count run inside one transaction behind a tenant-scoped advisory
 * lock, the same device insights.ts uses to keep concurrent reads from
 * double-generating. Without it two simultaneous requests both read a count of
 * one and both insert, and the budget silently becomes three. The lock is
 * xact-scoped, so it releases on commit or rollback and cannot leak. Its key
 * space is namespaced by the literal below so it can never collide with the
 * tenant-keyed lock insights.ts takes.
 */
export async function claimPlanRegeneration(
  tenantId: string,
  source: PlanRegenSource,
): Promise<PlanRegenDenial | null> {
  return db.transaction(async (tx) => {
    // Two-argument form, so the namespace and the tenant hash are separate
    // ints and this lock shares no key space with the tenant-keyed one in
    // insights.ts.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('plan-regen'), hashtext(${tenantId}))`,
    );

    const windowStart = new Date(Date.now() - PLAN_REGEN_WINDOW_MS);
    const recent = await tx
      .select({ createdAt: planRegenerationAttempts.createdAt })
      .from(planRegenerationAttempts)
      .where(
        and(
          eq(planRegenerationAttempts.tenantId, tenantId),
          gte(planRegenerationAttempts.createdAt, windowStart),
        ),
      )
      .orderBy(desc(planRegenerationAttempts.createdAt))
      .limit(PLAN_REGEN_LIMIT);

    if (recent.length < PLAN_REGEN_LIMIT) {
      await tx.insert(planRegenerationAttempts).values({ tenantId, source });
      return null;
    }

    // The budget frees up when the OLDEST of the attempts still inside the
    // window rolls out of it, which is the last row of the newest `limit`.
    const oldestHeld = recent[recent.length - 1]!.createdAt;
    const retryAt = new Date(new Date(oldestHeld).getTime() + PLAN_REGEN_WINDOW_MS);
    return {
      error: denialMessage(retryAt),
      code: "rate_limited" as const,
      retryAfter: retryAt.toISOString(),
    };
  });
}

/**
 * Take the in-flight claim on a structured plan, returning false when another
 * run already holds it.
 *
 * One conditional UPDATE, so two concurrent requests cannot both win: Postgres
 * serializes the row write, and the loser's WHERE no longer matches. A claim
 * older than STRUCTURED_RUN_STALE_MS is treated as dead and taken over, which
 * is what keeps a process death from locking the plan out permanently.
 */
export async function beginStructuredRun(
  tenantId: string,
  userId: string,
  planId: string,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STRUCTURED_RUN_STALE_MS);
  const claimed = await db
    .update(financialPlans)
    .set({ regenStartedAt: new Date() })
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
        or(
          isNull(financialPlans.regenStartedAt),
          lte(financialPlans.regenStartedAt, staleBefore),
        ),
      ),
    )
    .returning({ id: financialPlans.id });
  return claimed.length > 0;
}

/**
 * Release the in-flight claim. Call it in a `finally`: a run that throws still
 * has to hand the plan back, or the next request waits out the staleness window
 * for nothing.
 */
export async function endStructuredRun(
  tenantId: string,
  userId: string,
  planId: string,
): Promise<void> {
  await db
    .update(financialPlans)
    .set({ regenStartedAt: null })
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
      ),
    );
}
