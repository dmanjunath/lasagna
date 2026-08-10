import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, sql, accounts, balanceSnapshots, plaidItems, parseLoanMetadata, parsePropertyMetadata, accountTypeEnum } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { validatePropertyLink } from "../lib/account-links.js";
import { fetchAccountsWithBalances, LIABILITY_TYPES } from "../lib/account-balances.js";
import { kickOffValueEstimate, advanceValueEstimate } from "../lib/value-estimate.js";
import { pollRealEstateValue } from "../services/fetchRealEstateValues.js";

export const accountRoutes = new Hono<AuthEnv>();

// List all accounts for the tenant
accountRoutes.get("/", async (c) => {
  const session = c.get("session");

  const result = await db.query.accounts.findMany({
    where: eq(accounts.tenantId, session.tenantId),
  });

  return c.json({ accounts: result });
});

// Get latest balances for all accounts
accountRoutes.get("/balances", async (c) => {
  const session = c.get("session");

  const accts = await db.query.accounts.findMany({
    where: eq(accounts.tenantId, session.tenantId),
  });

  // Institution per account (for brand icons client-side). One query for the
  // tenant's items, mapped by id — avoids an N+1 join.
  const items = await db.query.plaidItems.findMany({
    where: eq(plaidItems.tenantId, session.tenantId),
    columns: { id: true, institutionId: true, institutionName: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));

  const balances = await Promise.all(
    accts.map(async (acct) => {
      const latest = await db.query.balanceSnapshots.findFirst({
        where: eq(balanceSnapshots.accountId, acct.id),
        orderBy: [desc(balanceSnapshots.snapshotAt)],
      });
      const rawBalance = latest?.balance ? parseFloat(latest.balance) : null;
      const item = acct.plaidItemId ? itemById.get(acct.plaidItemId) : undefined;
      return {
        accountId: acct.id,
        name: acct.name,
        type: acct.type,
        subtype: acct.subtype,
        mask: acct.mask,
        institutionId: item?.institutionId ?? null,
        institutionName: item?.institutionName ?? null,
        balance: latest?.balance ?? null,
        effectiveBalance:
          rawBalance == null ? null : acct.invertBalance ? -rawBalance : rawBalance,
        available: latest?.available ?? null,
        currency: latest?.isoCurrencyCode ?? "USD",
        asOf: latest?.snapshotAt ?? null,
        excludeFromNetWorth: acct.excludeFromNetWorth,
        excludeTransactions: acct.excludeTransactions,
        invertBalance: acct.invertBalance,
        propertyAccountId: acct.propertyAccountId ?? null,
      };
    }),
  );

  return c.json({ balances });
});

// Get net worth history (aggregated across all accounts by date)
// Must be before /:id/history to avoid matching "net-worth" as an :id
accountRoutes.get("/net-worth/history", async (c) => {
  const session = c.get("session");

  const accts = await db.query.accounts.findMany({
    where: eq(accounts.tenantId, session.tenantId),
  });
  if (accts.length === 0) {
    return c.json({ history: [] });
  }

  // Per-account overrides for the aggregation below: skip excluded accounts,
  // flip the sign on inverted ones, and keep the liability convention.
  const acctMeta = new Map(
    accts.map((a) => [
      a.id,
      { type: a.type, invert: a.invertBalance, exclude: a.excludeFromNetWorth },
    ]),
  );

  // Get latest snapshot per account per day
  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', ${balanceSnapshots.snapshotAt})::date`.as("date"),
      accountId: balanceSnapshots.accountId,
      balance: sql<string>`(array_agg(${balanceSnapshots.balance} ORDER BY ${balanceSnapshots.snapshotAt} DESC))[1]`.as("balance"),
    })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.tenantId, session.tenantId))
    .groupBy(sql`date_trunc('day', ${balanceSnapshots.snapshotAt})::date`, balanceSnapshots.accountId)
    .orderBy(sql`date_trunc('day', ${balanceSnapshots.snapshotAt})::date`);

  // Build per-account balance timeline, carrying forward last known balance
  // This prevents false drops when an account has no snapshot on a given day
  const allDates = [...new Set(rows.map((r) => String(r.date)))].sort();
  const accountBalances = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const acctId = row.accountId;
    const date = String(row.date);
    if (!accountBalances.has(acctId)) accountBalances.set(acctId, new Map());
    accountBalances.get(acctId)!.set(date, parseFloat(row.balance || "0"));
  }

  // Fill forward: for each account, carry the last known balance into missing days
  for (const [, dateBalMap] of accountBalances) {
    let lastBal = 0;
    for (const date of allDates) {
      if (dateBalMap.has(date)) {
        lastBal = dateBalMap.get(date)!;
      } else {
        dateBalMap.set(date, lastBal);
      }
    }
  }

  // Aggregate per-date net worth
  const history = allDates.map((date) => {
    let total = 0;
    for (const [acctId, dateBalMap] of accountBalances) {
      const m = acctMeta.get(acctId);
      if (!m || m.exclude) continue;
      let bal = dateBalMap.get(date) || 0;
      if (m.invert) bal = -bal;
      total += LIABILITY_TYPES.has(m.type) ? -Math.abs(bal) : bal;
    }
    return { date, value: Math.round(total * 100) / 100 };
  });

  return c.json({ history });
});

