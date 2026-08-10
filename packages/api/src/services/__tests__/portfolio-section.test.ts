import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HoldingInput } from "../portfolio-aggregator";

// Stub the DB-backed holdings source so the builder test stays pure — it feeds
// fixture holdings straight into the real aggregatePortfolio path.
const getHoldingsInput = vi.fn<(tenantId: string) => Promise<HoldingInput[]>>();
vi.mock("../../routes/portfolio.js", () => ({
  getHoldingsInput: (tenantId: string) => getHoldingsInput(tenantId),
}));

import { buildPortfolioSection } from "../portfolio-section";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildPortfolioSection", () => {
  it("collapses duplicate tickers (IVV + SPY) into one de-duped category line", async () => {
    getHoldingsInput.mockResolvedValue([
      { ticker: "IVV", value: 30000, shares: 60, name: "iShares S&P 500", account: "Brokerage", costBasis: null },
      { ticker: "SPY", value: 20000, shares: 40, name: "SPDR S&P 500", account: "IRA", costBasis: null },
      { ticker: "BND", value: 50000, shares: 500, name: "Vanguard Total Bond", account: "IRA", costBasis: null },
    ]);

    const section = await buildPortfolioSection("tenant-1");

    expect(getHoldingsInput).toHaveBeenCalledWith("tenant-1");
    expect(section.section).toBe("portfolio");
    expect(section.totalValue).toBe(100000);

    const usStocks = section.classes.find((c) => c.name === "US Stocks");
    expect(usStocks).toBeDefined();
    expect(usStocks!.value).toBe(50000);
    expect(usStocks!.weight).toBe(50);
    // IVV + SPY merge into a single "S&P 500" line, not two ticker rows.
    expect(usStocks!.categories).toHaveLength(1);
    expect(usStocks!.categories[0].name).toBe("S&P 500");
    expect(usStocks!.categories[0].value).toBe(50000);

    const bonds = section.classes.find((c) => c.name === "Bonds");
    expect(bonds!.value).toBe(50000);
    expect(bonds!.weight).toBe(50);
  });

  it("returns an empty composition when there are no holdings", async () => {
    getHoldingsInput.mockResolvedValue([]);

    const section = await buildPortfolioSection("tenant-1");

    expect(section.totalValue).toBe(0);
    expect(section.classes).toEqual([]);
  });
});
