# Plaid Liability Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync real Plaid liability data (maturity dates, interest rates, min payments) for mortgages, student loans, and credit cards; surface actual payoff dates instead of assumed amortization; add a manual override modal for accounts without Plaid data.

**Architecture:** A new `liability-metadata.ts` module in `@lasagna/core` owns the TypeScript discriminated union types and `parseLoanMetadata` helper. The sync layer calls `liabilitiesGet` and writes typed JSON to `accounts.metadata`. The `/debts` route reads the typed metadata and returns real `payoffDate` + source provenance. The frontend renders the date or an "Unknown — add details" button that opens a per-type edit modal calling `PATCH /accounts/:id/loan-details`.

**Spec deviation — Zod schema location:** The spec calls for Zod schemas to live in `packages/core/src/liability-metadata.ts`. However, `@lasagna/core` does not have `zod` as a dependency, and adding it would unnecessarily bloat the core package. Zod validation for the `PATCH` endpoint lives inline in the route handler in `packages/api/src/routes/accounts.ts`, which already has `zod` as a dependency. All TypeScript types are still exported from `@lasagna/core` as specified.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), Hono, Zod, React 19, Node.js built-in test runner (`node:test` + `node:assert/strict`), Plaid Node SDK

---

## File Map

| File | Change |
|---|---|
| `packages/core/src/liability-metadata.ts` | **New** — discriminated union types + `parseLoanMetadata` helper |
| `packages/core/src/__tests__/liability-metadata.test.ts` | **New** — unit tests for `parseLoanMetadata` |
| `packages/core/src/index.ts` | Add export for new module |
| `packages/api/src/lib/sync.ts` | Add `liabilitiesGet` block; fix balance-loop account lookup to use both `plaidAccountId` + `plaidItemId` |
| `packages/api/src/routes/accounts.ts` | Update `/debts` route (new response fields); add inline Zod validation; add `PATCH /:id/loan-details` |
| `packages/web/src/lib/api.ts` | Add `patchLoanDetails` method; update `getDebts` response type |
| `packages/web/src/pages/debt.tsx` | Update interface + mapping; add edit modal; show payoff date / badges |

---

## Task 1: Core types + parseLoanMetadata

**Files:**
- Create: `packages/core/src/liability-metadata.ts`
- Create: `packages/core/src/__tests__/liability-metadata.test.ts`

### Why this first

Everything downstream (sync, route, frontend) depends on these types. Unit testing `parseLoanMetadata` in isolation is fast and catches edge cases before any Plaid calls are needed.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/liability-metadata.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLoanMetadata } from "../liability-metadata.js";