// Get debt details for all credit/loan accounts
accountRoutes.get("/debts", async (c) => {
  const session = c.get("session");

  const accts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.tenantId, session.tenantId),
      sql`${accounts.type} IN ('credit', 'loan')`,
      eq(accounts.excludeFromNetWorth, false),
    ),
  });

  const propertyRows = await db.query.accounts.findMany({
    where: and(eq(accounts.tenantId, session.tenantId), eq(accounts.type, "real_estate")),
    columns: { id: true, name: true },
  });
  const propertyById = new Map(propertyRows.map((p) => [p.id, p]));

  const debts = await Promise.all(
    accts.map(async (acct) => {
      const latest = await db.query.balanceSnapshots.findFirst({
        where: eq(balanceSnapshots.accountId, acct.id),
        orderBy: [desc(balanceSnapshots.snapshotAt)],
      });

      const balance = Math.abs(parseFloat(latest?.balance ?? "0"));

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
        } else if (
          typedMeta.type === "mortgage" ||
          typedMeta.type === "student_loan" ||
          typedMeta.type === "other_loan"
        ) {
          interestRate = typedMeta.interestRatePercentage ?? null;
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

      return {
        id: acct.id,
        name: acct.name,
        mask: acct.mask ?? null,
        type: acct.type,
        subtype: acct.subtype,
        property: acct.propertyAccountId
          ? (propertyById.get(acct.propertyAccountId) ?? null)
          : null,
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
    }),
  );

  const totalDebt = debts.reduce((sum, d) => sum + d.balance, 0);
  const monthlyInterest = debts.reduce((sum, d) => {
    if (d.interestRate) {
      return sum + d.balance * (d.interestRate / 100 / 12);
    }
    return sum;
  }, 0);

  return c.json({
    debts,
    totalDebt: Math.round(totalDebt * 100) / 100,
    monthlyInterest: Math.round(monthlyInterest * 100) / 100,
  });
});

// Get balance history for a single account
accountRoutes.get("/:id/history", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("id");

  const acct = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!acct || acct.tenantId !== session.tenantId) {
    return c.json({ error: "Account not found" }, 404);
  }

  const snapshots = await db.query.balanceSnapshots.findMany({
    where: eq(balanceSnapshots.accountId, accountId),
    orderBy: [desc(balanceSnapshots.snapshotAt)],
  });

  return c.json({ account: acct, snapshots });
});

