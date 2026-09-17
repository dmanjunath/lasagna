import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The two brakes on plan regeneration, driven against a Postgres double.
 *
 * What these have to hold is not "the happy path works" but the cases that
 * decide whether the limit is worth having: the THIRD attempt inside the window
 * is refused, the first attempt after the window rolls is allowed, a FAILED run
 * spent its attempt, the budget belongs to the tenant rather than the user, and
 * none of it lives in this process.
 */

// ── Core mock: operator markers the fake db reconstructs predicates from ──────
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  ne: (...args: unknown[]) => ["ne", ...args],
  gte: (...args: unknown[]) => ["gte", ...args],
  lte: (...args: unknown[]) => ["lte", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  or: (...args: unknown[]) => ["or", ...args],
  isNull: (...args: unknown[]) => ["isNull", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?"),
    values,
  }),
  financialPlans: {
    id: "financialPlans.id",
    tenantId: "financialPlans.tenantId",
    userId: "financialPlans.userId",
    status: "financialPlans.status",
    regenStartedAt: "financialPlans.regenStartedAt",
  },
  planRegenerationAttempts: {
    tenantId: "planRegenerationAttempts.tenantId",
    source: "planRegenerationAttempts.source",
    createdAt: "planRegenerationAttempts.createdAt",
  },
}));

// ── The stand-in database ────────────────────────────────────────────────────
// Rows live in module-level arrays that OUTLIVE a module reset of the code under
// test, which is what lets the restart case below mean something: re-importing
// the guard gives it a fresh module scope and the same stored rows.
interface AttemptRow {
  tenantId: string;
  source: string;
  createdAt: Date;
}
interface PlanRow {
  id: string;
  tenantId: string;
  userId: string;
  status: string;
  regenStartedAt: Date | null;
}
const attempts: AttemptRow[] = [];
const plans: PlanRow[] = [];
/** Every statement handed to tx.execute, so the lock can be asserted. */
const executed: { text: string; values: unknown[] }[] = [];

/** Evaluate one of the operator markers above against a row. */
function matches(node: unknown, row: Record<string, unknown>): boolean {
  if (!Array.isArray(node)) return true;
  const [op, ...rest] = node as [string, ...unknown[]];
  const field = (col: unknown) => row[String(col).split(".")[1]!];
  switch (op) {
    case "and":
      return rest.every((child) => matches(child, row));
    case "or":
      return rest.some((child) => matches(child, row));
    case "eq":
      return field(rest[0]) === rest[1];
    case "ne":
      return field(rest[0]) !== rest[1];
    case "isNull":
      return field(rest[0]) == null;
    case "gte": {
      const v = field(rest[0]);
      return v instanceof Date && v.getTime() >= (rest[1] as Date).getTime();
    }
    case "lte": {
      const v = field(rest[0]);
      return v instanceof Date && v.getTime() <= (rest[1] as Date).getTime();
    }
    default:
      return true;
  }
}

function selectChain(rows: AttemptRow[]) {
  let working = rows;
  const self = {
    from: () => self,
    where: (w: unknown) => {
      working = working.filter((r) => matches(w, r as unknown as Record<string, unknown>));
      return self;
    },
    orderBy: () => {
      working = [...working].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return self;
    },
    limit: (n: number) => Promise.resolve(working.slice(0, n)),
  };
  return self;
}

const tx = {
  execute: async (stmt: { text: string; values: unknown[] }) => {
    executed.push(stmt);
    return [];
  },
  select: () => selectChain(attempts),
  insert: () => ({
    values: async (v: { tenantId: string; source: string }) => {
      attempts.push({ ...v, createdAt: new Date() });
    },
  }),
};

vi.mock("../db.js", () => ({
  db: {
    // Serialized per call, which is what the real advisory lock buys: two
    // concurrent claims cannot interleave their count and their insert.
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: (w: unknown) => {
          const hit = plans.filter((r) => matches(w, r as unknown as Record<string, unknown>));
          for (const row of hit) Object.assign(row, vals);
          const result = Promise.resolve(hit) as Promise<PlanRow[]> & {
            returning: (p?: unknown) => Promise<PlanRow[]>;
          };
          result.returning = () => Promise.resolve(hit);
          return result;
        },
      }),
    }),
  },
}));

