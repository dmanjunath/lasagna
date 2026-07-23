import { describe, it, expect, beforeAll } from "vitest";
import { holdings } from "@lasagna/core";
import { db } from "../../lib/db.js";
import { resolveSimInputs } from "../../services/resolve-sim-inputs.js";
import { runRetirementSim } from "../../services/retirement-sim.js";
import { runRetirementBacktest } from "../../services/retirement-backtest.js";
import { createSimulationTools } from "../tools/simulation.js";

// ── DB integration ────────────────────────────────────────────────────────────
// Requires a running, seeded Postgres reachable via DATABASE_URL.
//   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5432/lasagna \
//     cd packages/api && npx vitest run simulation-tools
//
// Self-skips if no DB reachable so CI without a DB stays green.

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

describe("createSimulationTools – run_monte_carlo", () => {
  it("with no overrides, successRate matches runRetirementSim(resolveSimInputs())", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }

    const tools = createSimulationTools(tenantId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const toolResult = (await tools.run_monte_carlo.execute!({}, { messages: [], toolCallId: "test" })) as {
      successRate: number;
    };

    // Compute the expected value the same way the tool does internally.
    const resolved = await resolveSimInputs(tenantId);
    const simResult = runRetirementSim(resolved);
    const expectedSuccessRate = Math.round(simResult.successRate * 100);

    expect(toolResult.successRate).toBe(expectedSuccessRate);
  });

  it("with retirementAge override, returns a different successRate than no-override", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }

    const tools = createSimulationTools(tenantId);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const baseResult = (await tools.run_monte_carlo.execute!({}, { messages: [], toolCallId: "test-base" })) as {
      successRate: number;
      horizonYears: number;
    };

    // Retire much earlier — stress-tests the plan and should produce a different result.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const earlyRetireResult = (await tools.run_monte_carlo.execute!(
      { retirementAge: 45 },
      { messages: [], toolCallId: "test-override" },
    )) as { successRate: number; horizonYears: number };

    // The numbers should differ (early retirement means fewer accumulation years
    // and more withdrawal years, which typically changes the success rate).
    // If the base plan already retires at 45, resolve and check horizonYears diff.
    const resolved = await resolveSimInputs(tenantId);
    if (resolved.retirementAge !== 45) {
      expect(earlyRetireResult.successRate).not.toBe(baseResult.successRate);
    } else {
      // retirementAge was already 45 — results should be identical
      expect(earlyRetireResult.successRate).toBe(baseResult.successRate);
    }
  });
});

describe("createSimulationTools – run_backtest", () => {
  it("with no overrides, successRate matches runRetirementBacktest(resolveSimInputs())", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }

    const tools = createSimulationTools(tenantId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const toolResult = (await tools.run_backtest.execute!({}, { messages: [], toolCallId: "test" })) as {
      successRate: number;
      startYearCount: number;
    };

    const resolved = await resolveSimInputs(tenantId);
    const summary = runRetirementBacktest(resolved);
    expect(toolResult.successRate).toBe(Math.round(summary.successRate * 100));
    expect(toolResult.startYearCount).toBe(summary.startYearCount);
    expect(toolResult.startYearCount).toBeGreaterThan(0);
  });
});
