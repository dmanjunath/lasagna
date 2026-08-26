import { eq, desc, and, sql, accounts, balanceSnapshots, parseLoanMetadata } from "@lasagna/core";
import { db } from "./db.js";

/**
 * One credit/loan account with its rate and payment resolved. `apr` is the
 * single source of truth for a per-account rate: both the debt page and the
 * priority ladder read it, so they can never disagree about the same account.
 */
export interface DebtAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance: number;
  /** Annual rate in percent (6.5 = 6.5%), or null when the account has none on file. */
  apr: number | null;
  minimumPayment: number;
  /**
   * True when `minimumPayment` was derived here rather than reported by the
   * lender. A step that funds this account must say so rather than presenting
   * an estimate as the lender's own number.
   */
  minimumPaymentEstimated: boolean;
  termMonths: number | null;
  originationDate: string | null;
  payoffDate: string | null;
  propertyAccountId: string | null;
  liabilitySource: "plaid" | "manual" | null;
  liabilityLastSyncedAt: string | null;
  lastUpdated: Date | null;
}

/**
 * Resolve an account's APR from its stored metadata.
 *
 * Chain: typed card `aprs[].purchase_apr` (then the first APR listed) →
 * typed loan `interestRatePercentage` → legacy raw `interestRate`. Returns
 * null when no rate is on file — a missing rate is not a zero rate.
 */
export function resolveDebtApr(metadata: string | null): number | null {
  const typedMeta = parseLoanMetadata(metadata);

  if (typedMeta) {
    if (typedMeta.type === "credit_card") {
      const purchaseApr = typedMeta.aprs?.find((a) => a.aprType === "purchase_apr");
      return purchaseApr?.aprPercentage ?? typedMeta.aprs?.[0]?.aprPercentage ?? null;
    }
    return typedMeta.interestRatePercentage ?? null;
  }

  // Legacy raw fallback (seed/legacy data without a type discriminant).
  if (!metadata) return null;
  try {
    const raw = JSON.parse(metadata);
    return typeof raw.interestRate === "number" ? raw.interestRate : null;
  } catch {
    return null;
  }
}

/** All of a tenant's credit/loan accounts that count toward net worth. */
export async function resolveDebtAccounts(tenantId: string): Promise<DebtAccount[]> {
  const accts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.tenantId, tenantId),
      sql`${accounts.type} IN ('credit', 'loan')`,
      eq(accounts.excludeFromNetWorth, false),
    ),
  });

  return Promise.all(
    accts.map(async (acct) => {
      const latest = await db.query.balanceSnapshots.findFirst({
        where: eq(balanceSnapshots.accountId, acct.id),
        orderBy: [desc(balanceSnapshots.snapshotAt)],
      });

      const balance = Math.abs(parseFloat(latest?.balance ?? "0"));

      // Parse typed liability metadata
      const typedMeta = parseLoanMetadata(acct.metadata ?? null);

      // Legacy raw fallback (for seed/legacy data without a type discriminant)
      let termMonths: number | null = null;
      let originationDate: string | null = null;
      if (!typedMeta && acct.metadata) {
        try {
          const raw = JSON.parse(acct.metadata);
          termMonths = typeof raw.termMonths === "number" ? raw.termMonths : null;
          originationDate = typeof raw.originationDate === "string" ? raw.originationDate : null;
        } catch {
          // malformed — leave null
        }
      }

      const interestRate = resolveDebtApr(acct.metadata ?? null);

      // Resolve payoffDate
      let payoffDate: string | null = null;
      if (typedMeta) {
        if (typedMeta.type === "mortgage") {
          payoffDate = typedMeta.maturityDate ?? null;
        } else if (typedMeta.type === "student_loan") {
          payoffDate = typedMeta.expectedPayoffDate ?? null;
        } else if (typedMeta.type === "other_loan") {
          payoffDate = typedMeta.maturityDate ?? null;
        }
        // credit_card: payoffDate stays null — calculated client-side
      }

      // Resolve minimumPayment (3-step fallback)
      let minimumPayment: number;
      const isMortgage =
        acct.subtype === "mortgage" || acct.name?.toLowerCase().includes("mortgage");

      let typedMinPayment: number | undefined;
      if (typedMeta) {
        if (typedMeta.type === "mortgage" && typedMeta.nextMonthlyPayment != null) {
          typedMinPayment = typedMeta.nextMonthlyPayment;
        } else if ("minimumPaymentAmount" in typedMeta && typedMeta.minimumPaymentAmount != null) {
          typedMinPayment = typedMeta.minimumPaymentAmount;
        }
      }

      if (typedMinPayment != null) {
        minimumPayment = typedMinPayment;
      } else if (acct.type === "credit") {
        const monthlyInterest = interestRate ? balance * (interestRate / 100 / 12) : 0;
        minimumPayment = Math.max(balance * 0.02, monthlyInterest + balance * 0.01, 25);
      } else if (isMortgage && !termMonths) {
        const rate = interestRate ?? 6.5;
        const r = rate / 100 / 12;
        const n = 360;
        minimumPayment =
          r > 0 ? (balance * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1) : balance / n;
      } else if (termMonths && originationDate) {
        const originated = new Date(originationDate);
        const monthsElapsed =
          (Date.now() - originated.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        const remaining = Math.max(termMonths - Math.floor(monthsElapsed), 1);
        minimumPayment = balance / remaining;
      } else {
        minimumPayment = Math.max(balance * 0.02, 25);
      }

      minimumPayment = Math.round(minimumPayment * 100) / 100;
      const minimumPaymentEstimated = typedMinPayment == null;

      return {
        id: acct.id,
        name: acct.name,
        mask: acct.mask ?? null,
        type: acct.type,
        subtype: acct.subtype,
        balance,
        apr: interestRate,
        minimumPayment,
        minimumPaymentEstimated,
        termMonths,
        originationDate,
        payoffDate,
        propertyAccountId: acct.propertyAccountId ?? null,
        liabilitySource: typedMeta?.source ?? null,
        liabilityLastSyncedAt: typedMeta?.lastSyncedAt ?? null,
        lastUpdated: latest?.snapshotAt ?? null,
      };
    }),
  );
}