import {
  claimPlanRegeneration,
  beginStructuredRun,
  endStructuredRun,
  PLAN_REGEN_WINDOW_MS,
  STRUCTURED_RUN_STALE_MS,
} from "../plan-regen-guard.js";

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";
const PLAN_ID = "plan-1";

/** Put an attempt in the store at a chosen age, as an earlier run would have. */
function attemptAgedMs(tenantId: string, ageMs: number) {
  attempts.push({
    tenantId,
    source: "plan-assumptions",
    createdAt: new Date(Date.now() - ageMs),
  });
}

beforeEach(() => {
  attempts.length = 0;
  plans.length = 0;
  executed.length = 0;
  plans.push({
    id: PLAN_ID,
    tenantId: TENANT,
    userId: "user-a",
    status: "draft",
    regenStartedAt: null,
  });
});

describe("the 24 hour budget", () => {
  it("allows two attempts and refuses the third", async () => {
    expect(await claimPlanRegeneration(TENANT, "plan-create")).toBeNull();
    expect(await claimPlanRegeneration(TENANT, "plan-assumptions")).toBeNull();

    const third = await claimPlanRegeneration(TENANT, "chat-assumptions");
    expect(third).not.toBeNull();
    expect(third?.code).toBe("rate_limited");
    // The refusal does not spend an attempt of its own.
    expect(attempts).toHaveLength(2);
  });

  it("tells the user a failed attempt counted, and when the budget frees up", async () => {
    attemptAgedMs(TENANT, 0);
    attemptAgedMs(TENANT, 0);

    const denial = await claimPlanRegeneration(TENANT, "plan-create");
    expect(denial?.error).toContain("twice every 24 hours");
    expect(denial?.error).toContain("A failed attempt still counts");
    expect(denial?.error).toMatch(/You can try again after .+ UTC\./);
    // A concrete instant, not "later".
    expect(Date.parse(denial!.retryAfter)).toBeGreaterThan(Date.now());
    // Copy rules: no em dash, en dash, middot or semicolon.
    expect(denial?.error).not.toMatch(/[—–·;]/);
  });

  it("counts an attempt whose run then FAILED", async () => {
    // What a failing caller does: claim, then blow up. The claim is the record.
    const claim = await claimPlanRegeneration(TENANT, "plan-assumptions");
    expect(claim).toBeNull();
    await expect(
      (async () => {
        throw new Error("regen boom");
      })(),
    ).rejects.toThrow();

    expect(await claimPlanRegeneration(TENANT, "plan-assumptions")).toBeNull();
    // Two failures have exhausted the budget just as two successes would.
    expect(await claimPlanRegeneration(TENANT, "plan-assumptions")).not.toBeNull();
  });
});

describe("the window is rolling, not a calendar day", () => {
  it("still refuses when both attempts are just inside the window", async () => {
    attemptAgedMs(TENANT, PLAN_REGEN_WINDOW_MS - 60_000);
    attemptAgedMs(TENANT, PLAN_REGEN_WINDOW_MS - 60_000);
    expect(await claimPlanRegeneration(TENANT, "plan-create")).not.toBeNull();
  });

  it("allows the first attempt after the window rolls past the older two", async () => {
    attemptAgedMs(TENANT, PLAN_REGEN_WINDOW_MS + 60_000);
    attemptAgedMs(TENANT, PLAN_REGEN_WINDOW_MS + 60_000);
    expect(await claimPlanRegeneration(TENANT, "plan-create")).toBeNull();
  });

  it("frees exactly one attempt when only the older of the two has rolled out", async () => {
    attemptAgedMs(TENANT, PLAN_REGEN_WINDOW_MS + 60_000); // out
    attemptAgedMs(TENANT, PLAN_REGEN_WINDOW_MS - 60_000); // still in
    expect(await claimPlanRegeneration(TENANT, "plan-create")).toBeNull();
    expect(await claimPlanRegeneration(TENANT, "plan-create")).not.toBeNull();
  });

  it("reports the retry time from the oldest attempt still inside the window", async () => {
    const olderAge = PLAN_REGEN_WINDOW_MS - 3 * 60 * 60 * 1000; // 21 hours ago
    attemptAgedMs(TENANT, olderAge);
    attemptAgedMs(TENANT, 60_000);

    const denial = await claimPlanRegeneration(TENANT, "plan-create");
    const expected = Date.now() - olderAge + PLAN_REGEN_WINDOW_MS;
    expect(Math.abs(Date.parse(denial!.retryAfter) - expected)).toBeLessThan(2000);
  });
});

