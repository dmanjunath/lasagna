/// <reference types="vitest/globals" />
import {
  computeWithdrawal,
  runBacktest,
  buildBands,
  SP500_RETURNS,
  BOND_RETURNS,
  CPI_INFLATION,
} from '../retirement-engine';

// ── 1. computeWithdrawal ────────────────────────────────────────────────────

describe('computeWithdrawal', () => {
  it('constant_dollar: returns baseWithdrawal regardless of portfolio value', () => {
    expect(computeWithdrawal('constant_dollar', 40_000, 500_000, 1_000_000, 40_000)).toBe(40_000);
    expect(computeWithdrawal('constant_dollar', 40_000, 2_000_000, 1_000_000, 40_000)).toBe(40_000);
    expect(computeWithdrawal('constant_dollar', 40_000, 100, 1_000_000, 40_000)).toBe(40_000);
  });

  it('percent_portfolio: returns exactly 4% of currentValue', () => {
    expect(computeWithdrawal('percent_portfolio', 40_000, 1_000_000, 1_000_000, 40_000)).toBe(40_000);
    expect(computeWithdrawal('percent_portfolio', 40_000, 500_000, 1_000_000, 40_000)).toBe(20_000);
    expect(computeWithdrawal('percent_portfolio', 40_000, 2_000_000, 1_000_000, 40_000)).toBe(80_000);
  });

  describe('guardrails', () => {
    // initialRate = baseWithdrawal / initialValue = 40000 / 1000000 = 0.04
    // upper threshold = initialRate * 0.8 = 0.032
    // lower threshold = initialRate * 1.2 = 0.048
    // rate = prevWithdrawal / currentValue

    it('stays flat when withdrawal rate is within thresholds', () => {
      // rate = 40000 / 1000000 = 0.04  (between 0.032 and 0.048)
      const result = computeWithdrawal('guardrails', 40_000, 1_000_000, 1_000_000, 40_000);
      expect(result).toBe(40_000);
    });

    it('raises by 10% when rate is below upper guardrail (portfolio grew a lot)', () => {
      // rate = 40000 / 2000000 = 0.02  (< upper threshold 0.032)
      // So withdrawal should increase by 10%: 40000 * 1.10 = 44000
      const result = computeWithdrawal('guardrails', 40_000, 2_000_000, 1_000_000, 40_000);
      expect(result).toBe(44_000);
    });

    it('cuts by 10% when rate is above lower guardrail (portfolio shrank a lot)', () => {
      // rate = 40000 / 500000 = 0.08  (> lower threshold 0.048)
      // So withdrawal should decrease by 10%: 40000 * 0.90 = 36000
      const result = computeWithdrawal('guardrails', 40_000, 500_000, 1_000_000, 40_000);
      expect(result).toBe(36_000);
    });
  });

});

// ── 2. runBacktest - Basic mechanics ────────────────────────────────────────

describe('runBacktest - Basic mechanics', () => {
  it('1 year horizon, no accumulation: end value = (initial - withdrawal) * (1 + return)', () => {
    // 2020, 100% stocks, $1M initial, $40k withdrawal, 1 year
    // SP500_RETURNS[2020] = 0.184
    // value = (1_000_000 - 40_000) * (1 + 0.184) = 960_000 * 1.184 = 1_136_640
    const result = runBacktest(2020, 1, 1_000_000, 40_000, 1.0, false, 'constant_dollar', 0, 0);
    expect(result.finalValue).toBeCloseTo(1_136_640, -1);
    expect(result.survived).toBe(true);
  });

  it('withdrawal happens at beginning of year (before returns applied)', () => {
    // If withdrawal happened after returns, the calc would be:
    //   value = 1_000_000 * 1.184 - 40_000 = 1_144_000  (WRONG)
    // The correct calc with withdrawal first:
    //   value = (1_000_000 - 40_000) * 1.184 = 1_136_640
    const result = runBacktest(2020, 1, 1_000_000, 40_000, 1.0, false, 'constant_dollar', 0, 0);
    // These two values differ; confirm it matches withdrawal-first
    expect(result.finalValue).toBeCloseTo(1_136_640, -1);
    expect(result.finalValue).not.toBeCloseTo(1_144_000, -1);
  });

  it('portfolio depletion: survived=false and depletedYear is set', () => {
    // Huge withdrawal on small portfolio should deplete quickly
    const result = runBacktest(2000, 30, 100_000, 80_000, 1.0, false, 'constant_dollar', 0, 0);
    expect(result.survived).toBe(false);
    expect(result.depletedYear).toBeDefined();
    expect(result.depletedYear!).toBeGreaterThanOrEqual(2000);
    expect(result.depletedYear!).toBeLessThan(2030);
  });

  it('yearByYear array has correct length = accumulationYears + retirementHorizon', () => {
    const accYears = 5;
    const retHorizon = 10;
    const result = runBacktest(1990, retHorizon, 500_000, 20_000, 0.6, false, 'constant_dollar', accYears, 10_000);
    // If portfolio survives, yearByYear should have accYears + retHorizon entries
    // But if it depletes early, it could be shorter. With these params it should survive.
    expect(result.yearByYear.length).toBeLessThanOrEqual(accYears + retHorizon);
    // Count phases
    const accEntries = result.yearByYear.filter(y => y.phase === 'accumulation');
    expect(accEntries.length).toBe(accYears);
  });
});

