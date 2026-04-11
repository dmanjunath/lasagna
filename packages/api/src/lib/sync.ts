import {
  eq,
  plaidItems,
  accounts,
  balanceSnapshots,
  securities,
  holdings,
  syncLog,
  decrypt,
} from "@lasagna/core";
import { db } from "./db.js";
import { plaidClient } from "./plaid.js";
import { env } from "./env.js";

export async function syncItem(itemId: string): Promise<void> {
  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, itemId),
  });
  if (!item) throw new Error(`Plaid item ${itemId} not found`);

  const [logEntry] = await db
    .insert(syncLog)
    .values({
      tenantId: item.tenantId,
      plaidItemId: item.id,
      status: "running",
    })
    .returning();

  try {
    const accessToken = await decrypt(item.accessToken, env.ENCRYPTION_KEY);

    // Sync accounts and balances
    const balResp = await plaidClient.accountsBalanceGet({
      access_token: accessToken,
    });

    for (const plaidAcct of balResp.data.accounts) {
      // Upsert account
      const existing = await db.query.accounts.findFirst({
        where: eq(accounts.plaidAccountId, plaidAcct.account_id),
      });

      let accountId: string;
      if (existing) {
        accountId = existing.id;
      } else {
        const [created] = await db
          .insert(accounts)
          .values({
            tenantId: item.tenantId,
            plaidItemId: item.id,
            plaidAccountId: plaidAcct.account_id,
            name: plaidAcct.name,
            type: plaidAcct.type as "depository" | "investment" | "credit" | "loan",
            subtype: plaidAcct.subtype ?? null,
            mask: plaidAcct.mask ?? null,
          })
          .returning();
        accountId = created.id;
      }

      // Insert balance snapshot
      await db.insert(balanceSnapshots).values({
        accountId,
        tenantId: item.tenantId,
        balance: plaidAcct.balances.current?.toString() ?? null,
        available: plaidAcct.balances.available?.toString() ?? null,
        limit: plaidAcct.balances.limit?.toString() ?? null,
        isoCurrencyCode: plaidAcct.balances.iso_currency_code ?? null,
      });
    }

    // Sync investments (if applicable)
    try {
      const holdResp = await plaidClient.investmentsHoldingsGet({
        access_token: accessToken,
      });

      // Upsert securities
      for (const sec of holdResp.data.securities) {
        const existing = await db.query.securities.findFirst({
          where: eq(securities.plaidSecurityId, sec.security_id),
        });
        if (!existing) {
          await db.insert(securities).values({
            plaidSecurityId: sec.security_id,
            name: sec.name ?? null,
            tickerSymbol: sec.ticker_symbol ?? null,
            type: sec.type ?? null,
            closePrice: sec.close_price?.toString() ?? null,
            closePriceAsOf: sec.close_price_as_of
              ? new Date(sec.close_price_as_of)
              : null,
          });
        }
      }

      // Insert holdings snapshot
      for (const h of holdResp.data.holdings) {
        const acct = await db.query.accounts.findFirst({
          where: eq(accounts.plaidAccountId, h.account_id),
        });
        const sec = await db.query.securities.findFirst({
          where: eq(securities.plaidSecurityId, h.security_id),
        });
        if (acct && sec) {
          await db.insert(holdings).values({
            accountId: acct.id,
            tenantId: item.tenantId,
            securityId: sec.id,
            quantity: h.quantity?.toString() ?? null,
            institutionPrice: h.institution_price?.toString() ?? null,
            institutionValue: h.institution_value?.toString() ?? null,
            costBasis: h.cost_basis?.toString() ?? null,
          });
        }
      }
    } catch {
      // Not an investment account — skip
    }

    // Mark sync as complete
    await db
      .update(syncLog)
      .set({ status: "success", completedAt: new Date() })
      .where(eq(syncLog.id, logEntry.id));

    await db
      .update(plaidItems)
      .set({ lastSyncedAt: new Date() })
      .where(eq(plaidItems.id, item.id));
  } catch (err) {
    // Extract detailed Plaid error if available
    let errorMessage = err instanceof Error ? err.message : String(err);
    if (err && typeof err === "object" && "response" in err) {
      const plaidErr = err as { response?: { data?: { error_message?: string; error_code?: string } } };
      if (plaidErr.response?.data) {
        const { error_code, error_message } = plaidErr.response.data;
        errorMessage = `${error_code}: ${error_message}`;
      }
    }
    console.error(`Sync failed for item ${itemId}:`, errorMessage);

    await db
      .update(syncLog)
      .set({
        status: "error",
        error: errorMessage,
        completedAt: new Date(),
      })
      .where(eq(syncLog.id, logEntry.id));
    throw err;
  }
}

export async function syncAllForTenant(tenantId: string): Promise<void> {
  const items = await db.query.plaidItems.findMany({
    where: eq(plaidItems.tenantId, tenantId),
  });
  await Promise.allSettled(items.map((item) => syncItem(item.id)));

  // Generate fresh insights after sync completes
  try {
    const { generateInsights } = await import("./insights-engine.js");
    await generateInsights(tenantId);
  } catch (e) {
    console.error("Post-sync insights generation failed:", e);
  }
}
