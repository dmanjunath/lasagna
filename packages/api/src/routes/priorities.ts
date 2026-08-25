import { Hono } from "hono";
import { eq, desc, and, sql, notInArray, accounts, balanceSnapshots, financialProfiles, transactions, categories, categoryGroups, goals, goalAccounts } from "@lasagna/core";
import { db } from "../lib/db.js";
import { excludedTxnAccountIds } from "../lib/account-balances.js";
import { buildGoalAccountMap, resolveGoalAmount } from "../lib/goal-progress.js";
import { type AuthEnv } from "../middleware/auth.js";
import { z } from "zod";
import { type UserFinancialContext, type ContextDebtAccount } from '../lib/layer-selector.js';
import {
  UNIVERSAL_LAYERS,
  assessLayer,
  classifyDebtBucket,
  DEBT_BUCKETS,
  DEBT_BAND_BY_BUCKET,
  type DebtBucket,
} from '../lib/universal-layers.js';
import { resolveDebtAccounts } from '../lib/debt-accounts.js';
import { readHouseholdProfile, readUserPersonalProfile, resolveProfile } from "../lib/profile-resolver.js";

const VALID_LAYER_IDS = new Set(UNIVERSAL_LAYERS.map(l => l.id));

export const priorityRoutes = new Hono<AuthEnv>();