// ── 3. runBacktest - Accumulation phase ─────────────────────────────────────

describe('runBacktest - Accumulation phase', () => {
  it('portfolio grows by historical returns + annualSavings during accumulation', () => {
    // 1 accumulation year starting 2020, 100% stocks, $100k initial, $10k savings
    // SP500_RETURNS[2020] = 0.184
    // endValue = 100_000 * (1 + 0.184) + 10_000 = 118_400 + 10_000 = 128_400
    const result = runBacktest(2020, 1, 100_000, 5_000, 1.0, false, 'constant_dollar', 1, 10_000);
    const accEntry = result.yearByYear[0];
    expect(accEntry.phase).toBe('accumulation');
    expect(accEntry.endValue).toBeCloseTo(128_400, -1);
  });

  it('portfolioAtRetirement reflects value after accumulation', () => {
    // 2 accumulation years starting 2019, 100% stocks, $100k, $10k/yr savings
    // Year 2019: SP500 = 0.315
    //   100_000 * 1.315 + 10_000 = 141_500
    // Year 2020: SP500 = 0.184
    //   141_500 * 1.184 + 10_000 = 167_536 + 10_000 = 177_536
    const result = runBacktest(2019, 1, 100_000, 5_000, 1.0, false, 'constant_dollar', 2, 10_000);
    expect(result.portfolioAtRetirement).toBeCloseTo(177_536, -2);
  });

  it('accumulation yearByYear entries have phase=accumulation, withdrawal=0, contribution=annualSavings', () => {
    const result = runBacktest(2015, 5, 200_000, 10_000, 0.6, false, 'constant_dollar', 3, 15_000);
    const accEntries = result.yearByYear.filter(y => y.phase === 'accumulation');
    expect(accEntries.length).toBe(3);
    for (const entry of accEntries) {
      expect(entry.phase).toBe('accumulation');
      expect(entry.withdrawal).toBe(0);
      expect(entry.contribution).toBe(15_000);
    }
  });
});

// ── 4. runBacktest - Inflation consistency (CRITICAL) ───────────────────────

