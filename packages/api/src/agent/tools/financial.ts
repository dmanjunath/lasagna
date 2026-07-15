import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import {
  financialProfiles,
  transactions,
  recurringTransactions,
  goals,
  goalAccounts,
  accounts,
  eq,
  and,
  desc,
  sql,
} from "@lasagna/core";
import { getHoldingsInput } from "../../routes/portfolio.js";
import { aggregatePortfolio } from "../../services/portfolio-aggregator.js";
import {
  fetchAccountsWithBalances,
  netWorthContribution,
} from "../../lib/account-balances.js";
import { buildGoalAccountMap, resolveGoalAmount } from "../../lib/goal-progress.js";
import { loadTaxonomy, UUID_RE } from "../../lib/taxonomy.js";

/** Parse the account.metadata JSON blob (property details, loan terms, etc.). */
function parseMeta(m: string | null): unknown {
  if (!m) return null;
  try {
    return JSON.parse(m);
  } catch {
    return m;
  }
}

export function createFinancialTools(tenantId: string) {
  return {
    get_accounts: tool({
      description:
        "Get ALL of the user's financial accounts with current balances and details. Covers every type: cash (checking/savings), investment & retirement (brokerage/401k/IRA/HSA), real estate / property, other/alternative assets, and liabilities (credit cards, loans, mortgages). Includes each account's `metadata` (e.g. property details for real estate, loan terms for debts). This is the complete account list — real estate and property ARE included here. Debts linked to a property carry propertyAccountId/propertyName, and real-estate accounts list their linkedDebtIds (e.g. the mortgage on a home) — use these to associate mortgages with properties.",
      inputSchema: z.object({}),
      execute: async () => {
        const [accts, rateRows] = await Promise.all([
          fetchAccountsWithBalances(tenantId),
          db
            .select({ id: accounts.id, apr: accounts.apr, apy: accounts.apy })
            .from(accounts)
            .where(eq(accounts.tenantId, tenantId)),
        ]);
        const rates = new Map(rateRows.map((r) => [r.id, r]));

        const nameById = new Map(accts.map((a) => [a.id, a.name]));
        const debtIdsByProperty = new Map<string, string[]>();
        for (const a of accts) {
          if (a.propertyAccountId) {
            const list = debtIdsByProperty.get(a.propertyAccountId) ?? [];
            list.push(a.id);
            debtIdsByProperty.set(a.propertyAccountId, list);
          }
        }

        return {
          accounts: accts.map((a) => {
            const rate = rates.get(a.id);
            return {
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
              // Interest rate: APR for loans/credit (e.g. mortgage rate), APY for deposits.
              apr: rate?.apr ? parseFloat(rate.apr) : null,
              apy: rate?.apy ? parseFloat(rate.apy) : null,
              // Property details (real estate), loan terms (debts), etc.
              metadata: parseMeta(a.metadata),
              // Mortgage↔property association (debt side / property side)
              propertyAccountId: a.propertyAccountId,
              propertyName: a.propertyAccountId ? (nameById.get(a.propertyAccountId) ?? null) : null,
              linkedDebtIds: a.type === "real_estate" ? (debtIdsByProperty.get(a.id) ?? []) : undefined,
            };
          }),
        };
      },
    }),

    get_net_worth: tool({
      description:
        "Get the user's current net worth with a per-type breakdown (cash, investment, real_estate, alternative, credit, loan). Real estate and all asset/liability types are included.",
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
      description: "Get investment holdings with securities information, grouped by asset class. Covers brokerage/retirement positions only (not real estate — use get_accounts for property).",
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

    get_debts: tool({
      description:
        "Get the user's debts and liabilities (credit cards, loans, mortgages) with balances, APR, and loan details (term, payment, payoff date) from metadata. Use for debt-payoff, interest, refinance, and minimum-payment questions. Debts linked to a real-estate account include property {id, name, currentValue} — use it for home-equity and LTV questions.",
      inputSchema: z.object({}),
      execute: async () => {
        const [accts, aprRows] = await Promise.all([
          fetchAccountsWithBalances(tenantId),
          db
            .select({ id: accounts.id, apr: accounts.apr, apy: accounts.apy })
            .from(accounts)
            .where(eq(accounts.tenantId, tenantId)),
        ]);
        const aprMap = new Map(aprRows.map((r) => [r.id, r.apr]));
        const byId = new Map(accts.map((a) => [a.id, a]));
        const liabilities = accts.filter(
          (a) => a.type === "credit" || a.type === "loan",
        );
        const apr = liabilities.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          subtype: a.subtype,
          balance: Math.abs(a.effectiveBalance),
          apr: aprMap.get(a.id) ? parseFloat(aprMap.get(a.id)!) : null,
          details: parseMeta(a.metadata),
          property: a.propertyAccountId
            ? {
                id: a.propertyAccountId,
                name: byId.get(a.propertyAccountId)?.name ?? null,
                currentValue: byId.get(a.propertyAccountId)?.effectiveBalance ?? null,
              }
            : null,
        }));
        return {
          debts: apr,
          totalDebt: apr.reduce((s, d) => s + d.balance, 0),
        };
      },
    }),

    get_goals: tool({
      description:
        "Get the user's savings goals with progress: name, category, target amount, current amount, planned monthly contribution, deadline, status, and which accounts fund each goal. Auto-tracked goals derive their progress from linked account balances.",
      inputSchema: z.object({}),
      execute: async () => {
        const [rows, links, accts] = await Promise.all([
          db.select().from(goals).where(eq(goals.tenantId, tenantId)),
          db.query.goalAccounts.findMany({
            where: eq(goalAccounts.tenantId, tenantId),
          }),
          fetchAccountsWithBalances(tenantId),
        ]);
        const accountMap = buildGoalAccountMap(links);
        const balanceById = new Map(accts.map((a) => [a.id, a.effectiveBalance]));
        return {
          goals: rows.map((g) => {
            const accountIds = accountMap.get(g.id) ?? [];
            const { amount, isAutoTracked } = resolveGoalAmount(
              g.currentAmount,
              accountIds,
              balanceById,
            );
            const target = parseFloat(g.targetAmount);
            return {
              id: g.id,
              name: g.name,
              category: g.category,
              target,
              current: amount,
              percentComplete: target > 0 ? Math.round((amount / target) * 100) : 0,
              plannedMonthlyContribution: g.monthlyContribution ? parseFloat(g.monthlyContribution) : null,
              deadline: g.deadline,
              status: g.status,
              autoTracked: isAutoTracked,
              fundedByAccountIds: accountIds,
            };
          }),
        };
      },
    }),

    get_transactions: tool({
      description:
        "Get individual transactions (date, name, merchant, amount, category, account). Positive amount = expense, negative = income. Use for questions about specific purchases, recent activity, or a detailed/filtered transaction list. For aggregate totals by category use get_spending_summary instead.",
      inputSchema: z.object({
        limit: z.number().optional().default(50).describe("Max rows (capped at 200)."),
        category: z.string().optional().describe("Filter to a single category."),
        startDate: z.string().optional().describe("ISO date, inclusive lower bound."),
        endDate: z.string().optional().describe("ISO date, inclusive upper bound."),
      }),
      execute: async ({ limit, category, startDate, endDate }) => {
        // Load tenant taxonomy to resolve the category param and map display names.
        const tax = await loadTaxonomy(tenantId);
        const taxById = new Map(tax.map((c) => [c.id, c.name]));

        const conds = [eq(transactions.tenantId, tenantId)];

        if (category) {
          // UUID → direct categoryId lookup; else case-insensitive name match, then systemKey.
          if (UUID_RE.test(category)) {
            if (!taxById.has(category)) {
              return {
                error: `Category id "${category}" not found. Known categories: ${tax.map((c) => c.name).join(", ")}.`,
              };
            }
            conds.push(eq(transactions.categoryId, category));
          } else {
            const lc = category.toLowerCase();
            const hit =
              tax.find((c) => c.name.toLowerCase() === lc) ??
              tax.find((c) => c.systemKey?.toLowerCase() === lc);
            if (!hit) {
              return {
                error: `Category "${category}" not found. Known categories: ${tax.map((c) => c.name).join(", ")}.`,
              };
            }
            conds.push(eq(transactions.categoryId, hit.id));
          }
        }

        if (startDate) conds.push(sql`${transactions.date} >= ${startDate}`);
        if (endDate) conds.push(sql`${transactions.date} <= ${endDate}`);
        const rows = await db
          .select({
            date: transactions.date,
            name: transactions.name,
            merchant: transactions.merchantName,
            amount: transactions.amount,
            categoryId: transactions.categoryId,
            accountId: transactions.accountId,
            pending: transactions.pending,
          })
          .from(transactions)
          .where(and(...conds))
          .orderBy(desc(transactions.date))
          .limit(Math.min(limit ?? 50, 200));
        return {
          transactions: rows.map((r) => ({
            date: r.date,
            name: r.name,
            merchant: r.merchant,
            amount: parseFloat(r.amount),
            // Display name via the taxonomy id.
            category: (r.categoryId ? taxById.get(r.categoryId) : undefined) ?? "Other",
            accountId: r.accountId,
            pending: r.pending === 1,
          })),
        };
      },
    }),

    get_recurring: tool({
      description:
        "Get recurring transactions — bills and subscriptions the user pays on a schedule (name, merchant, amount, frequency, next due date, category). Use for cash-flow, upcoming-bills, and subscription-audit questions.",
      inputSchema: z.object({}),
      execute: async () => {
        const [rows, tax] = await Promise.all([
          db
            .select()
            .from(recurringTransactions)
            .where(
              and(
                eq(recurringTransactions.tenantId, tenantId),
                eq(recurringTransactions.isActive, true),
              ),
            )
            .orderBy(recurringTransactions.nextDueDate),
          loadTaxonomy(tenantId),
        ]);
        const taxById = new Map(tax.map((c) => [c.id, c.name]));
        return {
          recurring: rows.map((r) => ({
            name: r.name,
            merchant: r.merchantName,
            amount: parseFloat(r.amount),
            frequency: r.frequency,
            nextDueDate: r.nextDueDate,
            // Display name via the taxonomy id.
            category: (r.categoryId ? taxById.get(r.categoryId) : undefined) ?? "Other",
            accountId: r.accountId,
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