// Poll the async value estimate for a property account. Tenant-scoped to the
// caller's own account. Reads the stored snapshot id and does one provider
// poll; when a value has landed it records a balance snapshot (source
// "estimate") and updates the displayed value, once. Returns { status, value? }.
accountRoutes.get("/:id/value-estimate", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("id");

  const acct = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!acct || acct.tenantId !== session.tenantId) {
    return c.json({ error: "Account not found" }, 404);
  }

  const meta = parsePropertyMetadata(acct.metadata ?? null);
  if (!meta?.valueEstimate) {
    // No job was ever kicked off (no address, or provider unconfigured).
    return c.json({ status: "none" });
  }

  const result = await advanceValueEstimate(
    { id: acct.id, tenantId: acct.tenantId, metadata: acct.metadata ?? null },
    pollRealEstateValue,
  );
  return c.json(result);
});

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

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const bodySchema = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("mortgage"),
      maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      interestRatePercentage: z.number().min(0).max(100).optional(),
      interestRateType: z.enum(["fixed", "variable"]).optional(),
      originationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      originationPrincipal: z.number().min(0).optional(),
      loanTermYears: z.number().int().min(1).max(50).optional(),
      loanTerm: z.string().optional(),
    }),
    z.object({
      type: z.literal("student_loan"),
      expectedPayoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      interestRatePercentage: z.number().min(0).max(100).optional(),
      minimumPaymentAmount: z.number().min(0).optional(),
      originationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      loanTermYears: z.number().int().min(1).max(50).optional(),
      repaymentPlanType: z.string().optional(),
      nextPaymentDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    z.object({
      type: z.literal("credit_card"),
      minimumPaymentAmount: z.number().min(0).optional(),
      nextPaymentDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      aprs: z
        .array(
          z.object({
            aprType: z.string(),
            aprPercentage: z.number().min(0).max(100),
            balanceSubjectToApr: z.number().min(0).optional(),
          }),
        )
        .optional(),
    }),
    z.object({
      type: z.literal("other_loan"),
      maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      interestRatePercentage: z.number().min(0).max(100).optional(),
      minimumPaymentAmount: z.number().min(0).optional(),
      originationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      loanTermYears: z.number().int().min(1).max(50).optional(),
    }),
  ]);

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  // Read existing metadata to preserve Plaid-synced fields not included in this update
  let existingFields: Record<string, unknown> = {};
  if (acct.metadata) {
    try {
      const existing = JSON.parse(acct.metadata);
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        // Only carry forward fields from the same loan type to avoid type mismatch
        if (existing.type === parsed.data.type) {
          existingFields = existing;
        }
      }
    } catch {
      // malformed — start fresh
    }
  }

  const metadata = {
    ...existingFields,
    ...parsed.data,
    source: "manual" as const,
    lastSyncedAt: new Date().toISOString(),
  };

  // Keep the `apr` column in sync with the edited rate so the chat tools
  // (which read accounts.apr) and the Debt page (which reads metadata) agree.
  let apr: string | undefined;
  if (parsed.data.type === "credit_card") {
    const purchase = parsed.data.aprs?.find((a) => a.aprType === "purchase_apr");
    if (purchase) apr = String(purchase.aprPercentage);
  } else if (parsed.data.interestRatePercentage !== undefined) {
    apr = String(parsed.data.interestRatePercentage);
  }

  await db
    .update(accounts)
    .set({
      metadata: JSON.stringify(metadata),
      ...(apr !== undefined ? { apr } : {}),
    })
    .where(eq(accounts.id, accountId));

  return c.json({ metadata });
});

