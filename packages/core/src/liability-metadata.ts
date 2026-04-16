export interface MortgageMetadata {
  type: "mortgage";
  source: "plaid" | "manual";
  interestRatePercentage?: number;
  interestRateType?: "fixed" | "variable";
  originationDate?: string;         // YYYY-MM-DD
  originationPrincipal?: number;
  maturityDate?: string;             // YYYY-MM-DD — primary payoff date
  loanTerm?: string;                 // e.g. "30 year"
  loanTypeDescription?: string;      // e.g. "conventional"
  nextMonthlyPayment?: number;
  nextPaymentDueDate?: string;       // YYYY-MM-DD
  lastPaymentAmount?: number;
  lastPaymentDate?: string;          // YYYY-MM-DD
  escrowBalance?: number;
  hasPmi?: boolean;
  ytdInterestPaid?: number;
  ytdPrincipalPaid?: number;
  lastSyncedAt?: string;             // ISO datetime
}

export interface StudentLoanMetadata {
  type: "student_loan";
  source: "plaid" | "manual";
  interestRatePercentage?: number;
  originationDate?: string;          // YYYY-MM-DD
  originationPrincipal?: number;
  expectedPayoffDate?: string;       // YYYY-MM-DD — primary payoff date
  minimumPaymentAmount?: number;
  nextPaymentDueDate?: string;       // YYYY-MM-DD
  lastPaymentAmount?: number;
  lastPaymentDate?: string;          // YYYY-MM-DD
  isOverdue?: boolean;
  repaymentPlanType?: string;
  repaymentPlanDescription?: string;
  guarantor?: string;
  outstandingInterest?: number;
  ytdInterestPaid?: number;
  ytdPrincipalPaid?: number;
  lastSyncedAt?: string;
}

export interface CreditCardMetadata {
  type: "credit_card";
  source: "plaid" | "manual";
  minimumPaymentAmount?: number;
  nextPaymentDueDate?: string;       // YYYY-MM-DD
  lastPaymentAmount?: number;
  lastPaymentDate?: string;          // YYYY-MM-DD
  lastStatementBalance?: number;
  isOverdue?: boolean;
  aprs?: Array<{
    aprType: string;
    aprPercentage: number;
    balanceSubjectToApr?: number;
  }>;
  lastSyncedAt?: string;
}

export interface OtherLoanMetadata {
  type: "other_loan";
  source: "plaid" | "manual";
  interestRatePercentage?: number;
  originationDate?: string;          // YYYY-MM-DD
  originationPrincipal?: number;
  maturityDate?: string;             // YYYY-MM-DD — primary payoff date
  minimumPaymentAmount?: number;
  nextPaymentDueDate?: string;       // YYYY-MM-DD
  lastPaymentAmount?: number;
  lastPaymentDate?: string;          // YYYY-MM-DD
  isOverdue?: boolean;
  lastSyncedAt?: string;
}

export type LoanMetadata =
  | MortgageMetadata
  | StudentLoanMetadata
  | CreditCardMetadata
  | OtherLoanMetadata;

const KNOWN_TYPES = new Set(["mortgage", "student_loan", "credit_card", "other_loan"]);

/**
 * Parse accounts.metadata JSON into a typed LoanMetadata object.
 *
 * Returns null for:
 * - null / empty input
 * - malformed JSON
 * - legacy seed metadata (no `type` field)
 * - unknown `type` values
 *
 * Callers should fall back to raw JSON parsing for the legacy estimation
 * path when this returns null.
 */
export function parseLoanMetadata(raw: string | null): LoanMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!KNOWN_TYPES.has(parsed.type)) return null;
    return parsed as LoanMetadata;
  } catch {
    return null;
  }
}
