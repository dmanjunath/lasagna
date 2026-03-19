import {
  eq,
  and,
  plaidItems,
  accounts,
  balanceSnapshots,
  securities,
  holdings,
  syncLog,
  decrypt,
  parseLoanMetadata,
  LoanMetadata,
} from "@lasagna/core";
import { db } from "./db.js";
import { plaidClient } from "./plaid.js";
import { env } from "./env.js";
import { syncTransactions } from "./transaction-sync.js";

export async function syncItem(itemId: string): Promise<void> {
  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, itemId),
  });
  if (!item) throw new Error(`Plaid item ${itemId} not found`);

  // Skip manual entry items — they have no Plaid connection to sync
  if (item.accessToken.startsWith("manual-")) {
    return;
  }

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
        where: and(
          eq(accounts.plaidAccountId, plaidAcct.account_id),
          eq(accounts.plaidItemId, item.id),
        ),
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
          where: and(
            eq(accounts.plaidAccountId, h.account_id),
            eq(accounts.plaidItemId, item.id),
          ),
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

    // Sync liability details (mortgages, student loans, credit cards)
    try {
      const liabResp = await plaidClient.liabilitiesGet({
        access_token: accessToken,
      });
      const liabilities = liabResp.data.liabilities;

      const syncedAt = new Date().toISOString();
      const entries: Array<{ account_id: string; metadata: LoanMetadata }> = [];

      // Map mortgage liabilities
      for (const m of liabilities.mortgage ?? []) {
        if (!m.account_id) continue;
        entries.push({
          account_id: m.account_id,
          metadata: {
            type: "mortgage",
            source: "plaid",
            interestRatePercentage: m.interest_rate.percentage ?? undefined,
            interestRateType:
              m.interest_rate.type === "fixed"
                ? "fixed"
                : m.interest_rate.type === "variable"
                  ? "variable"
                  : undefined,
            originationDate: m.origination_date ?? undefined,
            originationPrincipal: m.origination_principal_amount ?? undefined,
            maturityDate: m.maturity_date ?? undefined,
            loanTerm: m.loan_term ?? undefined,
            loanTypeDescription: m.loan_type_description ?? undefined,
            nextMonthlyPayment: m.next_monthly_payment ?? undefined,
            nextPaymentDueDate: m.next_payment_due_date ?? undefined,
            lastPaymentAmount: m.last_payment_amount ?? undefined,
            lastPaymentDate: m.last_payment_date ?? undefined,
            escrowBalance: m.escrow_balance ?? undefined,
            hasPmi: m.has_pmi ?? undefined,
            ytdInterestPaid: m.ytd_interest_paid ?? undefined,
            ytdPrincipalPaid: m.ytd_principal_paid ?? undefined,
            lastSyncedAt: syncedAt,
          },
        });
      }

      // Map student loan liabilities
      for (const s of liabilities.student ?? []) {
        if (!s.account_id) continue;
        entries.push({
          account_id: s.account_id,
          metadata: {
            type: "student_loan",
            source: "plaid",
            interestRatePercentage: s.interest_rate_percentage ?? undefined,
            originationDate: s.origination_date ?? undefined,
            originationPrincipal: s.origination_principal_amount ?? undefined,
            expectedPayoffDate: s.expected_payoff_date ?? undefined,
            minimumPaymentAmount: s.minimum_payment_amount ?? undefined,
            nextPaymentDueDate: s.next_payment_due_date ?? undefined,
            lastPaymentAmount: s.last_payment_amount ?? undefined,
            lastPaymentDate: s.last_payment_date ?? undefined,
            isOverdue: s.is_overdue ?? undefined,
            repaymentPlanType: s.repayment_plan?.type ?? undefined,
            repaymentPlanDescription: s.repayment_plan?.description ?? undefined,
            guarantor: s.guarantor ?? undefined,
            outstandingInterest: s.outstanding_interest_amount ?? undefined,
            ytdInterestPaid: s.ytd_interest_paid ?? undefined,
            ytdPrincipalPaid: s.ytd_principal_paid ?? undefined,
            lastSyncedAt: syncedAt,
          },
        });
      }

      // Map credit card liabilities
      for (const cc of liabilities.credit ?? []) {
        if (!cc.account_id) continue;
        entries.push({
          account_id: cc.account_id,
          metadata: {
            type: "credit_card",
            source: "plaid",
            minimumPaymentAmount: cc.minimum_payment_amount ?? undefined,
            nextPaymentDueDate: cc.next_payment_due_date ?? undefined,
            lastPaymentAmount: cc.last_payment_amount ?? undefined,
            lastPaymentDate: cc.last_payment_date ?? undefined,
            lastStatementBalance: cc.last_statement_balance ?? undefined,
            isOverdue: cc.is_overdue ?? undefined,
            aprs: cc.aprs?.map((a) => ({
              aprType: a.apr_type,
              aprPercentage: a.apr_percentage,
              balanceSubjectToApr: a.balance_subject_to_apr ?? undefined,
            })),
            lastSyncedAt: syncedAt,
          },
        });
      }

      // Write each entry — skip manual overrides
      for (const entry of entries) {
        const acct = await db.query.accounts.findFirst({
          where: and(
            eq(accounts.plaidAccountId, entry.account_id),
            eq(accounts.plaidItemId, item.id),
          ),
        });
        if (!acct) continue;

        const existingMeta = parseLoanMetadata(acct.metadata ?? null);
        if (existingMeta?.source === "manual") {
          console.info(
            `[sync] Skipping liability write for account ${acct.id} — manual override present`,
          );
          continue;
        }

        await db
          .update(accounts)
          .set({ metadata: JSON.stringify(entry.metadata) })
          .where(
            and(
              eq(accounts.plaidAccountId, entry.account_id),
              eq(accounts.plaidItemId, item.id),
            ),
          );
      }
    } catch (e) {
      // Extract Plaid error code if available, avoid dumping the full Axios object
      let detail = e instanceof Error ? e.message : String(e);
      if (e && typeof e === "object" && "response" in e) {
        const plaidErr = e as { response?: { data?: { error_code?: string; error_message?: string } } };
        if (plaidErr.response?.data?.error_code) {
          detail = `${plaidErr.response.data.error_code}: ${plaidErr.response.data.error_message}`;
        }
      }
      console.log(`[sync] liabilitiesGet skipped for item ${item.id}: ${detail}`);
      // Do not rethrow — liability sync failure must not fail the overall sync
    }

    // Sync transactions
    try {
      await syncTransactions(itemId);
    } catch (e) {
      console.error(`Transaction sync failed for item ${itemId}:`, e);
      // Don't fail the whole sync if transactions fail
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
