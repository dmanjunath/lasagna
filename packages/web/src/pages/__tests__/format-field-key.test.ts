import { describe, it, expect } from 'vitest';
import { formatFieldKey } from '../tax-strategy';

describe('formatFieldKey', () => {
  it('writes snake_case keys in sentence case', () => {
    expect(formatFieldKey('wages_tips_other_compensation')).toBe('Wages tips other compensation');
  });

  it('keeps tax acronyms uppercase', () => {
    expect(formatFieldKey('ein')).toBe('EIN');
    expect(formatFieldKey('employee_ssn')).toBe('Employee SSN');
    expect(formatFieldKey('w2_wages')).toBe('W-2 wages');
    expect(formatFieldKey('fica_tax_withheld')).toBe('FICA tax withheld');
    expect(formatFieldKey('hsa_contributions')).toBe('HSA contributions');
    expect(formatFieldKey('traditional_ira_basis')).toBe('Traditional IRA basis');
    expect(formatFieldKey('federal_agi')).toBe('Federal AGI');
  });

  it('splits camelCase keys', () => {
    expect(formatFieldKey('employerEin')).toBe('Employer EIN');
  });
});
