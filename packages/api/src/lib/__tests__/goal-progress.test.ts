import { describe, it, expect } from 'vitest';
import { buildGoalAccountMap, resolveGoalAmount } from '../goal-progress.js';

describe('buildGoalAccountMap', () => {
  it('groups account ids by goal id', () => {
    const map = buildGoalAccountMap([
      { goalId: 'g1', accountId: 'a1' },
      { goalId: 'g1', accountId: 'a2' },
      { goalId: 'g2', accountId: 'a3' },
    ]);
    expect(map.get('g1')).toEqual(['a1', 'a2']);
    expect(map.get('g2')).toEqual(['a3']);
  });
});

describe('resolveGoalAmount', () => {
  const balances = new Map<string, number>([
    ['a1', 100],
    ['a2', 250],
    ['a3', 0],
  ]);

  it('returns stored amount when the goal has no linked accounts', () => {
    const r = resolveGoalAmount('500', undefined, balances);
    expect(r).toEqual({ amount: 500, isAutoTracked: false });
  });

  it('returns stored amount when the linked list is empty', () => {
    const r = resolveGoalAmount('500', [], balances);
    expect(r).toEqual({ amount: 500, isAutoTracked: false });
  });

  it('sums effective balances of linked accounts', () => {
    const r = resolveGoalAmount('500', ['a1', 'a2'], balances);
    expect(r).toEqual({ amount: 350, isAutoTracked: true });
  });

  it('treats an unknown account id as 0', () => {
    const r = resolveGoalAmount('500', ['a1', 'missing'], balances);
    expect(r).toEqual({ amount: 100, isAutoTracked: true });
  });
});
