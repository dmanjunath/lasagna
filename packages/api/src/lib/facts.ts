import { fetchAccountsWithBalances, netWorthContribution, LIABILITY_TYPES } from "./account-balances.js";
import { payoffStanding, type DebtAccount } from "./debt-accounts.js";
import { computeCashFlow, lastFullMonthWindow } from "./cash-flow.js";
import { verdictFor, type ReadinessVerdict } from "@lasagna/core/retirement-verdict";
import { resolveSimInputs } from "../services/resolve-sim-inputs.js";
import { runRetirementSim } from "../services/retirement-sim.js";

/**
 * The one server-side place a user-facing fact is computed. Each concept the
 * app states in more than one place (Home, Money, chat) gets one function
 * here, and every surface reads it instead of re-deriving the number. Before
 * this, Home, Money and the chat tool each rebuilt net worth from raw
 * balances and disagreed on how many accounts there were.
 *
 * The concepts, what each one leaves out, and who reads it. The parity test
 * `__tests__/facts-parity-db.test.ts` fails when a page source and its chat
 * tool disagree.
 *
 * - accountsConnected: every account the tenant has, counted or not.
 *   Excludes nothing. Read by Home (empty state), the Accounts page (account
 *   count line), /spending (linked-accounts check) and chat `get_net_worth`.
 * - accountsCounted: accounts that count toward net worth. Excludes accounts
 *   the user marked "not counted in net worth". Read by the Accounts page
 *   ("N not counted in net worth") and chat `get_net_worth`.
 * - netWorth (assets, debt, netWorth, byType): counted assets minus counted
 *   credit and loan balances, invert override applied, debts as positive
 *   magnitudes. Excludes not-counted accounts. Read by Home (breakdown), the
 *   Accounts page (headline and section shares), /spending (card total in
 *   the no-transactions state) and chat `get_net_worth`.
 * - totalDebt: every counted credit card and loan, equal to `netWorth.debt`.
 *   Excludes not-counted accounts. Read by Home (Debt figure, as
 *   `netWorth.debt`), `/api/accounts/debts` and chat `get_debts`.
 * - debtOnPayoffPlan: the part of totalDebt a payoff plan works on. Excludes
 *   cards that clear every month and cards with no rate (listed under
 *   `notInPlan`). Read by /debt (hero, via `/api/accounts/debts`) and chat
 *   `get_debts`.
 * - monthlyNetFlow: income minus spending for the last full calendar month.
 *   Excludes transfers, refunds as income, excluded transactions and accounts
 *   excluded from transactions. Read by /spending (hero, via
 *   `/api/transactions/spending-summary` on the same `computeCashFlow`),
 *   `/api/facts` and chat `get_spending_summary`.
 * - retirementSuccess: the Monte Carlo chance the money lasts, on the
 *   server-resolved plan with no what-if edits. Excludes the historical
 *   backtest, which is a check beside it. Read by /retirement (headline, via
 *   `POST /api/retirement/simulate` with no overrides),
 *   `/api/facts?include=retirement` and chat `run_monte_carlo`.
 */

/** A total and how many accounts make it up. */
export interface TypeTotal {
  total: number;
  count: number;
}

export interface NetWorthFact {
  /**
   * Sum of every counted non-liability account (cash, investments, real
   * estate, alternative), with the invert override applied.
   */
  assets: number;
  /**
   * Sum of every counted liability (credit, loan) as a positive magnitude, so
   * net worth is `assets - debt`.
   */
  debt: number;
  /** `assets - debt`, the same sum chat and the history chart use. */
  netWorth: number;
  /**
   * Per type. Liabilities are positive magnitudes, like `debt`. Counts cover
   * only accounts that count toward net worth.
   */
  byType: {
    cash: TypeTotal;
    investments: TypeTotal;
    realEstate: TypeTotal;
    alternative: TypeTotal;
    creditCards: TypeTotal;
    loans: TypeTotal;
  };
}

export interface AccountFacts {
  /** Every account the tenant has, counted or not. */
  accountsConnected: number;
  /**
   * Accounts that count toward net worth: every account the user has not
   * flagged "not counted in net worth" (`excludeFromNetWorth`). The flag is
   * the user's own choice, for example a joint account a partner also tracks.
   */
  accountsCounted: number;
  /**
   * Net worth over the counted accounts only. Excluded accounts add nothing,
   * and the user's invert override is applied before summing.
   */
  netWorth: NetWorthFact;
}

const TYPE_KEY: Record<string, keyof NetWorthFact["byType"]> = {
  depository: "cash",
  investment: "investments",
  real_estate: "realEstate",
  alternative: "alternative",
  credit: "creditCards",
  loan: "loans",
};

