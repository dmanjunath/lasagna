/**
 * Builds the "What if?" section of a Financial Plan document — deterministic
 * scenario analysis that re-runs the SAME retirement engine with a small set of
 * overrides and reports each scenario's success rate plus the delta vs the base
 * plan. It answers "what happens if I retire earlier / spend more?".
 *
 * REUSES THE CANONICAL /retirement ENGINE — no second simulator, no LLM:
 *  - resolveSimInputs(tenantId, userId, overrides) → the same SimInputs the
 *    dashboard, chat agent, and Retirement Readiness section start from
 *  - runRetirementSim → the same Monte Carlo, same seed → same determinism
 *
 * RECONCILIATION: the base (empty-overrides) run reproduces the SimInputs the
 * stored Retirement Readiness section ran on. The caller passes in that
 * section's already-rounded successRate as `baseSuccessRate`, and every
 * scenario's `deltaVsBase` is computed against it — so the panel's "base" equals
 * the Retirement Readiness verdict exactly.
 */

import { resolveSimInputs } from "./resolve-sim-inputs.js";
import { runRetirementSim } from "./retirement-sim.js";
import type { SimInputs } from "./retirement-sim.js";

// How many years earlier the "retire earlier" scenario pulls the retirement age
// in, and how much more the "spend more" scenario spends. Kept small so the
// panel stays legible and plan-create stays fast (one extra sim run each).
const RETIRE_EARLIER_YEARS = 3;
const SPEND_MORE_FACTOR = 1.2;

export interface WhatIfScenario {
  label: string;
  overrides: {
    retirementAge?: number;
    monthlySpend?: number;
    planThroughAge?: number;
  };
  successRate: number; // 0..100
  medianLastsToAge: number | null;
  /** scenario.successRate − baseSuccessRate, in percentage points. */
  deltaVsBase: number;
}

export interface WhatIfSection {
  section: "what_ifs";
  baseSuccessRate: number; // 0..100, the stored Retirement Readiness success rate
  scenarios: WhatIfScenario[];
  generatedAt: string;
}

// One scenario definition: a human label plus the override to apply, derived
// from the resolved base inputs so each delta is relative to the REAL base.
interface ScenarioSpec {
  label: string;
  overrides: WhatIfScenario["overrides"];
}

/**
 * Run one scenario end-to-end against the SAME engine the base used. Returns
 * null if the run throws, so a single bad scenario never fails plan-create.
 */
async function runScenario(
  tenantId: string,
  userId: string,
  spec: ScenarioSpec,
  baseSuccessRate: number,
): Promise<WhatIfScenario | null> {
  try {
    const inputs = await resolveSimInputs(tenantId, userId, spec.overrides);
    const res = runRetirementSim(inputs);
    const successRate = Math.round(res.successRate * 100);
    return {
      label: spec.label,
      overrides: spec.overrides,
      successRate,
      medianLastsToAge: res.medianLastsToAge,
      deltaVsBase: successRate - baseSuccessRate,
    };
  } catch (e) {
    console.error(`[what-if-section] scenario "${spec.label}" failed:`, e);
    return null;
  }
}

/**
 * Build the What-if section. Reads the base retirement age / monthly spend from
 * the empty-overrides resolve so the scenario deltas are relative to the real
 * base, then runs 2-3 scenarios. `baseSuccessRate` is the stored Retirement
 * Readiness success rate (0..100) so the panel's base reconciles exactly.
 */
export async function buildWhatIfSection(
  tenantId: string,
  userId: string,
  baseSuccessRate: number,
): Promise<WhatIfSection> {
  const generatedAt = new Date().toISOString();
  const base: SimInputs = await resolveSimInputs(tenantId, userId);

  // Retire N years earlier, but never below the current age.
  const earlierAge = Math.max(base.currentAge, base.retirementAge - RETIRE_EARLIER_YEARS);
  const specs: ScenarioSpec[] = [
    {
      label: `Retire ${RETIRE_EARLIER_YEARS} years earlier`,
      overrides: { retirementAge: earlierAge },
    },
    {
      label: "Spend 20% more",
      overrides: { monthlySpend: Math.round(base.monthlySpend * SPEND_MORE_FACTOR) },
    },
    {
      label: `Retire ${RETIRE_EARLIER_YEARS} years later`,
      overrides: { retirementAge: base.retirementAge + RETIRE_EARLIER_YEARS },
    },
  ];

  const results = await Promise.all(
    specs.map((spec) => runScenario(tenantId, userId, spec, baseSuccessRate)),
  );

  return {
    section: "what_ifs",
    baseSuccessRate,
    scenarios: results.filter((s): s is WhatIfScenario => s !== null),
    generatedAt,
  };
}
