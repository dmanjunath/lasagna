import { Hono } from "hono";
import { eq, desc, accounts, balanceSnapshots, financialProfiles } from "@lasagna/core";
import { db } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const priorityRoutes = new Hono<AuthEnv>();
priorityRoutes.use("*", requireAuth);

// GET / - Calculate personalized financial priorities
priorityRoutes.get("/", async (c) => {
  const session = c.get("session");

  // Fetch all data in parallel
  const [accts, profile] = await Promise.all([
    // Get accounts with latest balances
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
          return {
            ...acct,
            balance: parseFloat(latest?.balance ?? "0"),
          };
        })
      );
    })(),
    db.query.financialProfiles.findFirst({
      where: eq(financialProfiles.tenantId, session.tenantId),
    }),
  ]);

  // Calculate financial state
  const annualIncome = parseFloat(profile?.annualIncome ?? "0");
  const monthlyIncome = annualIncome / 12;
  const employerMatch = parseFloat(profile?.employerMatch ?? "0");
  const age =
    profile?.dateOfBirth
      ? Math.floor(
          (Date.now() - new Date(profile.dateOfBirth).getTime()) /
            (365.25 * 24 * 60 * 60 * 1000)
        )
      : null;
  const filingStatus = profile?.filingStatus ?? null;
  const retirementAge = profile?.retirementAge ?? 65;

  // Categorize accounts
  let cashTotal = 0;
  let investmentTotal = 0;
  let hsaBalance = 0;
  let rothIraBalance = 0;
  let trad401kBalance = 0;
  let brokerageBalance = 0;
  const highInterestDebts: Array<{
    name: string;
    balance: number;
    rate: number;
  }> = [];
  const mediumInterestDebts: Array<{
    name: string;
    balance: number;
    rate: number;
  }> = [];

  for (const acct of accts) {
    const balance = Math.abs(acct.balance);
    if (acct.type === "depository") {
      cashTotal += acct.balance;
    } else if (acct.type === "investment") {
      investmentTotal += acct.balance;
      const sub = (acct.subtype || acct.name || "").toLowerCase();
      if (sub.includes("hsa") || sub.includes("health"))
        hsaBalance += acct.balance;
      else if (sub.includes("roth") && sub.includes("ira"))
        rothIraBalance += acct.balance;
      else if (
        sub.includes("401") ||
        sub.includes("403") ||
        sub.includes("457")
      )
        trad401kBalance += acct.balance;
      else brokerageBalance += acct.balance;
    } else if (acct.type === "credit" || acct.type === "loan") {
      let rate = 0;
      try {
        if (acct.metadata) {
          const meta = JSON.parse(acct.metadata);
          rate = meta.interestRate || 0;
        }
      } catch {
        // ignore malformed metadata
      }

      if (rate > 7) {
        highInterestDebts.push({ name: acct.name, balance, rate });
      } else if (rate >= 4) {
        mediumInterestDebts.push({ name: acct.name, balance, rate });
      }
    }
  }

  // Estimate monthly expenses (use 60% of income as rough estimate, or credit card balance)
  const creditSpend = accts
    .filter((a) => a.type === "credit")
    .reduce((sum, a) => sum + Math.abs(a.balance), 0);
  const monthlyExpenses =
    creditSpend > 0 ? creditSpend : monthlyIncome * 0.6;

  const isOver50 = age !== null && age >= 50;
  const isMarried = filingStatus === "married_joint";

  // Build priority steps
  const steps = [];

  // 1. Emergency Fund
  const emergencyTarget = monthlyExpenses * 6;
  const emergencyPct =
    emergencyTarget > 0 ? Math.min(1, cashTotal / emergencyTarget) : 0;
  steps.push({
    id: "emergency_fund",
    order: 1,
    title: "Build Emergency Fund",
    subtitle: "6 months of expenses in cash",
    icon: "shield",
    status:
      emergencyPct >= 1
        ? "complete"
        : emergencyPct > 0
          ? "in_progress"
          : "not_started",
    current: Math.round(cashTotal),
    target: Math.round(emergencyTarget),
    progress: Math.round(emergencyPct * 100),
    action:
      emergencyPct >= 1
        ? "Your emergency fund is fully funded!"
        : `Save $${Math.round(emergencyTarget - cashTotal).toLocaleString()} more in a high-yield savings account`,
    detail: `Target: $${Math.round(emergencyTarget).toLocaleString()} (6 x $${Math.round(monthlyExpenses).toLocaleString()}/mo expenses)`,
    priority: "critical",
  });

  // 2. Employer Match
  if (employerMatch > 0) {
    const matchContribution = monthlyIncome * (employerMatch / 100);
    const annualMatch = matchContribution * 12;
    steps.push({
      id: "employer_match",
      order: 2,
      title: "Get Full Employer Match",
      subtitle: `${employerMatch}% match = free money`,
      icon: "gift",
      status: trad401kBalance > 0 ? "in_progress" : "not_started",
      current: null,
      target: Math.round(annualMatch),
      progress: trad401kBalance > 0 ? 50 : 0,
      action: `Contribute at least ${employerMatch}% ($${Math.round(matchContribution).toLocaleString()}/mo) to your 401(k)`,
      detail: `Your employer matches ${employerMatch}% — that's $${Math.round(annualMatch).toLocaleString()}/yr in free money`,
      priority: "critical",
    });
  }

  // 3. High-Interest Debt
  const totalHighDebt = highInterestDebts.reduce(
    (s, d) => s + d.balance,
    0
  );
  if (totalHighDebt > 0) {
    steps.push({
      id: "high_interest_debt",
      order: 3,
      title: "Pay Off High-Interest Debt",
      subtitle: `${highInterestDebts.length} debt${highInterestDebts.length > 1 ? "s" : ""} above 7% APR`,
      icon: "flame",
      status: "in_progress",
      current: Math.round(totalHighDebt),
      target: 0,
      progress: 0,
      action: `Pay off $${Math.round(totalHighDebt).toLocaleString()} in high-interest debt`,
      detail: highInterestDebts
        .map(
          (d) =>
            `${d.name}: $${Math.round(d.balance).toLocaleString()} at ${d.rate}%`
        )
        .join(" · "),
      priority: "high",
      debts: highInterestDebts,
    });
  }

  // 4. Max HSA
  const hsaMax = isMarried ? 8550 : 4300;
  steps.push({
    id: "max_hsa",
    order: 4,
    title: "Max Out HSA",
    subtitle: "Triple tax advantage",
    icon: "heart-pulse",
    status: hsaBalance > 0 ? "in_progress" : "not_started",
    current: Math.round(hsaBalance),
    target: hsaMax,
    progress:
      hsaMax > 0
        ? Math.min(100, Math.round((hsaBalance / hsaMax) * 100))
        : 0,
    action: `Contribute up to $${hsaMax.toLocaleString()}/yr to your HSA`,
    detail:
      "Tax-deductible contributions, tax-free growth, tax-free withdrawals for medical expenses",
    priority: "high",
  });

  // 5. Max Roth IRA
  const rothMax = isOver50 ? 8000 : 7000;
  const incomeLimit = isMarried ? 240000 : 161000;
  const overIncomeLimit = annualIncome > incomeLimit;
  steps.push({
    id: "max_roth_ira",
    order: 5,
    title: overIncomeLimit ? "Backdoor Roth IRA" : "Max Out Roth IRA",
    subtitle: "Tax-free growth forever",
    icon: "sprout",
    status: rothIraBalance > 0 ? "in_progress" : "not_started",
    current: Math.round(rothIraBalance),
    target: rothMax,
    progress:
      rothMax > 0
        ? Math.min(100, Math.round((rothIraBalance / rothMax) * 100))
        : 0,
    action: overIncomeLimit
      ? `Use backdoor Roth conversion — your income ($${Math.round(annualIncome).toLocaleString()}) exceeds the $${incomeLimit.toLocaleString()} limit`
      : `Contribute up to $${rothMax.toLocaleString()}/yr to a Roth IRA`,
    detail: overIncomeLimit
      ? "Contribute to Traditional IRA then convert to Roth (check with tax advisor)"
      : "Contributions grow tax-free and withdrawals in retirement are tax-free",
    priority: "medium",
  });

  // 6. Max 401(k) beyond match
  const max401k = isOver50 ? 31000 : 23500;
  if (employerMatch > 0 || trad401kBalance > 0) {
    steps.push({
      id: "max_401k",
      order: 6,
      title: "Max Out 401(k)",
      subtitle: "Beyond employer match",
      icon: "trending-up",
      status: trad401kBalance > 0 ? "in_progress" : "not_started",
      current: Math.round(trad401kBalance),
      target: max401k,
      progress:
        max401k > 0
          ? Math.min(100, Math.round((trad401kBalance / max401k) * 100))
          : 0,
      action: `Increase 401(k) contributions toward the $${max401k.toLocaleString()}/yr max`,
      detail: isOver50
        ? "Includes $7,500 catch-up contribution for age 50+"
        : "Pre-tax or Roth 401(k) contributions reduce taxable income",
      priority: "medium",
    });
  }

  // 7. Medium-Interest Debt
  const totalMedDebt = mediumInterestDebts.reduce(
    (s, d) => s + d.balance,
    0
  );
  if (totalMedDebt > 0) {
    steps.push({
      id: "medium_interest_debt",
      order: 7,
      title: "Pay Down Medium-Interest Debt",
      subtitle: `${mediumInterestDebts.length} debt${mediumInterestDebts.length > 1 ? "s" : ""} at 4-7% APR`,
      icon: "credit-card",
      status: "in_progress",
      current: Math.round(totalMedDebt),
      target: 0,
      progress: 0,
      action: `Pay down $${Math.round(totalMedDebt).toLocaleString()} in medium-interest debt — or invest if expected returns exceed the rate`,
      detail: mediumInterestDebts
        .map(
          (d) =>
            `${d.name}: $${Math.round(d.balance).toLocaleString()} at ${d.rate}%`
        )
        .join(" · "),
      priority: "low",
      debts: mediumInterestDebts,
    });
  }

  // 8. Taxable Investing
  steps.push({
    id: "taxable_investing",
    order: 8,
    title: "Invest in Taxable Brokerage",
    subtitle: "Index funds for long-term growth",
    icon: "rocket",
    status: brokerageBalance > 0 ? "in_progress" : "not_started",
    current: Math.round(brokerageBalance),
    target: null,
    progress: brokerageBalance > 0 ? 100 : 0,
    action:
      brokerageBalance > 0
        ? `You have $${Math.round(brokerageBalance).toLocaleString()} invested — keep adding surplus cash here`
        : "Once previous steps are covered, invest surplus in a low-cost total market index fund",
    detail:
      "Consider tax-efficient funds (VTI, VXUS) and tax-loss harvesting opportunities",
    priority: "low",
  });

  // Find the "current step" — the first non-complete step
  const currentStepId =
    steps.find((s) => s.status !== "complete")?.id ||
    steps[steps.length - 1].id;

  return c.json({
    steps,
    currentStepId,
    summary: {
      monthlyIncome: Math.round(monthlyIncome),
      monthlyExpenses: Math.round(monthlyExpenses),
      monthlySurplus: Math.round(monthlyIncome - monthlyExpenses),
      totalCash: Math.round(cashTotal),
      totalInvested: Math.round(investmentTotal),
      totalHighInterestDebt: Math.round(totalHighDebt),
      totalMediumInterestDebt: Math.round(totalMedDebt),
      age,
      retirementAge,
      filingStatus,
    },
  });
});