/** Account count and net worth, from the same rows the net worth chart sums. */
export async function computeAccountFacts(tenantId: string): Promise<AccountFacts> {
  const accts = await fetchAccountsWithBalances(tenantId);
  const zero = (): TypeTotal => ({ total: 0, count: 0 });
  const byType: NetWorthFact["byType"] = {
    cash: zero(),
    investments: zero(),
    realEstate: zero(),
    alternative: zero(),
    creditCards: zero(),
    loans: zero(),
  };
  let assets = 0;
  let debt = 0;
  let accountsCounted = 0;

  for (const a of accts) {
    if (a.excludeFromNetWorth) continue;
    accountsCounted++;
    // Liabilities contribute negative, so the debt side is the magnitude.
    const contribution = netWorthContribution(a);
    const value = LIABILITY_TYPES.has(a.type) ? -contribution : contribution;
    if (LIABILITY_TYPES.has(a.type)) debt += value;
    else assets += value;
    const key = TYPE_KEY[a.type];
    if (key) {
      byType[key].total += value;
      byType[key].count++;
    }
  }

  return {
    accountsConnected: accts.length,
    accountsCounted,
    netWorth: { assets, debt, netWorth: assets - debt, byType },
  };
}

/** An amount owed and how many accounts make it up. */
export interface DebtAmount {
  amount: number;
  count: number;
}

export interface DebtFacts {
  /**
   * Every credit card and loan counted in net worth, as a positive magnitude.
   * The same number as `netWorth.debt`: Home's Debt figure. An account the
   * user marked "not counted in net worth" is left out.
   */
  totalDebt: number;
  /**
   * The part of `totalDebt` a payoff plan works on, the /debt hero. It is
   * narrower because two kinds of card are owed but have nothing to pay down
   * (`payoffStanding`): a card that clears every month costs no interest, and
   * a card with no rate and no payment history cannot be ranked until the user
   * adds its rate. `amount + notInPlan.amount === totalDebt`.
   */
  debtOnPayoffPlan: {
    amount: number;
    notInPlan: DebtAmount & {
      clearsMonthly: DebtAmount;
      needsRate: DebtAmount;
    };
  };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Debt facts from figures a caller already holds: `netWorthDebt` is
 * `computeAccountFacts().netWorth.debt` and `debts` is `resolveDebtAccounts()`
 * for the same tenant. Both cover the same counted credit and loan accounts
 * at the same magnitude, so the payoff split adds back up to `totalDebt`.
 */
export function debtFactsFrom(netWorthDebt: number, debts: DebtAccount[]): DebtFacts {
  const onPlan: DebtAmount = { amount: 0, count: 0 };
  const clearsMonthly: DebtAmount = { amount: 0, count: 0 };
  const needsRate: DebtAmount = { amount: 0, count: 0 };
  const bucket = { payoff: onPlan, "clears-monthly": clearsMonthly, "needs-rate": needsRate };
  for (const d of debts) {
    const b = bucket[payoffStanding(d)];
    b.amount += d.balance;
    b.count++;
  }
  for (const b of [onPlan, clearsMonthly, needsRate]) b.amount = cents(b.amount);
  return {
    totalDebt: cents(netWorthDebt),
    debtOnPayoffPlan: {
      amount: onPlan.amount,
      notInPlan: {
        amount: cents(clearsMonthly.amount + needsRate.amount),
        count: clearsMonthly.count + needsRate.count,
        clearsMonthly,
        needsRate,
      },
    },
  };
}


export interface MonthlyNetFlowFact {
  /** ISO bounds of the month and its name, e.g. "October 2026". */
  window: { start: string; end: string; label: string };
  income: number;
  spending: number;
  /** `income - spending`: positive is a surplus, negative a shortfall. */
  net: number;
}

/**
 * Income, spending and net for the last full calendar month, the month the
 * Spending page opens on, from the same `computeCashFlow` its hero reads.
 * Transfers are excluded. Income is income-group inflows only, so a refund is
 * not income. Each category is netted first, and a refund-heavy category
 * (net negative) counts as neither income nor spending. Accounts excluded from
 * transactions and transactions the user excluded are skipped.
 */
export async function computeMonthlyNetFlow(tenantId: string, now = new Date()): Promise<MonthlyNetFlowFact> {
  const win = lastFullMonthWindow(now);
  const { income, spending, net } = await computeCashFlow(tenantId, win.start, win.end);
  return {
    window: { start: win.start.toISOString(), end: win.end.toISOString(), label: win.label },
    income,
    spending,
    net,
  };
}

export interface RetirementSuccessFact {
  /** Chance the money lasts through `planThroughAge`, as a whole 0..100 percent. */
  percent: number;
  verdict: ReadinessVerdict;
  method: "monte_carlo";
  simulations: number;
  planThroughAge: number;
  retirementAge: number;
}

/**
 * The headline chance of retirement success: the Monte Carlo figure the
 * Retirement page leads with and chat quotes. It runs the same engine on the
 * same server-resolved inputs with the default seed, so with no what-if edits
 * the page, this fact and chat's `run_monte_carlo` all print the same number.
 * The historical backtest and the sustainable draw are checks shown beside it,
 * never the headline.
 */
export async function computeRetirementSuccess(tenantId: string, userId: string): Promise<RetirementSuccessFact> {
  const inputs = await resolveSimInputs(tenantId, userId, {});
  const percent = Math.round(runRetirementSim(inputs).successRate * 100);
  return {
    percent,
    verdict: verdictFor(percent),
    method: "monte_carlo",
    simulations: inputs.numSimulations,
    planThroughAge: inputs.planThroughAge,
    retirementAge: inputs.retirementAge,
  };
}
