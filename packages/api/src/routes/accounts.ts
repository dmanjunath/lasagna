import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, sql, accounts, balanceSnapshots, parseLoanMetadata } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";

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

  const balances = await Promise.all(
    accts.map(async (acct) => {
      const latest = await db.query.balanceSnapshots.findFirst({
        where: eq(balanceSnapshots.accountId, acct.id),
        orderBy: [desc(balanceSnapshots.snapshotAt)],
      });
      return {
        accountId: acct.id,
        name: acct.name,
        type: acct.type,
        mask: acct.mask,
        balance: latest?.balance ?? null,
        available: latest?.available ?? null,
        currency: latest?.isoCurrencyCode ?? "USD",
        asOf: latest?.snapshotAt ?? null,
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

  const liabilityTypes = new Set(["credit", "loan"]);
  const accountTypeMap = new Map(accts.map((a) => [a.id, a.type]));

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
      const bal = dateBalMap.get(date) || 0;
      const type = accountTypeMap.get(acctId);
      total += type && liabilityTypes.has(type) ? -bal : bal;
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
    ),
  });

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
      loanTerm: z.string().optional(),
    }),
    z.object({
      type: z.literal("student_loan"),
      expectedPayoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      interestRatePercentage: z.number().min(0).max(100).optional(),
      minimumPaymentAmount: z.number().min(0).optional(),
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

  await db
    .update(accounts)
    .set({ metadata: JSON.stringify(metadata) })
    .where(eq(accounts.id, accountId));

  return c.json({ metadata });
});
