import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_TYPE_CATALOG,
  accountTypeLabel,
  canonicalSubtype,
} from '../account-types';

describe('accountTypeLabel', () => {
  it('names a catalogued pair from the catalog', () => {
    expect(accountTypeLabel('loan', 'mortgage')).toBe('Mortgage');
    expect(accountTypeLabel('investment', 'roth_ira')).toBe('Roth IRA');
  });

  it('reads an aliased subtype as the catalog entry it means', () => {
    // Plaid's spelling, older code's spelling, and Plaid's Roth.
    expect(accountTypeLabel('credit', 'credit card')).toBe('Credit card');
    expect(accountTypeLabel('loan', 'student_loan')).toBe('Student loan');
    expect(accountTypeLabel('investment', 'roth')).toBe('Roth IRA');
  });

  it('falls back to sentence case, matching the catalog', () => {
    expect(accountTypeLabel('depository', 'cash management')).toBe('Cash management');
    expect(accountTypeLabel('loan', 'home equity')).toBe('Home equity');
  });

  it('leaves acronyms and plan numbers alone', () => {
    expect(accountTypeLabel('investment', 'utma')).toBe('UTMA');
    expect(accountTypeLabel('investment', '529')).toBe('529');
    expect(accountTypeLabel('investment', 'sep ira')).toBe('SEP IRA');
    expect(accountTypeLabel('depository', 'cd')).toBe('CD');
  });

  it('never offers two entries for one thing', () => {
    const labels = ACCOUNT_TYPE_CATALOG.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('canonicalSubtype', () => {
  it('resolves an alias to the catalog token, so a stored value matches it', () => {
    expect(canonicalSubtype('credit card')).toBeNull();
    expect(canonicalSubtype('roth')).toBe('roth_ira');
    const key = (s: string | null) => `credit:${s ?? ''}`;
    const catalogKeys = ACCOUNT_TYPE_CATALOG.filter((o) => o.type === 'credit').map((o) =>
      key(o.subtype),
    );
    expect(catalogKeys).toContain(key(canonicalSubtype('credit card')));
  });

  it('passes an uncatalogued subtype through untouched', () => {
    expect(canonicalSubtype('cash management')).toBe('cash management');
    expect(canonicalSubtype(null)).toBeNull();
    expect(canonicalSubtype(undefined)).toBeNull();
  });
});
