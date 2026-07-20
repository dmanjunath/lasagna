import { Hono } from "hono";
import { eq, desc, inArray, and, sql, holdings, securities, accounts, balanceSnapshots } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { aggregatePortfolio, extractAllocation, symbolAccountBreakdown, type HoldingInput } from "../services/portfolio-aggregator.js";
import { loadSecurityClassifications } from "../lib/security-classifier.js";

export const portfolioRoutes = new Hono<AuthEnv>();

portfolioRoutes.get("/composition", async (c) => {
  const session = c.get("session");

  // Use shared helper to get holdings
  const holdingsInput = await getHoldingsInput(session.tenantId);
  const composition = aggregatePortfolio(holdingsInput);

  return c.json(composition);
});

// Per-symbol account breakdown — which account(s) hold a given symbol, and how
// much in each. Reuses the same tenant-scoped holdings the composition chart is
// built from, so per-account numbers reconcile to that symbol's chart total.
portfolioRoutes.get("/holdings/:symbol/accounts", async (c) => {
  const session = c.get("session");
  const symbol = decodeURIComponent(c.req.param("symbol"));

  const holdingsInput = await getHoldingsInput(session.tenantId);
  return c.json(symbolAccountBreakdown(holdingsInput, symbol));
});

// Get holdings with security and account details (used by portfolio routes + chat tools)
export async function getHoldingsInput(tenantId: string): Promise<HoldingInput[]> {
  const rows = await db.query.holdings.findMany({
    where: eq(holdings.tenantId, tenantId),
    orderBy: desc(holdings.snapshotAt),
  });

  // Deduplicate by taking most recent snapshot per security+account
  const latestHoldings = new Map<string, typeof rows[0]>();
  for (const row of rows) {
    const key = `${row.accountId}-${row.securityId}`;
    if (!latestHoldings.has(key)) {
      latestHoldings.set(key, row);
    }
  }

  const holdingsArray = Array.from(latestHoldings.values());
  const holdingsInput: HoldingInput[] = [];

  if (holdingsArray.length > 0) {
    // Batch fetch all securities and accounts using inArray
    const securityIds = [...new Set(holdingsArray.map(h => h.securityId))];
    const accountIds = [...new Set(holdingsArray.map(h => h.accountId))];

    const [allSecurities, allAccounts] = await Promise.all([
      db.query.securities.findMany({ where: inArray(securities.id, securityIds) }),
      db.query.accounts.findMany({ where: inArray(accounts.id, accountIds) }),
    ]);

    const securitiesMap = new Map(allSecurities.map(s => [s.id, s]));
    const accountsMap = new Map(allAccounts.map(a => [a.id, a]));

    for (const h of holdingsArray) {
      const sec = securitiesMap.get(h.securityId);
      const acct = accountsMap.get(h.accountId);
      if (acct?.excludeFromNetWorth) continue;
      if (sec && acct) {
        holdingsInput.push({
          ticker: sec.tickerSymbol || 'UNKNOWN',
          value: parseFloat(h.institutionValue || '0'),
          shares: parseFloat(h.quantity || '0'),
          name: sec.name || sec.tickerSymbol || 'Unknown Security',
          account: acct.name,
          costBasis: h.costBasis ? parseFloat(h.costBasis) : null,
          securityType: sec.type || undefined,
        });
      }
    }
  }

  // Include depository account balances (savings, checking, cash management) as cash
  const depositoryAccts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.tenantId, tenantId),
      sql`${accounts.type} = 'depository'`,
      eq(accounts.excludeFromNetWorth, false),
    ),
  });

  for (const acct of depositoryAccts) {
    const latest = await db.query.balanceSnapshots.findFirst({
      where: eq(balanceSnapshots.accountId, acct.id),
      orderBy: desc(balanceSnapshots.snapshotAt),
    });
    const raw = parseFloat(latest?.balance ?? "0");
    const balance = acct.invertBalance ? -raw : raw;
    if (balance > 0) {
      holdingsInput.push({
        ticker: 'CASH',
        value: balance,
        shares: balance,
        name: `${acct.name} (Cash)`,
        account: acct.name,
        costBasis: balance,
        securityType: 'cash',
      });
    }
  }

  // Investment accounts without per-security holdings (e.g., manually entered
  // via Quick Import) get an assumed 60/40 split — 60% US stocks, 40% bonds —
  // so they show up in portfolio summaries instead of vanishing into a $0 total.
  // Without this, a manual $325k 401k looks like an empty portfolio to the LLM.
  const accountsWithRealHoldings = new Set(holdingsArray.map(h => h.accountId));
  const investmentAccts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.tenantId, tenantId),
      sql`${accounts.type} = 'investment'`,
    ),
  });

  for (const acct of investmentAccts) {
    if (accountsWithRealHoldings.has(acct.id)) continue;
    if (acct.excludeFromNetWorth) continue;
    const latest = await db.query.balanceSnapshots.findFirst({
      where: eq(balanceSnapshots.accountId, acct.id),
      orderBy: desc(balanceSnapshots.snapshotAt),
    });
    const raw = parseFloat(latest?.balance ?? "0");
    const balance = acct.invertBalance ? -raw : raw;
    if (balance <= 0) continue;

    const stockValue = balance * 0.6;
    const bondValue = balance * 0.4;

    holdingsInput.push({
      ticker: 'VTI',
      value: stockValue,
      shares: stockValue,
      name: `${acct.name} (assumed 60% US Stocks)`,
      account: acct.name,
      costBasis: stockValue,
      securityType: 'etf',
    });
    holdingsInput.push({
      ticker: 'BND',
      value: bondValue,
      shares: bondValue,
      name: `${acct.name} (assumed 40% Bonds)`,
      account: acct.name,
      costBasis: bondValue,
      securityType: 'etf',
    });
  }

  // Attach any globally-cached AI classifications so looked-up securities stop
  // showing as "Other"/"Unknown". The hardcoded ticker map still wins inside
  // getTickerCategoryWithFallback; this only helps symbols it can't place.
  const classifications = await loadSecurityClassifications(
    holdingsInput.map((h) => h.ticker),
  );
  for (const h of holdingsInput) {
    const cached = classifications.get(h.ticker.toUpperCase());
    if (cached) h.classified = cached;
  }

  return holdingsInput;
}

