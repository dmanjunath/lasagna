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
- Credit card payoff dates continue to be calculated client-side via `monthsToPayoff` (revolving credit has no fixed payoff date).

## Out of Scope

- Plaid auto/personal loan liability details (Plaid doesn't expose a dedicated endpoint for these; they sync as generic loan accounts with no liability payload).
- Backfilling historical liability data.

---

## TypeScript Models (`packages/core/src/liability-metadata.ts`)

A new file exports a discriminated union keyed on `type`. Each variant maps 1-1 to a Plaid liability type. The `source` field (`"plaid" | "manual"`) tracks provenance. All fields except `type` and `source` are optional so partial manual entry is valid.

### Date field format

All date-only fields from Plaid (`maturityDate`, `originationDate`, `expectedPayoffDate`, `nextPaymentDueDate`, `lastPaymentDate`) are stored as-is in `YYYY-MM-DD` string format — do **not** convert via `new Date().toISOString()` as that introduces timezone offsets. `lastSyncedAt` is a full ISO datetime string (`new Date().toISOString()`).

### Variants

**`MortgageMetadata`** (`type: "mortgage"`)
- `interestRatePercentage`, `interestRateType` ("fixed" | "variable")
- `originationDate`, `originationPrincipal`
- `maturityDate` — primary payoff date (`YYYY-MM-DD`)
- `loanTerm` (e.g. "30 year"), `loanTypeDescription` (e.g. "conventional")
- `nextMonthlyPayment`, `nextPaymentDueDate`
- `lastPaymentAmount`, `lastPaymentDate`
- `escrowBalance`, `hasPmi`
- `ytdInterestPaid`, `ytdPrincipalPaid`
- `lastSyncedAt` (ISO datetime)

**`StudentLoanMetadata`** (`type: "student_loan"`)
- `interestRatePercentage`
- `originationDate`, `originationPrincipal`
- `expectedPayoffDate` — primary payoff date (`YYYY-MM-DD`)
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
- `aprs: Array<{ aprType: string; aprPercentage: number; balanceSubjectToApr?: number }>`
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

Returns `null` for:
- Missing or empty input
- Malformed JSON
- **Legacy seed metadata** that lacks a `type` discriminant (shape: `{ interestRate, termMonths, originationDate }`)
- Any object whose `type` field does not match a known variant (`"mortgage"`, `"student_loan"`, `"credit_card"`, `"other_loan"`) — unknown type values return `null` rather than throwing

When `null` is returned, the `/debts` route falls back to reading `interestRate` and `termMonths` directly from `JSON.parse(acct.metadata)` — the existing estimation path is preserved for seed/legacy accounts. Both paths must coexist until seed data is migrated.

### Zod schemas

A companion Zod schema for each variant is exported from the same file. These are used by the `PATCH /accounts/:id/loan-details` route for runtime validation. The Zod input schema for each variant **omits the `source` field** (using `.omit({ source: true })` or equivalent) — clients cannot set provenance. The handler always sets `source: "manual"` on write regardless of any `source` value sent by the client.

---

## Sync Changes (`packages/api/src/lib/sync.ts`)

After the existing `accountsBalanceGet` loop, add a `liabilitiesGet` call inside a try/catch. Failure (e.g. `PRODUCT_NOT_READY`, unsupported institution) is logged and skipped — it must not fail the overall sync.

### Account lookup

When matching a Plaid liability item to a DB account, use:

```sql
WHERE plaid_account_id = ? AND plaid_item_id = ?
```

Both fields are in scope: `account_id` from the Plaid liability item, and `item.id` (the current Plaid item being synced). Using only `plaid_account_id` is unsafe in multi-tenant environments.

> **Note:** The existing `accountsBalanceGet` loop in `sync.ts` uses only `plaid_account_id` for its account lookup. The `liabilitiesGet` block must use both fields. Fix the existing balance sync lookup to also use `AND plaid_item_id = ?` for consistency and correctness — this is a correctness fix, not a new behavior change for single-item environments.

### Mapping

```
plaidLiabilities.mortgage[]   → MortgageMetadata   (type: "mortgage")
plaidLiabilities.student[]    → StudentLoanMetadata (type: "student_loan")
plaidLiabilities.credit[]     → CreditCardMetadata  (type: "credit_card")
```

### Manual override preservation

Before writing Plaid data, fetch the account row from the DB using `WHERE plaid_account_id = ? AND plaid_item_id = ?` (re-query, do not rely on cached balance-loop objects). Read its `metadata` column and call `parseLoanMetadata`. If the result has `source === "manual"`, **skip the write** — manual overrides take precedence over Plaid. Log a debug message noting the skip.

This prevents a user's correction from being silently erased on the next sync. A TOCTOU race (two syncs running concurrently) is acceptable: the sync schedule (every 4 hours) and single-process Node.js runtime make simultaneous writes to the same account row negligibly unlikely. A last-writer-wins outcome is preferable to complex locking.

### Write

For each eligible account (not manually overridden), build the typed metadata object with `source: "plaid"` and `lastSyncedAt: new Date().toISOString()`, serialize to JSON, and update:

```sql
UPDATE accounts SET metadata = ? WHERE plaid_account_id = ? AND plaid_item_id = ?
```

Only accounts present in the Plaid liabilities response are updated. Accounts absent from the response retain their existing metadata.

---

## Manual Override

### API: `PATCH /accounts/:id/loan-details`

- Protected by `requireAuth`.
- If the account does not exist or does not belong to the session's tenant, return **404** (not 403 — avoids account enumeration across tenants).
- Accepts a body matching the `LoanMetadata` union, discriminated on `type`, validated with Zod.
- Sets `source: "manual"` unconditionally on write (frontend does not control this field).
- Writes serialized JSON to `accounts.metadata`.
- Returns the updated metadata object.

### UI: Inline edit on the debt page

Each loan card on `/debt` gains a pencil icon button. Clicking opens a small modal. The form fields are scoped to the liability type:

- **Mortgage**: Maturity date, interest rate, origination date, origination principal, loan term
- **Student loan**: Expected payoff date, interest rate, minimum payment, repayment plan type
- **Credit card**: Minimum payment amount, APR(s)
- **Other loan**: Maturity date, interest rate, minimum payment, origination date

The form pre-fills from stored metadata. On submit it calls `PATCH /accounts/:id/loan-details` and re-fetches the debts query. When `source === "plaid"`, show a "Synced from Plaid" badge with `lastSyncedAt` date on hover. When `source === "manual"`, show a "Manually entered" badge. When `source` is null, show no badge.

---

## Debt Route Changes (`GET /accounts/debts`)

### Payoff date

The route reads metadata via `parseLoanMetadata`. The returned `payoffDate` field is a `YYYY-MM-DD` string or `null`:

| Condition | `payoffDate` returned |
|---|---|
| `metadata.type === "mortgage"` and `maturityDate` present | `maturityDate` |
| `metadata.type === "student_loan"` and `expectedPayoffDate` present | `expectedPayoffDate` |
| `metadata.type === "other_loan"` and `maturityDate` present | `maturityDate` |
| `metadata.type === "credit_card"` | `null` — payoff calculated client-side |
| `parseLoanMetadata` returns `null` (legacy/seed/no metadata) | `null` |

### Minimum payment

1. If typed metadata is present and `minimumPaymentAmount` is set → use it.
2. If `parseLoanMetadata` returns `null` but raw metadata has `interestRate`/`termMonths` → use existing estimation logic (legacy path).
3. Otherwise → use existing type-based fallback estimation.

### Interest rate

1. If typed metadata has `interestRatePercentage` → use it. For `CreditCardMetadata` (which has no `interestRatePercentage` field), use the `aprPercentage` of the first entry in `aprs[]` whose `aprType` is `"purchase_apr"`, falling back to `aprs[0].aprPercentage` if no purchase APR is found, and then to the type default if `aprs` is empty.
2. If `parseLoanMetadata` returns `null` but raw metadata has `interestRate` → use that.
3. Otherwise → use existing type-based defaults (mortgage: 6.5%, other: 8.0%).

### New response fields

```typescript
{
  // existing fields unchanged...
  payoffDate: string | null,              // YYYY-MM-DD or null
  liabilitySource: "plaid" | "manual" | null,
  liabilityLastSyncedAt: string | null,  // ISO datetime
}
```

### Updated `DebtAccount` interface (frontend)

```typescript
interface DebtAccount {
  id: string;
  name: string;
  balance: number;
  type: string;
  subtype: string | null;
  apr: number;
  minPayment: number;
  suggestedPayment: number;
  minPayoffDate: string;       // calculated, used for timeline Math.max
  suggestedPayoffDate: string; // calculated, used for timeline Math.max
  payoffDate: string | null;   // real date from Plaid/manual; null = unknown
  liabilitySource: "plaid" | "manual" | null;
  liabilityLastSyncedAt: string | null;
}
```

`payoffDate` is `string | null` — the null path renders "Unknown — add details", not the string `"null"`.

The `id` field is already returned by the existing `/debts` API response. The frontend `useEffect` that maps API data to `DebtAccount` objects must explicitly include `id` so the edit modal can call `PATCH /accounts/:id/loan-details`.

### Frontend rendering

- Per-loan card: if `payoffDate` is non-null, display it directly. If null, render **"Unknown — add details"** as a button that opens the edit modal.
- Credit cards: always show the client-side calculated date (never "Unknown").
- PAYOFF TIMELINE section: continues to use `monthsToPayoff` across all debts for the aggregate timeline — this is unaffected by `payoffDate`.

---

## Error Handling

- `liabilitiesGet` errors are caught and logged; sync continues without failing.
- `PATCH /accounts/:id/loan-details` with an invalid body returns 400 with Zod validation details.
- `PATCH` for a missing or foreign-tenant account returns 404.
- Accounts with no liability data render gracefully with "Unknown — add details" rather than a wrong assumed date.

## Files Changed

| File | Change |
|---|---|
| `packages/core/src/liability-metadata.ts` | **New** — discriminated union types + Zod input schemas + `parseLoanMetadata` helper |
| `packages/core/src/index.ts` | Export new module |
| `packages/api/src/lib/sync.ts` | Add `liabilitiesGet` block after balance sync |
| `packages/api/src/routes/accounts.ts` | Update `/debts` route; add `PATCH /:id/loan-details` |
| `packages/web/src/pages/debt.tsx` | Use `payoffDate`, add edit modal, update `DebtAccount` interface |
