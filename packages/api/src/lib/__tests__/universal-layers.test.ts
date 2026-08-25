import { describe, it, expect } from 'vitest';
import {
  UNIVERSAL_LAYERS,
  assessLayer,
  classifyDebtBucket,
  DEBT_BAND_BY_BUCKET,
} from '../universal-layers.js';
import { buildContextDefaults, type ContextDebtAccount } from '../layer-selector.js';
import { resolveDebtApr } from '../debt-accounts.js';

// ── Structure tests ────────────────────────────────────────────────────────────

describe('UNIVERSAL_LAYERS structure', () => {
  it('has exactly 12 layers', () => {
    expect(UNIVERSAL_LAYERS).toHaveLength(12);
  });

  it('layers are ordered 1–12', () => {
    UNIVERSAL_LAYERS.forEach((layer, index) => {
      expect(layer.order).toBe(index + 1);
    });
  });

  it('every layer has required fields', () => {
    for (const layer of UNIVERSAL_LAYERS) {
      expect(typeof layer.id).toBe('string');
      expect(layer.id.length).toBeGreaterThan(0);
      expect(typeof layer.order).toBe('number');
      expect(typeof layer.name).toBe('string');
      expect(layer.name.length).toBeGreaterThan(0);
      expect(typeof layer.subtitle).toBe('string');
      expect(layer.subtitle.length).toBeGreaterThan(0);
      expect(typeof layer.description).toBe('string');
      expect(layer.description.length).toBeGreaterThan(0);
      expect(typeof layer.icon).toBe('string');
      expect(layer.icon.length).toBeGreaterThan(0);
    }
  });

  it('first layer is stabilize', () => {
    expect(UNIVERSAL_LAYERS[0].id).toBe('stabilize');
  });

  it('last layer is estate-legacy', () => {
    expect(UNIVERSAL_LAYERS[11].id).toBe('estate-legacy');
  });
});

// ── assessLayer tests ──────────────────────────────────────────────────────────

describe('assessLayer — stabilize', () => {
  it('complete when cash >= 1000, no collections, no overdraft', () => {
    const ctx = buildContextDefaults({ cashTotal: 1000, collectionsDebt: 0, hasOverdraft: false });
    const result = assessLayer('stabilize', ctx);
    expect(result.status).toBe('complete');
    expect(result.progress).toBe(100);
  });

  it('in_progress when cash > 0 but < 1000', () => {
    const ctx = buildContextDefaults({ cashTotal: 500, collectionsDebt: 0, hasOverdraft: false });
    const result = assessLayer('stabilize', ctx);
    expect(result.status).toBe('in_progress');
    expect(result.progress).toBeGreaterThan(0);
    expect(result.progress).toBeLessThan(100);
  });

  it('not_started when has collections', () => {
    const ctx = buildContextDefaults({ cashTotal: 500, collectionsDebt: 200 });
    const result = assessLayer('stabilize', ctx);
    expect(result.status).toBe('not_started');
  });

  it('not_started when has overdraft', () => {
    const ctx = buildContextDefaults({ cashTotal: 500, hasOverdraft: true });
    const result = assessLayer('stabilize', ctx);
    expect(result.status).toBe('not_started');
  });
});

describe('assessLayer — high-rate-debt', () => {
  it('complete when all high-rate debts are zero', () => {
    const ctx = buildContextDefaults({
      creditCardDebt: 0,
      paydayLoanDebt: 0,
      personalLoanHighDebt: 0,
      autoLoanHighDebt: 0,
    });
    const result = assessLayer('high-rate-debt', ctx);
    expect(result.status).toBe('complete');
    expect(result.current).toBe(0);
    expect(result.target).toBe(0);
  });

  it('in_progress when high-rate debt exists', () => {
    const ctx = buildContextDefaults({ creditCardDebt: 5000, paydayLoanDebt: 500 });
    const result = assessLayer('high-rate-debt', ctx);
    expect(result.status).toBe('in_progress');
    expect(result.current).toBe(5500);
    expect(result.target).toBe(0);
  });
});

