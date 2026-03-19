import { Hono } from "hono";
import { eq, desc, and, sql, accounts, balanceSnapshots, financialProfiles, transactions, goals } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { z } from "zod";
import { type UserFinancialContext } from '../lib/layer-selector.js';
import { UNIVERSAL_LAYERS, assessLayer } from '../lib/universal-layers.js';

const VALID_LAYER_IDS = new Set(UNIVERSAL_LAYERS.map(l => l.id));

export const priorityRoutes = new Hono<AuthEnv>();

// GET / - Calculate personalized financial priorities
priorityRoutes.get("/", async (c) => {
  const session = c.get("session");

  const [accts, profile, activeGoals] = await Promise.all([
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
          return { ...acct, balance: parseFloat(latest?.balance ?? "0") };
        })
      );
    })(),
    db.query.financialProfiles.findFirst({
      where: eq(financialProfiles.tenantId, session.tenantId),
    }),
    db.query.goals.findMany({
      where: and(
        eq(goals.tenantId, session.tenantId),
        eq(goals.status, 'active'),
      ),
    }),
  ]);

  // ── Build UserFinancialContext from DB data ─────────────────────────────

  const annualIncome = parseFloat(profile?.annualIncome ?? "0");
  const monthlyIncome = annualIncome / 12;
  const employerMatchPct = parseFloat(profile?.employerMatch ?? "0");
  const age = profile?.dateOfBirth
    ? Math.floor((Date.now() - new Date(profile.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;
  const filingStatus = (profile?.filingStatus ?? null) as UserFinancialContext['filingStatus'];
  const retirementAge = profile?.retirementAge ?? 65;

  let cashTotal = 0, hsaBalance = 0, rothIraBalance = 0, trad401kBalance = 0, brokerageBalance = 0;
  let paydayLoanDebt = 0, creditCardDebt = 0, personalLoanHighDebt = 0, autoLoanHighDebt = 0;
  let mediumInterestDebt = 0, autoLoanMedDebt = 0, personalLoanMedDebt = 0;
  let federalStudentLoanDebt = 0, privateStudentLoanDebt = 0;
  let autoLoanLowDebt = 0, studentLoanLowDebt = 0, mortgageBalance = 0;
  let medicalDebt = 0, collectionsDebt = 0;
  let hasOverdraft = false, hasESPP = false, hasPension = false, has457b = false, has403b = false, hasInheritedIRA = false;

  for (const acct of accts) {
    const balance = Math.abs(acct.balance);
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
    } else if (acct.type === "credit" || acct.type === "loan") {
      let rate = 0;
      try {
        if (acct.metadata) {
          const meta = JSON.parse(acct.metadata);
          rate = meta.interestRate || 0;
        }
      } catch { /* ignore */ }

      const loanType = sub;
      if (loanType.includes("payday") || loanType.includes("bnpl")) {
        paydayLoanDebt += balance;
      } else if (loanType.includes("student") || loanType.includes("sloan")) {
        const isFederal = loanType.includes("federal") || loanType.includes("direct") || loanType.includes("perkins");
        if (isFederal) federalStudentLoanDebt += balance;
        else if (rate < 5) studentLoanLowDebt += balance;
        else privateStudentLoanDebt += balance;
      } else if (loanType.includes("mortgage") || loanType.includes("home")) {
        mortgageBalance += balance;
      } else if (loanType.includes("auto") || loanType.includes("car") || loanType.includes("vehicle")) {
        if (rate > 10) autoLoanHighDebt += balance;
        else if (rate >= 6) autoLoanMedDebt += balance;
        else autoLoanLowDebt += balance;
      } else if (loanType.includes("medical")) {
        medicalDebt += balance;
      } else if (loanType.includes("collection")) {
        collectionsDebt += balance;
      } else if (acct.type === "credit") {
        creditCardDebt += balance;
      } else {
        if (rate > 15) personalLoanHighDebt += balance;
        else if (rate >= 6) personalLoanMedDebt += balance;
        else mediumInterestDebt += balance;
      }
    }
  }

  // Monthly expenses from last 30 days of transactions
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [txnResult] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(
      eq(transactions.tenantId, session.tenantId),
      sql`${transactions.amount} > 0`,
      sql`${transactions.category} != 'transfer'`,
      sql`${transactions.date} >= ${thirtyDaysAgo.toISOString().split('T')[0]}`,
    ));
  const realMonthlyExpenses = parseFloat(txnResult?.total ?? "0");
  const hasTransactionData = realMonthlyExpenses > 0;
  const monthlyExpenses = hasTransactionData ? realMonthlyExpenses : null;
  const savingsRate = monthlyExpenses !== null && monthlyIncome > 0
    ? Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)
    : null;

  const ctx: UserFinancialContext = {
    age,
    annualIncome,
    filingStatus,
    employmentType: profile?.employmentType ?? 'w2',
    employerMatchPct,
    stateOfResidence: profile?.stateOfResidence ?? null,
    retirementAge,
    riskTolerance: profile?.riskTolerance ?? null,
    hasHDHP: profile?.hasHDHP ?? false,
    dependentCount: profile?.dependentCount ?? 0,
    isPSLFEligible: profile?.isPSLFEligible ?? false,
    goals: activeGoals.map(g => ({
      id: g.id,
      name: g.name,
      category: g.category,
      targetAmount: parseFloat(g.targetAmount ?? "0"),
      currentAmount: parseFloat(g.currentAmount ?? "0"),
      deadline: g.deadline ? new Date(g.deadline) : null,
    })),
    skippedLayerIds: profile?.skippedPrioritySteps ?? [],
    cashTotal, hsaBalance, rothIraBalance, trad401kBalance, brokerageBalance,
    paydayLoanDebt, creditCardDebt, personalLoanHighDebt, autoLoanHighDebt,
    mediumInterestDebt, autoLoanMedDebt, personalLoanMedDebt,
    federalStudentLoanDebt, privateStudentLoanDebt,
    autoLoanLowDebt, studentLoanLowDebt, mortgageBalance,
    medicalDebt, collectionsDebt,
    hasOverdraft, hasESPP, hasPension, has457b, has403b, hasInheritedIRA,
    monthlyExpenses,
    savingsRate,
  };

  // ── Assess all 12 universal layers ──────────────────────────────────────

  const skippedSet = new Set(profile?.skippedPrioritySteps ?? []);

  // Build completion map from jsonb
  const completionEntries: Array<{id: string; note: string; completedAt: string}> =
    (profile?.completedPrioritySteps as any) ?? [];
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
      totalHighInterestDebt: Math.round(creditCardDebt + paydayLoanDebt + personalLoanHighDebt + autoLoanHighDebt),
      totalMediumInterestDebt: Math.round(mediumInterestDebt + autoLoanMedDebt + personalLoanMedDebt),
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
