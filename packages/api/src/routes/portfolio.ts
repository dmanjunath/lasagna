import { Hono } from "hono";
import { eq, desc, inArray, and, sql, holdings, securities, accounts, balanceSnapshots } from "@lasagna/core";
import { db } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { aggregatePortfolio, extractAllocation, type HoldingInput } from "../services/portfolio-aggregator.js";

export const portfolioRoutes = new Hono<AuthEnv>();
portfolioRoutes.use("*", requireAuth);

portfolioRoutes.get("/composition", async (c) => {
  const session = c.get("session");

  // Use shared helper to get holdings
  const holdingsInput = await getHoldingsInput(session.tenantId);
  const composition = aggregatePortfolio(holdingsInput);

  return c.json(composition);
});

// Helper function to get holdings with security and account details
async function getHoldingsInput(tenantId: string): Promise<HoldingInput[]> {
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
  if (holdingsArray.length === 0) return [];

  // Batch fetch all securities and accounts using inArray
  const securityIds = [...new Set(holdingsArray.map(h => h.securityId))];
  const accountIds = [...new Set(holdingsArray.map(h => h.accountId))];

  const [allSecurities, allAccounts] = await Promise.all([
    db.query.securities.findMany({ where: inArray(securities.id, securityIds) }),
    db.query.accounts.findMany({ where: inArray(accounts.id, accountIds) }),
  ]);

  const securitiesMap = new Map(allSecurities.map(s => [s.id, s]));
  const accountsMap = new Map(allAccounts.map(a => [a.id, a]));

  const holdingsInput: HoldingInput[] = [];
  for (const h of holdingsArray) {
    const sec = securitiesMap.get(h.securityId);
    const acct = accountsMap.get(h.accountId);
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

  // Include depository account balances (savings, checking, cash management) as cash
  const depositoryAccts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.tenantId, tenantId),
      sql`${accounts.type} = 'depository'`,
    ),
  });

  for (const acct of depositoryAccts) {
    const latest = await db.query.balanceSnapshots.findFirst({
      where: eq(balanceSnapshots.accountId, acct.id),
      orderBy: desc(balanceSnapshots.snapshotAt),
    });
    const balance = parseFloat(latest?.balance ?? "0");
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

  return holdingsInput;
}

// Exposure analysis — aggregate by subcategory across all accounts
// Shows "Total S&P 500 exposure" etc. with blended historical return
portfolioRoutes.get("/exposure", async (c) => {
  const session = c.get("session");

  const holdingsInput = await getHoldingsInput(session.tenantId);
  const composition = aggregatePortfolio(holdingsInput);

  // Historical average annual returns by subcategory
  const SUBCATEGORY_RETURNS: Record<string, number> = {
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
    "Large Cap": 10.5,
    Unknown: 7.0,
  };

  // Build exposure groups: subcategory across all accounts
  const exposures: Array<{
    name: string;
    assetClass: string;
    value: number;
    percentage: number;
    historicalReturn: number;
    holdings: Array<{ ticker: string; name: string; value: number; account: string; shares: number }>;
  }> = [];

  for (const ac of composition.assetClasses) {
    for (const sc of ac.subCategories) {
      exposures.push({
        name: sc.name,
        assetClass: ac.name,
        value: sc.value,
        percentage: sc.percentage,
        historicalReturn: SUBCATEGORY_RETURNS[sc.name] ?? 7.0,
        holdings: sc.holdings.map((h) => ({
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