// Exposure analysis — aggregate by category across all accounts
// Shows "Total S&P 500 exposure" etc. with blended historical return
portfolioRoutes.get("/exposure", async (c) => {
  const session = c.get("session");

  const holdingsInput = await getHoldingsInput(session.tenantId);
  const composition = aggregatePortfolio(holdingsInput);

  // Historical average annual returns by category
  const CATEGORY_RETURNS: Record<string, number> = {
    "S&P 500": 10.2,
    "Total Market": 10.0,
    "Total World": 9.5,
    Growth: 11.5,
    Nasdaq: 12.0,
    Value: 9.5,
    "Small Cap": 10.5,
    "Mid Cap": 10.0,
    Dividend: 9.0,
    Developed: 7.5,
    Emerging: 8.0,
    "Total International": 7.5,
    "Total Bond": 5.0,
    Corporate: 5.5,
    Government: 4.5,
    TIPS: 4.0,
    Municipal: 4.0,
    "US REITs": 9.5,
    "International REITs": 7.0,
    "Money Market": 2.0,
    "Short-Term": 2.5,
    "Savings & Checking": 1.5,
    "Large Cap": 10.5,
    Unknown: 7.0,
  };

  // Build exposure groups: category across all accounts
  const exposures: Array<{
    name: string;
    assetClass: string;
    value: number;
    percentage: number;
    historicalReturn: number;
    holdings: Array<{ ticker: string; name: string; value: number; account: string; shares: number }>;
  }> = [];

  for (const ac of composition.assetClasses) {
    for (const cat of ac.categories) {
      exposures.push({
        name: cat.name,
        assetClass: ac.name,
        value: cat.value,
        percentage: cat.percentage,
        historicalReturn: CATEGORY_RETURNS[cat.name] ?? 7.0,
        holdings: cat.holdings.map((h) => ({
          ticker: h.ticker,
          name: h.name,
          value: h.value,
          account: h.account,
          shares: h.shares,
        })),
      });
    }
  }

  // Sort by value descending
  exposures.sort((a, b) => b.value - a.value);

  // Calculate blended historical return
  let weightedReturn = 0;
  for (const e of exposures) {
    weightedReturn += (e.percentage / 100) * e.historicalReturn;
  }

  return c.json({
    totalValue: composition.totalValue,
    blendedReturn: Math.round(weightedReturn * 100) / 100,
    exposures,
  });
});

portfolioRoutes.get("/allocation", async (c) => {
  const session = c.get("session");

  // Use shared helper to get holdings (batch queries, no N+1)
  const holdingsInput = await getHoldingsInput(session.tenantId);
  const composition = aggregatePortfolio(holdingsInput);
  const allocation = extractAllocation(composition);

  return c.json({
    allocation,
    totalValue: composition.totalValue,
  });
});
