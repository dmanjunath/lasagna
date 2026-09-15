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
  /**
   * The rate the minimum was AMORTISED AT when we had to invent one, or null.
   *
   * Only the mortgage branch below invents a rate, and until now it did so
   * silently: every other estimate on the path says it is one, and this one
   * quoted a payment worked out from a number nobody supplied. Whatever shows
   * the payment shows this beside it.
   */
  minimumPaymentAssumedApr: number | null;
  termMonths: number | null;
  originationDate: string | null;
  payoffDate: string | null;
  propertyAccountId: string | null;
  liabilitySource: "plaid" | "manual" | null;
  liabilityLastSyncedAt: string | null;
  lastUpdated: Date | null;
  /**
   * A credit card's last statement balance and last payment, or null. Together
   * they say whether the card is paid in full each month (a transactor) or
   * carries a balance (a revolver) — see `creditCardPaysInFull`. Null on a loan,
   * which has no revolving statement, and on a card that reports neither.
   */
  lastStatementBalance: number | null;
  lastPaymentAmount: number | null;
  /**
   * The user's own designation that this card is paid in full every month. A
   * fallback for banks that report no statement/payment data: it makes the card
   * a transactor regardless of what sync knows. Credit cards only.
   */
  paidInFullMonthly: boolean;
}

/**
 * The rule behind `creditCardPaysInFull`, over the two raw numbers, so a caller
 * with its own account shape (the insights engine) applies the same test.
 *
 * The signal Plaid reports on the first sync, no transaction history needed:
 * did the last payment cover the last statement. A statement of nothing owed is
 * paid by definition. When the statement is missing, or a balance was owed and
 * no payment is on file, we cannot tell — and an unknown card is treated as a
 * carrier rather than dropped on a guess. A dollar of slack absorbs rounding.
 */
export function statementPaidInFull(
  lastStatementBalance: number | null,
  lastPaymentAmount: number | null,
): boolean {
  if (lastStatementBalance == null) return false;
  if (lastStatementBalance <= 0) return true;
  if (lastPaymentAmount == null) return false;
  return lastPaymentAmount >= lastStatementBalance - 1;
}

/**
 * Whether a credit card is paid in full each month rather than carrying a
 * balance. A transactor's current balance is this month's spending, cleared by
 * the due date, so it is not a debt to plan a payoff for.
 */
export function creditCardPaysInFull(account: DebtAccount): boolean {
  if (account.type !== "credit") return false;
  // A manual designation is the fallback when the bank reports no statement data.
  return (
    account.paidInFullMonthly ||
    statementPaidInFull(account.lastStatementBalance, account.lastPaymentAmount)
  );
}

/**
 * The rate a mortgage payment is amortised at when the account reports none.
 *
 * A stand-in for ordering and for a payment estimate, never a claim about this
 * loan. Anything that shows a payment worked out from it says so.
 */
const DEFAULT_MORTGAGE_APR = 6.5;

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
      // Typed metadata FIRST. The raw block below was written as a legacy
      // fallback and guarded on `!typedMeta`, so every Plaid-synced loan, which
      // always carries a type discriminant, skipped it and reported no
      // origination date and no term at all. `MortgageMetadata` has declared
      // both fields the whole time. The effect was that a mortgage taken out in
      // 2022 had no schedule to date, and was dated thirty years from today.
      if (typedMeta) {
        if ("originationDate" in typedMeta && typeof typedMeta.originationDate === "string") {
          originationDate = typedMeta.originationDate;
        }
        if ("loanTermYears" in typedMeta && typeof typedMeta.loanTermYears === "number") {
          termMonths = Math.round(typedMeta.loanTermYears * 12);
        } else if (
          typedMeta.type === "mortgage" &&
          typeof typedMeta.loanTerm === "string" &&
          /^\s*(\d+)\s*year/i.test(typedMeta.loanTerm)
        ) {
          termMonths = Number(/^\s*(\d+)\s*year/i.exec(typedMeta.loanTerm)![1]) * 12;
        }
      } else if (acct.metadata) {
        try {
          const raw = JSON.parse(acct.metadata);
          // The metadata never carries `termMonths`: Plaid reports a mortgage's
          // term as `loanTerm` ("30 year") and the manual form writes
          // `loanTermYears`, so reading only the first key left every loan with
          // no term and no schedule to date it from.
          termMonths =
            typeof raw.termMonths === "number"
              ? raw.termMonths
              : typeof raw.loanTermYears === "number"
                ? Math.round(raw.loanTermYears * 12)
                : typeof raw.loanTerm === "string" && /^\s*(\d+)\s*year/i.test(raw.loanTerm)
                  ? Number(/^\s*(\d+)\s*year/i.exec(raw.loanTerm)![1]) * 12
                  : null;
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
      let minimumPaymentAssumedApr: number | null = null;
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
        const rate = interestRate ?? DEFAULT_MORTGAGE_APR;
        if (interestRate == null) minimumPaymentAssumedApr = DEFAULT_MORTGAGE_APR;
        const r = rate / 100 / 12;
        const n = 360;
        minimumPayment =
          r > 0 ? (balance * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1) : balance / n;
      } else if (termMonths && originationDate) {
        const originated = new Date(originationDate);
        // Counted in calendar months, not in average-length ones. Dividing by
        // 30.44 days makes the answer depend on which day of the month it is
        // run: a loan originated exactly twelve months ago measured 11.99 and
        // floored to 11, so its payment moved as the calendar rolled past the
        // day of the month it started on.
        // UTC on BOTH sides. An origination date is a bare "YYYY-MM-DD", which
        // parses as midnight UTC, so comparing it against local calendar parts
        // makes the answer depend on the machine's timezone as well as the day.
        const now = new Date();
        const monthsElapsed =
          (now.getUTCFullYear() - originated.getUTCFullYear()) * 12 +
          (now.getUTCMonth() - originated.getUTCMonth()) -
          (now.getUTCDate() < originated.getUTCDate() ? 1 : 0);
        const remaining = termMonths - monthsElapsed;
        // A loan past its own term has no schedule left to spread the balance
        // over. Clamping the months remaining to 1 asked for the entire balance
        // as a monthly payment, so a $27,537 auto loan whose term ran out
        // reported a minimum of $27,537 a month. Past the term the schedule
        // tells us nothing, so it falls back to the same estimate a balance
        // with no schedule at all gets.
        minimumPayment = remaining >= 1 ? balance / remaining : Math.max(balance * 0.02, 25);
      } else {
        minimumPayment = Math.max(balance * 0.02, 25);
      }

      minimumPayment = Math.round(minimumPayment * 100) / 100;
      const minimumPaymentEstimated = typedMinPayment == null;

      // Statement/payment behaviour is a credit card concept; a loan has neither.
      const lastStatementBalance =
        typedMeta?.type === "credit_card" ? typedMeta.lastStatementBalance ?? null : null;
      const lastPaymentAmount =
        typedMeta?.type === "credit_card" ? typedMeta.lastPaymentAmount ?? null : null;

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
        minimumPaymentAssumedApr,
        termMonths,
        originationDate,
        payoffDate,
        propertyAccountId: acct.propertyAccountId ?? null,
        liabilitySource: typedMeta?.source ?? null,
        liabilityLastSyncedAt: typedMeta?.lastSyncedAt ?? null,
        lastUpdated: latest?.snapshotAt ?? null,
        lastStatementBalance,
        lastPaymentAmount,
        paidInFullMonthly: acct.paidInFullMonthly,
      };
    }),
  );
}
