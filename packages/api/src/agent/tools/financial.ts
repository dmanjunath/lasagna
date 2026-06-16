import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { financialProfiles } from "@lasagna/core";
import { eq } from "@lasagna/core";
import { getHoldingsInput } from "../../routes/portfolio.js";
import { aggregatePortfolio } from "../../services/portfolio-aggregator.js";
import {
  fetchAccountsWithBalances,
  netWorthContribution,
} from "../../lib/account-balances.js";

export function createFinancialTools(tenantId: string) {
  return {
    get_accounts: tool({
      description:
        "Get all financial accounts for the user with their current balances",
      inputSchema: z.object({}),
      execute: async () => {
        const accts = await fetchAccountsWithBalances(tenantId);

        return {
          accounts: accts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            subtype: a.subtype,
            mask: a.mask,
            // effectiveBalance already reflects the user's invert override
            balance: a.effectiveBalance,
            available: a.available,
            lastUpdated: a.asOf,
            excludedFromNetWorth: a.excludeFromNetWorth,
            inverted: a.invertBalance,
          })),
        };
      },
    }),

    get_net_worth: tool({
      description:
        "Get the user's net worth with historical data for trend analysis",
      inputSchema: z.object({
        timeframe: z
          .enum(["1m", "3m", "6m", "1y", "all"])
          .optional()
          .default("3m"),
      }),
      execute: async () => {
        const accts = await fetchAccountsWithBalances(tenantId);

        if (accts.length === 0) {
          return { currentNetWorth: 0, breakdown: {}, accountCount: 0 };
        }

        // Excluded accounts contribute 0; inverted balances already flipped.
        let currentNetWorth = 0;
        const breakdown: Record<string, number> = {};
        for (const a of accts) {
          const contribution = netWorthContribution(a);
          currentNetWorth += contribution;
          breakdown[a.type] = (breakdown[a.type] ?? 0) + contribution;
        }

        return {
          currentNetWorth,
          breakdown,
          accountCount: accts.length,
        };
      },
    }),

    get_holdings: tool({
      description: "Get investment holdings with securities information, grouped by asset class",
      inputSchema: z.object({}),
      execute: async () => {
        // Use the same pipeline as the portfolio tab for consistent data
        const holdingsInput = await getHoldingsInput(tenantId);
        const composition = aggregatePortfolio(holdingsInput);

        return {
          totalValue: composition.totalValue,
          assetClasses: composition.assetClasses.map((ac) => ({
            name: ac.name,
            value: ac.value,
            percentage: Math.round(ac.percentage * 100) / 100,
            holdings: ac.categories.flatMap((cat) =>
              cat.holdings.map((h) => ({
                ticker: h.ticker,
                name: h.name,
                shares: h.shares,
                value: h.value,
                costBasis: h.costBasis,
                account: h.account,
                category: cat.name,
              }))
            ),
          })),
        };
      },
    }),

    get_financial_profile: tool({
      description:
        "Get the user's financial profile: annual income, filing status, age, state of residence, employment type, risk tolerance, target retirement age, employer 401(k) match %, number of dependents, HDHP and PSLF status. Use this for income, tax, and retirement-planning questions — income lives here, NOT in transactions (manual-entry users often have no income transactions).",
      inputSchema: z.object({}),
      execute: async () => {
        const profile = await db.query.financialProfiles.findFirst({
          where: eq(financialProfiles.tenantId, tenantId),
        });

        if (!profile) {
          return { profile: null, note: "No financial profile has been set up yet." };
        }

        const age = profile.dateOfBirth
          ? Math.floor(
              (Date.now() - new Date(profile.dateOfBirth).getTime()) /
                (365.25 * 24 * 60 * 60 * 1000)
            )
          : null;

        return {
          profile: {
            annualIncome: profile.annualIncome ? parseFloat(profile.annualIncome) : null,
            filingStatus: profile.filingStatus,
            age,
            stateOfResidence: profile.stateOfResidence,
            employmentType: profile.employmentType,
            riskTolerance: profile.riskTolerance,
            retirementAge: profile.retirementAge,
            employerMatchPercent:
              profile.employerMatch !== null && profile.employerMatch !== undefined
                ? parseFloat(profile.employerMatch)
                : null,
            dependentCount: profile.dependentCount ?? null,
            hasHDHP: profile.hasHDHP ?? null,
            isPSLFEligible: profile.isPSLFEligible ?? null,
          },
        };
      },
    }),
  };
}