// GET / - Calculate personalized financial priorities
priorityRoutes.get("/", async (c) => {
  const session = c.get("session");

  const [accts, debtAccounts, household, personal, activeGoals, goalLinks] = await Promise.all([
    (async () => {
      const allAccounts = await db.query.accounts.findMany({
        where: eq(accounts.tenantId, session.tenantId),
      });
      return Promise.all(
        allAccounts.map(async (acct) => {
          const latest = await db.query.balanceSnapshots.findFirst({
            where: eq(balanceSnapshots.accountId, acct.id),
            orderBy: [desc(balanceSnapshots.snapshotAt)],
          });
          const rawBalance = parseFloat(latest?.balance ?? "0");
          return { ...acct, balance: acct.invertBalance ? -rawBalance : rawBalance };
        })
      );
    })(),
    // Per-account debts with their real APR resolved from liability metadata —
    // the same resolver /accounts/debts uses, so the ladder and the debt page
    // can never disagree about an account's rate.
    resolveDebtAccounts(session.tenantId),
    // Household row (also carries the priorities bookkeeping) + THIS user's
    // personal profile → merged for the per-user "you vs partner" priorities.
    readHouseholdProfile(session.tenantId),
    readUserPersonalProfile(session.tenantId, session.userId),
    db.query.goals.findMany({
      where: and(
        eq(goals.tenantId, session.tenantId),
        eq(goals.status, 'active'),
      ),
    }),
    db.query.goalAccounts.findMany({
      where: eq(goalAccounts.tenantId, session.tenantId),
    }),
  ]);

  // Merged personal + household fields (session user). Bookkeeping arrays stay
  // on the raw `household` row below.
  const resolved = resolveProfile(household ?? null, personal ?? null);

  const goalAccountMap = buildGoalAccountMap(goalLinks);
  const goalBalanceById = new Map(accts.map((a) => [a.id, a.balance]));

  // ── Build UserFinancialContext from DB data ─────────────────────────────

  const annualIncome = resolved.annualIncome ?? 0;
  const monthlyIncome = annualIncome / 12;
  const employerMatchPct = resolved.employerMatchPercent ?? 0;
  const age = resolved.age;
  const filingStatus = (resolved.filingStatus ?? null) as UserFinancialContext['filingStatus'];
  const retirementAge = resolved.retirementAge ?? 65;

  let cashTotal = 0, hsaBalance = 0, rothIraBalance = 0, trad401kBalance = 0, brokerageBalance = 0;
  let hasOverdraft = false, hasESPP = false, hasPension = false, has457b = false, has403b = false, hasInheritedIRA = false;

  for (const acct of accts) {
    if (acct.excludeFromNetWorth) continue;
    const sub = (acct.subtype || acct.name || "").toLowerCase();

    if (acct.type === "depository") {
      cashTotal += acct.balance;
    } else if (acct.type === "investment") {
      if (sub.includes("hsa") || sub.includes("health savings")) hsaBalance += acct.balance;
      else if (sub.includes("roth") && sub.includes("ira")) rothIraBalance += acct.balance;
      else if (sub.includes("401") || sub.includes("403b") || sub.includes("457")) trad401kBalance += acct.balance;
      else brokerageBalance += acct.balance;
      if (sub.includes("457")) has457b = true;
      if (sub.includes("403")) has403b = true;
    }
  }

  // Debt totals, bucketed from the resolved per-account APRs. One pass fills
  // both the totals the layers assess and the account list each layer names,
  // so a balance can't be counted in one band and listed under another.
  const debtTotals = Object.fromEntries(DEBT_BUCKETS.map((b) => [b, 0])) as Record<DebtBucket, number>;
  const ctxDebtAccounts: ContextDebtAccount[] = debtAccounts.map((d) => {
    const bucket = classifyDebtBucket(d);
    debtTotals[bucket] += d.balance;
    return {
      id: d.id,
      name: d.name,
      mask: d.mask,
      balance: d.balance,
      apr: d.apr,
      band: DEBT_BAND_BY_BUCKET[bucket],
    };
  });

  // Monthly expenses from last 30 days of transactions
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const excludedTxnIds = await excludedTxnAccountIds(session.tenantId);
  const [txnResult] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(
      eq(transactions.tenantId, session.tenantId),
      sql`${transactions.amount} > 0`,
      sql`coalesce(${categoryGroups.type}::text, 'expense') != 'transfer'`,
      sql`${transactions.date} >= ${thirtyDaysAgo.toISOString().split('T')[0]}`,
      ...(excludedTxnIds.length > 0 ? [notInArray(transactions.accountId, excludedTxnIds)] : []),
    ));
  const realMonthlyExpenses = parseFloat(txnResult?.total ?? "0");
  const hasTransactionData = realMonthlyExpenses > 0;
  const monthlyExpenses = hasTransactionData ? realMonthlyExpenses : null;

  // Stable monthly spend for progress targets: total non-transfer expense over the
  // last 3 full calendar months ÷ 3, so the emergency-fund target doesn't drift daily.
  const now = new Date();
  const threeMonthStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [stableTxnResult] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(
      eq(transactions.tenantId, session.tenantId),
      sql`${transactions.amount} > 0`,
      sql`coalesce(${categoryGroups.type}::text, 'expense') != 'transfer'`,
      sql`${transactions.date} >= ${threeMonthStart.toISOString().split('T')[0]}`,
      sql`${transactions.date} < ${currentMonthStart.toISOString().split('T')[0]}`,
      ...(excludedTxnIds.length > 0 ? [notInArray(transactions.accountId, excludedTxnIds)] : []),
    ));
  const threeMonthExpense = parseFloat(stableTxnResult?.total ?? "0");
  const stableMonthlyExpenses = threeMonthExpense > 0 ? threeMonthExpense / 3 : monthlyExpenses;
  const savingsRate = monthlyExpenses !== null && monthlyIncome > 0
    ? Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)
    : null;

  const ctx: UserFinancialContext = {
    age,
    annualIncome,
    filingStatus,
    employmentType: resolved.employmentType ?? 'w2',
    employerMatchPct,
    stateOfResidence: resolved.stateOfResidence ?? null,
    retirementAge,
    riskTolerance: resolved.riskTolerance ?? null,
    hasHDHP: resolved.hasHDHP ?? false,
    dependentCount: resolved.dependentCount ?? 0,
    isPSLFEligible: resolved.isPSLFEligible ?? false,
    goals: activeGoals.map(g => ({
      id: g.id,
      name: g.name,
      category: g.category,
      targetAmount: parseFloat(g.targetAmount ?? "0"),
      currentAmount: resolveGoalAmount(
        g.currentAmount ?? "0",
        goalAccountMap.get(g.id),
        goalBalanceById,
      ).amount,
      deadline: g.deadline ? new Date(g.deadline) : null,
    })),
    skippedLayerIds: household?.skippedPrioritySteps ?? [],
    cashTotal, hsaBalance, rothIraBalance, trad401kBalance, brokerageBalance,
    ...debtTotals,
    debtAccounts: ctxDebtAccounts,
    hasOverdraft, hasESPP, hasPension, has457b, has403b, hasInheritedIRA,
    monthlyExpenses,
    stableMonthlyExpenses,
    savingsRate,
  };

  // ── Assess all 12 universal layers ──────────────────────────────────────

  const skippedSet = new Set(household?.skippedPrioritySteps ?? []);

  // Build completion map from jsonb
  const completionEntries: Array<{id: string; note: string; completedAt: string}> =
    (household?.completedPrioritySteps as any) ?? [];
  const manuallyCompletedSet = new Set(completionEntries.map(e => e.id));
  const completionNoteMap = Object.fromEntries(completionEntries.map(e => [e.id, e.note]));

  const steps = UNIVERSAL_LAYERS.map((layer) => {
    const skipped = skippedSet.has(layer.id);
    const assessment = assessLayer(layer.id, ctx);

    let { status, progress, current, target, action } = assessment;

    // Manual completion override
    if (manuallyCompletedSet.has(layer.id)) {
      status = 'complete';
      progress = 100;
      action = completionNoteMap[layer.id] ? `Note: ${completionNoteMap[layer.id]}` : 'Marked complete.';
    }

    return {
      id: layer.id,
      order: layer.order,
      title: layer.name,
      subtitle: layer.subtitle,
      description: layer.description,
      icon: layer.icon,
      status,
      current,
      target,
      progress,
      action,
      accounts: assessment.accounts,
      detail: layer.subtitle,
      priority: layer.order <= 3 ? 'critical' as const : layer.order <= 7 ? 'high' as const : 'medium' as const,
      skipped,
      note: completionNoteMap[layer.id] ?? '',
    };
  });

  const currentStepId =
    steps.find(s => s.status !== 'complete' && !s.skipped)?.id ??
    steps[steps.length - 1]?.id;

  return c.json({
    steps,
    currentStepId,
    summary: {
      monthlyIncome: Math.round(monthlyIncome),
      monthlyExpenses: hasTransactionData ? Math.round(monthlyExpenses!) : null,
      monthlySurplus: hasTransactionData ? Math.round(monthlyIncome - monthlyExpenses!) : null,
      totalCash: Math.round(cashTotal),
      totalInvested: Math.round(rothIraBalance + trad401kBalance + brokerageBalance),
      totalHighInterestDebt: Math.round(debtTotals.creditCardDebt + debtTotals.paydayLoanDebt + debtTotals.personalLoanHighDebt + debtTotals.autoLoanHighDebt),
      totalMediumInterestDebt: Math.round(debtTotals.mediumInterestDebt + debtTotals.autoLoanMedDebt + debtTotals.personalLoanMedDebt),
      age,
      retirementAge,
      filingStatus,
    },
  });
});

