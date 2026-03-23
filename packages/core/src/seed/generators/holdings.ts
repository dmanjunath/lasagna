import type { Database } from "../../db.js";
import { securities, holdings, balanceSnapshots } from "../../schema.js";
import { eq, desc } from "drizzle-orm";
import { randomVariance } from "../utils.js";

const SECURITIES_POOL = [
  { ticker: "AAPL", name: "Apple Inc.", type: "equity", price: 195.5 },
  { ticker: "MSFT", name: "Microsoft Corporation", type: "equity", price: 420.0 },
  { ticker: "GOOGL", name: "Alphabet Inc.", type: "equity", price: 175.0 },
  { ticker: "AMZN", name: "Amazon.com Inc.", type: "equity", price: 185.0 },
  { ticker: "NVDA", name: "NVIDIA Corporation", type: "equity", price: 880.0 },
  { ticker: "VTI", name: "Vanguard Total Stock Market ETF", type: "etf", price: 265.0 },
  { ticker: "VXUS", name: "Vanguard Total International Stock ETF", type: "etf", price: 60.0 },
  { ticker: "BND", name: "Vanguard Total Bond Market ETF", type: "etf", price: 73.0 },
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", type: "etf", price: 485.0 },
  { ticker: "VNQ", name: "Vanguard Real Estate ETF", type: "etf", price: 85.0 },
  { ticker: "SCHD", name: "Schwab US Dividend Equity ETF", type: "etf", price: 78.0 },
  { ticker: "QQQ", name: "Invesco QQQ Trust", type: "etf", price: 480.0 },
  { ticker: "BRK.B", name: "Berkshire Hathaway Inc.", type: "equity", price: 410.0 },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", type: "equity", price: 195.0 },
  { ticker: "V", name: "Visa Inc.", type: "equity", price: 280.0 },
  { ticker: "JNJ", name: "Johnson & Johnson", type: "equity", price: 155.0 },
  { ticker: "PG", name: "Procter & Gamble Co.", type: "equity", price: 165.0 },
  { ticker: "BTC", name: "Bitcoin", type: "cryptocurrency", price: 65000.0 },
  { ticker: "ETH", name: "Ethereum", type: "cryptocurrency", price: 3500.0 },
  { ticker: "SOL", name: "Solana", type: "cryptocurrency", price: 150.0 },
];

const INVESTMENT_SUBTYPES = [
  "401k",
  "roth_401k",
  "ira",
  "roth_ira",
  "brokerage",
  "hsa",
  "529",
  "crypto",
];

export async function generateHoldings(
  db: Database,
  tenantId: string,
  createdAccounts: { accountId: string; key: string }[],
  timestamp: number,
): Promise<void> {
  const now = new Date();

  // Filter to only investment accounts
  const investmentAccounts = createdAccounts.filter((a) =>
    INVESTMENT_SUBTYPES.includes(a.key),
  );

  for (const { accountId, key } of investmentAccounts) {
    // Get account balance from latest snapshot
    const [latestSnapshot] = await db
      .select()
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.accountId, accountId))
      .orderBy(desc(balanceSnapshots.snapshotAt))
      .limit(1);

    const accountBalance = parseFloat(latestSnapshot?.balance || "0");
    if (accountBalance <= 0) continue;

    // Select securities based on account type
    const selectedSecurities = selectSecuritiesForAccount(key);

    // Allocate balance across securities
    const allocations = allocateBalance(accountBalance, selectedSecurities.length);

    for (let i = 0; i < selectedSecurities.length; i++) {
      const secData = selectedSecurities[i];
      const allocation = allocations[i];

      // Create or get security
      const security = await getOrCreateSecurity(db, secData, timestamp);

      // Calculate quantity
      const price = randomVariance(secData.price, 2);
      const quantity = allocation / price;
      const value = quantity * price;

      await db.insert(holdings).values({
        accountId,
        tenantId,
        securityId: security.id,
        quantity: String(quantity.toFixed(6)),
        institutionPrice: String(price.toFixed(2)),
        institutionValue: String(value.toFixed(2)),
        costBasis: String((value * randomVariance(0.9, 10)).toFixed(2)),
        snapshotAt: now,
      });
    }
  }
}

function selectSecuritiesForAccount(
  subtype: string,
): (typeof SECURITIES_POOL)[number][] {
  const isCrypto = subtype === "crypto";
  const isRetirement = ["401k", "roth_401k", "ira", "roth_ira"].includes(subtype);

  if (isCrypto) {
    return SECURITIES_POOL.filter((s) => s.type === "cryptocurrency");
  }

  if (isRetirement) {
    // Retirement: mostly ETFs
    const etfs = SECURITIES_POOL.filter((s) => s.type === "etf");
    return shuffleArray(etfs).slice(0, 5);
  }

  // Brokerage: mix of stocks and ETFs
  const nonCrypto = SECURITIES_POOL.filter((s) => s.type !== "cryptocurrency");
  return shuffleArray(nonCrypto).slice(0, 8);
}

function allocateBalance(total: number, count: number): number[] {
  const weights = Array.from({ length: count }, () => Math.random());
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / sum) * total);
}

async function getOrCreateSecurity(
  db: Database,
  data: (typeof SECURITIES_POOL)[number],
  timestamp: number,
) {
  const plaidId = `seed-${timestamp}-${data.ticker}`;

  const existing = await db
    .select()
    .from(securities)
    .where(eq(securities.plaidSecurityId, plaidId));

  if (existing.length > 0) return existing[0];

  const [security] = await db
    .insert(securities)
    .values({
      plaidSecurityId: plaidId,
      name: data.name,
      tickerSymbol: data.ticker,
      type: data.type,
      closePrice: String(randomVariance(data.price, 2)),
      closePriceAsOf: new Date(),
    })
    .returning();

  return security;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
