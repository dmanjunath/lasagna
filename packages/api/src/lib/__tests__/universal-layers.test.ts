import { describe, it, expect } from 'vitest';
import { UNIVERSAL_LAYERS, assessLayer } from '../universal-layers.js';
import { buildContextDefaults } from '../layer-selector.js';

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