describe('assessLayer — emergency-fund', () => {
  it('uses 9 months for self-employed', () => {
    const ctx = buildContextDefaults({
      employmentType: 'self_employed',
      monthlyExpenses: 3000,
      cashTotal: 0,
    });
    const result = assessLayer('emergency-fund', ctx);
    expect(result.target).toBe(27000); // 3000 * 9
  });

  it('uses 9 months for 1099', () => {
    const ctx = buildContextDefaults({
      employmentType: '1099',
      monthlyExpenses: 3000,
      cashTotal: 0,
    });
    const result = assessLayer('emergency-fund', ctx);
    expect(result.target).toBe(27000); // 3000 * 9
  });

  it('uses 6 months for W2', () => {
    const ctx = buildContextDefaults({
      employmentType: 'w2',
      monthlyExpenses: 3000,
      cashTotal: 0,
    });
    const result = assessLayer('emergency-fund', ctx);
    expect(result.target).toBe(18000); // 3000 * 6
  });

  it('handles null monthlyExpenses with income fallback', () => {
    const ctx = buildContextDefaults({
      employmentType: 'w2',
      annualIncome: 60000,
      monthlyExpenses: null,
      cashTotal: 21000,
    });
    const result = assessLayer('emergency-fund', ctx);
    // expBase = (60000 / 12) * 0.7 = 3500, target = 3500 * 6 = 21000
    expect(result.target).toBe(21000);
    expect(result.status).toBe('complete');
  });

  it('zero target when no income or expenses', () => {
    const ctx = buildContextDefaults({
      employmentType: 'w2',
      annualIncome: 0,
      monthlyExpenses: null,
      cashTotal: 0,
    });
    const result = assessLayer('emergency-fund', ctx);
    expect(result.target).toBe(0);
  });
});

describe('assessLayer — employer-match', () => {
  it('complete when employerMatchPct is 0', () => {
    const ctx = buildContextDefaults({ employerMatchPct: 0 });
    const result = assessLayer('employer-match', ctx);
    expect(result.status).toBe('complete');
  });

  it('in_progress when 401k balance exists and employer match > 0', () => {
    const ctx = buildContextDefaults({ employerMatchPct: 3, trad401kBalance: 5000 });
    const result = assessLayer('employer-match', ctx);
    expect(result.status).toBe('in_progress');
  });

  it('not_started when no 401k balance and employer match > 0', () => {
    const ctx = buildContextDefaults({ employerMatchPct: 3, trad401kBalance: 0 });
    const result = assessLayer('employer-match', ctx);
    expect(result.status).toBe('not_started');
  });
});

describe('assessLayer — insurance-will', () => {
  it('always returns not_started', () => {
    const ctx = buildContextDefaults();
    const result = assessLayer('insurance-will', ctx);
    expect(result.status).toBe('not_started');
    expect(result.current).toBeNull();
    expect(result.target).toBeNull();
    expect(result.action).toBe('Review and mark complete when done.');
  });
});

describe('assessLayer — mid-rate-debt', () => {
  it('complete when all mid-rate debts are zero', () => {
    const ctx = buildContextDefaults({
      mediumInterestDebt: 0,
      autoLoanMedDebt: 0,
      personalLoanMedDebt: 0,
      privateStudentLoanDebt: 0,
    });
    const result = assessLayer('mid-rate-debt', ctx);
    expect(result.status).toBe('complete');
  });

  it('in_progress when mid-rate debt exists', () => {
    const ctx = buildContextDefaults({ mediumInterestDebt: 8000, autoLoanMedDebt: 5000 });
    const result = assessLayer('mid-rate-debt', ctx);
    expect(result.status).toBe('in_progress');
    expect(result.current).toBe(13000);
  });
});

