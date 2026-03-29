import { Hono } from "hono";
import { eq, desc, holdings, securities, accounts } from "@lasagna/core";
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

  // Enrich with security and account details
  const enriched = await Promise.all(
    holdingsArray.map(async (h) => {
      const sec = await db.query.securities.findFirst({
        where: eq(securities.id, h.securityId),
      });
      const acct = await db.query.accounts.findFirst({
        where: eq(accounts.id, h.accountId),
      });

      if (!sec || !acct) return null;

      return {
        ticker: sec.tickerSymbol || 'UNKNOWN',
        value: parseFloat(h.institutionValue || '0'),
        shares: parseFloat(h.quantity || '0'),
        name: sec.name || sec.tickerSymbol || 'Unknown Security',
        account: acct.name,
        costBasis: h.costBasis ? parseFloat(h.costBasis) : null,
        securityType: sec.type || undefined,
      } as HoldingInput;
    }),
  );

  return enriched.filter((h): h is HoldingInput => h !== null);
}

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