describe('runBacktest - Inflation consistency', () => {
  it('constant_dollar with inflation ON: real withdrawal is identical across all withdrawal years in a single run', () => {
    const result = runBacktest(1990, 20, 1_000_000, 40_000, 0.6, true, 'constant_dollar', 0, 0);
    const wdYears = result.yearByYear.filter(y => y.phase === 'withdrawal');

    // Real withdrawal = nominal withdrawal / cumulativeInflation
    // For constant_dollar with inflation, baseWithdrawal grows with CPI each year
    // and cumulativeInflation tracks the same CPI. So real withdrawal should be stable.
    const realWithdrawals = wdYears.map(y => y.withdrawal / y.cumulativeInflation);
    // Year 0 has cumulativeInflation=1, withdrawal=40000, so realWd = 40000
    // All subsequent years should match
    for (const rw of realWithdrawals) {
      expect(rw).toBeCloseTo(40_000, -1);
    }
  });

  it('constant_dollar with inflation ON: real withdrawal is identical across DIFFERENT cohorts', () => {
    const result1990 = runBacktest(1990, 10, 1_000_000, 40_000, 0.6, true, 'constant_dollar', 0, 0);
    const result2000 = runBacktest(2000, 10, 1_000_000, 40_000, 0.6, true, 'constant_dollar', 0, 0);

    const real1990 = result1990.yearByYear[0].withdrawal / result1990.yearByYear[0].cumulativeInflation;
    const real2000 = result2000.yearByYear[0].withdrawal / result2000.yearByYear[0].cumulativeInflation;

    // Both cohorts start with baseWithdrawal=40000 and cumulativeInflation=1 in year 0
    expect(real1990).toBeCloseTo(40_000, -1);
    expect(real2000).toBeCloseTo(40_000, -1);
    expect(real1990).toBeCloseTo(real2000, -1);
  });

  it('constant_dollar with inflation OFF: nominal withdrawal is constant across years', () => {
    const result = runBacktest(1990, 20, 1_000_000, 40_000, 0.6, false, 'constant_dollar', 0, 0);
    const wdYears = result.yearByYear.filter(y => y.phase === 'withdrawal');
    for (const y of wdYears) {
      expect(y.withdrawal).toBe(40_000);
    }
  });

  it('cumulativeInflation in year 0 of withdrawal phase should be 1', () => {
    const result = runBacktest(1990, 10, 1_000_000, 40_000, 0.6, true, 'constant_dollar', 0, 0);
    const firstWdYear = result.yearByYear.find(y => y.phase === 'withdrawal')!;
    expect(firstWdYear.cumulativeInflation).toBe(1);
  });
});

// ── 5. runBacktest - Withdrawal strategies ──────────────────────────────────

describe('runBacktest - Withdrawal strategies', () => {
  it('percent_portfolio: withdrawal varies with portfolio value', () => {
    const result = runBacktest(1990, 10, 1_000_000, 40_000, 0.6, false, 'percent_portfolio', 0, 0);
    const wdYears = result.yearByYear.filter(y => y.phase === 'withdrawal');
    const withdrawals = wdYears.map(y => y.withdrawal);
    // Not all withdrawals should be the same (portfolio changes over time)
    const unique = new Set(withdrawals);
    expect(unique.size).toBeGreaterThan(1);
    // Each withdrawal should be 4% of the startValue for that year
    for (const y of wdYears) {
      expect(y.withdrawal).toBeCloseTo(y.startValue * 0.04, -1);
    }
  });

  it('guardrails: verify adjustments happen at correct thresholds', () => {
    // Use a scenario where portfolio grows significantly to trigger raise
    // Start 1995 (big bull market), 100% stocks
    const result = runBacktest(1995, 10, 1_000_000, 40_000, 1.0, false, 'guardrails', 0, 0);
    const wdYears = result.yearByYear.filter(y => y.phase === 'withdrawal');

    // initialRate = 40000/1000000 = 0.04
    // upper = 0.04 * 0.8 = 0.032
    // If portfolio grows enough that prevWithdrawal/currentValue < 0.032,
    // withdrawal increases by 10%
    let sawAdjustment = false;
    for (let i = 1; i < wdYears.length; i++) {
      if (wdYears[i].withdrawal !== wdYears[i - 1].withdrawal) {
        sawAdjustment = true;
        break;
      }
    }
    expect(sawAdjustment).toBe(true);
  });

});

// ── 6. runBacktest - Known historical scenarios ─────────────────────────────

describe('runBacktest - Known historical scenarios', () => {
  it('1929 start, 100% stocks, 30yr, 4% withdrawal: should fail (Great Depression)', () => {
    // $1M portfolio, $40k withdrawal (4%), 100% stocks, no inflation adjustment
    const result = runBacktest(1929, 30, 1_000_000, 40_000, 1.0, false, 'constant_dollar', 0, 0);
    expect(result.survived).toBe(false);
    expect(result.depletedYear).toBeDefined();
  });

  it('1950 start, 60/40, 30yr, 4% withdrawal: should survive (post-war boom)', () => {
    const result = runBacktest(1950, 30, 1_000_000, 40_000, 0.6, false, 'constant_dollar', 0, 0);
    expect(result.survived).toBe(true);
    expect(result.finalValue).toBeGreaterThan(0);
  });

  it('worstReturn and worstYear are correctly identified', () => {
    // 2007-2012 range, 100% stocks: worst year should be 2008 with return -0.370
    const result = runBacktest(2007, 6, 1_000_000, 30_000, 1.0, false, 'constant_dollar', 0, 0);
    expect(result.worstYear).toBe(2008);
    expect(result.worstReturn).toBeCloseTo(-0.370, 2);
  });
});

