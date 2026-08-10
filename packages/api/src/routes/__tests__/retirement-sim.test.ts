/**
 * Tests for POST /api/retirement/simulate
 *
 * Validation tests: use a minimal Hono app with a fake session — no DB needed.
 * Happy-path test: requires a seeded DB at DATABASE_URL. Self-skips if absent.
 *
 * Run:
 *   cd packages/api && DATABASE_URL=postgresql://lasagna:lasagna@localhost:5432/lasagna \
 *     npx vitest run retirement-sim
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import type { AuthEnv } from "../../middleware/auth.js";
import { retirementSimRouter } from "../retirement-sim.js";
import { holdings } from "@lasagna/core";
import { db } from "../../lib/db.js";

// ── Test app with a fake session middleware ───────────────────────────────────
function makeApp(tenantId: string) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("session", {
      tenantId,
      userId: "test-user-id",
      isDemo: false,
      isAdmin: false,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);
    await next();
  });
  app.route("/", retirementSimRouter);
  return app;
}

// ── DB discovery (for happy-path) ─────────────────────────────────────────────
let tenantId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const rows = await db
      .select({ tenantId: holdings.tenantId })
      .from(holdings)
      .groupBy(holdings.tenantId)
      .limit(1);
    if (rows.length > 0) {
      tenantId = rows[0].tenantId;
      dbAvailable = true;
    }
  } catch {
    dbAvailable = false;
  }
});

// ── Validation tests (no DB required) ─────────────────────────────────────────

describe("POST /simulate — validation", () => {
  const app = makeApp("any-tenant-id");

  it("returns 400 when allocation fields sum to more than 1.01", async () => {
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocation: {
          usStocks: 0.6,
          intlStocks: 0.6,
          bonds: 0.4,
          reits: 0.2,
          cash: 0.2,
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/allocation/i);
  });

  it("returns 400 when allocation fields sum to less than 0.99", async () => {
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocation: {
          usStocks: 0.1,
          intlStocks: 0.0,
          bonds: 0.1,
          reits: 0.0,
          cash: 0.0,
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/allocation/i);
  });

  it("returns 400 when retirementAge > planThroughAge", async () => {
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAge: 40,
        retirementAge: 95,
        planThroughAge: 90,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/age/i);
  });

  it("returns 400 when currentAge > retirementAge", async () => {
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAge: 70,
        retirementAge: 65,
        planThroughAge: 90,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/age/i);
  });

  it("accepts empty body (all defaults from resolveSimInputs) but may fail if no DB", async () => {
    // This just checks that an empty JSON body doesn't cause a parse error —
    // actual DB-dependent behaviour is covered by the integration test below.
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // 200 (DB available) or 500 (no DB) — either way not a 400 validation error
    expect(res.status).not.toBe(400);
  });

  it("remaps client strategy 'percent_portfolio' to 'percent_of_portfolio'", async () => {
    // The remap itself is tested indirectly: we can only confirm no 400 is
    // returned for the client spelling (with a valid allocation that sums to 1).
    // Full behaviour is exercised in the integration test.
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategy: "percent_portfolio",
        allocation: {
          usStocks: 0.6,
          intlStocks: 0.1,
          bonds: 0.2,
          reits: 0.05,
          cash: 0.05,
        },
      }),
    });
    // Should not be a 400 (bad strategy), though may be 500 without DB
    expect(res.status).not.toBe(400);
  });
});

// ── Integration / happy-path (requires seeded DB) ────────────────────────────

describe("POST /simulate — integration", () => {
  it("returns 200 with successRate when DB is available", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    const app = makeApp(tenantId);
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("successRate");
    expect(typeof body.successRate).toBe("number");
    expect(body.successRate).toBeGreaterThanOrEqual(0);
    expect(body.successRate).toBeLessThanOrEqual(1);
  });

  it("applies overrides and returns valid SimResult", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    const app = makeApp(tenantId);
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numSimulations: 50,
        retirementAge: 65,
        planThroughAge: 90,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("successRate");
    expect(body).toHaveProperty("percentiles");
    expect(body).toHaveProperty("horizonYears");
    expect(body.horizonYears).toBeGreaterThan(0);
  });

  it("accepts valid allocation override (sums to 1.0)", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    const app = makeApp(tenantId);
    const res = await app.request("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numSimulations: 50,
        allocation: {
          usStocks: 0.6,
          intlStocks: 0.1,
          bonds: 0.2,
          reits: 0.05,
          cash: 0.05,
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("successRate");
  });
});

// ── /backtest ─────────────────────────────────────────────────────────────────

describe("POST /backtest — validation", () => {
  const app = makeApp("any-tenant-id");

  it("returns 400 when allocation fields do not sum to 1", async () => {
    const res = await app.request("/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocation: { usStocks: 0.6, intlStocks: 0.6, bonds: 0.4, reits: 0.2, cash: 0.2 },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/allocation/i);
  });

  it("returns 400 when retirementAge > planThroughAge", async () => {
    const res = await app.request("/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentAge: 40, retirementAge: 95, planThroughAge: 90 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/age/i);
  });
});

describe("POST /backtest — integration", () => {
  it("returns 200 with successRate + cohortBands when DB is available", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    const app = makeApp(tenantId);
    const res = await app.request("/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("successRate");
    expect(typeof body.successRate).toBe("number");
    expect(body.successRate).toBeGreaterThanOrEqual(0);
    expect(body.successRate).toBeLessThanOrEqual(1);
    expect(body).toHaveProperty("cohortBands");
    expect(body).toHaveProperty("startYearCount");
    expect(body.startYearCount).toBeGreaterThan(0);
    expect(body.cohortBands.p50.length).toBe(body.horizonYears + 1);
  });
});
