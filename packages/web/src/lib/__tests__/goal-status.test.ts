import { describe, expect, it } from 'vitest';
import { goalStatus, goalStatusFill } from '../goal-status';

const now = new Date('2026-01-15T00:00:00Z');
const base = { targetAmount: '1200', currentAmount: '200', monthlyContribution: '100', deadline: '2027-01-01', status: 'active' };

describe('goalStatus', () => {
  it('is on track when the plan lands by the deadline', () => {
    expect(goalStatus(base, now)).toBe('good');
  });
  it('is slipping up to three months late, off track beyond', () => {
    expect(goalStatus({ ...base, deadline: '2026-09-01' }, now)).toBe('attention');
    expect(goalStatus({ ...base, deadline: '2026-05-01' }, now)).toBe('bad');
  });
  it('has no status without a plan, a deadline, a start, or once reached', () => {
    expect(goalStatus({ ...base, monthlyContribution: null }, now)).toBeNull();
    expect(goalStatus({ ...base, deadline: null }, now)).toBeNull();
    expect(goalStatus({ ...base, currentAmount: '0' }, now)).toBeNull();
    expect(goalStatus({ ...base, currentAmount: '1200' }, now)).toBeNull();
    expect(goalStatus({ ...base, deadline: '2025-12-01' }, now)).toBeNull();
    expect(goalStatus({ ...base, status: 'completed' }, now)).toBeNull();
  });
  it('fills neutral with no verdict', () => {
    expect(goalStatusFill(null)).toContain('content-faint');
    expect(goalStatusFill('good')).toContain('brand');
  });
});