// PATCH /skip — toggle skipped status for a step
const skipSchema = z.object({
  stepId: z.string().min(1).max(100),
  skipped: z.boolean(),
});

priorityRoutes.patch("/skip", async (c) => {
  const session = c.get("session");
  const raw = await c.req.json();
  const parsed = skipSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const { stepId, skipped } = parsed.data;

  if (!VALID_LAYER_IDS.has(stepId)) {
    return c.json({ error: 'Invalid step ID' }, 400);
  }

  // Get or create profile
  let profile = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, session.tenantId),
  });

  const currentSkipped = new Set<string>(profile?.skippedPrioritySteps ?? []);
  if (skipped) {
    currentSkipped.add(stepId);
  } else {
    currentSkipped.delete(stepId);
  }
  const updatedArray = [...currentSkipped];

  if (profile) {
    await db
      .update(financialProfiles)
      .set({ skippedPrioritySteps: updatedArray })
      .where(eq(financialProfiles.tenantId, session.tenantId));
  } else {
    await db.insert(financialProfiles).values({
      tenantId: session.tenantId,
      skippedPrioritySteps: updatedArray,
    });
  }

  return c.json({ ok: true, skippedSteps: updatedArray });
});

// PATCH /complete — toggle manually-completed status for a step
priorityRoutes.patch("/complete", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();
  const { stepId, completed, note } = z.object({
    stepId: z.string(),
    completed: z.boolean(),
    note: z.string().optional().default(''),
  }).parse(body);

  if (!VALID_LAYER_IDS.has(stepId)) {
    return c.json({ error: 'Invalid step ID' }, 400);
  }

  const existing = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, session.tenantId),
  });

  // completedPrioritySteps is now Array<{id, note, completedAt}>
  const current: Array<{id: string; note: string; completedAt: string}> =
    (existing?.completedPrioritySteps as any) ?? [];

  let updated: Array<{id: string; note: string; completedAt: string}>;
  if (completed) {
    // upsert: replace existing entry if present, otherwise add
    const without = current.filter(e => e.id !== stepId);
    updated = [...without, { id: stepId, note: note ?? '', completedAt: new Date().toISOString() }];
  } else {
    updated = current.filter(e => e.id !== stepId);
  }

  await db
    .insert(financialProfiles)
    .values({ tenantId: session.tenantId, completedPrioritySteps: updated })
    .onConflictDoUpdate({
      target: financialProfiles.tenantId,
      set: { completedPrioritySteps: updated },
    });

  return c.json({ ok: true });
});