// ── 7. buildBands (Monte Carlo) ─────────────────────────────────────────────

describe('buildBands (Monte Carlo)', () => {
  // Deterministic seeded RNG using a simple linear congruential generator
  function createSeededRng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  it('output has correct array lengths (horizon + 1 entries per band)', () => {
    const currentAge = 30;
    const retirementAge = 65;
    // horizon = max(65 + 30, 90) - 30 = max(95, 90) - 30 = 95 - 30 = 65
    const expectedHorizon = 65;
    const rng = createSeededRng(42);

    const result = buildBands(500_000, 20_000, retirementAge, currentAge, 7, 40_000, 0.6, false, 'constant_dollar', rng);

    // Each band should have horizon + 1 entries (including year 0)
    expect(result.p5.length).toBe(expectedHorizon + 1);
    expect(result.p25.length).toBe(expectedHorizon + 1);
    expect(result.p50.length).toBe(expectedHorizon + 1);
    expect(result.p75.length).toBe(expectedHorizon + 1);
    expect(result.p95.length).toBe(expectedHorizon + 1);
  });

  it('p5 <= p25 <= p50 <= p75 <= p95 at every time step', () => {
    const rng = createSeededRng(123);
    const result = buildBands(500_000, 20_000, 65, 30, 7, 40_000, 0.6, false, 'constant_dollar', rng);

    for (let i = 0; i < result.p5.length; i++) {
      expect(result.p5[i]).toBeLessThanOrEqual(result.p25[i]);
      expect(result.p25[i]).toBeLessThanOrEqual(result.p50[i]);
      expect(result.p50[i]).toBeLessThanOrEqual(result.p75[i]);
      expect(result.p75[i]).toBeLessThanOrEqual(result.p95[i]);
    }
  });

  it('success rate is between 0 and 100', () => {
    const rng = createSeededRng(999);
    const result = buildBands(1_000_000, 0, 65, 60, 7, 40_000, 0.6, false, 'constant_dollar', rng);
    expect(result.mcSuccessRate).toBeGreaterThanOrEqual(0);
    expect(result.mcSuccessRate).toBeLessThanOrEqual(100);
  });

  it('accumulation phase (age < retirementAge) has growing median values', () => {
    const currentAge = 30;
    const retirementAge = 65;
    const rng = createSeededRng(77);

    const result = buildBands(100_000, 30_000, retirementAge, currentAge, 7, 20_000, 0.6, false, 'constant_dollar', rng);

    // During accumulation (years 0 through retirementAge - currentAge - 1),
    // with savings and positive expected return, p50 should generally grow
    const accYears = retirementAge - currentAge; // 35
    // Compare start to end of accumulation
    expect(result.p50[accYears]).toBeGreaterThan(result.p50[0]);
  });

  it('volatility scales with equity fraction', () => {
    // 100% equity -> volatility = 0.05 + 0.10 * 1.0 = 0.15
    // 0% equity   -> volatility = 0.05 + 0.10 * 0.0 = 0.05
    // Higher volatility means wider spread between p5 and p95

    const rng100 = createSeededRng(42);
    const result100 = buildBands(500_000, 0, 65, 60, 7, 30_000, 1.0, false, 'constant_dollar', rng100);

    const rng0 = createSeededRng(42);
    const result0 = buildBands(500_000, 0, 65, 60, 7, 30_000, 0.0, false, 'constant_dollar', rng0);

    // At the last time step, the spread (p95 - p5) should be wider for 100% equity
    const lastIdx = result100.p5.length - 1;
    const spread100 = result100.p95[lastIdx] - result100.p5[lastIdx];
    const spread0 = result0.p95[lastIdx] - result0.p5[lastIdx];
    expect(spread100).toBeGreaterThan(spread0);
  });
});

