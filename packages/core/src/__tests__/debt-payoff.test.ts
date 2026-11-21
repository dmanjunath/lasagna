import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareStrategies, monthsToPayOff, simulatePayoff, type PayoffDebt } from '../debt-payoff.js';

// Two amortising loans, synthetic figures.
const loans: PayoffDebt[] = [
  { id: 'home', balance: 400_000, apr: 6.5, minPayment: 2_528 },
  { id: 'car', balance: 18_000, apr: 7.9, minPayment: 420 },
];

// A card that is both the highest rate and NOT the smallest balance, so the two
// orders pick different targets once there is extra to send.
const mixed: PayoffDebt[] = [
  { id: 'card', balance: 12_000, apr: 24.99, minPayment: 300 },
  { id: 'car', balance: 4_000, apr: 7.9, minPayment: 150 },
  { id: 'student', balance: 20_000, apr: 5.5, minPayment: 220 },
];

test('zero extra is exactly the minimums schedule', () => {
  const r = simulatePayoff(loans, 'avalanche', 0);
  for (const d of loans) {
    assert.equal(r.monthsById[d.id], monthsToPayOff(d.balance, d.minPayment, d.apr));
  }
  assert.equal(r.months, Math.max(...loans.map((d) => monthsToPayOff(d.balance, d.minPayment, d.apr))));
});

test('with no extra the two orders tie, for any mix of debts', () => {
  for (const debts of [loans, mixed]) {
    const c = compareStrategies(debts, 0);
    assert.equal(c.tie, true);
    assert.equal(c.avalanche.months, c.snowball.months);
    assert.equal(Math.round(c.avalanche.totalInterest), Math.round(c.snowball.totalInterest));
  }
});

test('one debt always ties, extra or not', () => {
  assert.equal(compareStrategies([loans[0]], 500).tie, true);
});

test('orders that differ in cost are not a tie', () => {
  const c = compareStrategies(mixed, 400);
  assert.equal(c.tie, false);
  assert.deepEqual(c.avalanche.order, ['card', 'car', 'student']);
  assert.deepEqual(c.snowball.order, ['car', 'card', 'student']);
  // Highest rate first costs less, smallest balance first closes one sooner.
  assert.ok(c.avalanche.totalInterest < c.snowball.totalInterest);
  assert.ok(c.snowball.firstClearedMonths < c.avalanche.firstClearedMonths);
});

test('extra pays off sooner and costs less interest than the minimums', () => {
  const base = simulatePayoff(loans, 'avalanche', 0);
  const plus = simulatePayoff(loans, 'avalanche', 500);
  assert.ok(plus.months < base.months);
  assert.ok(plus.totalInterest < base.totalInterest);
  // The extra goes to the highest rate first, so the car clears sooner.
  assert.ok(plus.monthsById.car < base.monthsById.car);
});

test('more extra never makes it slower or dearer', () => {
  const a = simulatePayoff(mixed, 'avalanche', 500);
  const b = simulatePayoff(mixed, 'avalanche', 5_000);
  assert.ok(b.months <= a.months);
  assert.ok(b.totalInterest < a.totalInterest);
});

test('a minimum below the interest never clears, and extra can fix it', () => {
  const stuck: PayoffDebt[] = [{ id: 'card', balance: 10_000, apr: 24, minPayment: 150 }];
  const r = simulatePayoff(stuck, 'avalanche', 0);
  assert.equal(r.months, Infinity);
  assert.equal(r.totalInterest, Infinity);
  assert.ok(Number.isFinite(simulatePayoff(stuck, 'avalanche', 200).months));
});

test('negative or invalid extra counts as none', () => {
  const base = simulatePayoff(loans, 'avalanche', 0);
  for (const bad of [-100, Number.NaN]) {
    const r = simulatePayoff(loans, 'avalanche', bad);
    assert.equal(r.months, base.months);
    assert.equal(r.totalInterest, base.totalInterest);
  }
});