describe('assessLayer — low-interest-debt', () => {
  it('in_progress when mortgage exists', () => {
    const ctx = buildContextDefaults({ mortgageBalance: 250000 });
    const result = assessLayer('low-interest-debt', ctx);
    expect(result.status).toBe('in_progress');
    expect(result.current).toBe(250000);
  });

  it('complete when all low-interest debts are zero', () => {
    const ctx = buildContextDefaults({
      mortgageBalance: 0,
      autoLoanLowDebt: 0,
      studentLoanLowDebt: 0,
    });
    const result = assessLayer('low-interest-debt', ctx);
    expect(result.status).toBe('complete');
  });
});

describe('assessLayer — tax-advantaged', () => {
  it('in_progress when any balance exists', () => {
    const ctx = buildContextDefaults({ rothIraBalance: 5000 });
    const result = assessLayer('tax-advantaged', ctx);
    expect(result.status).toBe('in_progress');
  });

  it('not_started when no balances', () => {
    const ctx = buildContextDefaults({ hsaBalance: 0, rothIraBalance: 0, trad401kBalance: 0 });
    const result = assessLayer('tax-advantaged', ctx);
    expect(result.status).toBe('not_started');
  });
});

describe('assessLayer — max-contributions', () => {
  it('age 61 with HDHP → target = 8000 + 34750 + 5300 = 48050', () => {
    const ctx = buildContextDefaults({ age: 61, hasHDHP: true });
    const result = assessLayer('max-contributions', ctx);
    // rothMax = 8000 (age >= 50), k401Max = 34750 (age 60-63), hsaMax = 4300 + 1000 = 5300 (age >= 55)
    expect(result.target).toBe(48050);
  });

  it('complete when balances meet target', () => {
    const ctx = buildContextDefaults({ age: 61, hasHDHP: true, rothIraBalance: 8000, trad401kBalance: 34750, hsaBalance: 5300 });
    const result = assessLayer('max-contributions', ctx);
    expect(result.target).toBe(48050);
    expect(result.status).toBe('complete');
  });

  it('age 30 with HDHP → target = 7000 + 23500 + 4300 = 34800', () => {
    const ctx = buildContextDefaults({ age: 30, hasHDHP: true });
    const result = assessLayer('max-contributions', ctx);
    // rothMax = 7000, k401Max = 23500, hsaMax = 4300
    expect(result.target).toBe(34800);
  });

  it('age 30 without HDHP → target = 7000 + 23500 + 0 = 30500', () => {
    const ctx = buildContextDefaults({ age: 30, hasHDHP: false });
    const result = assessLayer('max-contributions', ctx);
    expect(result.target).toBe(30500);
  });
});

describe('assessLayer — financial-independence', () => {
  it('calculates FI number as 25x annual expenses', () => {
    const ctx = buildContextDefaults({ monthlyExpenses: 5000 });
    const result = assessLayer('financial-independence', ctx);
    // annualExpenses = 5000 * 12 = 60000, fiNumber = 60000 * 25 = 1500000
    expect(result.target).toBe(1500000);
  });

  it('complete when portfolio exceeds FI number', () => {
    const ctx = buildContextDefaults({
      monthlyExpenses: 5000,
      rothIraBalance: 500000,
      trad401kBalance: 700000,
      brokerageBalance: 400000,
      hsaBalance: 0,
    });
    const result = assessLayer('financial-independence', ctx);
    expect(result.status).toBe('complete');
    expect(result.current).toBe(1600000);
    expect(result.target).toBe(1500000);
  });

  it('in_progress when portfolio is partial', () => {
    const ctx = buildContextDefaults({
      monthlyExpenses: 5000,
      rothIraBalance: 200000,
    });
    const result = assessLayer('financial-independence', ctx);
    expect(result.status).toBe('in_progress');
  });
});

describe('assessLayer — tax-optimization', () => {
  it('returns not_started', () => {
    const ctx = buildContextDefaults({ brokerageBalance: 500000 });
    const result = assessLayer('tax-optimization', ctx);
    expect(result.status).toBe('not_started');
    expect(result.current).toBeNull();
    expect(result.target).toBeNull();
    expect(result.action).toBe('Review and mark complete when done.');
  });
});

