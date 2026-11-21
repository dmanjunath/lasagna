import { Hono } from "hono";
import { type AuthEnv } from "../middleware/auth.js";
import { computeAccountFacts, computeMonthlyNetFlow, computeRetirementSuccess, debtFactsFrom } from "../lib/facts.js";
import { resolveDebtAccounts } from "../lib/debt-accounts.js";

export const factsRoutes = new Hono<AuthEnv>();

// The canonical account count, net worth, debt and monthly net flow every page
// states. `?include=retirement` adds the retirement chance of success, which
// runs a simulation, so a plain Home load does not pay for it.
factsRoutes.get("/", async (c) => {
  const session = c.get("session");
  const withRetirement = c.req.query("include")?.split(",").includes("retirement") ?? false;
  const [facts, debts, monthlyNetFlow, retirementSuccess] = await Promise.all([
    computeAccountFacts(session.tenantId),
    resolveDebtAccounts(session.tenantId),
    computeMonthlyNetFlow(session.tenantId),
    withRetirement ? computeRetirementSuccess(session.tenantId, session.userId) : undefined,
  ]);
  return c.json({
    ...facts,
    ...debtFactsFrom(facts.netWorth.debt, debts),
    monthlyNetFlow,
    ...(retirementSuccess ? { retirementSuccess } : {}),
  });
});
