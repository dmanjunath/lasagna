// ── Historical data ──────────────────────────────────────────────────────────

export const CPI_INFLATION: Record<number, number> = {
  1928: -0.017, 1929:  0.000, 1930: -0.023, 1931: -0.090, 1932: -0.099, 1933: -0.051,
  1934:  0.031, 1935:  0.022, 1936:  0.015, 1937:  0.036, 1938: -0.021, 1939: -0.014,
  1940:  0.007, 1941:  0.050, 1942:  0.109, 1943:  0.061, 1944:  0.017, 1945:  0.023,
  1946:  0.083, 1947:  0.144, 1948:  0.081, 1949: -0.012, 1950:  0.013, 1951:  0.079,
  1952:  0.019, 1953:  0.008, 1954:  0.008, 1955: -0.004, 1956:  0.015, 1957:  0.033,
  1958:  0.029, 1959:  0.007, 1960:  0.017, 1961:  0.010, 1962:  0.010, 1963:  0.013,
  1964:  0.013, 1965:  0.016, 1966:  0.029, 1967:  0.031, 1968:  0.042, 1969:  0.055,
  1970:  0.057, 1971:  0.044, 1972:  0.032, 1973:  0.062, 1974:  0.110, 1975:  0.091,
  1976:  0.058, 1977:  0.065, 1978:  0.076, 1979:  0.114, 1980:  0.135, 1981:  0.103,
  1982:  0.062, 1983:  0.032, 1984:  0.043, 1985:  0.036, 1986:  0.019, 1987:  0.037,
  1988:  0.041, 1989:  0.048, 1990:  0.054, 1991:  0.042, 1992:  0.030, 1993:  0.030,
  1994:  0.026, 1995:  0.028, 1996:  0.030, 1997:  0.023, 1998:  0.016, 1999:  0.022,
  2000:  0.034, 2001:  0.029, 2002:  0.016, 2003:  0.023, 2004:  0.027, 2005:  0.034,
  2006:  0.032, 2007:  0.029, 2008:  0.038, 2009: -0.004, 2010:  0.016, 2011:  0.032,
  2012:  0.021, 2013:  0.015, 2014:  0.016, 2015:  0.001, 2016:  0.013, 2017:  0.021,
  2018:  0.024, 2019:  0.018, 2020:  0.012, 2021:  0.047, 2022:  0.080, 2023:  0.041,
  2024:  0.030,
};

export const BOND_RETURNS: Record<number, number> = {
  1928: 0.008, 1929: 0.042, 1930: 0.045, 1931: -0.026, 1932: 0.088, 1933: 0.019,
  1934: 0.080, 1935: 0.045, 1936: 0.050, 1937: 0.014, 1938: 0.042, 1939: 0.044,
  1940: 0.054, 1941: -0.020, 1942: 0.023, 1943: 0.025, 1944: 0.026, 1945: 0.038,
  1946: 0.031, 1947: 0.009, 1948: 0.020, 1949: 0.047, 1950: 0.004, 1951: -0.003,
  1952: 0.023, 1953: 0.041, 1954: 0.033, 1955: -0.013, 1956: -0.023, 1957: 0.068,
  1958: -0.021, 1959: -0.027, 1960: 0.116, 1961: 0.021, 1962: 0.057, 1963: 0.017,
  1964: 0.037, 1965: 0.007, 1966: 0.029, 1967: -0.016, 1968: 0.033, 1969: -0.050,
  1970: 0.168, 1971: 0.098, 1972: 0.028, 1973: 0.037, 1974: 0.020, 1975: 0.036,
  1976: 0.160, 1977: 0.013, 1978: -0.008, 1979: 0.007, 1980: -0.030, 1981: 0.082,
  1982: 0.328, 1983: 0.032, 1984: 0.137, 1985: 0.257, 1986: 0.243, 1987: -0.050,
  1988: 0.082, 1989: 0.177, 1990: 0.062, 1991: 0.150, 1992: 0.094, 1993: 0.142,
  1994: -0.080, 1995: 0.235, 1996: 0.014, 1997: 0.099, 1998: 0.149, 1999: -0.083,
  2000: 0.167, 2001: 0.056, 2002: 0.151, 2003: 0.004, 2004: 0.045, 2005: 0.029,
  2006: 0.020, 2007: 0.102, 2008: 0.201, 2009: -0.111, 2010: 0.085, 2011: 0.160,
  2012: 0.030, 2013: -0.091, 2014: 0.108, 2015: 0.013, 2016: 0.007, 2017: 0.028,
  2018: 0.000, 2019: 0.096, 2020: 0.113, 2021: -0.044, 2022: -0.178, 2023: 0.039,
  2024: -0.016,
};

