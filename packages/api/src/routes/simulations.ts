import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { plans, eq, and } from "@lasagna/core";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { getMonteCarloEngine } from "../services/monte-carlo.js";
import { getBacktester } from "../services/backtester.js";
import { getScenarioEngine } from "../services/scenario.js";

export const simulationsRouter = new Hono<AuthEnv>();
simulationsRouter.use("*", requireAuth);

// Validation schemas
const uuidSchema = z.string().uuid();

const assetAllocationSchema = z.object({
  stocks: z.number().min(0).max(1),
  bonds: z.number().min(0).max(1),
  cash: z.number().min(0).max(1).optional(),
});

const monteCarloParamsSchema = z.object({
  initialBalance: z.number().positive(),
  withdrawalRate: z.number().min(0).max(1),
  yearsToSimulate: z.number().int().positive(),
  assetAllocation: assetAllocationSchema,
  inflationAdjusted: z.boolean(),
  numSimulations: z.number().int().positive().max(10000),
});

const backtestParamsSchema = z.object({
  initialBalance: z.number().positive(),
  withdrawalRate: z.number().min(0).max(1),
  yearsToSimulate: z.number().int().positive(),
  assetAllocation: assetAllocationSchema,
  inflationAdjusted: z.boolean(),
  startYearRange: z
    .object({
      from: z.number().int(),
      to: z.number().int(),
    })
    .optional(),
});

const scenarioParamsSchema = z.object({
  initialBalance: z.number().positive(),
  withdrawalRate: z.number().min(0).max(1),
  retirementDuration: z.number().int().positive(),
  assetAllocation: assetAllocationSchema,
  scenario: z.enum([
    "crash_2008",
    "great_depression",
    "stagflation_70s",
    "japan_lost_decade",
    "custom",
  ]),
  customParams: z
    .object({
      yearOneReturn: z.number(),
      subsequentReturns: z.number(),
      inflationRate: z.number(),
      durationYears: z.number().int().positive(),
    })
    .optional(),
});

const runSimulationSchema = z.object({
  planId: z.string().uuid(),
  type: z.enum(["monte_carlo", "backtest", "scenario"]),
  params: z.union([
    monteCarloParamsSchema,
    backtestParamsSchema,
    scenarioParamsSchema,
  ]),
});

// POST /run - Run a simulation
simulationsRouter.post("/run", async (c) => {
  const { tenantId } = c.get("session");
  const rawBody = await c.req.json();

  const parseResult = runSimulationSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      { error: "Invalid request body", details: parseResult.error.issues },
      400
    );
  }

  const { planId, type, params } = parseResult.data;

  // Verify plan exists and belongs to tenant
  const [plan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  const startTime = Date.now();
  let result: unknown;

  try {
    switch (type) {
      case "monte_carlo": {
        const mcEngine = getMonteCarloEngine();
        const mcParams = params as z.infer<typeof monteCarloParamsSchema>;
        result = mcEngine.run({
          ...mcParams,
          assetAllocation: {
            stocks: mcParams.assetAllocation.stocks,
            bonds: mcParams.assetAllocation.bonds,
            cash: mcParams.assetAllocation.cash ?? 0,
          },
        });
        break;
      }
      case "backtest": {
        const backtester = getBacktester();
        const btParams = params as z.infer<typeof backtestParamsSchema>;
        result = backtester.run({
          ...btParams,
          assetAllocation: {
            stocks: btParams.assetAllocation.stocks,
            bonds: btParams.assetAllocation.bonds,
          },
        });
        break;
      }
      case "scenario": {
        const scenarioEngine = getScenarioEngine();
        const scParams = params as z.infer<typeof scenarioParamsSchema>;
        result = scenarioEngine.run({
          ...scParams,
          assetAllocation: {
            stocks: scParams.assetAllocation.stocks,
            bonds: scParams.assetAllocation.bonds,
            cash: scParams.assetAllocation.cash ?? 0,
          },
        });
        break;
      }
      default:
        return c.json({ error: "Invalid simulation type" }, 400);
    }
  } catch (error) {
    console.error("Simulation error:", error);
    return c.json(
      {
        error: "Simulation failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }

  const endTime = Date.now();
  const executionTimeMs = endTime - startTime;

  return c.json({
    planId,
    type,
    result,
    timing: {
      executionTimeMs,
      timestamp: new Date().toISOString(),
    },
  });
});
