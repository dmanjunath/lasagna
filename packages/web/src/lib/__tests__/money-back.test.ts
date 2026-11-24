import { describe, it, expect } from 'vitest';
import { rankWithMoneyBackLast, signedTotal } from '../money-back';

describe('money back', () => {
  it('signs a money-back category negative', () => {
    expect(signedTotal({ total: 267, moneyBack: true })).toBe(-267);
    expect(signedTotal({ total: 100 })).toBe(100);
  });

  it('lists money back last under every sort', () => {
    const rows = [
      { label: 'Other', total: -267 },
      { label: 'Groceries', total: 500 },
      { label: 'Dining', total: 250 },
      { label: 'Gifts', total: -20 },
    ];
    const order = (key: 'label' | 'amount', dir: 'asc' | 'desc') => rankWithMoneyBackLast(rows, { key, dir }).map((r) => r.label);
    expect(order('amount', 'desc')).toEqual(['Groceries', 'Dining', 'Other', 'Gifts']);
    expect(order('amount', 'asc')).toEqual(['Dining', 'Groceries', 'Other', 'Gifts']);
    expect(order('label', 'asc')).toEqual(['Dining', 'Groceries', 'Other', 'Gifts']);
  });
});