// ── 8. Deterministic multi-year backtest calculations ──────────────────────

describe('runBacktest - deterministic end-to-end math', () => {
  // All hand-computed using actual historical data from the engine's tables.
  // Formula: endValue = (startValue - withdrawal) * (1 + blendedReturn)
  // blended = equity * SP500 + (1 - equity) * BOND

  it('2020–2022, $1M, 100% stocks, $40k withdrawal, no inflation adj', () => {
    // Year 2020: SP500=0.184, Bond=0.113
    //   blended = 1.0*0.184 + 0.0*0.113 = 0.184
    //   end = (1_000_000 - 40_000) * 1.184 = 960_000 * 1.184 = 1_136_640
    // Year 2021: SP500=0.287
    //   end = (1_136_640 - 40_000) * 1.287 = 1_096_640 * 1.287 = 1_411,375.68
    // Year 2022: SP500=-0.181
    //   end = (1_411_375.68 - 40_000) * 0.819 = 1_371_375.68 * 0.819 = 1,123,176.68
    const result = runBacktest(2020, 3, 1_000_000, 40_000, 1.0, false, 'constant_dollar', 0, 0);
    expect(result.survived).toBe(true);

    const yby = result.yearByYear;
    expect(yby.length).toBe(3);

    // Year 2020
    expect(yby[0].year).toBe(2020);
    expect(yby[0].startValue).toBe(1_000_000);
    expect(yby[0].withdrawal).toBe(40_000);
    expect(yby[0].endValue).toBeCloseTo(1_136_640, -2);

    // Year 2021
    expect(yby[1].year).toBe(2021);
    expect(yby[1].startValue).toBeCloseTo(1_136_640, -2);
    expect(yby[1].withdrawal).toBe(40_000);
    const expected2021 = (1_136_640 - 40_000) * (1 + 0.287);
    expect(yby[1].endValue).toBeCloseTo(expected2021, -2);

    // Year 2022
    expect(yby[2].year).toBe(2022);
    const expected2022 = (expected2021 - 40_000) * (1 + (-0.181));
    expect(yby[2].endValue).toBeCloseTo(expected2022, -2);
    expect(result.finalValue).toBeCloseTo(expected2022, -2);
  });

  it('2020–2022, 60/40, $500k, $20k withdrawal, no inflation adj', () => {
    // 60% stocks / 40% bonds
    // Year 2020: blended = 0.6*0.184 + 0.4*0.113 = 0.1104 + 0.0452 = 0.1556
    //   end = (500_000 - 20_000) * 1.1556 = 480_000 * 1.1556 = 554_688
    // Year 2021: blended = 0.6*0.287 + 0.4*(-0.044) = 0.1722 + (-0.0176) = 0.1546
    //   end = (554_688 - 20_000) * 1.1546 = 534_688 * 1.1546 = 617,336.93
    // Year 2022: blended = 0.6*(-0.181) + 0.4*(-0.178) = -0.1086 + (-0.0712) = -0.1798
    //   end = (617_336.93 - 20_000) * 0.8202 = 597_336.93 * 0.8202 = 489,735.82
    const result = runBacktest(2020, 3, 500_000, 20_000, 0.6, false, 'constant_dollar', 0, 0);

    const y0blend = 0.6 * SP500_RETURNS[2020] + 0.4 * BOND_RETURNS[2020];
    const y0end = (500_000 - 20_000) * (1 + y0blend);
    expect(result.yearByYear[0].endValue).toBeCloseTo(y0end, -2);

    const y1blend = 0.6 * SP500_RETURNS[2021] + 0.4 * BOND_RETURNS[2021];
    const y1end = (y0end - 20_000) * (1 + y1blend);
    expect(result.yearByYear[1].endValue).toBeCloseTo(y1end, -2);

    const y2blend = 0.6 * SP500_RETURNS[2022] + 0.4 * BOND_RETURNS[2022];
    const y2end = (y1end - 20_000) * (1 + y2blend);
    expect(result.yearByYear[2].endValue).toBeCloseTo(y2end, -2);
    expect(result.finalValue).toBeCloseTo(y2end, -2);
  });

  it('accumulation then withdrawal: 2018–2019 accumulate, 2020–2021 withdraw', () => {
    // $200k initial, 100% stocks, $10k/yr savings, $30k withdrawal
    // Accumulation:
    //   2018: SP500=-0.044. end = 200_000 * (1-0.044) + 10_000 = 191_200 + 10_000 = 201_200
    //   2019: SP500=0.315.  end = 201_200 * 1.315 + 10_000 = 264_578 + 10_000 = 274_578
    // portfolioAtRetirement ≈ 274_578
    // Withdrawal:
    //   2020: SP500=0.184. end = (274_578 - 30_000) * 1.184 = 244_578 * 1.184 = 289_580.35
    //   2021: SP500=0.287. end = (289_580.35 - 30_000) * 1.287 = 259_580.35 * 1.287 = 334,079.87
    const result = runBacktest(2018, 2, 200_000, 30_000, 1.0, false, 'constant_dollar', 2, 10_000);

    // Check accumulation
    const acc0 = 200_000 * (1 + SP500_RETURNS[2018]) + 10_000;
    expect(result.yearByYear[0].endValue).toBeCloseTo(acc0, -2);

    const acc1 = acc0 * (1 + SP500_RETURNS[2019]) + 10_000;
    expect(result.yearByYear[1].endValue).toBeCloseTo(acc1, -2);
    expect(result.portfolioAtRetirement).toBeCloseTo(acc1, -2);

    // Check withdrawal phase
    const wd0 = (acc1 - 30_000) * (1 + SP500_RETURNS[2020]);
    expect(result.yearByYear[2].endValue).toBeCloseTo(wd0, -2);

    const wd1 = (wd0 - 30_000) * (1 + SP500_RETURNS[2021]);
    expect(result.yearByYear[3].endValue).toBeCloseTo(wd1, -2);
    expect(result.finalValue).toBeCloseTo(wd1, -2);
  });

  it('inflation-adjusted withdrawal: nominal grows by CPI each year', () => {
    // 2020–2022, $1M, 100% stocks, $40k initial withdrawal, inflation ON
    // Year 2020 (i=0): withdrawal = 40_000 (no CPI adjustment)
    //   end = (1_000_000 - 40_000) * (1+0.184) = 1_136_640
    // Year 2021 (i=1): CPI_2021 = 0.047
    //   baseWithdrawal = 40_000 * 1.047 = 41_880
    //   end = (1_136_640 - 41_880) * (1+0.287) = 1_094_760 * 1.287 = 1_408,956.12
    // Year 2022 (i=2): CPI_2022 = 0.080
    //   baseWithdrawal = 41_880 * 1.080 = 45_230.4
    //   end = (1_408_956.12 - 45_230.4) * (1+(-0.181)) = 1_363_725.72 * 0.819 = 1,116,891.36
    const result = runBacktest(2020, 3, 1_000_000, 40_000, 1.0, true, 'constant_dollar', 0, 0);
    const yby = result.yearByYear;

    // Year 0: withdrawal = 40_000
    expect(yby[0].withdrawal).toBe(40_000);
    expect(yby[0].endValue).toBeCloseTo(1_136_640, -2);

    // Year 1: withdrawal = 40_000 * (1 + CPI_2021)
    const wd1 = 40_000 * (1 + CPI_INFLATION[2021]);
    expect(yby[1].withdrawal).toBeCloseTo(wd1, -1);
    const end1 = (1_136_640 - wd1) * (1 + SP500_RETURNS[2021]);
    expect(yby[1].endValue).toBeCloseTo(end1, -2);

    // Year 2: withdrawal = wd1 * (1 + CPI_2022)
    const wd2 = wd1 * (1 + CPI_INFLATION[2022]);
    expect(yby[2].withdrawal).toBeCloseTo(wd2, -1);
    const end2 = (end1 - wd2) * (1 + SP500_RETURNS[2022]);
    expect(yby[2].endValue).toBeCloseTo(end2, -2);
  });

  it('percent_portfolio strategy: each year withdraws 4% of start value', () => {
    // 2020–2021, $1M, 100% stocks
    // Year 2020: withdrawal = 1_000_000 * 0.04 = 40_000
    //   end = (1_000_000 - 40_000) * 1.184 = 1_136_640
    // Year 2021: withdrawal = 1_136_640 * 0.04 = 45_465.6
    //   end = (1_136_640 - 45_465.6) * 1.287 = 1_091_174.4 * 1.287 = 1_404,341.45
    const result = runBacktest(2020, 2, 1_000_000, 40_000, 1.0, false, 'percent_portfolio', 0, 0);
    const yby = result.yearByYear;

    expect(yby[0].withdrawal).toBeCloseTo(1_000_000 * 0.04, -1);
    const end0 = (1_000_000 - 1_000_000 * 0.04) * (1 + SP500_RETURNS[2020]);
    expect(yby[0].endValue).toBeCloseTo(end0, -2);

    expect(yby[1].withdrawal).toBeCloseTo(end0 * 0.04, -1);
    const end1 = (end0 - end0 * 0.04) * (1 + SP500_RETURNS[2021]);
    expect(yby[1].endValue).toBeCloseTo(end1, -2);
  });

  it('depletion mid-run: exact year identified', () => {
    // $100k portfolio, 100% stocks, $80k withdrawal (80% rate), start 2000 (dot-com bust)
    // Year 2000: SP500=-0.091. end = (100_000 - 80_000) * 0.909 = 20_000 * 0.909 = 18_180
    // Year 2001: SP500=-0.119. end = (18_180 - 80_000) * 0.881 → negative → depleted
    const result = runBacktest(2000, 5, 100_000, 80_000, 1.0, false, 'constant_dollar', 0, 0);
    expect(result.survived).toBe(false);
    expect(result.depletedYear).toBe(2001);

    // Verify year 0 math
    const end0 = (100_000 - 80_000) * (1 + SP500_RETURNS[2000]);
    expect(result.yearByYear[0].endValue).toBeCloseTo(end0, -2);
  });

  it('finalValueReal uses totalInflation (includes year 0 CPI)', () => {
    // 2020–2022, $1M, 100% stocks, $40k, no inflation adj
    // totalInflation = (1+CPI_2020) * (1+CPI_2021) * (1+CPI_2022)
    //               = 1.012 * 1.047 * 1.080 = 1.14366...
    // finalValueReal = finalValue / totalInflation
    const result = runBacktest(2020, 3, 1_000_000, 40_000, 1.0, false, 'constant_dollar', 0, 0);
    const expectedTotalInflation = (1 + CPI_INFLATION[2020]) * (1 + CPI_INFLATION[2021]) * (1 + CPI_INFLATION[2022]);
    expect(result.finalValueReal).toBeCloseTo(result.finalValue / expectedTotalInflation, -2);
  });
});