describe('assessLayer — estate-legacy', () => {
  it('returns not_started', () => {
    const ctx = buildContextDefaults();
    const result = assessLayer('estate-legacy', ctx);
    expect(result.status).toBe('not_started');
    expect(result.current).toBeNull();
    expect(result.target).toBeNull();
    expect(result.action).toBe('Review and mark complete when done.');
  });
});

describe('assessLayer — unknown layer ID', () => {
  it('returns not_started with empty action', () => {
    const ctx = buildContextDefaults();
    const result = assessLayer('unknown-layer-xyz', ctx);
    expect(result.status).toBe('not_started');
    expect(result.progress).toBe(0);
    expect(result.current).toBeNull();
    expect(result.target).toBeNull();
    expect(result.action).toBe('');
  });
});


// ── Banding by the account's real APR ──────────────────────────────────────────
//
// The APR has to come out of the account's stored liability metadata, not out
// of an ad hoc `JSON.parse(metadata).interestRate`: Plaid-synced and manually
// entered loans keep their rate under `interestRatePercentage`, and cards keep
// it under `aprs[].purchase_apr`. Reading the legacy key alone yields 0 for
// every one of them, which drops real debt into the wrong band.

/** The band a stored account lands in, end to end: metadata → APR → bucket → band. */
function bandOf(account: { type: string; subtype: string | null; name: string; metadata: string | null }) {
  const apr = resolveDebtApr(account.metadata);
  return DEBT_BAND_BY_BUCKET[classifyDebtBucket({ ...account, apr })];
}

describe('debt banding — APR resolved from liability metadata', () => {
  it('bands a Plaid mortgage by interestRatePercentage', () => {
    expect(
      bandOf({
        type: 'loan',
        subtype: 'mortgage',
        name: 'Primary Mortgage',
        metadata: '{"type":"mortgage","source":"plaid","interestRatePercentage":6.125}',
      }),
    ).toBe('low');
  });

  it('bands an 18.4% personal loan high, not medium', () => {
    // The legacy key is absent, so the old resolution saw 0% and filed this
    // under mediumInterestDebt — the medium band.
    expect(
      bandOf({
        type: 'loan',
        subtype: 'personal',
        name: 'Upstart Personal Loan',
        metadata: '{"type":"other_loan","source":"manual","interestRatePercentage":18.4}',
      }),
    ).toBe('high');
  });

  it('bands a 7.99% auto loan medium, not low', () => {
    expect(
      bandOf({
        type: 'loan',
        subtype: 'auto',
        name: 'Civic Auto Loan',
        metadata: '{"type":"other_loan","source":"manual","interestRatePercentage":7.99}',
      }),
    ).toBe('mid');
  });

  it('bands a 6.5% private student loan medium, not low', () => {
    expect(
      bandOf({
        type: 'loan',
        subtype: 'student',
        name: 'Sallie Mae',
        metadata: '{"type":"student_loan","source":"plaid","interestRatePercentage":6.5}',
      }),
    ).toBe('mid');
  });

  it('reads a card rate from aprs[].purchase_apr, not the first APR listed', () => {
    expect(
      resolveDebtApr(
        '{"type":"credit_card","source":"plaid","aprs":[{"aprType":"balance_transfer_apr","aprPercentage":12.5},{"aprType":"purchase_apr","aprPercentage":22.99}]}',
      ),
    ).toBe(22.99);
  });

  it('still reads the legacy interestRate key when metadata is untyped', () => {
    expect(resolveDebtApr('{"interestRate":15.75}')).toBe(15.75);
  });

  it('returns null, not 0, when no rate is on file', () => {
    expect(resolveDebtApr(null)).toBeNull();
    expect(resolveDebtApr('{"type":"other_loan","source":"manual"}')).toBeNull();
    expect(resolveDebtApr('not json')).toBeNull();
  });
});

// ── The accounts a debt layer names ───────────────────────────────────────────

function debtAccount(over: Partial<ContextDebtAccount> & { id: string }): ContextDebtAccount {
  return { name: over.id, mask: null, balance: 1000, apr: null, band: 'high', ...over };
}

