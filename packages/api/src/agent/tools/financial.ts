import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import {
  accounts,
  balanceSnapshots,
  holdings,
  securities,
} from "@lasagna/core";
import { eq, desc, and, sql } from "@lasagna/core";

export function createFinancialTools(tenantId: string) {
  return {
    get_accounts: tool({
      description:
        "Get all financial accounts for the user with their current balances",
      inputSchema: z.object({}),
      execute: async () => {
        const results = await db
          .select({
            id: accounts.id,
            name: accounts.name,
            type: accounts.type,
            subtype: accounts.subtype,
            mask: accounts.mask,
          })
          .from(accounts)
          .where(eq(accounts.tenantId, tenantId));

        // Get latest balance for each account
        const accountsWithBalances = await Promise.all(
          results.map(async (account) => {
            const [latestBalance] = await db
              .select({
                balance: balanceSnapshots.balance,
                available: balanceSnapshots.available,
                snapshotAt: balanceSnapshots.snapshotAt,
              })
              .from(balanceSnapshots)
              .where(eq(balanceSnapshots.accountId, account.id))
              .orderBy(desc(balanceSnapshots.snapshotAt))
              .limit(1);

            return {
              ...account,
              balance: latestBalance?.balance ?? "0",
              available: latestBalance?.available ?? null,
              lastUpdated: latestBalance?.snapshotAt ?? null,
            };
          })
        );

        return { accounts: accountsWithBalances };
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
      execute: async ({ timeframe }) => {
        const timeframeMap: Record<string, number> = {
          "1m": 30,
          "3m": 90,
          "6m": 180,
          "1y": 365,
          all: 3650,
        };
        const days = timeframeMap[timeframe];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get all accounts for tenant
        const tenantAccounts = await db
          .select({ id: accounts.id, type: accounts.type })
          .from(accounts)
          .where(eq(accounts.tenantId, tenantId));

        const accountIds = tenantAccounts.map((a) => a.id);

        if (accountIds.length === 0) {
          return { currentNetWorth: 0, history: [], breakdown: {} };
        }

        // Get latest balances
        const latestBalances = await Promise.all(
          tenantAccounts.map(async (account) => {
            const [latest] = await db
              .select({ balance: balanceSnapshots.balance })
              .from(balanceSnapshots)
              .where(eq(balanceSnapshots.accountId, account.id))
              .orderBy(desc(balanceSnapshots.snapshotAt))
              .limit(1);

            const balance = parseFloat(latest?.balance ?? "0");
            // Credit and loan are liabilities (negative)
            const adjustedBalance =
              account.type === "credit" || account.type === "loan"
                ? -Math.abs(balance)
                : balance;

            return { type: account.type, balance: adjustedBalance };
          })
        );

        const currentNetWorth = latestBalances.reduce(
          (sum, b) => sum + b.balance,
          0
        );

        // Group by type for breakdown
        const breakdown: Record<string, number> = {};
        latestBalances.forEach(({ type, balance }) => {
          breakdown[type] = (breakdown[type] ?? 0) + balance;
        });

        return {
          currentNetWorth,
          breakdown,
          accountCount: accountIds.length,
        };
      },
    }),

    get_holdings: tool({
      description: "Get investment holdings with securities information",
      inputSchema: z.object({}),
      execute: async () => {
        const results = await db
          .select({
            id: holdings.id,
            accountId: holdings.accountId,
            quantity: holdings.quantity,
            institutionPrice: holdings.institutionPrice,
            institutionValue: holdings.institutionValue,
            costBasis: holdings.costBasis,
            securityName: securities.name,
            tickerSymbol: securities.tickerSymbol,
            securityType: securities.type,
          })
          .from(holdings)
          .innerJoin(securities, eq(holdings.securityId, securities.id))
          .where(eq(holdings.tenantId, tenantId));

        const totalValue = results.reduce(
          (sum, h) => sum + parseFloat(h.institutionValue ?? "0"),
          0
        );

        return { holdings: results, totalValue };
      },
    }),

    get_asset_allocation: tool({
      description: "Get breakdown of assets by account type",
      inputSchema: z.object({}),
      execute: async () => {
        const tenantAccounts = await db
          .select({ id: accounts.id, type: accounts.type, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.tenantId, tenantId));

        const allocation: Record<
          string,
          { total: number; accounts: { name: string; balance: number }[] }
        > = {};

        for (const account of tenantAccounts) {
          const [latest] = await db
            .select({ balance: balanceSnapshots.balance })
            .from(balanceSnapshots)
            .where(eq(balanceSnapshots.accountId, account.id))
            .orderBy(desc(balanceSnapshots.snapshotAt))
            .limit(1);

          const balance = parseFloat(latest?.balance ?? "0");

          if (!allocation[account.type]) {
            allocation[account.type] = { total: 0, accounts: [] };
          }
          allocation[account.type].total += balance;
          allocation[account.type].accounts.push({
            name: account.name,
            balance,
          });
        }

        return { allocation };
      },
    }),
  };
}
