import { Hono } from "hono";
import { eq, holdings, securities, accounts } from "@lasagna/core";
import { db } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const holdingsRoutes = new Hono<AuthEnv>();
holdingsRoutes.use("*", requireAuth);

// List all holdings for the tenant
holdingsRoutes.get("/", async (c) => {
  const session = c.get("session");

  const rows = await db.query.holdings.findMany({
    where: eq(holdings.tenantId, session.tenantId),
  });

  // Enrich with security and account info
  const enriched = await Promise.all(
    rows.map(async (h) => {
      const sec = await db.query.securities.findFirst({
        where: eq(securities.id, h.securityId),
      });
      const acct = await db.query.accounts.findFirst({
        where: eq(accounts.id, h.accountId),
      });
      return {
        id: h.id,
        accountName: acct?.name ?? null,
        tickerSymbol: sec?.tickerSymbol ?? null,
        securityName: sec?.name ?? null,
        quantity: h.quantity,
        institutionPrice: h.institutionPrice,
        institutionValue: h.institutionValue,
        costBasis: h.costBasis,
        snapshotAt: h.snapshotAt,
      };
    }),
  );

  return c.json({ holdings: enriched });
});