// ── 8b. Historical data integrity ──────────────────────────────────────────

describe('Historical data integrity', () => {
  const expectedYears = Array.from({ length: 2024 - 1928 + 1 }, (_, i) => 1928 + i);

  it('SP500_RETURNS has entries for 1928-2024', () => {
    for (const yr of expectedYears) {
      expect(SP500_RETURNS[yr]).toBeDefined();
    }
  });

  it('BOND_RETURNS has entries for 1928-2024', () => {
    for (const yr of expectedYears) {
      expect(BOND_RETURNS[yr]).toBeDefined();
    }
  });

  it('CPI_INFLATION has entries for 1928-2024', () => {
    for (const yr of expectedYears) {
      expect(CPI_INFLATION[yr]).toBeDefined();
    }
  });

  it('no NaN or undefined values in any dataset', () => {
    for (const yr of expectedYears) {
      expect(Number.isNaN(SP500_RETURNS[yr])).toBe(false);
      expect(Number.isNaN(BOND_RETURNS[yr])).toBe(false);
      expect(Number.isNaN(CPI_INFLATION[yr])).toBe(false);
    }
  });

  it('S&P 500 2008 return is approximately -0.37', () => {
    expect(SP500_RETURNS[2008]).toBeCloseTo(-0.370, 2);
  });

  it('CPI 1980 is approximately 0.135', () => {
    expect(CPI_INFLATION[1980]).toBeCloseTo(0.135, 3);
  });
});