describe('assessLayer — debt layers name their accounts', () => {
  const ctx = buildContextDefaults({
    creditCardDebt: 9630.55,
    personalLoanHighDebt: 9600,
    autoLoanMedDebt: 18740.1,
    mortgageBalance: 412000,
    debtAccounts: [
      debtAccount({ id: 'mortgage', name: 'Primary Mortgage', mask: '5109', balance: 412000, apr: 6.125, band: 'low' }),
      debtAccount({ id: 'card-lo', name: 'Store Card', mask: '9930', balance: 1430.55, apr: 26.24, band: 'high' }),
      debtAccount({ id: 'auto', name: 'Civic Auto Loan', mask: '1189', balance: 18740.1, apr: 7.99, band: 'mid' }),
      debtAccount({ id: 'card-hi', name: 'Sapphire Preferred', mask: '4021', balance: 8200, apr: 22.99, band: 'high' }),
      debtAccount({ id: 'personal', name: 'Upstart Loan', mask: '7712', balance: 9600, apr: 18.4, band: 'high' }),
      debtAccount({ id: 'federal', name: 'Federal Direct Loan', mask: '3030', balance: 12000, apr: 5.5, band: null }),
    ],
  });

  it('lists only the high band, worst rate first', () => {
    const result = assessLayer('high-rate-debt', ctx);
    expect(result.accounts?.map((a) => a.id)).toEqual(['card-lo', 'card-hi', 'personal']);
  });

  it('carries name, mask, balance and APR for each account', () => {
    const result = assessLayer('high-rate-debt', ctx);
    expect(result.accounts?.[0]).toEqual({
      id: 'card-lo',
      name: 'Store Card',
      mask: '9930',
      balance: 1430.55,
      apr: 26.24,
    });
  });

  it('breaks an APR tie on the smaller balance', () => {
    const tied = buildContextDefaults({
      creditCardDebt: 4500,
      debtAccounts: [
        debtAccount({ id: 'small', balance: 1500, apr: 19.99 }),
        debtAccount({ id: 'big', balance: 3000, apr: 19.99 }),
      ],
    });
    expect(assessLayer('high-rate-debt', tied).accounts?.map((a) => a.id)).toEqual(['small', 'big']);
  });

  it('ranks an account with no rate on file at the rate its band implies', () => {
    // The high band assumes 22%, so an unrated card sorts below a 26.24% one
    // and above an 18.4% one instead of jumping the whole list. Between two
    // unrated accounts the smaller balance leads.
    const unrated = buildContextDefaults({
      creditCardDebt: 12500,
      debtAccounts: [
        debtAccount({ id: 'rated-hi', balance: 3000, apr: 26.24 }),
        debtAccount({ id: 'unrated-small', balance: 1016.14, apr: null }),
        debtAccount({ id: 'rated-lo', balance: 200, apr: 18.4 }),
        debtAccount({ id: 'unrated-big', balance: 8320.32, apr: null }),
      ],
    });
    expect(assessLayer('high-rate-debt', unrated).accounts?.map((a) => a.id)).toEqual([
      'rated-hi',
      'unrated-small',
      'unrated-big',
      'rated-lo',
    ]);
  });

  it('never lets an unrated $0 balance outrank the worst rated account', () => {
    // Sorting every unrated account to the front put a card with nothing owed
    // on it at the top of the payoff list and pushed the balance that actually
    // costs the most behind the preview cap.
    const zero = buildContextDefaults({
      creditCardDebt: 12345679,
      debtAccounts: [
        debtAccount({ id: 'empty', balance: 0, apr: null }),
        debtAccount({ id: 'unrated-a', balance: 900, apr: null }),
        debtAccount({ id: 'unrated-b', balance: 800, apr: null }),
        debtAccount({ id: 'unrated-c', balance: 700, apr: null }),
        debtAccount({ id: 'worst', balance: 12345679, apr: 31.24 }),
      ],
    });
    const ranked = assessLayer('high-rate-debt', zero).accounts!.map((a) => a.id);
    expect(ranked[0]).toBe('worst');
    expect(ranked.indexOf('empty')).toBeGreaterThan(ranked.indexOf('worst'));
    // Four unrated rows used to bury it behind "Show 1 more" (preview is 4).
    expect(ranked.indexOf('worst')).toBeLessThan(4);
  });

  it('still ranks unrated cards above the low-rate end of the high band', () => {
    const mixed = buildContextDefaults({
      creditCardDebt: 5000,
      debtAccounts: [
        debtAccount({ id: 'rated-16', balance: 1000, apr: 16.5 }),
        debtAccount({ id: 'unrated', balance: 1000, apr: null }),
      ],
    });
    expect(assessLayer('high-rate-debt', mixed).accounts?.map((a) => a.id)).toEqual([
      'unrated',
      'rated-16',
    ]);
  });

  it('lists the mid band separately', () => {
    expect(assessLayer('mid-rate-debt', ctx).accounts?.map((a) => a.id)).toEqual(['auto']);
  });

  it('lists the low band separately', () => {
    expect(assessLayer('low-interest-debt', ctx).accounts?.map((a) => a.id)).toEqual(['mortgage']);
  });

  it('leaves a banded-out account (federal student loan) off every list', () => {
    const listed = (['high-rate-debt', 'mid-rate-debt', 'low-interest-debt'] as const).flatMap(
      (id) => assessLayer(id, ctx).accounts ?? [],
    );
    expect(listed.map((a) => a.id)).not.toContain('federal');
  });

  it('leaves the caller\'s account list in its own order', () => {
    // Its own context, not the shared `ctx` above: that one has already been
    // through assessLayer several times, so an in-place sort would have left
    // it sorted before this ran and re-sorting it would be a no-op.
    const own = buildContextDefaults({
      creditCardDebt: 4500,
      debtAccounts: [
        debtAccount({ id: 'mid', balance: 1000, apr: 19.99 }),
        debtAccount({ id: 'worst', balance: 2000, apr: 26.24 }),
        debtAccount({ id: 'best', balance: 1500, apr: 12.5 }),
      ],
    });
    const ranked = assessLayer('high-rate-debt', own).accounts?.map((a) => a.id);
    expect(ranked).toEqual(['worst', 'mid', 'best']);
    expect(own.debtAccounts.map((a) => a.id)).toEqual(['mid', 'worst', 'best']);
  });

  it('omits accounts entirely on the nine non-debt layers', () => {
    for (const layer of UNIVERSAL_LAYERS) {
      if (['high-rate-debt', 'mid-rate-debt', 'low-interest-debt'].includes(layer.id)) continue;
      expect(assessLayer(layer.id, ctx).accounts).toBeUndefined();
    }
  });

  it('omits accounts when the band is clear', () => {
    const clear = buildContextDefaults({ debtAccounts: [] });
    expect(assessLayer('high-rate-debt', clear).status).toBe('complete');
    expect(assessLayer('high-rate-debt', clear).accounts).toBeUndefined();
  });

  it('states a total that equals the rows beneath it', () => {
    // Three cents-carrying balances: rounding the raw sum reads $1,353,752
    // while the rows, each rounded on its own, add up to $1,353,751.
    const cents = buildContextDefaults({
      mortgageBalance: 354415.23 + 220000 + 770000 + 9336.46,
      debtAccounts: [
        debtAccount({ id: 'a', balance: 354415.23, apr: 2.5, band: 'low' }),
        debtAccount({ id: 'b', balance: 220000, apr: 3.875, band: 'low' }),
        debtAccount({ id: 'c', balance: 770000, apr: 4.875, band: 'low' }),
        debtAccount({ id: 'd', balance: 8320.32, apr: 1.9, band: 'low' }),
        debtAccount({ id: 'e', balance: 1016.14, apr: 1.9, band: 'low' }),
      ],
    });
    const result = assessLayer('low-interest-debt', cents);
    const rows = result.accounts!.reduce((sum, a) => sum + Math.round(a.balance), 0);
    expect(result.action).toContain(`$${rows.toLocaleString()}`);
    expect(result.action.startsWith('$1,353,751 ')).toBe(true);
  });

  it('reads complete when every balance in the band rounds to $0', () => {
    // The headline sums the rounded row balances, and the page drops any row
    // that rounds to $0. Testing completion against the RAW total instead left
    // a band holding nothing but a residual 40-cent card stating "Pay off $0
    // in high-rate debt" over an empty list: pinned on "You are here" forever
    // with nothing on the page to act on. The completion test has to read the
    // same rounded figure the headline and the rows do.
    const residual = buildContextDefaults({
      creditCardDebt: 0.4,
      autoLoanMedDebt: 0.29,
      studentLoanLowDebt: 0.11,
      debtAccounts: [
        debtAccount({ id: 'card', name: 'Store Card', balance: 0.4, apr: 26.24, band: 'high' }),
        debtAccount({ id: 'auto', name: 'Civic Auto Loan', balance: 0.29, apr: 7.99, band: 'mid' }),
        debtAccount({ id: 'student', name: 'Student Loan', balance: 0.11, apr: 3.5, band: 'low' }),
      ],
    });
    const assessed = (['high-rate-debt', 'mid-rate-debt', 'low-interest-debt'] as const).map(
      (id) => {
        const r = assessLayer(id, residual);
        return [id, r.status, r.progress, r.action];
      },
    );
    expect(assessed).toEqual([
      ['high-rate-debt', 'complete', 100, ''],
      ['mid-rate-debt', 'complete', 100, ''],
      ['low-interest-debt', 'complete', 100, ''],
    ]);
  });

  it('still states a band that rounds up to $1', () => {
    // The boundary the rounded completion test must not swallow: the smallest
    // balance that still prints as a dollar is still debt to pay off.
    const dollar = buildContextDefaults({
      creditCardDebt: 0.5,
      debtAccounts: [debtAccount({ id: 'card', name: 'Store Card', balance: 0.5, apr: 26.24 })],
    });
    const result = assessLayer('high-rate-debt', dollar);
    expect(result.status).toBe('in_progress');
    expect(result.action).toBe('Pay off $1 in high-rate debt (above 15% APR).');
  });
});

