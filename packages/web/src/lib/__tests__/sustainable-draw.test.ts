import { describe, it, expect } from 'vitest';
import { sustainableDrawRate } from '../retirement-kpi';

describe('sustainableDrawRate', () => {
  it('returns 0.03 for retireAge 30 (under 45)', () => {
    expect(sustainableDrawRate(30)).toBe(0.03);
  });

  it('returns 0.03 for retireAge 44 (under 45)', () => {
    expect(sustainableDrawRate(44)).toBe(0.03);
  });

  it('returns 0.035 for retireAge 45 (45–59 bracket)', () => {
    expect(sustainableDrawRate(45)).toBe(0.035);
  });

  it('returns 0.035 for retireAge 59 (45–59 bracket)', () => {
    expect(sustainableDrawRate(59)).toBe(0.035);
  });

  it('returns 0.04 for retireAge 60 (60+ bracket)', () => {
    expect(sustainableDrawRate(60)).toBe(0.04);
  });

  it('returns 0.04 for retireAge 70 (60+ bracket)', () => {
    expect(sustainableDrawRate(70)).toBe(0.04);
  });
});