describe("parseLoanMetadata", () => {
  it("returns null for null input", () => {
    assert.equal(parseLoanMetadata(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseLoanMetadata(""), null);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseLoanMetadata("{bad json"), null);
  });

  it("returns null for legacy seed metadata without type field", () => {
    const legacy = JSON.stringify({ interestRate: 6.5, termMonths: 360, originationDate: "2020-01-01" });
    assert.equal(parseLoanMetadata(legacy), null);
  });

  it("returns null for unknown type value", () => {
    const unknown = JSON.stringify({ type: "heloc", source: "plaid" });
    assert.equal(parseLoanMetadata(unknown), null);
  });

  it("parses a valid mortgage metadata object", () => {
    const raw = JSON.stringify({
      type: "mortgage",
      source: "plaid",
      maturityDate: "2050-01-01",
      interestRatePercentage: 3.5,
      lastSyncedAt: "2026-04-16T00:00:00.000Z",
    });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "mortgage");
    assert.equal(result!.source, "plaid");
    if (result!.type === "mortgage") {
      assert.equal(result.maturityDate, "2050-01-01");
      assert.equal(result.interestRatePercentage, 3.5);
    }
  });

  it("parses a valid student loan metadata object", () => {
    const raw = JSON.stringify({
      type: "student_loan",
      source: "manual",
      expectedPayoffDate: "2032-06-01",
      interestRatePercentage: 5.0,
      minimumPaymentAmount: 250,
    });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "student_loan");
    assert.equal(result!.source, "manual");
    if (result!.type === "student_loan") {
      assert.equal(result.expectedPayoffDate, "2032-06-01");
    }
  });

  it("parses a valid credit card metadata object", () => {
    const raw = JSON.stringify({
      type: "credit_card",
      source: "plaid",
      minimumPaymentAmount: 35,
      aprs: [{ aprType: "purchase_apr", aprPercentage: 21.99 }],
      lastSyncedAt: "2026-04-16T00:00:00.000Z",
    });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "credit_card");
    if (result!.type === "credit_card") {
      assert.equal(result.aprs![0].aprPercentage, 21.99);
    }
  });

  it("parses a valid other_loan metadata object", () => {
    const raw = JSON.stringify({
      type: "other_loan",
      source: "manual",
      maturityDate: "2028-09-01",
      interestRatePercentage: 7.5,
    });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "other_loan");
  });

  it("accepts partial metadata — all optional fields absent is valid", () => {
    const raw = JSON.stringify({ type: "mortgage", source: "plaid" });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "mortgage");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @lasagna/core test
```

Expected: Error — `../liability-metadata.js` not found (or similar module-not-found error).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/liability-metadata.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @lasagna/core test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/liability-metadata.ts packages/core/src/__tests__/liability-metadata.test.ts
git commit -m "feat(core): add LoanMetadata discriminated union and parseLoanMetadata"
```

---

## Task 2: Export from @lasagna/core

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the export**

In `packages/core/src/index.ts`, append after the last existing export line:

```typescript
export * from "./liability-metadata.js";
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @lasagna/core typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export liability-metadata module"
```

---

## Task 3: Sync — liabilitiesGet + fix balance loop

**Files:**
- Modify: `packages/api/src/lib/sync.ts`

### Context

The existing balance loop (around line 39) uses only `eq(accounts.plaidAccountId, ...)` to look up an account. This is unsafe in multi-tenant environments. Fix it to also match `plaid_item_id`. Then add the new `liabilitiesGet` block after the investments try/catch, before the `syncTransactions` call.

- [ ] **Step 1: Fix the import line — add `and` and `parseLoanMetadata`**

Find the existing import at the top of `sync.ts`:

```typescript
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
```

Replace with:

```typescript
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
} from "@lasagna/core";
```

- [ ] **Step 2: Fix the balance loop account lookup**

Find the account lookup inside the balance loop (around line 39):

```typescript
const existing = await db.query.accounts.findFirst({
  where: eq(accounts.plaidAccountId, plaidAcct.account_id),
});
```

Replace with:

```typescript
const existing = await db.query.accounts.findFirst({
  where: and(
    eq(accounts.plaidAccountId, plaidAcct.account_id),
    eq(accounts.plaidItemId, item.id),
  ),
});
```

- [ ] **Step 3: Add the liabilitiesGet block**

After the investments `try/catch` block and before the `syncTransactions` call, insert:

```typescript
// Sync liability details (mortgages, student loans, credit cards)
try {
  const liabResp = await plaidClient.liabilitiesGet({
    access_token: accessToken,
  });
  const liabilities = liabResp.data.liabilities;

  type LiabEntry = {
    account_id: string;
    metadata: import("@lasagna/core").LoanMetadata;
  };
  const entries: LiabEntry[] = [];

  // Map mortgage liabilities
  for (const m of liabilities.mortgage ?? []) {
    entries.push({
      account_id: m.account_id,
      metadata: {
        type: "mortgage",
        source: "plaid",
        interestRatePercentage: m.interest_rate_percentage ?? undefined,
        interestRateType:
          m.interest_rate_type === "fixed"
            ? "fixed"
            : m.interest_rate_type === "variable"
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
        lastSyncedAt: new Date().toISOString(),
      },
    });
  }

  // Map student loan liabilities
  for (const s of liabilities.student ?? []) {
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
        lastSyncedAt: new Date().toISOString(),
      },
    });
  }

  // Map credit card liabilities
  for (const cc of liabilities.credit ?? []) {
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
        lastSyncedAt: new Date().toISOString(),
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
      console.debug(
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
  console.error(
    `[sync] liabilitiesGet failed for item ${item.id} — skipping:`,
    e,
  );
  // Do not rethrow — liability sync failure must not fail the overall sync
}
```

**Note on Plaid SDK field names:** The Plaid Node SDK uses snake_case response fields. If you get TypeScript errors on any field name, check the `MortgageLiability`, `StudentLoan`, and `CreditCardLiability` interfaces in `node_modules/plaid/dist/api.d.ts` for the exact field names in the SDK version installed.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @lasagna/api typecheck
```

Expected: No new errors. (There is a pre-existing `insights-engine.ts:147` error — it predates this change. Ignore it.)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/lib/sync.ts
git commit -m "feat(sync): add liabilitiesGet block, fix balance loop multi-tenant lookup"
```

---

## Task 4: API — update /debts route + add PATCH /:id/loan-details

**Files:**
- Modify: `packages/api/src/routes/accounts.ts`

### Context

The `/debts` route currently returns `interestRate`, `termMonths`, `originationDate` from raw JSON. This task adds `payoffDate`, `liabilitySource`, `liabilityLastSyncedAt` using typed metadata, while preserving the legacy estimation fallback for seed accounts.

The new `PATCH /:id/loan-details` endpoint uses inline Zod discriminated union validation and sets `source: "manual"` server-side.

- [ ] **Step 1: Update imports**

In `packages/api/src/routes/accounts.ts`, add to the existing imports:

```typescript
import { z } from "zod";
import { parseLoanMetadata } from "@lasagna/core";
```

The `parseLoanMetadata` import can be added to the existing `@lasagna/core` import line, or added as a separate line — either works.

- [ ] **Step 2: Replace the metadata parsing block in the /debts route**

Find this block inside `accts.map(async (acct) => { ... })`:

```typescript
// Parse metadata JSON safely
let interestRate: number | null = null;
let termMonths: number | null = null;
let originationDate: string | null = null;
try {
  if (acct.metadata) {
    const meta = JSON.parse(acct.metadata);
    interestRate = typeof meta.interestRate === "number" ? meta.interestRate : null;
    termMonths = typeof meta.termMonths === "number" ? meta.termMonths : null;
    originationDate = typeof meta.originationDate === "string" ? meta.originationDate : null;
  }
} catch {
  // malformed metadata — leave defaults
}
```

Replace with:

```typescript
// Parse typed liability metadata
const typedMeta = parseLoanMetadata(acct.metadata ?? null);

// Legacy raw fallback (for seed/legacy data without a type discriminant)
let legacyInterestRate: number | null = null;
let termMonths: number | null = null;
let originationDate: string | null = null;
if (!typedMeta && acct.metadata) {
  try {
    const raw = JSON.parse(acct.metadata);
    legacyInterestRate = typeof raw.interestRate === "number" ? raw.interestRate : null;
    termMonths = typeof raw.termMonths === "number" ? raw.termMonths : null;
    originationDate = typeof raw.originationDate === "string" ? raw.originationDate : null;
  } catch {
    // malformed — leave null
  }
}

// Resolve interestRate (3-step fallback)
let interestRate: number | null = null;
if (typedMeta) {
  if (typedMeta.type === "credit_card") {
    const purchaseApr = typedMeta.aprs?.find((a) => a.aprType === "purchase_apr");
    interestRate = purchaseApr?.aprPercentage ?? typedMeta.aprs?.[0]?.aprPercentage ?? null;
  } else {
    // MortgageMetadata | StudentLoanMetadata | OtherLoanMetadata all have interestRatePercentage
    interestRate =
      (
        typedMeta as
          | import("@lasagna/core").MortgageMetadata
          | import("@lasagna/core").StudentLoanMetadata
          | import("@lasagna/core").OtherLoanMetadata
      ).interestRatePercentage ?? null;
  }
} else {
  interestRate = legacyInterestRate;
}

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
```

- [ ] **Step 3: Replace the minimumPayment block**

Find the existing `let minimumPayment: number;` block and replace with:

```typescript
// Resolve minimumPayment (3-step fallback)
let minimumPayment: number;
const isMortgage =
  acct.subtype === "mortgage" || acct.name?.toLowerCase().includes("mortgage");

const typedMinPayment =
  typedMeta && "minimumPaymentAmount" in typedMeta
    ? typedMeta.minimumPaymentAmount
    : undefined;

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
```

- [ ] **Step 4: Update the return object**

Find the `return { id: acct.id, name: acct.name, ... }` inside the map callback and replace with:

```typescript
return {
  id: acct.id,
  name: acct.name,
  type: acct.type,
  subtype: acct.subtype,
  balance,
  interestRate,
  termMonths,
  originationDate,
  minimumPayment,
  payoffDate,
  liabilitySource: typedMeta?.source ?? null,
  liabilityLastSyncedAt: typedMeta?.lastSyncedAt ?? null,
  lastUpdated: latest?.snapshotAt ?? null,
};
```

- [ ] **Step 5: Add PATCH /:id/loan-details**

After the existing `/:id/history` route, add:

```typescript
// Manual loan details override
accountRoutes.patch("/:id/loan-details", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("id");

  // Tenant isolation — 404 (not 403) to avoid account enumeration
  const acct = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!acct || acct.tenantId !== session.tenantId) {
    return c.json({ error: "Account not found" }, 404);
  }

  const raw = await c.req.json();

  const bodySchema = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("mortgage"),
      maturityDate: z.string().optional(),
      interestRatePercentage: z.number().optional(),
      interestRateType: z.enum(["fixed", "variable"]).optional(),
      originationDate: z.string().optional(),
      originationPrincipal: z.number().optional(),
      loanTerm: z.string().optional(),
    }),
    z.object({
      type: z.literal("student_loan"),
      expectedPayoffDate: z.string().optional(),
      interestRatePercentage: z.number().optional(),
      minimumPaymentAmount: z.number().optional(),
      repaymentPlanType: z.string().optional(),
      nextPaymentDueDate: z.string().optional(),
    }),
    z.object({
      type: z.literal("credit_card"),
      minimumPaymentAmount: z.number().optional(),
      nextPaymentDueDate: z.string().optional(),
      aprs: z
        .array(
          z.object({
            aprType: z.string(),
            aprPercentage: z.number(),
            balanceSubjectToApr: z.number().optional(),
          }),
        )
        .optional(),
    }),
    z.object({
      type: z.literal("other_loan"),
      maturityDate: z.string().optional(),
      interestRatePercentage: z.number().optional(),
      minimumPaymentAmount: z.number().optional(),
      originationDate: z.string().optional(),
    }),
  ]);

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const metadata = {
    ...parsed.data,
    source: "manual" as const,
    lastSyncedAt: new Date().toISOString(),
  };

  await db
    .update(accounts)
    .set({ metadata: JSON.stringify(metadata) })
    .where(eq(accounts.id, accountId));

  return c.json({ metadata });
});
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @lasagna/api typecheck
```

Expected: No new errors (pre-existing `insights-engine.ts:147` error is ok).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/accounts.ts
git commit -m "feat(api): add payoffDate/liabilitySource to debts route, add PATCH loan-details endpoint"
```

---

## Task 5: Frontend — api.ts + edit modal + payoffDate display

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/pages/debt.tsx`

### Step A — Update api.ts first (required before debt.tsx changes)

- [ ] **Step 1: Update getDebts return type in api.ts**

Find the `getDebts` entry in `packages/web/src/lib/api.ts` (around line 114):

```typescript
getDebts: () =>
  request<{
    debts: Array<{
      id: string;
      name: string;
      type: string;
      subtype: string | null;
      balance: number;
      interestRate: number | null;
      termMonths: number | null;
      originationDate: string | null;
      minimumPayment: number;
      lastUpdated: string | null;
    }>;
    totalDebt: number;
    monthlyInterest: number;
  }>("/accounts/debts"),
```

Replace with:

```typescript
getDebts: () =>
  request<{
    debts: Array<{
      id: string;
      name: string;
      type: string;
      subtype: string | null;
      balance: number;
      interestRate: number | null;
      termMonths: number | null;
      originationDate: string | null;
      minimumPayment: number;
      payoffDate: string | null;
      liabilitySource: "plaid" | "manual" | null;
      liabilityLastSyncedAt: string | null;
      lastUpdated: string | null;
    }>;
    totalDebt: number;
    monthlyInterest: number;
  }>("/accounts/debts"),
```

- [ ] **Step 2: Add patchLoanDetails to api.ts**

After `getDebts`, add a new method. Find a clean line break after the `getDebts` entry and insert:

```typescript
patchLoanDetails: (accountId: string, body: Record<string, unknown>) =>
  request<{ metadata: Record<string, unknown> }>(
    `/accounts/${accountId}/loan-details`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ),
```

- [ ] **Step 3: Commit api.ts**

```bash
git add packages/web/src/lib/api.ts
git commit -m "feat(web/api): update getDebts type, add patchLoanDetails"
```

### Step B — Update debt.tsx

- [ ] **Step 4: Update imports in debt.tsx**

Replace the existing React import line:

```typescript
import { useState, useEffect } from 'react';
```

With:

```typescript
import { useState, useEffect } from 'react';
```

(No change — `useRef` is NOT needed.)

Add `Pencil` and `X` to the lucide import line:

```typescript
import { Loader2, CreditCard, Landmark, Pencil, X } from 'lucide-react';
```

- [ ] **Step 5: Update the DebtAccount interface**

Replace lines 10–19 (the interface):

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
  minPayoffDate: string;
  suggestedPayoffDate: string;
  payoffDate: string | null;
  liabilitySource: "plaid" | "manual" | null;
  liabilityLastSyncedAt: string | null;
}
```

- [ ] **Step 6: Add refreshKey and editingDebt state to the Debt component**

In `Debt()`, after the existing `useState` calls, add:

```typescript
const [refreshKey, setRefreshKey] = useState(0);
const [editingDebt, setEditingDebt] = useState<DebtAccount | null>(null);
```

Change the `useEffect` dependency array from `[]` to `[refreshKey]`.

Add this callback inside `Debt()`:

```typescript
const handleLoanDetailsSaved = () => {
  setEditingDebt(null);
  setRefreshKey((k) => k + 1);
};
```

- [ ] **Step 7: Update the useEffect data mapping**

In the `useEffect`, update the `return` inside `apiDebts.map(...)`:

```typescript
return {
  id: d.id,
  name: d.name,
  balance: d.balance,
  type: d.type,
  subtype: d.subtype ?? null,
  apr: Math.round(apr * 100) / 100,
  minPayment: minPay,
  suggestedPayment: suggestedPay,
  minPayoffDate: addMonths(minMonths),
  suggestedPayoffDate: addMonths(sugMonths),
  payoffDate: d.payoffDate ?? null,
  liabilitySource: d.liabilitySource ?? null,
  liabilityLastSyncedAt: d.liabilityLastSyncedAt ?? null,
};
```

- [ ] **Step 8: Update HasDebtView call in JSX**

Pass new props to `HasDebtView`:

```tsx
<HasDebtView
  debts={debts}
  totalDebt={totalDebt}
  totalMonthlyPayment={totalMonthlyPayment}
  interestSavedVsSnowball={interestSavedVsSnowball}
  minOnlyDate={addMonths(minOnlyMonths)}
  suggestedDate={addMonths(suggestedMonths)}
  monthsSaved={monthsSaved}
  interestSavedVsMinimums={interestSavedVsMinimums}
  openChat={openChat}
  editingDebt={editingDebt}
  onEditDebt={setEditingDebt}
  onCloseModal={() => setEditingDebt(null)}
  onLoanDetailsSaved={handleLoanDetailsSaved}
