/**
 * Debt payoff math, shared by the API (journey sizing, insights) and the web
 * debt page, so a payoff month is worked out one way everywhere.
 *
 * The model: every debt gets its minimum each month. An extra amount on top
 * goes to one debt at a time, in the order the strategy picks, and moves to the
 * next debt when that one clears. A cleared debt's minimum is not rolled into
 * the next one. So with no extra the schedule is exactly the minimums, and the
 * order cannot change anything.
 */

export function monthsToPayOff(balance: number, payment: number, aprPercent: number | null): number {
  if (balance <= 0) return 0;
  if (payment <= 0) return Infinity;
  const r = (aprPercent ?? 0) / 100 / 12;
  if (r <= 0) return Math.ceil(balance / payment);
  // Anything at or below the monthly interest never touches the principal.
  if (payment <= balance * r) return Infinity;
  return Math.ceil(-Math.log(1 - (balance * r) / payment) / Math.log(1 + r));
}

export interface PayoffDebt {
  id: string;
  balance: number;
  /** Annual rate as a percentage, e.g. 24.99. */
  apr: number;
  minPayment: number;
}

export type PayoffStrategy = 'avalanche' | 'snowball';

export interface PayoffResult {
  /** Months until the last debt clears. Infinity when one never does. */
  months: number;
  /** Interest paid over the schedule. Infinity when a debt never clears. */
  totalInterest: number;
  /** Months until each debt clears, by id. Infinity when it never does. */
  monthsById: Record<string, number>;
  /** Months until the first debt clears. */
  firstClearedMonths: number;
  /** The order the extra amount goes in. */
  order: string[];
}

/** 100 years. A schedule still running past this is treated as never clearing. */
const MAX_MONTHS = 1200;
const CENT = 0.005;

/**
 * Avalanche: highest rate first, smaller balance breaking a tie.
 * Snowball: smallest balance first, higher rate breaking a tie.
 */
export function payoffOrder(debts: PayoffDebt[], strategy: PayoffStrategy): PayoffDebt[] {
  return [...debts].sort((a, b) =>
    strategy === 'avalanche'
      ? b.apr - a.apr || a.balance - b.balance
      : a.balance - b.balance || b.apr - a.apr,
  );
}

export function simulatePayoff(debts: PayoffDebt[], strategy: PayoffStrategy, extra: number): PayoffResult {
  const ordered = payoffOrder(debts, strategy);
  const bal = ordered.map((d) => Math.max(0, d.balance));
  const cleared: number[] = ordered.map((_, i) => (bal[i] <= CENT ? 0 : Infinity));
  const pool0 = Number.isFinite(extra) && extra > 0 ? extra : 0;
  let interest = 0;

  for (let m = 1; m <= MAX_MONTHS && cleared.some((c) => c === Infinity); m++) {
    for (let i = 0; i < ordered.length; i++) {
      if (cleared[i] !== Infinity) continue;
      const accrued = bal[i] * (ordered[i].apr / 100 / 12);
      interest += accrued;
      bal[i] = bal[i] + accrued - Math.min(Math.max(0, ordered[i].minPayment), bal[i] + accrued);
    }
    let pool = pool0;
    for (let i = 0; i < ordered.length && pool > 0; i++) {
      if (cleared[i] !== Infinity) continue;
      const x = Math.min(pool, bal[i]);
      bal[i] -= x;
      pool -= x;
    }
    for (let i = 0; i < ordered.length; i++) {
      if (cleared[i] === Infinity && bal[i] <= CENT) cleared[i] = m;
    }
  }

  const months = cleared.length ? Math.max(...cleared) : 0;
  const monthsById: Record<string, number> = {};
  ordered.forEach((d, i) => { monthsById[d.id] = cleared[i]; });
  return {
    months,
    totalInterest: months === Infinity ? Infinity : interest,
    monthsById,
    firstClearedMonths: cleared.length ? Math.min(...cleared) : 0,
    order: ordered.map((d) => d.id),
  };
}

export interface StrategyComparison {
  avalanche: PayoffResult;
  snowball: PayoffResult;
  /**
   * The two orders cost the same interest (to the dollar) and finish in the
   * same month, so there is no choice to offer between them.
   */
  tie: boolean;
}

export function compareStrategies(debts: PayoffDebt[], extra: number): StrategyComparison {
  const avalanche = simulatePayoff(debts, 'avalanche', extra);
  const snowball = simulatePayoff(debts, 'snowball', extra);
  const sameInterest =
    avalanche.totalInterest === snowball.totalInterest ||
    Math.round(avalanche.totalInterest) === Math.round(snowball.totalInterest);
  return { avalanche, snowball, tie: sameInterest && avalanche.months === snowball.months };
}
