import { Hono } from "hono";
import { z } from "zod";
import { type AuthEnv } from "../middleware/auth.js";
import { resolveSimInputs } from "../services/resolve-sim-inputs.js";
import { runRetirementSim } from "../services/retirement-sim.js";
import { runRetirementBacktest } from "../services/retirement-backtest.js";

export const retirementSimRouter = new Hono<AuthEnv>();

// Client-side spells "percent_portfolio"; the engine uses "percent_of_portfolio".
// All remapping lives here — single point of truth.
const CLIENT_STRATEGY_MAP: Record<string, string> = {
  percent_portfolio: "percent_of_portfolio",
};

const allocationSchema = z.object({
  usStocks: z.number(),
  intlStocks: z.number(),
  bonds: z.number(),
  reits: z.number(),
  cash: z.number(),
});

const overridesSchema = z
  .object({
    currentAge: z.number().optional(),
    retirementAge: z.number().optional(),
    planThroughAge: z.number().optional(),
    startingBalance: z.number().optional(),
    monthlySavings: z.number().optional(),
    monthlySpend: z.number().optional(),
    strategy: z.string().optional(),
    strategyParams: z.record(z.string(), z.unknown()).optional(),
    ssMonthly: z.number().optional(),
    ssClaimAge: z.number().optional(),
    otherMonthly: z.number().optional(),
    otherStartAge: z.number().optional(),
    allocation: allocationSchema.optional(),
    inflationAdjusted: z.boolean().optional(),
    numSimulations: z.number().optional(),
    seed: z.number().optional(),
  })
  .transform((data) => {
    // Remap client strategy spelling to server enum value
    if (data.strategy && CLIENT_STRATEGY_MAP[data.strategy]) {
      return { ...data, strategy: CLIENT_STRATEGY_MAP[data.strategy] };
    }
    return data;
  });

// Parse + validate the request body (shared by /simulate and /backtest). On
// success returns the parsed overrides; on failure returns the error string +
// status so the caller can `c.json(error, status)`.
async function parseOverrides(
  c: { req: { json: () => Promise<unknown> } },
): Promise<
  | { ok: true; overrides: z.infer<typeof overridesSchema> }
  | { ok: false; error: string; status: 400 }
> {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    rawBody = {};
  }

  const parsed = overridesSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request body", status: 400 };
  }

  const overrides = parsed.data;

  // Validate allocation sums to ~1 (±0.01) if provided
  if (overrides.allocation) {
    const { usStocks, intlStocks, bonds, reits, cash } = overrides.allocation;
    const sum = usStocks + intlStocks + bonds + reits + cash;
    if (Math.abs(sum - 1) > 0.01) {
      return {
        ok: false,
        error: `allocation fields must sum to 1.0 (got ${sum.toFixed(4)}); adjust values so usStocks + intlStocks + bonds + reits + cash ≈ 1`,
        status: 400,
      };
    }
  }

  // Validate age ordering if any ages are provided
  const { currentAge, retirementAge, planThroughAge } = overrides;

  if (currentAge !== undefined && retirementAge !== undefined && currentAge > retirementAge) {
    return {
      ok: false,
      error: `age constraint violated: currentAge (${currentAge}) must be ≤ retirementAge (${retirementAge})`,
      status: 400,
    };
  }
  if (retirementAge !== undefined && planThroughAge !== undefined && retirementAge > planThroughAge) {
    return {
      ok: false,
      error: `age constraint violated: retirementAge (${retirementAge}) must be ≤ planThroughAge (${planThroughAge})`,
      status: 400,
    };
  }
  if (currentAge !== undefined && planThroughAge !== undefined && currentAge > planThroughAge) {
    return {
      ok: false,
      error: `age constraint violated: currentAge (${currentAge}) must be ≤ planThroughAge (${planThroughAge})`,
      status: 400,
    };
  }

  return { ok: true, overrides };
}

retirementSimRouter.post("/simulate", async (c) => {
  const { tenantId } = c.get("session");

  const parsed = await parseOverrides(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

  const inputs = await resolveSimInputs(tenantId, parsed.overrides as any);
  return c.json(runRetirementSim(inputs));
});

retirementSimRouter.post("/backtest", async (c) => {
  const { tenantId } = c.get("session");

  const parsed = await parseOverrides(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

  const inputs = await resolveSimInputs(tenantId, parsed.overrides as any);
  return c.json(runRetirementBacktest(inputs));
});