/>
```

- [ ] **Step 9: Update HasDebtView props type**

Add the new props to the `HasDebtView` function signature:

```typescript
function HasDebtView({
  debts, totalDebt, totalMonthlyPayment, interestSavedVsSnowball,
  minOnlyDate, suggestedDate, monthsSaved, interestSavedVsMinimums,
  openChat, editingDebt, onEditDebt, onCloseModal, onLoanDetailsSaved,
}: {
  debts: DebtAccount[];
  totalDebt: number;
  totalMonthlyPayment: number;
  interestSavedVsSnowball: number;
  minOnlyDate: string;
  suggestedDate: string;
  monthsSaved: number;
  interestSavedVsMinimums: number;
  openChat: (prompt: string) => void;
  editingDebt: DebtAccount | null;
  onEditDebt: (debt: DebtAccount) => void;
  onCloseModal: () => void;
  onLoanDetailsSaved: () => void;
})
```

- [ ] **Step 10: Update the Payoff Order card in HasDebtView**

Find the `<div className="flex-1 min-w-0">` block inside the `debts.map` loop and replace its contents with:

```tsx
<div className="flex-1 min-w-0">
  <div className="flex items-center gap-1.5">
    <div className="text-[15px] font-semibold">{d.name}</div>
    <button
      type="button"
      onClick={() => onEditDebt(d)}
      className="text-text-muted hover:text-text-primary transition-colors"
      title="Edit loan details"
    >
      <Pencil className="w-3 h-3" />
    </button>
    {d.liabilitySource === "plaid" && (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-semibold cursor-default"
        title={
          d.liabilityLastSyncedAt
            ? `Synced ${new Date(d.liabilityLastSyncedAt).toLocaleDateString()}`
            : undefined
        }
      >
        Synced from Plaid
      </span>
    )}
    {d.liabilitySource === "manual" && (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-hover text-text-muted font-semibold">
        Manually entered
      </span>
    )}
  </div>
  <div className="text-[13px] text-text-muted mt-0.5">
    {d.apr}% APR &middot; Min {formatCurrency(d.minPayment)}/mo &middot; Paying{' '}
    {formatCurrency(d.suggestedPayment)}/mo
  </div>
  <div className="text-[11px] text-text-muted mt-1">
    {d.type !== 'credit' && d.payoffDate ? (
      <>
        Payoff:{' '}
        <span className="text-success">
          {new Date(d.payoffDate + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          })}
        </span>
        {' '}&middot;{' '}
      </>
    ) : d.type !== 'credit' && !d.payoffDate ? (
      <>
        <button
          type="button"
          onClick={() => onEditDebt(d)}
          className="text-warning hover:text-warning/80 font-semibold transition-colors"
        >
          Unknown — add details
        </button>
        {' '}&middot;{' '}
      </>
    ) : null}
    Min payoff:{' '}
    <span className="text-danger">{d.minPayoffDate}</span> &middot; Your plan:{' '}
    <span className="text-success">{d.suggestedPayoffDate}</span>
  </div>