export const SP500_RETURNS: Record<number, number> = {
  1928: 0.437, 1929: -0.084, 1930: -0.249, 1931: -0.433, 1932: -0.082, 1933: 0.534,
  1934: -0.012, 1935: 0.477, 1936: 0.339, 1937: -0.350, 1938: 0.311, 1939: -0.004,
  1940: -0.098, 1941: -0.116, 1942: 0.203, 1943: 0.259, 1944: 0.198, 1945: 0.364,
  1946: -0.081, 1947: 0.057, 1948: 0.055, 1949: 0.188, 1950: 0.317, 1951: 0.240,
  1952: 0.184, 1953: -0.010, 1954: 0.526, 1955: 0.316, 1956: 0.066, 1957: -0.108,
  1958: 0.434, 1959: 0.120, 1960: 0.005, 1961: 0.269, 1962: -0.087, 1963: 0.228,
  1964: 0.165, 1965: 0.125, 1966: -0.101, 1967: 0.240, 1968: 0.111, 1969: -0.085,
  1970: 0.040, 1971: 0.143, 1972: 0.190, 1973: -0.147, 1974: -0.265, 1975: 0.372,
  1976: 0.238, 1977: -0.072, 1978: 0.066, 1979: 0.184, 1980: 0.324, 1981: -0.049,
  1982: 0.214, 1983: 0.225, 1984: 0.063, 1985: 0.322, 1986: 0.185, 1987: 0.052,
  1988: 0.168, 1989: 0.315, 1990: -0.032, 1991: 0.306, 1992: 0.077, 1993: 0.101,
  1994: 0.013, 1995: 0.376, 1996: 0.230, 1997: 0.334, 1998: 0.286, 1999: 0.210,
  2000: -0.091, 2001: -0.119, 2002: -0.221, 2003: 0.287, 2004: 0.109, 2005: 0.049,
  2006: 0.158, 2007: 0.055, 2008: -0.370, 2009: 0.265, 2010: 0.151, 2011: 0.021,
  2012: 0.160, 2013: 0.324, 2014: 0.137, 2015: 0.014, 2016: 0.120, 2017: 0.218,
  2018: -0.044, 2019: 0.315, 2020: 0.184, 2021: 0.287, 2022: -0.181, 2023: 0.263,
  2024: 0.233,
};

// ── Types ────────────────────────────────────────────────────────────────────

export type WithdrawalStrategy = 'constant_dollar' | 'percent_portfolio' | 'guardrails';

export interface BacktestYearData {
  year: number;
  phase: 'accumulation' | 'withdrawal';
  startValue: number;
  contribution: number;
  withdrawal: number;
  marketReturn: number;
  endValue: number;
  cumulativeInflation: number;
}

export interface BacktestRow {
  accStartYear: number;
  startYear: number;
  endYear: number;
  era: string;
  survived: boolean;
  finalValue: number;
  finalValueReal: number;
  portfolioAtRetirement: number;
  depletedYear?: number;
  worstYear: number;
  worstReturn: number;
  yearByYear: BacktestYearData[];
}

// ── Withdrawal strategy ──────────────────────────────────────────────────────

export function computeWithdrawal(
  strategy: WithdrawalStrategy,
  baseWithdrawal: number,
  currentValue: number,
  initialValue: number,
  prevWithdrawal: number,
): number {
  switch (strategy) {
    case 'constant_dollar':
      return baseWithdrawal;
    case 'percent_portfolio':
      return currentValue * 0.04;
    case 'guardrails': {
      const rate = currentValue > 0 ? prevWithdrawal / currentValue : 1;
      const initialRate = initialValue > 0 ? baseWithdrawal / initialValue : 0.04;
      const upper = initialRate * 0.8;
      const lower = initialRate * 1.2;
      if (rate < upper) return prevWithdrawal * 1.10;
      if (rate > lower) return prevWithdrawal * 0.90;
      return prevWithdrawal;
    }
    default:
      return baseWithdrawal;
  }
}

// ── Era label ────────────────────────────────────────────────────────────────

const ERA_LABELS: Array<[number, number, string]> = [
  [1928, 1932, 'Great Depression'],
  [1933, 1945, 'WWII recovery'],
  [1946, 1965, 'Post-war boom'],
  [1966, 1982, 'Stagflation era'],
  [1983, 1999, 'Long bull market'],
  [2000, 2002, 'Dot-com bust'],
  [2003, 2007, 'Pre-GFC expansion'],
  [2008, 2009, 'Financial crisis'],
  [2010, 2019, 'Recovery & bull'],
  [2020, 2024, 'COVID & rebound'],
];

export function eraLabel(year: number): string {
  for (const [start, end, label] of ERA_LABELS) {
    if (year >= start && year <= end) return label;
  }
  return '';
}

// ── Backtest engine ──────────────────────────────────────────────────────────

