import { describe, it, expect } from 'vitest';
import { runRetirementSim, type SimInputs } from '../retirement-sim.js';
import { solveMonthlySavings, TARGET_SUCCESS } from '../retirement-readiness.js';

/**
 * The solver, against the REAL Monte Carlo rather than a stub.
 *
 * The point of these is that the contribution the path quotes is a figure the
 * engine actually reached the target on, so they re-run the same simulation at
 * the answer and check the rate. A stubbed sim would prove nothing here.
 *
 * `numSimulations` is dialled down on the fixtures purely for speed — the solver
 * inherits whatever the inputs carry, so the behaviour is the same either way.
 */

// 50 years old, 15 to go, $100k invested and $900 a month going in against
// $4,700 a month of spending: short of the target, but not hopelessly.
const SHORT: SimInputs = {
  currentAge: 50,
  retirementAge: 65,
  planThroughAge: 90,
  startingBalance: 100_000,
  monthlySavings: 900,
  monthlySpend: 4700,
  strategy: 'constant_dollar',
  ssMonthly: 2900,
  ssClaimAge: 67,
  otherMonthly: 0,
  otherStartAge: 65,
  allocation: { usStocks: 0.5, intlStocks: 0.1, bonds: 0.25, reits: 0.05, cash: 0.1 },
  inflationAdjusted: true,
  numSimulations: 200,
};

const successPct = (inputs: SimInputs, monthlySavings: number) =>
  Math.round(runRetirementSim({ ...inputs, monthlySavings }).successRate * 100);

describe('solveMonthlySavings — the number it names is one it measured', () => {
  it('starts from a household the engine says is short of the target', () => {
    expect(successPct(SHORT, SHORT.monthlySavings)).toBeLessThan(TARGET_SUCCESS);
  });

  it('returns a contribution that reaches the target when the sim is re-run at it', () => {
    const solved = solveMonthlySavings(SHORT, 7083);
    expect(solved.monthlySavings).not.toBeNull();
    expect(successPct(SHORT, solved.monthlySavings!)).toBeGreaterThanOrEqual(TARGET_SUCCESS);
  });

  it('reports the rate that run produced, not a rounded-up promise', () => {
    const solved = solveMonthlySavings(SHORT, 7083);
    expect(solved.successRate).toBe(successPct(SHORT, solved.monthlySavings!));
  });

  it('asks for more than they already save', () => {
    const solved = solveMonthlySavings(SHORT, 7083);
    expect(solved.monthlySavings!).toBeGreaterThan(SHORT.monthlySavings);
  });

  it('lands on a round $50 figure rather than a false precision', () => {
    const solved = solveMonthlySavings(SHORT, 7083);
    expect(solved.monthlySavings! % 50).toBe(0);
  });

  it('names the same figure whatever ceiling the income implies', () => {
    // The ceiling is the household's monthly income. It bounds the search and
    // has nothing else to do with the answer, so the answer must not move with
    // it. It did: the bisection stopped after six refinements, so a wider
    // bracket simply ran out of runs before it reached the boundary, and the
    // same retirement inputs quoted $2,900, $2,950 or $3,000 depending on what
    // the person earned.
    const tight = solveMonthlySavings(SHORT, 3_000);
    const middling = solveMonthlySavings(SHORT, 20_000);
    const wide = solveMonthlySavings(SHORT, 100_000);

    expect(tight.monthlySavings).not.toBeNull();
    expect(middling.monthlySavings).toBe(tight.monthlySavings);
    expect(wide.monthlySavings).toBe(tight.monthlySavings);
  });

  it('is the SMALLEST $50 step that clears the target, as it claims', () => {
    const solved = solveMonthlySavings(SHORT, 20_000);
    expect(solved.monthlySavings).not.toBeNull();
    // The step below it must fall short, or the figure above it is not minimal.
    expect(successPct(SHORT, solved.monthlySavings! - 50)).toBeLessThan(TARGET_SUCCESS);
  });

  it('costs a bounded number of simulations however wide the bracket', () => {
    // One probe at the ceiling plus refinements that halve the bracket, so the
    // cost grows with the LOG of the bracket rather than running to convergence
    // at any price.
    expect(solveMonthlySavings(SHORT, 7083).runs).toBeLessThanOrEqual(22);
    expect(solveMonthlySavings(SHORT, 500_000).runs).toBeLessThanOrEqual(22);
  });

  it('names nothing when even the ceiling falls short', () => {
    // 60 years old, $5k invested, $12k a month of spending. No contribution
    // inside a $3,000 ceiling saves this, so there is no honest figure to give.
    const hopeless: SimInputs = {
      ...SHORT,
      currentAge: 60,
      startingBalance: 5_000,
      monthlySpend: 12_000,
      ssMonthly: 1000,
    };
    const solved = solveMonthlySavings(hopeless, 3000);
    expect(solved.monthlySavings).toBeNull();
    expect(solved.successRate).toBeNull();
    // It cost exactly the one probe that proved it.
    expect(solved.runs).toBe(1);
  });

  it('does not run at all when the ceiling is below what they already save', () => {
    const solved = solveMonthlySavings(SHORT, 500);
    expect(solved.monthlySavings).toBeNull();
    expect(solved.runs).toBe(0);
  });
});