// ── Unrated and mis-typed accounts land in the right bucket ───────────────────
//
// The two failures these cover both put real money under advice that is wrong
// for it: an unrated account banded as if it were interest-free, and a credit
// card banded as an auto loan because "credit card" contains "car".

describe('classifyDebtBucket — no rate on file', () => {
  it('bands an unrated credit card as a card, not as a 0% auto loan', () => {
    expect(
      classifyDebtBucket({ type: 'credit', subtype: 'credit card', name: 'CREDIT CARD', apr: null }),
    ).toBe('creditCardDebt');
  });

  it('bands an unrated auto loan medium, not low', () => {
    expect(
      classifyDebtBucket({ type: 'loan', subtype: 'auto', name: 'Auto Loans', apr: null }),
    ).toBe('autoLoanMedDebt');
  });

  it('bands an unrated private student loan as private, not sub-5%', () => {
    expect(
      classifyDebtBucket({ type: 'loan', subtype: 'student', name: 'Student Loan', apr: null }),
    ).toBe('privateStudentLoanDebt');
  });

  it('bands an unrated personal loan medium, not low', () => {
    expect(
      classifyDebtBucket({ type: 'loan', subtype: 'personal', name: 'Personal Loan', apr: null }),
    ).toBe('personalLoanMedDebt');
  });

  it('still reads 0% as the real rate it is', () => {
    expect(
      classifyDebtBucket({ type: 'loan', subtype: 'auto', name: 'Promo Auto Loan', apr: 0 }),
    ).toBe('autoLoanLowDebt');
  });

  it('leaves a federal student loan and a mortgage on their name alone', () => {
    // Both are decided before any rate is read, so no rate on file changes
    // nothing for them.
    expect(
      classifyDebtBucket({ type: 'loan', subtype: null, name: 'Federal Student Loan', apr: null }),
    ).toBe('federalStudentLoanDebt');
    expect(
      classifyDebtBucket({ type: 'loan', subtype: 'mortgage', name: 'Mortgage', apr: null }),
    ).toBe('mortgageBalance');
  });
});

