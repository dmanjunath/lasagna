# Plaid Liability Sync & Manual Override

**Date:** 2026-04-16
**Status:** Approved

## Problem

The debt page calculates payoff dates by assuming a fresh 30-year amortization on the current balance. For a mortgage originated years ago, this produces a payoff date ~30 years from today (e.g. 2056) instead of the correct remaining term (e.g. 2050). No payoff date should be assumed when real data is unavailable.

Plaid's Liabilities API provides `maturity_date`, `expected_payoff_date`, `interest_rate_percentage`, `minimum_payment_amount`, and ~15 other fields per loan type. Currently the sync only calls `accountsBalanceGet` and ignores all of this.

## Goals

- Sync all available Plaid liability data for mortgages, student loans, and credit cards during every account sync.
- Store data in typed, discriminated-union metadata — one shape per Plaid liability type.
- Provide a manual override endpoint + UI for accounts where Plaid has no liability data.
- Never assume a payoff date; return `null` and surface "Unknown — add details" in the UI when data is absent.

## Out of Scope

- Plaid auto/personal loan liability details (Plaid doesn't expose a dedicated endpoint for these; they sync as generic loan accounts with no liability payload).
- Backfilling historical liability data.

---

## TypeScript Models (`packages/core/src/liability-metadata.ts`)

A new file exports a discriminated union keyed on `type`. Each variant maps 1-1 to a Plaid liability type. The `source` field (`"plaid" | "manual"`) tracks provenance. All fields except `type` and `source` are optional so partial manual entry is valid.

### Variants

**`MortgageMetadata`** (`type: "mortgage"`)
- `interestRatePercentage`, `interestRateType` ("fixed" | "variable")
- `originationDate`, `originationPrincipal`
- `maturityDate` — primary payoff date
- `loanTerm` (e.g. "30 year"), `loanTypeDescription` (e.g. "conventional")
- `nextMonthlyPayment`, `nextPaymentDueDate`
- `lastPaymentAmount`, `lastPaymentDate`
- `escrowBalance`, `hasPmi`
- `ytdInterestPaid`, `ytdPrincipalPaid`
- `lastSyncedAt` (ISO timestamp)

**`StudentLoanMetadata`** (`type: "student_loan"`)
- `interestRatePercentage`
- `originationDate`, `originationPrincipal`
- `expectedPayoffDate` — primary payoff date
- `minimumPaymentAmount`
- `nextPaymentDueDate`
- `lastPaymentAmount`, `lastPaymentDate`
- `isOverdue`
- `repaymentPlanType`, `repaymentPlanDescription`
- `guarantor`, `outstandingInterest`
- `ytdInterestPaid`, `ytdPrincipalPaid`
- `lastSyncedAt`

**`CreditCardMetadata`** (`type: "credit_card"`)
- `minimumPaymentAmount`
- `nextPaymentDueDate`
- `lastPaymentAmount`, `lastPaymentDate`
- `lastStatementBalance`, `isOverdue`
- `aprs: Array<{ aprType, aprPercentage, balanceSubjectToApr? }>`
- `lastSyncedAt`

**`OtherLoanMetadata`** (`type: "other_loan"`)
For auto loans and any loan subtype Plaid doesn't expose via Liabilities.
- `interestRatePercentage`
- `originationDate`, `originationPrincipal`
- `maturityDate`
- `minimumPaymentAmount`
- `nextPaymentDueDate`
- `lastPaymentAmount`, `lastPaymentDate`
- `isOverdue`
- `lastSyncedAt`

### Parse helper

```typescript
export type LoanMetadata =
  | MortgageMetadata
  | StudentLoanMetadata
  | CreditCardMetadata
  | OtherLoanMetadata;

export function parseLoanMetadata(raw: string | null): LoanMetadata | null
```

Returns `null` for missing, empty, or malformed JSON, and for legacy seed metadata that lacks a `type` discriminant. Callers treat `null` as "no liability data available."

---

## Sync Changes (`packages/api/src/lib/sync.ts`)

After the existing `accountsBalanceGet` loop, add a `liabilitiesGet` call inside a try/catch. Failure (e.g. `PRODUCT_NOT_READY`, unsupported institution) is logged and skipped — it must not fail the overall sync.

### Mapping

```
plaidLiabilities.mortgage[]   → MortgageMetadata   (type: "mortgage")
plaidLiabilities.student[]    → StudentLoanMetadata (type: "student_loan")
plaidLiabilities.credit[]     → CreditCardMetadata  (type: "credit_card")
```

For each Plaid liability item, look up the account by `plaid_account_id`, build the typed metadata object with `source: "plaid"` and `lastSyncedAt: new Date().toISOString()`, serialize to JSON, and `UPDATE accounts SET metadata = ? WHERE plaid_account_id = ?`.

Only accounts returned in the liabilities response are updated. Accounts with no Plaid liability data retain their existing metadata (or `null`).

---

## Manual Override

### API: `PATCH /accounts/:id/loan-details`

- Protected by `requireAuth`.
- Validates that `:id` belongs to the session's tenant.
- Accepts a body matching the `LoanMetadata` union (validated with Zod, discriminated on `type`).
- Sets `source: "manual"` on write (frontend does not control this field).
- Writes serialized JSON to `accounts.metadata`.
- Returns the updated account row.

### UI: Inline edit on the debt page

Each loan card on `/debt` gains a pencil icon button. Clicking opens a small modal/popover. The form fields are scoped to the liability type:

- **Mortgage**: Maturity date, interest rate, origination date, origination principal, loan term
- **Student loan**: Expected payoff date, interest rate, minimum payment, repayment plan type
- **Credit card**: Minimum payment amount, APR(s)
- **Other loan**: Maturity date, interest rate, minimum payment, origination date

The form pre-fills from stored metadata. On submit it calls `PATCH /accounts/:id/loan-details` and invalidates the debt query. A "Synced from Plaid" badge is shown when `source === "plaid"`, with the `lastSyncedAt` timestamp on hover.

---

## Debt Route Changes (`GET /accounts/debts`)

### Payoff date

Replace the current assumption-based logic:

| Condition | `payoffDate` returned |
|---|---|
| `metadata.type === "mortgage"` and `maturityDate` present | `maturityDate` |
| `metadata.type === "student_loan"` and `expectedPayoffDate` present | `expectedPayoffDate` |
| `metadata.type === "other_loan"` and `maturityDate` present | `maturityDate` |
| Any other case (including `null` metadata) | `null` |

### Minimum payment

- If `metadata.minimumPaymentAmount` is set → use it directly.
- Otherwise → keep the existing estimation logic (still valid for seed/manual-entry accounts without payment data).

### Interest rate

- If `metadata.interestRatePercentage` is set → use it.
- Otherwise → keep existing fallback chain (`interestRate` from legacy metadata, then type-based defaults).

### New response fields

```typescript
{
  // existing fields...
  payoffDate: string | null,        // ISO date, null = unknown
  liabilitySource: "plaid" | "manual" | null,
  liabilityLastSyncedAt: string | null,
}
```

### Frontend

- Replace the `addMonths(monthsToPayoff(...))` calculation for the per-loan payoff date display with `payoffDate` when present.
- When `payoffDate` is `null`: render **"Unknown — add details"** as a link that opens the edit modal.
- The overall PAYOFF TIMELINE section (the `Math.max` across all debts) continues to use `monthsToPayoff` for debts that don't have a real payoff date, so the timeline is still useful even with partial data.

---

## Error Handling

- `liabilitiesGet` errors are caught and logged; sync continues.
- `PATCH /accounts/:id/loan-details` with invalid body returns 400 with Zod validation details.
- Accounts with no liability data render gracefully ("Unknown") rather than showing a wrong assumed date.

## Files Changed

| File | Change |
|---|---|
| `packages/core/src/liability-metadata.ts` | **New** — types + parse helper |
| `packages/core/src/index.ts` | Export new module |
| `packages/api/src/lib/sync.ts` | Add `liabilitiesGet` block |
| `packages/api/src/routes/accounts.ts` | Update `/debts` route + add `PATCH /:id/loan-details` |
| `packages/web/src/pages/debt.tsx` | Use `payoffDate`, add edit modal |