</div>
```

- [ ] **Step 11: Add the edit modal to HasDebtView return**

At the bottom of the `HasDebtView` return (before the closing `</>`), add:

```tsx
{editingDebt && (
  <LoanDetailsModal
    debt={editingDebt}
    onClose={onCloseModal}
    onSaved={onLoanDetailsSaved}
  />
)}
```

- [ ] **Step 12: Add LoanDetailsModal component**

Add this component directly before the `HasDebtView` function definition:

```tsx
function LoanDetailsModal({
  debt,
  onClose,
  onSaved,
}: {
  debt: DebtAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maturityDate, setMaturityDate] = useState("");
  const [expectedPayoffDate, setExpectedPayoffDate] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [minPayment, setMinPayment] = useState("");
  const [originationDate, setOriginationDate] = useState("");
  const [repaymentPlanType, setRepaymentPlanType] = useState("");
  const [purchaseApr, setPurchaseApr] = useState("");

  const isMortgage =
    debt.subtype === "mortgage" || debt.name.toLowerCase().includes("mortgage");
  const isStudentLoan =
    debt.subtype === "student_loan" || debt.name.toLowerCase().includes("student");
  const isCredit = debt.type === "credit";
  const loanType: "mortgage" | "student_loan" | "credit_card" | "other_loan" = isMortgage
    ? "mortgage"
    : isStudentLoan
      ? "student_loan"
      : isCredit
        ? "credit_card"
        : "other_loan";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { type: loanType };
      if (loanType === "mortgage") {
        if (maturityDate) body.maturityDate = maturityDate;
        if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
        if (originationDate) body.originationDate = originationDate;
      } else if (loanType === "student_loan") {
        if (expectedPayoffDate) body.expectedPayoffDate = expectedPayoffDate;
        if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
        if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
        if (repaymentPlanType) body.repaymentPlanType = repaymentPlanType;
      } else if (loanType === "credit_card") {
        if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
        if (purchaseApr)
          body.aprs = [{ aprType: "purchase_apr", aprPercentage: parseFloat(purchaseApr) }];
      } else {
        if (maturityDate) body.maturityDate = maturityDate;
        if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
        if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
        if (originationDate) body.originationDate = originationDate;
      }
      await api.patchLoanDetails(debt.id, body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-base">{debt.name}</h2>
            <p className="text-xs text-text-muted mt-0.5">Update loan details</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {(loanType === "mortgage" || loanType === "other_loan") && (
            <label className="block">
              <span className="text-xs text-text-muted font-medium">
                Maturity / Payoff Date
              </span>
              <input
                type="date"
                value={maturityDate}
                onChange={(e) => setMaturityDate(e.target.value)}
                className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          )}
          {loanType === "student_loan" && (
            <label className="block">
              <span className="text-xs text-text-muted font-medium">Expected Payoff Date</span>
              <input
                type="date"
                value={expectedPayoffDate}
                onChange={(e) => setExpectedPayoffDate(e.target.value)}
                className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          )}
          {loanType !== "credit_card" && (
            <label className="block">
              <span className="text-xs text-text-muted font-medium">Interest Rate (%)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                placeholder={loanType === "mortgage" ? "e.g. 3.5" : "e.g. 6.5"}
                className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          )}
          {loanType === "credit_card" && (
            <label className="block">
              <span className="text-xs text-text-muted font-medium">Purchase APR (%)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={purchaseApr}
                onChange={(e) => setPurchaseApr(e.target.value)}
                placeholder="e.g. 21.99"
                className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          )}
          {(loanType === "student_loan" ||
            loanType === "credit_card" ||
            loanType === "other_loan") && (
            <label className="block">
              <span className="text-xs text-text-muted font-medium">Minimum Payment ($)</span>
              <input
                type="number"
                step="1"
                min="0"
                value={minPayment}
                onChange={(e) => setMinPayment(e.target.value)}
                placeholder="e.g. 250"
                className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          )}
          {loanType === "student_loan" && (
            <label className="block">
              <span className="text-xs text-text-muted font-medium">Repayment Plan</span>
              <input
                type="text"
                value={repaymentPlanType}
                onChange={(e) => setRepaymentPlanType(e.target.value)}
                placeholder="e.g. income_driven, standard"
                className="mt-1 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold border border-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-bg hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 13: Typecheck**

```bash
pnpm --filter @lasagna/web typecheck
```

Expected: No new errors.

- [ ] **Step 14: Commit**

```bash
git add packages/web/src/pages/debt.tsx packages/web/src/lib/api.ts
git commit -m "feat(web): add loan details edit modal, payoffDate display, liability source badges"
```

---

## Task 6: Smoke test

- [ ] **Step 1: Start the dev server**

```bash
pnpm docker:up
```

- [ ] **Step 2: Trigger a sync**

Navigate to the Accounts page (or call `POST /api/sync` directly) to trigger a sync for a connected Plaid item. Check Docker logs:

```bash
docker compose logs api --tail=50
```

Expect either:
- Successful liability data written to accounts
- A graceful skip log: `[sync] liabilitiesGet failed for item ... — skipping:` (if the Plaid item wasn't created with the `liabilities` product)
- No unhandled errors or crashes

- [ ] **Step 3: Navigate to /debt and verify**

For accounts with Plaid liability data:
- Payoff date is displayed (not "Unknown")
- "Synced from Plaid" badge is visible
- Hovering the badge shows the sync date

For loan accounts without Plaid liability data:
- "Unknown — add details" button is shown

For credit cards:
- Client-side calculated payoff date is always shown (never "Unknown")

- [ ] **Step 4: Test the edit modal**

Click "Unknown — add details" or the pencil icon on a loan. Fill in a maturity date and interest rate. Click Save. Verify:
- Modal closes
- Page re-fetches automatically
- "Manually entered" badge appears
- The entered date is displayed as the payoff date

- [ ] **Step 5: Verify manual override survives sync**

Trigger another sync. Verify that the manually-entered data is not overwritten — "Manually entered" badge still shows after sync.

- [ ] **Step 6: Final commit if needed**

```bash
git add -p
git commit -m "fix: post-smoke-test tweaks for liability sync"
```

---

## Notes for implementer

1. **Plaid SDK field names:** Verify against `@plaidinc/plaid` TypeScript interfaces in `node_modules`. The `MortgageLiability`, `StudentLoan`, and `CreditCardLiability` interfaces list all available fields. Some fields may be `null | undefined` depending on the institution — use `?? undefined` to normalize.

2. **liabilitiesGet product availability:** In Plaid sandbox, `liabilitiesGet` requires the item to have been created with the `liabilities` product scoped in the Link token. Production items also need `liabilities` in their product scope. A `PRODUCT_NOT_READY` or `INVALID_PRODUCT` error will be caught and logged gracefully — this is expected for items that don't support liabilities.

3. **Pre-existing typecheck error:** `packages/api/src/lib/insights-engine.ts:147` has a `string | null` type error that predates this feature. Do not fix it.

4. **No DB migration needed:** `accounts.metadata` is already a `text` column. No migration required.

5. **Zod v4 note:** The project uses `zod ^4.3.6`. The `z.discriminatedUnion` API works the same as v3 for this use case.
