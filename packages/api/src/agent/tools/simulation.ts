import { tool } from "ai";
import { z } from "zod";
import { getScenarioEngine } from "../../services/scenario.js";
import { getSimulationCache } from "../../services/simulation-cache.js";
import { getHoldingsInput } from "../../routes/portfolio.js";
import { aggregatePortfolio, extractAllocation } from "../../services/portfolio-aggregator.js";
import { runRetirementSim } from "../../services/retirement-sim.js";
import { runRetirementBacktest } from "../../services/retirement-backtest.js";
import { resolveSimInputs } from "../../services/resolve-sim-inputs.js";

export function createSimulationTools(tenantId: string) {
  return {
    get_portfolio_summary: tool({
      description:
        "Get user's portfolio summary including total balance and asset allocation for retirement planning",
      inputSchema: z.object({}),
      execute: async () => {
        // Use the same pipeline as the portfolio tab for consistent data
        const holdingsInput = await getHoldingsInput(tenantId);

        if (holdingsInput.length === 0) {
          return {
            totalBalance: 0,
            allocation: { usStocks: 0, intlStocks: 0, bonds: 0, reits: 0, cash: 0 },
            holdings: [],
          };
        }

        const composition = aggregatePortfolio(holdingsInput);
        const allocation = extractAllocation(composition);

        return {
          totalBalance: composition.totalValue,
          allocation,
          assetClasses: composition.assetClasses.map((ac) => ({
            name: ac.name,
            value: ac.value,
            percentage: Math.round(ac.percentage * 100) / 100,
          })),
        };
      },
    }),

    run_monte_carlo: tool({
      description:
        "Simulate the user's actual retirement plan using Monte Carlo analysis. Unspecified values default " +
        "to the user's real data (portfolio balance, spending, savings, allocation, Social Security, etc.). " +
        "Only pass overrides for explicit what-if questions (e.g. 'what if I retire at 55?'). " +
        "Returns success rate, median balance trajectory, and percentile bands.",
      inputSchema: z.object({
        retirementAge: z.number().int().positive().optional(),
        planThroughAge: z.number().int().positive().optional(),
        monthlySpend: z.number().nonnegative().optional(),
        monthlySavings: z.number().nonnegative().optional(),
        startingBalance: z.number().nonnegative().optional(),
        ssMonthly: z.number().nonnegative().optional(),
        ssClaimAge: z.number().int().positive().optional(),
        otherMonthly: z.number().nonnegative().optional(),
        otherStartAge: z.number().int().positive().optional(),
        strategy: z
          .enum(["constant_dollar", "percent_of_portfolio", "guardrails", "rules_based"])
          .optional(),
        allocation: z
          .object({
            usStocks: z.number().min(0).max(1),
            intlStocks: z.number().min(0).max(1),
            bonds: z.number().min(0).max(1),
            reits: z.number().min(0).max(1),
            cash: z.number().min(0).max(1),
          })
          .optional(),
        numSimulations: z.number().int().positive().optional(),
      }),
      execute: async (params) => {
        const inputs = await resolveSimInputs(tenantId, params);
        const result = runRetirementSim(inputs);

        // Compact LLM-facing summary — full percentile arrays are too large for context.
        const lastIdx = result.percentiles.p50.length - 1;
        const midIdx = Math.floor(lastIdx / 2);
        return {
          successRate: Math.round(result.successRate * 100),
          medianLastsToAge: result.medianLastsToAge,
          blendedExpectedReturn: Math.round(result.blendedExpectedReturn * 10000) / 100,
          horizonYears: result.horizonYears,
          finalBalanceDistribution: {
            mean: Math.round(result.finalBalanceDistribution.mean),
            median: Math.round(result.finalBalanceDistribution.median),
          },
          percentileSummary: {
            start: {
              p5: result.percentiles.p5[0],
              p50: result.percentiles.p50[0],
              p95: result.percentiles.p95[0],
            },
            mid: {
              p5: result.percentiles.p5[midIdx],
              p50: result.percentiles.p50[midIdx],
              p95: result.percentiles.p95[midIdx],
            },
            end: {
              p5: result.percentiles.p5[lastIdx],
              p50: result.percentiles.p50[lastIdx],
              p95: result.percentiles.p95[lastIdx],
            },
          },
        };
      },
    }),

    run_backtest: tool({
      description:
        "Backtest the user's actual retirement plan against real historical market data " +
        "(S&P 500 + bonds + CPI, every start year from 1928 on). Unspecified values default " +
        "to the user's real data (portfolio balance, spending, savings, allocation, Social " +
        "Security, etc.). Only pass overrides for explicit what-if questions (e.g. 'what if I " +
        "retire at 55?'). Returns the historical success rate, how many start-year cohorts " +
        "were tested, and the median real-dollar balance trajectory across cohorts.",
      inputSchema: z.object({
        retirementAge: z.number().int().positive().optional(),
        planThroughAge: z.number().int().positive().optional(),
        monthlySpend: z.number().nonnegative().optional(),
        monthlySavings: z.number().nonnegative().optional(),
        startingBalance: z.number().nonnegative().optional(),
        ssMonthly: z.number().nonnegative().optional(),
        ssClaimAge: z.number().int().positive().optional(),
        otherMonthly: z.number().nonnegative().optional(),
        otherStartAge: z.number().int().positive().optional(),
        strategy: z
          .enum(["constant_dollar", "percent_of_portfolio", "guardrails", "rules_based"])
          .optional(),
        allocation: z
          .object({
            usStocks: z.number().min(0).max(1),
            intlStocks: z.number().min(0).max(1),
            bonds: z.number().min(0).max(1),
            reits: z.number().min(0).max(1),
            cash: z.number().min(0).max(1),
          })
          .optional(),
      }),
      execute: async (params) => {
        const inputs = await resolveSimInputs(tenantId, params);
        const result = runRetirementBacktest(inputs);

        // Compact LLM-facing summary — full cohort bands are too large for context.
        const lastIdx = result.cohortBands.p50.length - 1;
        const midIdx = Math.floor(lastIdx / 2);
        return {
          successRate: Math.round(result.successRate * 100),
          startYearCount: result.startYearCount,
          firstStartYear: result.firstStartYear,
          horizonYears: result.horizonYears,
          // Median real-dollar balance across cohorts at the start, midpoint, and end.
          cohortMedianSummary: {
            start: result.cohortBands.p50[0],
            mid: result.cohortBands.p50[midIdx],
            end: result.cohortBands.p50[lastIdx],
          },
        };
      },
    }),

    run_scenario: tool({
      description:
        "Test portfolio against specific historical crisis scenarios like 2008 crash or Great Depression. " +
        "initialBalance, assetAllocation, and retirementDuration default to the user's real plan data when omitted.",
      inputSchema: z.object({
        planId: z.string().uuid().optional(),
        initialBalance: z.number().positive().optional(),
        withdrawalRate: z
          .number()
          .min(0)
          .max(1)
          .describe("Annual withdrawal as percentage (e.g., 0.04 for 4%)"),
        retirementDuration: z.number().int().positive().optional(),
        assetAllocation: z
          .object({
            usStocks: z.number().min(0).max(1),
            intlStocks: z.number().min(0).max(1),
            bonds: z.number().min(0).max(1),
            reits: z.number().min(0).max(1),
            cash: z.number().min(0).max(1),
          })
          .optional(),
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
      }),
      execute: async (params) => {
        // Fill omitted shared inputs from the user's real plan.
        let allocation = params.assetAllocation;
        let initialBalance = params.initialBalance;
        let retirementDuration = params.retirementDuration;

        if (!allocation || initialBalance === undefined || retirementDuration === undefined) {
          const resolved = await resolveSimInputs(tenantId);
          allocation ??= resolved.allocation;
          initialBalance ??= resolved.startingBalance;
          retirementDuration ??= resolved.planThroughAge - resolved.retirementAge;
        }

        // Validate allocation sums to 1
        const allocationSum =
          allocation.usStocks +
          allocation.intlStocks +
          allocation.bonds +
          allocation.reits +
          allocation.cash;
        if (Math.abs(allocationSum - 1) > 0.01) {
          return {
            error: "Asset allocation must sum to 1 (100%)",
            currentSum: allocationSum,
          };
        }

        // Validate custom scenario
        if (params.scenario === "custom" && !params.customParams) {
          return {
            error:
              "Custom scenario requires customParams with yearOneReturn, subsequentReturns, inflationRate, and durationYears",
          };
        }

        // Check cache if planId provided
        const cache = getSimulationCache();
        if (params.planId) {
          const cached = await cache.get(params.planId, "scenario", params);
          if (cached) {
            return { ...cached, cached: true };
          }
        }

        // Run scenario (crisis engine; %-based withdrawal — unchanged from original)
        const engine = getScenarioEngine();
        const result = engine.run({
          initialBalance,
          withdrawalRate: params.withdrawalRate,
          retirementDuration,
          assetAllocation: allocation,
          scenario: params.scenario,
          customParams: params.customParams,
        });

        // Cache result if planId provided
        if (params.planId) {
          await cache.set(params.planId, tenantId, "scenario", params, result);
        }

        // Return compact summary — yearByYear is too large for LLM context
        return {
          scenarioName: result.scenarioName,
          description: result.description,
          survivalRate: result.survivalRate,
          endBalance: result.endBalance,
          depletionYear: result.depletionYear,
          comparison: result.comparison,
          cached: false,
        };
      },
    }),

    calculate_fire_number: tool({
      description:
        "Calculate FIRE (Financial Independence, Retire Early) number based on annual expenses and withdrawal rate",
      inputSchema: z.object({
        annualExpenses: z.number().positive(),
        withdrawalRate: z
          .number()
          .min(0)
          .max(1)
          .default(0.04)
          .describe("Safe withdrawal rate (default 4% = 0.04)"),
        currentSavings: z.number().nonnegative().optional(),
        monthlyContribution: z.number().nonnegative().optional(),
        expectedReturn: z
          .number()
          .min(0)
          .max(1)
          .default(0.07)
          .describe("Expected annual return (default 7% = 0.07)"),
      }),
      execute: async (params) => {
        // FIRE number = Annual Expenses / Safe Withdrawal Rate
        const fireNumber = params.annualExpenses / params.withdrawalRate;

        // Calculate time to FIRE if savings info provided
        let yearsToFire: number | null = null;
        let futureValue: number | null = null;

        if (
          params.currentSavings !== undefined &&
          params.monthlyContribution !== undefined &&
          params.monthlyContribution > 0
        ) {
          const monthlyRate = params.expectedReturn / 12;
          const currentSavings = params.currentSavings;
          const monthlyContribution = params.monthlyContribution;
          const target = fireNumber;

          // Calculate months to reach target using future value formula
          // FV = PV(1+r)^n + PMT * ((1+r)^n - 1) / r
          // Solving for n when FV = target is complex, so we'll iterate

          let months = 0;
          let balance = currentSavings;

          // Cap at 100 years to prevent infinite loops
          while (balance < target && months < 1200) {
            balance = balance * (1 + monthlyRate) + monthlyContribution;
            months++;
          }

          if (months < 1200) {
            yearsToFire = months / 12;
            futureValue = balance;
          }
        }

        return {
          fireNumber,
          annualExpenses: params.annualExpenses,
          withdrawalRate: params.withdrawalRate,
          currentSavings: params.currentSavings ?? null,
          amountNeeded:
            params.currentSavings !== undefined
              ? Math.max(0, fireNumber - params.currentSavings)
              : fireNumber,
          yearsToFire,
          futureValue,
          percentageComplete:
            params.currentSavings !== undefined
              ? (params.currentSavings / fireNumber) * 100
              : 0,
        };
      },
    }),
  };
}
