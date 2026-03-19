import { tool } from "ai";
import { z } from "zod";
import { getMonteCarloEngine } from "../../services/monte-carlo.js";
import { getBacktester } from "../../services/backtester.js";
import { getScenarioEngine } from "../../services/scenario.js";
import { getSimulationCache } from "../../services/simulation-cache.js";
import { getHoldingsInput } from "../../routes/portfolio.js";
import { aggregatePortfolio, extractAllocation } from "../../services/portfolio-aggregator.js";

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
        "Run Monte Carlo simulation to test retirement portfolio sustainability with stochastic returns",
      inputSchema: z.object({
        planId: z.string().uuid().optional(),
        initialBalance: z.number().positive(),
        withdrawalRate: z
          .number()
          .min(0)
          .max(1)
          .describe("Annual withdrawal as percentage (e.g., 0.04 for 4%)"),
        yearsToSimulate: z.number().int().positive(),
        assetAllocation: z.object({
          usStocks: z.number().min(0).max(1),
          intlStocks: z.number().min(0).max(1),
          bonds: z.number().min(0).max(1),
          reits: z.number().min(0).max(1),
          cash: z.number().min(0).max(1),
        }).default({ usStocks: 0.6, intlStocks: 0, bonds: 0.3, reits: 0, cash: 0.1 }),
        inflationAdjusted: z.boolean().default(true),
        numSimulations: z.number().int().positive().default(1000),
      }),
      execute: async (params) => {
        // Use default allocation if not provided or malformed
        const allocation = params.assetAllocation ?? { usStocks: 0.6, intlStocks: 0, bonds: 0.3, reits: 0, cash: 0.1 };

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

        // Check cache if planId provided
        const cache = getSimulationCache();
        if (params.planId) {
          const cached = await cache.get(
            params.planId,
            "monte_carlo",
            params
          );
          if (cached) {
            return { ...cached, cached: true };
          }
        }

        // Run simulation
        const engine = getMonteCarloEngine();
        const result = engine.run({
          initialBalance: params.initialBalance,
          annualWithdrawal: params.initialBalance * params.withdrawalRate,
          yearsToSimulate: params.yearsToSimulate,
          assetAllocation: allocation,
          numSimulations: params.numSimulations,
          strategyParams: { inflationAdjusted: params.inflationAdjusted },
        });

        // Cache result if planId provided
        if (params.planId) {
          await cache.set(params.planId, tenantId, "monte_carlo", params, result);
        }

        return { ...result, cached: false };
      },
    }),

    run_backtest: tool({
      description:
        "Run historical backtesting to test portfolio against actual market data",
      inputSchema: z.object({
        planId: z.string().uuid().optional(),
        initialBalance: z.number().positive(),
        withdrawalRate: z
          .number()
          .min(0)
          .max(1)
          .describe("Annual withdrawal as percentage (e.g., 0.04 for 4%)"),
        yearsToSimulate: z.number().int().positive(),
        assetAllocation: z.object({
          usStocks: z.number().min(0).max(1),
          intlStocks: z.number().min(0).max(1),
          bonds: z.number().min(0).max(1),
          reits: z.number().min(0).max(1),
          cash: z.number().min(0).max(1),
        }).default({ usStocks: 0.6, intlStocks: 0, bonds: 0.4, reits: 0, cash: 0 }),
        inflationAdjusted: z.boolean().default(true),
        startYearRange: z
          .object({
            from: z.number().int(),
            to: z.number().int(),
          })
          .optional(),
      }),
      execute: async (params) => {
        // Use default allocation if not provided or malformed
        const allocation = params.assetAllocation ?? { usStocks: 0.6, intlStocks: 0, bonds: 0.4, reits: 0, cash: 0 };

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

        // Check cache if planId provided
        const cache = getSimulationCache();
        if (params.planId) {
          const cached = await cache.get(params.planId, "backtest", params);
          if (cached) {
            return { ...cached, cached: true };
          }
        }

        // Run backtest
        const backtester = getBacktester();
        const result = backtester.run({
          initialBalance: params.initialBalance,
          annualWithdrawal: params.initialBalance * params.withdrawalRate,
          yearsToSimulate: params.yearsToSimulate,
          assetAllocation: allocation,
          strategy: "constant_dollar",
          strategyParams: { inflationAdjusted: params.inflationAdjusted },
          startYearRange: params.startYearRange,
        });

        // Cache result if planId provided
        if (params.planId) {
          await cache.set(params.planId, tenantId, "backtest", params, result);
        }

        return { ...result, cached: false };
      },
    }),

    run_scenario: tool({
      description:
        "Test portfolio against specific historical crisis scenarios like 2008 crash or Great Depression",
      inputSchema: z.object({
        planId: z.string().uuid().optional(),
        initialBalance: z.number().positive(),
        withdrawalRate: z
          .number()
          .min(0)
          .max(1)
          .describe("Annual withdrawal as percentage (e.g., 0.04 for 4%)"),
        retirementDuration: z.number().int().positive(),
        assetAllocation: z.object({
          usStocks: z.number().min(0).max(1),
          intlStocks: z.number().min(0).max(1),
          bonds: z.number().min(0).max(1),
          reits: z.number().min(0).max(1),
          cash: z.number().min(0).max(1),
        }).default({ usStocks: 0.6, intlStocks: 0, bonds: 0.3, reits: 0, cash: 0.1 }),
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
        // Use default allocation if not provided or malformed
        const allocation = params.assetAllocation ?? { usStocks: 0.6, intlStocks: 0, bonds: 0.3, reits: 0, cash: 0.1 };

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

        // Run scenario
        const engine = getScenarioEngine();
        const result = engine.run({
          initialBalance: params.initialBalance,
          withdrawalRate: params.withdrawalRate,
          retirementDuration: params.retirementDuration,
          assetAllocation: allocation,
          scenario: params.scenario,
          customParams: params.customParams,
        });

        // Cache result if planId provided
        if (params.planId) {
          await cache.set(params.planId, tenantId, "scenario", params, result);
        }

        return { ...result, cached: false };
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