// Manual property details (real_estate accounts). Merge-only — never
// replaces the whole metadata blob, so unknown keys survive. null clears.
accountRoutes.patch("/:id/property-details", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("id");

  const acct = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!acct || acct.tenantId !== session.tenantId) {
    return c.json({ error: "Account not found" }, 404);
  }
  if (acct.type !== "real_estate") {
    return c.json({ error: "Property details only apply to real_estate accounts" }, 400);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const bodySchema = z
    .object({
      address: z.string().max(300).nullable(),
      placeId: z.string().max(300).nullable(),
      lat: z.number().min(-90).max(90).nullable(),
      lng: z.number().min(-180).max(180).nullable(),
      monthlyRent: z.number().min(0).nullable(),
      annualInsurance: z.number().min(0).nullable(),
      annualMaintenance: z.number().min(0).nullable(),
      // Value source: "market" re-enables the auto-estimate (clears any
      // override); "own" persists the user's own value as the source of truth.
      valueSource: z.enum(["market", "own"]),
      // The user's own value, sent alongside valueSource === "own".
      ownValue: z.number().min(0),
    })
    .partial();

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  let existing: Record<string, unknown> = {};
  if (acct.metadata) {
    try {
      const p = JSON.parse(acct.metadata);
      if (p && typeof p === "object" && !Array.isArray(p)) existing = p;
    } catch {
      // malformed — start fresh
    }
  }
  const metadata: Record<string, unknown> = { ...existing };
  // Only the persisted property fields go straight into metadata — valueSource /
  // ownValue are control signals handled separately below.
  const { valueSource, ownValue, ...fields } = parsed.data;
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) delete metadata[k];
    else metadata[k] = v;
  }

  // Value-source override handling. "own" pins the user's value; "market" clears
  // the override so the auto-estimate resumes. We manage the valueEstimate blob
  // here so the address re-kick below sees the right state.
  const existingVe =
    existing.valueEstimate && typeof existing.valueEstimate === "object"
      ? (existing.valueEstimate as Record<string, unknown>)
      : undefined;
  const switchingToOwn = valueSource === "own";
  const switchingToMarket = valueSource === "market";
  if (switchingToOwn) {
    // Persist the override flag so the auto-estimate never overwrites the value.
    metadata.valueEstimate = { ...(existingVe ?? {}), override: true };
  } else if (switchingToMarket) {
    // Drop the override — a fresh estimate is (re)kicked below off the address.
    delete metadata.valueEstimate;
  }

  const metaStr = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
  await db.update(accounts).set({ metadata: metaStr }).where(eq(accounts.id, accountId));

  // "own" with a value → record it as the displayed balance (a manual snapshot),
  // same as a manual value update. The override flag above keeps the estimate
  // from clobbering it.
  if (switchingToOwn && ownValue !== undefined) {
    await db.insert(balanceSnapshots).values({
      accountId,
      tenantId: session.tenantId,
      balance: String(ownValue),
      isoCurrencyCode: "USD",
      snapshotAt: new Date(),
    });
  }

  // (Re)kick an async value estimate when the address changed, or when switching
  // back to the market estimate. Compares against the prior stored address so
  // re-saving the same address doesn't needlessly restart the job.
  // Best-effort — never blocks the PATCH. Skip entirely while an override is set.
  const newAddress = typeof metadata.address === "string" ? metadata.address : "";
  const prevAddress = typeof existing.address === "string" ? existing.address : "";
  const addressChanged = "address" in fields && newAddress.trim() !== prevAddress.trim();
  if (!switchingToOwn && newAddress.trim() && (addressChanged || switchingToMarket)) {
    await kickOffValueEstimate(accountId, metaStr, newAddress);
  }
  return c.json({ metadata });
});

// Update account settings — classification and per-account overrides.
// Works for both Plaid and manual accounts; type/subtype reclassification
// sticks across syncs (sync only sets type/subtype on first insert).
accountRoutes.patch("/:id", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("id");

  const acct = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!acct || acct.tenantId !== session.tenantId) {
    return c.json({ error: "Account not found" }, 404);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const bodySchema = z
    .object({
      // Rename sticks across syncs — sync only sets name on first insert.
      name: z.string().trim().min(1).max(255),
      type: z.enum(accountTypeEnum.enumValues),
      subtype: z.string().max(100).nullable(),
      excludeFromNetWorth: z.boolean(),
      excludeTransactions: z.boolean(),
      invertBalance: z.boolean(),
      propertyAccountId: z.string().uuid().nullable(),
    })
    .partial();

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  if ("propertyAccountId" in parsed.data) {
    const targetId = parsed.data.propertyAccountId;
    const target =
      targetId == null
        ? null
        : await db.query.accounts.findFirst({
            where: and(eq(accounts.id, targetId), eq(accounts.tenantId, session.tenantId)),
          });
    const linkError = validatePropertyLink(acct, target);
    if (linkError) return c.json({ error: linkError }, 400);
  }

  const [updated] = await db
    .update(accounts)
    .set(parsed.data)
    .where(eq(accounts.id, accountId))
    .returning();

  return c.json({ ok: true, account: updated });
});