describe("the budget belongs to the tenant", () => {
  it("is shared by two users in the same household", async () => {
    // Nothing in the claim is keyed by user: the same tenant exhausts it
    // whichever member spends the attempts.
    await claimPlanRegeneration(TENANT, "plan-create");
    await claimPlanRegeneration(TENANT, "chat-assumptions");
    expect(await claimPlanRegeneration(TENANT, "plan-assumptions")).not.toBeNull();
    expect(attempts.every((a) => a.tenantId === TENANT)).toBe(true);
  });

  it("does not let one tenant spend another's", async () => {
    await claimPlanRegeneration(TENANT, "plan-create");
    await claimPlanRegeneration(TENANT, "plan-create");
    expect(await claimPlanRegeneration(TENANT, "plan-create")).not.toBeNull();
    expect(await claimPlanRegeneration(OTHER_TENANT, "plan-create")).toBeNull();
    expect(await claimPlanRegeneration(OTHER_TENANT, "plan-create")).toBeNull();
    expect(await claimPlanRegeneration(OTHER_TENANT, "plan-create")).not.toBeNull();
  });
});

describe("the counter is not in this process", () => {
  it("still refuses after the module is reloaded", async () => {
    await claimPlanRegeneration(TENANT, "plan-create");
    await claimPlanRegeneration(TENANT, "plan-create");

    // A restart: the code under test gets a brand new module scope. Only the
    // stored rows carry over, so an in-memory counter would reset to zero here.
    vi.resetModules();
    const reloaded = await import("../plan-regen-guard.js");
    expect(reloaded.claimPlanRegeneration).not.toBe(claimPlanRegeneration);

    expect(await reloaded.claimPlanRegeneration(TENANT, "plan-create")).not.toBeNull();
  });

  it("serializes the claim behind a tenant advisory lock", async () => {
    await claimPlanRegeneration(TENANT, "plan-create");
    // Count and insert are only safe together if concurrent claims cannot
    // interleave. That is what this statement buys.
    expect(executed).toHaveLength(1);
    expect(executed[0]!.text).toContain("pg_advisory_xact_lock");
    expect(executed[0]!.values).toContain(TENANT);
  });
});

describe("the in-flight claim on a structured plan", () => {
  it("lets one run in and turns the next away", async () => {
    expect(await beginStructuredRun(TENANT, "user-a", PLAN_ID)).toBe(true);
    expect(await beginStructuredRun(TENANT, "user-a", PLAN_ID)).toBe(false);
  });

  it("frees the plan when the run ends", async () => {
    await beginStructuredRun(TENANT, "user-a", PLAN_ID);
    await endStructuredRun(TENANT, "user-a", PLAN_ID);
    expect(plans[0]!.regenStartedAt).toBeNull();
    expect(await beginStructuredRun(TENANT, "user-a", PLAN_ID)).toBe(true);
  });

  it("takes over a claim left behind by a dead process", async () => {
    plans[0]!.regenStartedAt = new Date(Date.now() - STRUCTURED_RUN_STALE_MS - 60_000);
    expect(await beginStructuredRun(TENANT, "user-a", PLAN_ID)).toBe(true);
  });

  it("gives the plan to exactly one of two concurrent requests", async () => {
    const [a, b] = await Promise.all([
      beginStructuredRun(TENANT, "user-a", PLAN_ID),
      beginStructuredRun(TENANT, "user-a", PLAN_ID),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("refuses a plan belonging to another tenant or user", async () => {
    expect(await beginStructuredRun(OTHER_TENANT, "user-a", PLAN_ID)).toBe(false);
    expect(await beginStructuredRun(TENANT, "user-b", PLAN_ID)).toBe(false);
  });
});