export function runBacktest(
  startYear: number,
  retirementHorizon: number,
  initialValue: number,
  annualWithdrawal: number,
  equityFraction: number,
  inflationAdjusted: boolean,
  strategy: WithdrawalStrategy = 'constant_dollar',
  accumulationYears: number = 0,
  annualSavings: number = 0,
): BacktestRow {
  let value = initialValue;
  const yearByYear: BacktestYearData[] = [];

  // Accumulation phase
  for (let i = 0; i < accumulationYears; i++) {
    const yr = startYear + i;
    const stockRet = SP500_RETURNS[yr] ?? 0.07;
    const bondRet = BOND_RETURNS[yr] ?? 0.04;
    const blended = equityFraction * stockRet + (1 - equityFraction) * bondRet;
    const sv = value;
    value = value * (1 + blended) + annualSavings;
    yearByYear.push({ year: yr, phase: 'accumulation', startValue: Math.round(sv), contribution: Math.round(annualSavings), withdrawal: 0, marketReturn: blended, endValue: Math.round(value), cumulativeInflation: 1 });
  }

  // Withdrawal phase
  const retireStartYear = startYear + accumulationYears;
  const retireValue = value;
  let worstReturn = 1;
  let worstYear = retireStartYear;
  let cumulativeInflation = 1;
  let totalInflation = 1;
  let baseWithdrawal = annualWithdrawal;
  let prevWithdrawal = annualWithdrawal;
  for (let i = 0; i < retirementHorizon; i++) {
    const yr = retireStartYear + i;
    const stockRet = SP500_RETURNS[yr] ?? 0.07;
    const bondRet = BOND_RETURNS[yr] ?? 0.04;
    const blended = equityFraction * stockRet + (1 - equityFraction) * bondRet;
    if (blended < worstReturn) { worstReturn = blended; worstYear = yr; }
    const yearInflation = CPI_INFLATION[yr] ?? 0.03;
    if (i > 0) {
      cumulativeInflation *= (1 + yearInflation);
      if (inflationAdjusted) baseWithdrawal *= (1 + yearInflation);
    }
    const withdrawal = computeWithdrawal(strategy, baseWithdrawal, value, retireValue, prevWithdrawal);
    prevWithdrawal = withdrawal;
    const startValue = value;
    value = (value - withdrawal) * (1 + blended);
    totalInflation *= (1 + yearInflation);
    yearByYear.push({ year: yr, phase: 'withdrawal', startValue: Math.round(startValue), contribution: 0, withdrawal: Math.round(withdrawal), marketReturn: blended, endValue: Math.max(0, Math.round(value)), cumulativeInflation });
    if (value <= 0) {
      return { accStartYear: startYear, startYear: retireStartYear, endYear: retireStartYear + retirementHorizon - 1, era: eraLabel(retireStartYear), survived: false, finalValue: 0, finalValueReal: 0, portfolioAtRetirement: Math.round(retireValue), depletedYear: yr, worstYear, worstReturn, yearByYear };
    }
  }
  return { accStartYear: startYear, startYear: retireStartYear, endYear: retireStartYear + retirementHorizon - 1, era: eraLabel(retireStartYear), survived: true, finalValue: Math.round(value), finalValueReal: Math.round(value / totalInflation), portfolioAtRetirement: Math.round(retireValue), worstYear, worstReturn, yearByYear };
}

// ── Monte Carlo engine ───────────────────────────────────────────────────────

export interface McBands {
  p5: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
  mcSuccessRate: number;
  finalValues: number[];
}

export function buildBands(
  portfolioValue: number,
  annualSavings: number,
  retirementAge: number,
  currentAge: number,
  expReturn: number,
  annualWithdrawal: number,
  equityFraction: number,
  inflationAdjusted: boolean,
  strategy: WithdrawalStrategy = 'constant_dollar',
  rngFn: () => number = Math.random,
): McBands {
  const N = 1000;
  const horizon = Math.max(retirementAge + 30, 90) - currentAge;
  const rate = expReturn / 100;
  const volatility = 0.05 + 0.10 * equityFraction;
  const inflation = 0.03;
  const allPaths: number[][] = [];
  let depletedCount = 0;

  for (let run = 0; run < N; run++) {
    const path: number[] = [];
    let v = portfolioValue;
    let depleted = false;
    let baseWd = annualWithdrawal;
    let prevWd = annualWithdrawal;
    let retireValue = 0;
    for (let yr = 0; yr <= horizon; yr++) {
      path.push(Math.max(0, Math.round(v)));
      const u1 = rngFn(), u2 = rngFn();
      const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
      const r = rate + volatility * z;
      const age = currentAge + yr;
      if (age < retirementAge) {
        v = v * (1 + r) + annualSavings;
      } else {
        if (age === retirementAge) retireValue = v;
        if (inflationAdjusted && age > retirementAge) baseWd *= (1 + inflation);
        const wd = computeWithdrawal(strategy, baseWd, v, retireValue || v, prevWd);
        prevWd = wd;
        v = (v - wd) * (1 + r);
        if (v <= 0 && !depleted) { depleted = true; depletedCount++; }
      }
      if (v < 0) v = 0;
    }
    allPaths.push(path);
  }

  const bands = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
  for (let yr = 0; yr <= horizon; yr++) {
    const vals = allPaths.map(p => p[yr]).sort((a, b) => a - b);
    const p = (pct: number) => vals[Math.floor((pct / 100) * (N - 1))];
    bands.p5.push(p(5));
    bands.p25.push(p(25));
    bands.p50.push(p(50));
    bands.p75.push(p(75));
    bands.p95.push(p(95));
  }

  const finalValues = allPaths.map(p => p[p.length - 1]);
  const mcSuccessRate = Math.round(((N - depletedCount) / N) * 100);
  return { ...bands, mcSuccessRate, finalValues };
}
