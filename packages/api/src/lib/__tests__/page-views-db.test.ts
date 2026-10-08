/**
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test page-views-db
 *
 * The default .env DATABASE_URL uses the docker-internal host `db:5432`, which
 * isn't resolvable from a host-run test — point DATABASE_URL at localhost:5439.
 * If the DB is unreachable the tests self-skip (they do not fail), so a run
 * without a DB stays green.
 *
 * All data lives in a throwaway tenant this file creates in beforeAll and
 * deletes in afterAll. It never reads or writes any other tenant's rows.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, tenants, users, pageViews } from "@lasagna/core";
import { db } from "../db.js";
import { recordPageView, findLastVisit, LAST_VISIT_GAP_MS } from "../page-views.js";

let tenantId: string | null = null;
let userId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "page-views.test" }).returning({ id: tenants.id });
    tenantId = t.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `page-views-${Date.now()}@example.com` })
      .returning({ id: users.id });
    userId = u.id;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
});

const at = (msAgo: number, now: Date) => new Date(now.getTime() - msAgo);
const MIN = 60_000;

// Each case seeds its own views.
beforeEach(async () => {
  if (dbAvailable) await db.delete(pageViews).where(eq(pageViews.userId, userId!));
});

describe("findLastVisit", () => {
  it("is null with no views", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    expect(await findLastVisit(userId!, new Date())).toBeNull();
  });

  it("ignores views inside the gap and returns the newest one before it", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const now = new Date();
    await db.insert(pageViews).values([
      { userId: userId!, tenantId: tenantId!, path: "/", visitedAt: at(3 * 86_400_000, now) },
      { userId: userId!, tenantId: tenantId!, path: "/money", visitedAt: at(2 * 86_400_000, now) },
      { userId: userId!, tenantId: tenantId!, path: "/", visitedAt: at(LAST_VISIT_GAP_MS - 60_000, now) },
    ]);
    const last = await findLastVisit(userId!, now);
    expect(last?.getTime()).toBe(at(2 * 86_400_000, now).getTime());
  });

  it("skips the whole current session, however long it has run", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const now = new Date();
    // Last visit two days ago, then a session of clicks 20 minutes apart that
    // started 90 minutes ago. Every click in it is part of "now".
    await db.insert(pageViews).values(
      [2 * 1440, 90, 70, 50, 30, 10].map((m) => ({
        userId: userId!, tenantId: tenantId!, path: "/", visitedAt: at(m * MIN, now),
      })),
    );
    const last = await findLastVisit(userId!, now);
    expect(last?.getTime()).toBe(at(2 * 1440 * MIN, now).getTime());
  });

  it("returns the newest view when no session is under way", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const now = new Date();
    await db.insert(pageViews).values(
      [2 * 1440, 120].map((m) => ({
        userId: userId!, tenantId: tenantId!, path: "/", visitedAt: at(m * MIN, now),
      })),
    );
    const last = await findLastVisit(userId!, now);
    expect(last?.getTime()).toBe(at(120 * MIN, now).getTime());
  });

  it("recordPageView stores the path", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    await recordPageView({ userId: userId!, tenantId: tenantId! }, "/goals");
    const rows = await db.select().from(pageViews).where(eq(pageViews.path, "/goals"));
    expect(rows.some((r) => r.userId === userId)).toBe(true);
  });
});