describe('classifyDebtBucket — cards are not auto loans', () => {
  it('bands a Plaid `credit card` subtype as a card', () => {
    expect(
      classifyDebtBucket({ type: 'credit', subtype: 'credit card', name: 'Sapphire', apr: 22.99 }),
    ).toBe('creditCardDebt');
  });

  it('puts a card with no rate on file in the high band', () => {
    const bucket = classifyDebtBucket({
      type: 'credit',
      subtype: 'credit card',
      name: 'CREDIT CARD',
      apr: null,
    });
    expect(bucket).toBe('creditCardDebt');
    expect(DEBT_BAND_BY_BUCKET[bucket]).toBe('high');
  });

  it('bands a card that reports its rate by that rate', () => {
    // The high-band fallback is for an UNKNOWN rate. A 0% promo balance is a
    // known rate, and calling it debt above 15% APR is wrong in the same way
    // as calling an unrated card interest-free, just in the other direction.
    const card = (apr: number | null) =>
      classifyDebtBucket({ type: 'credit', subtype: 'credit card', name: 'CREDIT CARD', apr });
    expect(DEBT_BAND_BY_BUCKET[card(22.99)]).toBe('high');
    expect(DEBT_BAND_BY_BUCKET[card(15.01)]).toBe('high');
    expect(DEBT_BAND_BY_BUCKET[card(9.9)]).toBe('mid');
    expect(DEBT_BAND_BY_BUCKET[card(0)]).toBe('mid');
    expect(card(0)).toBe('mediumInterestDebt');
  });

  it('bands a card with no subtype by its type, not by its name', () => {
    expect(
      classifyDebtBucket({ type: 'credit', subtype: null, name: 'Credit Card Debt', apr: null }),
    ).toBe('creditCardDebt');
    // "Home Depot" would otherwise match the `home` branch and be counted as a
    // mortgage, which is the low band.
    expect(
      classifyDebtBucket({ type: 'credit', subtype: null, name: 'Home Depot Card', apr: null }),
    ).toBe('creditCardDebt');
  });

  it('still bands real auto loans by their rate', () => {
    const auto = (apr: number | null, name = 'Auto Loan') =>
      classifyDebtBucket({ type: 'loan', subtype: null, name, apr });
    expect(auto(11.9)).toBe('autoLoanHighDebt');
    expect(auto(7.5)).toBe('autoLoanMedDebt');
    expect(auto(3.9)).toBe('autoLoanLowDebt');
    expect(auto(7.5, 'Car Notes')).toBe('autoLoanMedDebt');
    expect(auto(7.5, 'Vehicle Loan')).toBe('autoLoanMedDebt');
  });

  it('keeps `credit card` out of the auto bucket on an account that is not type `credit`', () => {
    // `car` is a substring of "credit card", so a loose match files this as an
    // auto loan. The `type === 'credit'` branch above returns before the auto
    // matcher for a card account, which masks the substring bug entirely — it
    // only shows on an account whose type never reaches that branch, such as a
    // store card financing plan booked as a loan.
    const bucket = classifyDebtBucket({
      type: 'loan',
      subtype: 'credit card',
      name: 'Store Card Plan',
      apr: 12,
    });
    expect(bucket).toBe('personalLoanMedDebt');
    expect(DEBT_BAND_BY_BUCKET[bucket]).toBe('mid');
  });

  it('keeps medical debt and collections out of the card bucket', () => {
    expect(
      classifyDebtBucket({ type: 'credit', subtype: null, name: 'Medical Card', apr: null }),
    ).toBe('medicalDebt');
    expect(
      classifyDebtBucket({ type: 'credit', subtype: null, name: 'Collections Account', apr: null }),
    ).toBe('collectionsDebt');
  });
});
