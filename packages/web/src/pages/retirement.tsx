import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { formatMoney } from '../lib/utils';
import { PageActions } from '../components/common/page-actions';

// ── Historical returns & MC constants ─────────────────────────────────────────
const HISTORICAL_RETURNS: Record<string, number> = {
  usStocks: 10.0,
  intlStocks: 7.5,
  bonds: 5.0,
  reits: 9.5,
  cash: 2.0,
};

const MC_PRESETS = [
  { id: 'current',      label: 'Current portfolio', alloc: { us: 49, intl: 11, bonds: 20, reit: 8, cash: 12 } },
  { id: 'conservative', label: 'Conservative',      alloc: { us: 30, intl: 10, bonds: 50, reit: 5, cash: 5 } },
  { id: 'balanced',     label: 'Balanced',          alloc: { us: 45, intl: 15, bonds: 30, reit: 5, cash: 5 } },
  { id: 'growth',       label: 'Growth',            alloc: { us: 60, intl: 20, bonds: 15, reit: 5, cash: 0 } },
  { id: 'aggressive',   label: 'Aggressive',        alloc: { us: 70, intl: 20, bonds: 5,  reit: 5, cash: 0 } },
];

const MC_RETURNS: Record<string, number> = { us: 10.0, intl: 7.5, bonds: 5.0, reit: 9.5, cash: 2.0 };
const MC_LABELS: Record<string, string> = { us: 'US Stocks', intl: "Int'l Stocks", bonds: 'Bonds', reit: 'REITs', cash: 'Cash' };
const MC_ACCENT: Record<string, string> = {
  us: 'var(--lf-sauce)',   // terracotta
  intl: 'var(--lf-cheese)', // ochre
  bonds: 'var(--lf-basil)', // sage green
  reit: 'var(--lf-noodle)', // warm yellow
  cash: 'var(--lf-crust)',  // warm brown
};

// Real S&P 500 annual total returns (Damodaran / Ibbotson data)
const SP500_RETURNS: Record<number, number> = {
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

function eraLabel(year: number): string {
  for (const [start, end, label] of ERA_LABELS) {
    if (year >= start && year <= end) return label;
  }
  return '';
}

interface BacktestRow {
  startYear: number;
  endYear: number;
  era: string;
  survived: boolean;
  finalValue: number;
  depletedYear?: number;
  worstYear: number;
  worstReturn: number;
}

function runBacktest(
  startYear: number,
  horizonYears: number,
  initialValue: number,
  annualWithdrawal: number,
  equityFraction: number,
): BacktestRow {
  let value = initialValue;
  let worstReturn = 1;
  let worstYear = startYear;
  for (let i = 0; i < horizonYears; i++) {
    const yr = startYear + i;
    const stockRet = SP500_RETURNS[yr] ?? 0.07;
    const bondRet = yr < 1980 ? 0.035 : yr < 2000 ? 0.065 : 0.04; // rough bond proxy
    const blended = equityFraction * stockRet + (1 - equityFraction) * bondRet;
    if (blended < worstReturn) { worstReturn = blended; worstYear = yr; }
    value = value * (1 + blended) - annualWithdrawal;
    if (value <= 0) {
      return { startYear, endYear: startYear + horizonYears - 1, era: eraLabel(startYear), survived: false, finalValue: 0, depletedYear: yr, worstYear, worstReturn };
    }
  }
  return { startYear, endYear: startYear + horizonYears - 1, era: eraLabel(startYear), survived: true, finalValue: Math.round(value), worstYear, worstReturn };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getExpectedReturn(allocation: Record<string, number>): number {
  const total = Object.values(allocation).reduce((s, v) => s + v, 0);
  if (total === 0) return 7;
  let weighted = 0;
  for (const [key, pct] of Object.entries(allocation)) {
    const ret = HISTORICAL_RETURNS[key] ?? 7;
    weighted += pct * ret;
  }
  return weighted / total;
}

function buildProjectionData(
  currentAge: number,
  retirementAge: number,
  portfolioValue: number,
  annualContribution: number,
  expectedReturn: number
) {
  const data: { age: number; value: number; label?: string }[] = [];
  let value = portfolioValue;
  const rate = expectedReturn / 100;
  for (let age = currentAge; age <= Math.max(retirementAge + 20, 90); age++) {
    data.push({ age, value: Math.round(value), label: age === retirementAge ? 'Retirement' : undefined });
    if (age < retirementAge) {
      value = value * (1 + rate) + annualContribution;
    } else {
      value = value * (1 + rate * 0.6);
    }
    if (value < 0) value = 0;
  }
  return data;
}

// Box-Muller Monte Carlo fan bands
function buildBands(portfolioValue: number, annualSavings: number, retirementAge: number, currentAge: number, expReturn: number, annualWithdrawal: number) {
  const N = 1000;
  const horizon = Math.max(retirementAge + 30, 90) - currentAge;
  const rate = expReturn / 100;
  const volatility = 0.15;
  const allPaths: number[][] = [];
  let depletedCount = 0;

  for (let run = 0; run < N; run++) {
    const path: number[] = [];
    let v = portfolioValue;
    let depleted = false;
    for (let yr = 0; yr <= horizon; yr++) {
      path.push(Math.max(0, Math.round(v)));
      // Box-Muller
      const u1 = Math.random(), u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
      const r = rate + volatility * z;
      const age = currentAge + yr;
      if (age < retirementAge) {
        v = v * (1 + r) + annualSavings;
      } else {
        v = v * (1 + r) - annualWithdrawal;
        if (v <= 0 && !depleted) { depleted = true; depletedCount++; }
      }
      if (v < 0) v = 0;
    }
    allPaths.push(path);
  }

  // Build percentile bands
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

// ── Sub-components ────────────────────────────────────────────────────────────
function Eyebrow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13, letterSpacing: '0.14em',
      textTransform: 'uppercase', color: 'var(--lf-muted)',
      marginBottom: 6, ...style,
    }}>
      {children}
    </p>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--lf-paper)',
      border: '1px solid var(--lf-rule)',
      borderRadius: 14, padding: 20, ...style,
    }}>
      {children}
    </div>
  );
}

function ProjectionLine({ data }: { data: { age: number; value: number; label?: string }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data.length) return null;

  const W = 760; const H = 220;
  const PL = 52; const PR = 16; const PT = 14; const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const maxV = Math.max(...data.map(d => d.value));
  const xf = (i: number) => PL + (i / (data.length - 1)) * chartW;
  const yf = (v: number) => PT + chartH - (v / Math.max(maxV, 1)) * chartH;

  const yTicks = [0.25, 0.5, 0.75, 1].map(pct => ({ pct, val: maxV * pct, y: yf(maxV * pct) }));
  const retireIdx = data.findIndex(d => d.label === 'Retirement');
  const fmt = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`;

  const areaPath = [
    `M ${xf(0)},${yf(0)}`,
    ...data.map((d, i) => `L ${xf(i)},${yf(d.value)}`),
    `L ${xf(data.length - 1)},${yf(0)}`, 'Z',
  ].join(' ');
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xf(i)},${yf(d.value)}`).join(' ');

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((svgX - PL) / chartW) * (data.length - 1));
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
  };

  const hx = hoverIdx !== null ? xf(hoverIdx) : null;
  const hData = hoverIdx !== null ? data[hoverIdx] : null;
  const ttX = hx !== null ? Math.min(hx, W - PR - 140) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const svgX = ((e.touches[0].clientX - rect.left) / rect.width) * W;
        const idx = Math.round(((svgX - PL) / chartW) * (data.length - 1));
        setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
      }}
      onTouchEnd={() => setHoverIdx(null)}
    >
      <defs>
        <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--lf-sauce)" stopOpacity={0.22} />
          <stop offset="100%" stopColor="var(--lf-sauce)" stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* Gridlines + Y-axis labels */}
      {yTicks.map(({ pct, val, y }) => (
        <g key={pct}>
          <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--lf-rule)" strokeDasharray="2 4" />
          <text x={PL - 6} y={y + 4} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={9} fill="var(--lf-muted)">
            {fmt(val)}
          </text>
        </g>
      ))}

      {/* Retirement marker */}
      {retireIdx >= 0 && (
        <>
          <line x1={xf(retireIdx)} x2={xf(retireIdx)} y1={PT} y2={H - PB}
            stroke="var(--lf-basil)" strokeDasharray="4 4" strokeWidth={1} />
          <text x={xf(retireIdx) + 5} y={PT + 14} fontFamily="'JetBrains Mono', monospace" fontSize={9} fill="var(--lf-basil)">
            retire {data[retireIdx].age}
          </text>
        </>
      )}

      {/* Area + Line */}
      <path d={areaPath} fill="url(#projFill)" />
      <path d={linePath} fill="none" stroke="var(--lf-sauce)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* X-axis age labels */}
      <text x={xf(0)} y={H - 6} fontFamily="'JetBrains Mono', monospace" fontSize={9} fill="var(--lf-muted)">
        {data[0].age}
      </text>
      <text x={xf(Math.floor((data.length - 1) / 2))} y={H - 6} fontFamily="'JetBrains Mono', monospace" fontSize={9} fill="var(--lf-muted)" textAnchor="middle">
        {data[Math.floor((data.length - 1) / 2)]?.age}
      </text>
      <text x={xf(data.length - 1)} y={H - 6} fontFamily="'JetBrains Mono', monospace" fontSize={9} fill="var(--lf-muted)" textAnchor="end">
        {data[data.length - 1].age}
      </text>

      {/* Hover crosshair + tooltip */}
      {hx !== null && hData !== null && (
        <g>
          <line x1={hx} x2={hx} y1={PT} y2={H - PB} stroke="var(--lf-ink)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
          <circle cx={hx} cy={yf(hData.value)} r={4} fill="var(--lf-sauce)" />
          <rect x={ttX} y={PT + 4} width={130} height={44} rx={6} fill="var(--lf-ink)" opacity={0.92} />
          <text x={ttX + 10} y={PT + 22} fontFamily="'JetBrains Mono', monospace" fontSize={10} fill="var(--lf-cheese)">age {hData.age}</text>
          <text x={ttX + 10} y={PT + 38} fontFamily="'JetBrains Mono', monospace" fontSize={10} fill="var(--lf-paper)">{fmt(hData.value)}</text>
        </g>
      )}
    </svg>
  );
}

function ReadinessRing({ pct }: { pct: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 80 ? 'var(--lf-basil)' : pct >= 50 ? 'var(--lf-cheese)' : 'var(--lf-sauce)';
  return (
    <div style={{ position: 'relative', width: 140, height: 140 }}>
      <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--lf-rule)" strokeWidth={8} />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth={8}
          strokeLinecap="round" strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color, lineHeight: 1 }}>
          {pct.toFixed(0)}%
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--lf-muted)', marginTop: 2 }}>
          ready
        </span>
      </div>
    </div>
  );
}

function FanChart({ bands, retireAge, currentAge }: { bands: ReturnType<typeof buildBands>; retireAge: number; currentAge: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 760; const H = 200;
  const n = bands.p50.length;
  const max = Math.max(...bands.p95) || 1;
  const xf = (i: number) => (i / (n - 1)) * W;
  const yf = (v: number) => H - (v / max) * H;
  const path = (arr: number[], close?: number[]) => {
    let d = `M ${xf(0)},${yf(arr[0])}`;
    for (let i = 1; i < n; i++) d += ` L ${xf(i)},${yf(arr[i])}`;
    if (close) {
      for (let i = n - 1; i >= 0; i--) d += ` L ${xf(i)},${yf(close[i])}`;
      d += ' Z';
    }
    return d;
  };
  const retireOffset = Math.max(0, retireAge - currentAge);
  const retirePos = retireOffset < n ? xf(retireOffset) : W;

  const fmt = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`;

  const hx = hoverIdx !== null ? xf(hoverIdx) : null;
  const hAge = hoverIdx !== null ? currentAge + hoverIdx : null;
  const hp50 = hoverIdx !== null ? bands.p50[hoverIdx] : null;
  const hp25 = hoverIdx !== null ? bands.p25[hoverIdx] : null;
  const hp75 = hoverIdx !== null ? bands.p75[hoverIdx] : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((svgX / W) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  // Tooltip position
  const ttX = hx !== null ? Math.min(hx, W - 140) : 0;
  const ttY = 10;

  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" style={{ display: 'block', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const svgX = ((e.touches[0].clientX - rect.left) / rect.width) * W;
        const idx = Math.round((svgX / W) * (n - 1));
        setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
      }}
      onTouchEnd={() => setHoverIdx(null)}
    >
      {[0, 1, 2, 3, 4].map(i => (
        <line key={i} x1={0} x2={W} y1={i * H / 4} y2={i * H / 4} stroke="var(--lf-rule)" strokeDasharray="2 4" />
      ))}
      <path d={path(bands.p95, bands.p5)} fill="var(--lf-sauce)" opacity="0.08" />
      <path d={path(bands.p75, bands.p25)} fill="var(--lf-sauce)" opacity="0.16" />
      <path d={path(bands.p50)} stroke="var(--lf-sauce)" strokeWidth="2" fill="none" />
      <line x1={retirePos} x2={retirePos} y1={0} y2={H} stroke="var(--lf-basil)" strokeDasharray="4 4" />
      <text x={retirePos + 6} y={16} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-basil)">
        retire {retireAge}
      </text>
      <text x={0} y={H + 14} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-muted)">
        age {currentAge}
      </text>
      <text x={W / 2} y={H + 14} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-muted)" textAnchor="middle">
        age {Math.round(currentAge + (n - 1) / 2)}
      </text>
      <text x={W} y={H + 14} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-muted)" textAnchor="end">
        age {currentAge + n - 1}
      </text>
      {hx !== null && hAge !== null && hp50 !== null && (
        <g>
          <line x1={hx} x2={hx} y1={0} y2={H} stroke="var(--lf-ink)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <rect x={ttX} y={ttY} width={136} height={58} rx={6} fill="var(--lf-ink)" opacity="0.92" />
          <text x={ttX + 8} y={ttY + 16} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-cheese)">age {hAge}</text>
          <text x={ttX + 8} y={ttY + 30} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-paper)">p50 {fmt(hp50)}</text>
          <text x={ttX + 8} y={ttY + 42} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="rgba(251,246,236,0.6)">p25 {hp25 ? fmt(hp25) : '—'} · p75 {hp75 ? fmt(hp75) : '—'}</text>
        </g>
      )}
    </svg>
  );
}

function DistributionBar({ finalValues }: { finalValues: number[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const BINS = [
    { label: 'Depleted', min: -Infinity, max: 0, success: false },
    { label: '<$500k', min: 0, max: 500_000, success: false },
    { label: '$500k–1M', min: 500_000, max: 1_000_000, success: true },
    { label: '$1–2M', min: 1_000_000, max: 2_000_000, success: true },
    { label: '$2–4M', min: 2_000_000, max: 4_000_000, success: true },
    { label: '$4–8M', min: 4_000_000, max: 8_000_000, success: true },
    { label: '$8M+', min: 8_000_000, max: Infinity, success: true },
  ];
  const total = finalValues.length || 1;
  const histogram = BINS.map(bin => ({
    ...bin,
    pct: (finalValues.filter(v => v > bin.min && v <= bin.max).length / total) * 100,
  }));
  const maxPct = Math.max(...histogram.map(h => h.pct), 1);
  const W = 720; const H = 160;
  const bw = W / histogram.length - 8;
  return (
    <svg viewBox={`0 0 ${W} ${H + 50}`} width="100%" style={{ cursor: 'pointer' }}>
      {histogram.map((h, i) => {
        const barH = Math.max(2, (h.pct / maxPct) * H);
        const bx = i * (bw + 8) + 4;
        const isHov = hovered === i;
        const ttX = Math.min(bx, W - 120);
        return (
          <g key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onTouchStart={() => setHovered(hovered === i ? null : i)}
          >
            <rect x={bx} y={H - barH} width={bw} height={barH}
              fill={h.success ? 'var(--lf-basil)' : 'var(--lf-sauce)'}
              opacity={isHov ? 1 : 0.82} rx="3"
              style={{ transition: 'opacity 0.15s' }} />
            <text x={bx + bw / 2} y={H + 14} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-muted)">
              {h.label}
            </text>
            {h.pct >= 1 && (
              <text x={bx + bw / 2} y={H - barH - 4} textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-ink)">
                {h.pct.toFixed(1)}%
              </text>
            )}
            {isHov && (
              <g>
                <rect x={ttX} y={H + 22} width={120} height={22} rx={5} fill="var(--lf-ink)" />
                <text x={ttX + 8} y={H + 37} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-paper)">
                  {h.pct.toFixed(1)}% → {h.label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function EditableStat({ label, value, sub, onInc, onDec }: {
  label: string; value: number; sub?: string;
  onInc: () => void; onDec: () => void;
}) {
  return (
    <Card>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
        <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 34, letterSpacing: '-0.02em', flex: 1, lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onDec} style={{
            width: 26, height: 26, borderRadius: 6, border: '1px solid var(--lf-rule)',
            background: 'var(--lf-paper)', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--lf-ink-soft)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>−</button>
          <button onClick={onInc} style={{
            width: 26, height: 26, borderRadius: 6, border: '1px solid var(--lf-rule)',
            background: 'var(--lf-paper)', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--lf-ink-soft)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>+</button>
        </div>
      </div>
      {sub && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 6 }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

// ── SimulateView ──────────────────────────────────────────────────────────────
type McAlloc = { us: number; intl: number; bonds: number; reit: number; cash: number };

// Map parent API allocation keys → SimulateView keys.
// API returns decimals (0.0–1.0), SimulateView expects percentages (0–100).
function mapAllocation(alloc: Record<string, number>): McAlloc | null {
  const keyMap: Record<string, keyof McAlloc> = {
    usStocks: 'us', us: 'us',
    intlStocks: 'intl', intl: 'intl', international: 'intl',
    bonds: 'bonds', bond: 'bonds',
    reits: 'reit', reit: 'reit',
    cash: 'cash',
  };
  const result: McAlloc = { us: 0, intl: 0, bonds: 0, reit: 0, cash: 0 };
  let matched = false;
  for (const [k, v] of Object.entries(alloc)) {
    const mapped = keyMap[k];
    if (mapped) { result[mapped] = v; matched = true; }
  }
  if (!matched) return null;
  // Detect decimal format (total ≤ 1.0) and scale to percentages
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  const scale = total <= 1.0 ? 100 : 1;
  return {
    us: Math.round(result.us * scale),
    intl: Math.round(result.intl * scale),
    bonds: Math.round(result.bonds * scale),
    reit: Math.round(result.reit * scale),
    cash: Math.round(result.cash * scale),
  };
}

function SimulateView({
  retirementAge, setRetirementAge,
  monthlySpend, setMonthlySpend,
  portfolioValue, currentAge, annualSavings,
  portfolioAtRetirement,
  portfolioAllocation,
  actualBlendedReturn,
}: {
  retirementAge: number; setRetirementAge: (v: number) => void;
  monthlySpend: number; setMonthlySpend: (v: number) => void;
  portfolioValue: number; currentAge: number; annualSavings: number;
  portfolioAtRetirement: number;
  portfolioAllocation: Record<string, number>;
  actualBlendedReturn: number | null;
}) {
  const [lifeExp, setLifeExp] = useState(92);
  const [simTab, setSimTab] = useState<'mc' | 'backtest'>('mc');
  const [strategy, setStrategy] = useState('constant_dollar');
  const mappedAlloc = mapAllocation(portfolioAllocation);
  const [mcAlloc, setMcAlloc] = useState<McAlloc>(mappedAlloc ?? { us: 45, intl: 15, bonds: 30, reit: 5, cash: 5 });
  const [preset, setPreset] = useState(mappedAlloc ? 'current' : 'balanced');
  const [inflAdj, setInflAdj] = useState(true);
  const [dollars, setDollars] = useState<'real' | 'nominal'>('real');

  // Draft strings allow free typing in number inputs without immediate clamping
  const [monthlySpendStr, setMonthlySpendStr] = useState(String(monthlySpend));
  const [allocStrs, setAllocStrs] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.keys(MC_LABELS).map(k => [k, String(mcAlloc[k as keyof typeof mcAlloc])]))
  );
  useEffect(() => { setMonthlySpendStr(String(monthlySpend)); }, [monthlySpend]);
  useEffect(() => {
    setAllocStrs(Object.fromEntries(Object.keys(MC_LABELS).map(k => [k, String(mcAlloc[k as keyof typeof mcAlloc])])));
  }, [mcAlloc]);

  const updateAlloc = (k: string, v: number) => {
    setMcAlloc(a => ({ ...a, [k]: v }));
    setPreset('custom');
  };

  const selectPreset = (p: typeof MC_PRESETS[0]) => {
    setPreset(p.id);
    setMcAlloc(p.alloc as typeof mcAlloc);
  };

  const allocTotal = Object.values(mcAlloc).reduce((s, v) => s + v, 0);
  const mcComputedReturn = Object.entries(mcAlloc).reduce((s, [k, v]) => s + v * (MC_RETURNS[k] ?? 7), 0) / (allocTotal || 1);
  // When using the actual portfolio ("current" preset), use the server-computed blended return
  // (category-level granularity) so the simulation matches the Portfolio page. On any other preset
  // or custom edits, fall back to the MC_RETURNS computation.
  const expReturn = (preset === 'current' && actualBlendedReturn !== null) ? actualBlendedReturn : mcComputedReturn;
  const annualWithdrawal = monthlySpend * 12;

  const bands = useMemo(
    () => buildBands(portfolioValue, annualSavings, retirementAge, currentAge, expReturn, annualWithdrawal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portfolioValue, annualSavings, retirementAge, currentAge, expReturn, annualWithdrawal]
  );

  const mcSuccessRate = bands.mcSuccessRate;
  const mcSuccessColor = mcSuccessRate >= 80 ? 'var(--lf-pos)' : mcSuccessRate >= 60 ? 'var(--lf-cheese)' : 'var(--lf-sauce)';

  // Real vs nominal: deflate by 3% / yr from current age
  const displayBands = useMemo(() => {
    if (dollars === 'nominal') return bands;
    const deflate = (v: number, t: number) => Math.round(v / Math.pow(1.03, t));
    const horizon = bands.p50.length;
    return {
      ...bands,
      p5:  bands.p5.map((v, t) => deflate(v, t)),
      p25: bands.p25.map((v, t) => deflate(v, t)),
      p50: bands.p50.map((v, t) => deflate(v, t)),
      p75: bands.p75.map((v, t) => deflate(v, t)),
      p95: bands.p95.map((v, t) => deflate(v, t)),
      finalValues: bands.finalValues.map(v => deflate(v, horizon - 1)),
    };
  }, [bands, dollars]);

  const lifeHorizon = Math.max(1, lifeExp - retirementAge);
  const equityFraction = (mcAlloc.us + mcAlloc.intl + mcAlloc.reit) / Math.max(allocTotal, 1);
  // Generate year-by-year backtest rows for every start year with full data
  const backtestRows = useMemo(() => {
    const maxStart = 2024 - lifeHorizon;
    const rows: BacktestRow[] = [];
    for (let yr = 1928; yr <= Math.min(maxStart, 2024); yr++) {
      rows.push(runBacktest(yr, lifeHorizon, portfolioAtRetirement, annualWithdrawal, equityFraction));
    }
    return rows;
  }, [lifeHorizon, portfolioAtRetirement, annualWithdrawal, equityFraction]);
  const survived = backtestRows.filter(r => r.survived).length;

  const strategyDescriptions: Record<string, string> = {
    constant_dollar: 'Withdraw the same real amount each year, regardless of portfolio.',
    percent_portfolio: 'Withdraw a fixed % of current portfolio each year — flexible but volatile.',
    guardrails: 'Adjust withdrawals when portfolio hits upper/lower guardrail thresholds.',
    rules_based: 'Combine bucket strategy, floors/ceilings, and tax-efficient source ordering.',
  };

  const backtestSuccessRate = backtestRows.length > 0 ? Math.round((survived / backtestRows.length) * 100) : 0;
  const btSuccessColor = backtestSuccessRate >= 80 ? 'var(--lf-pos)' : backtestSuccessRate >= 60 ? 'var(--lf-cheese)' : 'var(--lf-sauce)';

  return (
    <>
      {/* Success overview strip — both methods side by side */}
      <div className="ret-simulate-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 20 }}>
        <Card style={{ padding: 20 }}>
          <Eyebrow>Monte Carlo success</Eyebrow>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 34, letterSpacing: '-0.02em', color: mcSuccessColor, marginTop: 8, lineHeight: 1 }}>
            {mcSuccessRate}%
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 6 }}>
            1,000 runs · {lifeHorizon} yr horizon
          </div>
        </Card>
        <Card style={{ padding: 20 }}>
          <Eyebrow>Historical backtest success</Eyebrow>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 34, letterSpacing: '-0.02em', color: btSuccessColor, marginTop: 8, lineHeight: 1 }}>
            {backtestSuccessRate}%
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 6 }}>
            {survived}/{backtestRows.length} scenarios survived
          </div>
        </Card>
        <EditableStat
          label="Retirement age"
          value={retirementAge}
          sub="adjust to stress-test"
          onInc={() => setRetirementAge(Math.min(100, retirementAge + 1))}
          onDec={() => setRetirementAge(Math.max(currentAge, retirementAge - 1))}
        />
        <EditableStat
          label="Life expectancy"
          value={lifeExp}
          sub="plan through this age"
          onInc={() => setLifeExp(Math.min(110, lifeExp + 1))}
          onDec={() => setLifeExp(Math.max(retirementAge + 1, lifeExp - 1))}
        />
      </div>

      {/* Withdrawal strategy */}
      <Eyebrow style={{ marginBottom: 10 }}>Withdrawal strategy</Eyebrow>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {[
            { id: 'constant_dollar', label: 'Constant Dollar (4%)' },
            { id: 'percent_portfolio', label: '% of Portfolio' },
            { id: 'guardrails', label: 'Guyton-Klinger Guardrails' },
            { id: 'rules_based', label: 'Rules-Based' },
          ].map(s => (
            <button key={s.id} onClick={() => setStrategy(s.id)} style={{
              padding: '8px 14px', fontSize: 13, cursor: 'pointer',
              fontFamily: "'Geist', system-ui, sans-serif", borderRadius: 8, fontWeight: 500,
              background: strategy === s.id ? 'rgba(201,84,58,0.08)' : 'var(--lf-paper)',
              color: strategy === s.id ? 'var(--lf-sauce)' : 'var(--lf-ink-soft)',
              border: `1px solid ${strategy === s.id ? 'rgba(201,84,58,0.3)' : 'var(--lf-rule)'}`,
            }}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="ret-withdrawal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 28, width: '100%' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 13, color: 'var(--lf-ink-soft)', fontWeight: 500, fontFamily: "'Geist', system-ui, sans-serif" }}>
                Monthly spending
              </label>
              <input
                type="number" min={500} max={50000} step={500} value={monthlySpendStr}
                onChange={e => {
                  setMonthlySpendStr(e.target.value);
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 500 && v <= 50000) setMonthlySpend(v);
                }}
                onBlur={() => {
                  const v = parseInt(monthlySpendStr, 10);
                  const clamped = isNaN(v) ? 500 : Math.max(500, Math.min(50000, v));
                  setMonthlySpend(clamped);
                  setMonthlySpendStr(String(clamped));
                }}
                style={{ width: 80, textAlign: 'right', border: '1px solid var(--lf-rule)', borderRadius: 6, padding: '2px 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#C9543A', fontWeight: 600, background: 'transparent' }}
              />
            </div>
            <input type="range" min={2000} max={20000} step={500} value={monthlySpend}
              onChange={e => setMonthlySpend(+e.target.value)}
              style={{ width: '100%', accentColor: '#C9543A' }} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 4 }}>
              annual withdrawal ≈ ${(monthlySpend * 12).toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--lf-ink-soft)', fontWeight: 500, marginBottom: 8, fontFamily: "'Geist', system-ui, sans-serif" }}>
              Parameters
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 0', cursor: 'pointer', fontFamily: "'Geist', system-ui, sans-serif", color: 'var(--lf-ink-soft)' }}>
              <input type="checkbox" checked={inflAdj} onChange={e => setInflAdj(e.target.checked)} style={{ accentColor: '#C9543A' }} />
              Inflation-adjusted withdrawals
            </label>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 4, lineHeight: 1.6 }}>
              {strategyDescriptions[strategy]}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 6, opacity: 0.7 }}>
              Simulation uses constant-dollar withdrawals. Strategy descriptions are informational.
            </div>
          </div>
        </div>
      </Card>

      {/* Portfolio allocation */}
      <Eyebrow style={{ marginBottom: 10 }}>Portfolio allocation</Eyebrow>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {MC_PRESETS.map(p => (
            <button key={p.id} onClick={() => selectPreset(p)} style={{
              padding: '8px 14px', fontSize: 13, cursor: 'pointer',
              fontFamily: "'Geist', system-ui, sans-serif", borderRadius: 8, fontWeight: 500,
              background: preset === p.id ? 'rgba(201,84,58,0.08)' : 'var(--lf-paper)',
              color: preset === p.id ? 'var(--lf-sauce)' : 'var(--lf-ink-soft)',
              border: `1px solid ${preset === p.id ? 'rgba(201,84,58,0.3)' : 'var(--lf-rule)'}`,
            }}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <span style={{
              padding: '8px 14px', fontSize: 13, borderRadius: 8,
              background: 'var(--lf-cream)', color: 'var(--lf-muted)',
              border: '1px solid var(--lf-rule)', fontFamily: "'JetBrains Mono', monospace",
            }}>Custom</span>
          )}
        </div>
        <div className="ret-5col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 20, width: '100%' }}>
          {Object.keys(MC_LABELS).map(k => (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--lf-ink-soft)', fontFamily: "'Geist', system-ui, sans-serif" }}>
                  {MC_LABELS[k]}
                </span>
                <input
                  type="number" min={0} max={100} step={5}
                  value={allocStrs[k] ?? String(mcAlloc[k as keyof typeof mcAlloc])}
                  onChange={e => {
                    setAllocStrs(prev => ({ ...prev, [k]: e.target.value }));
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 0 && v <= 100) updateAlloc(k, v);
                  }}
                  onBlur={() => {
                    const str = allocStrs[k] ?? '0';
                    const v = parseInt(str, 10);
                    const clamped = isNaN(v) ? 0 : Math.max(0, Math.min(100, v));
                    updateAlloc(k, clamped);
                    setAllocStrs(prev => ({ ...prev, [k]: String(clamped) }));
                  }}
                  style={{ width: 44, textAlign: 'right', border: '1px solid var(--lf-rule)', borderRadius: 6, padding: '2px 4px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: 'var(--lf-ink)', background: 'transparent' }}
                />
              </div>
              <input type="range" min={0} max={100} step={5}
                value={mcAlloc[k as keyof typeof mcAlloc]}
                onChange={e => updateAlloc(k, +e.target.value)}
                style={{ width: '100%', accentColor: MC_ACCENT[k] }} />
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 3 }}>
                {MC_RETURNS[k]}% avg · hist.
              </div>
            </div>
          ))}
        </div>
        {/* Stacked allocation bar */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--lf-rule)' }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1, marginBottom: 10 }}>
            {Object.keys(MC_LABELS).map(k => {
              const pct = allocTotal > 0 ? (mcAlloc[k as keyof McAlloc] / allocTotal) * 100 : 0;
              return pct > 0 ? (
                <div key={k} style={{ width: `${pct}%`, background: MC_ACCENT[k], transition: 'width 0.3s ease', minWidth: 2 }} />
              ) : null;
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {Object.keys(MC_LABELS).map(k => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-ink-soft)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: MC_ACCENT[k], flexShrink: 0 }} />
                {MC_LABELS[k]} {mcAlloc[k as keyof McAlloc]}%
              </span>
            ))}
          </div>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 12, fontSize: 13,
          fontFamily: "'Geist', system-ui, sans-serif", color: 'var(--lf-ink-soft)',
        }}>
          <span>
            Blended return · <strong>{expReturn.toFixed(2)}%</strong>
            {preset !== 'current' && actualBlendedReturn !== null && (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)', marginLeft: 8 }}>
                (your actual portfolio: {actualBlendedReturn.toFixed(1)}%)
              </span>
            )}
            {preset === 'current' && actualBlendedReturn !== null && (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)', marginLeft: 8 }}>
                · from your actual holdings
              </span>
            )}
          </span>
          {allocTotal !== 100 && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-sauce)' }}>
              ⚠ allocation totals {allocTotal}%
            </span>
          )}
        </div>
      </Card>

      {/* ── Real / Nominal toggle — applies to both tabs ───────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)' }}>
        <span>Values in:</span>
        <div style={{ display: 'flex', border: '1px solid var(--lf-rule)', borderRadius: 8, overflow: 'hidden' }}>
          {(['real', 'nominal'] as const).map((d, i) => (
            <button key={d} onClick={() => setDollars(d)} style={{
              padding: '5px 12px', fontSize: 13, cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              background: dollars === d ? 'rgba(201,84,58,0.08)' : 'transparent',
              color: dollars === d ? 'var(--lf-sauce)' : 'var(--lf-muted)',
              border: 0, borderRight: i === 0 ? '1px solid var(--lf-rule)' : 'none',
              transition: 'background 0.15s, color 0.15s',
            }}>
              {d === 'real' ? 'Real $' : 'Nominal $'}
            </button>
          ))}
        </div>
        {dollars === 'real' && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>inflation-adjusted · 3%/yr</span>
        )}
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '1px solid var(--lf-rule)', borderRadius: 10, overflow: 'hidden', background: 'var(--lf-cream)' }}>
        {([
          { id: 'mc', label: 'Monte Carlo', rate: mcSuccessRate, color: mcSuccessColor },
          { id: 'backtest', label: 'Historical Backtest', rate: backtestSuccessRate, color: btSuccessColor },
        ] as const).map((tab, i) => {
          const isActive = simTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSimTab(tab.id)}
              style={{
                flex: 1, padding: '12px 16px', cursor: 'pointer', border: 0,
                borderRight: i === 0 ? '1px solid var(--lf-rule)' : 'none',
                borderBottom: isActive ? `2px solid var(--lf-sauce)` : '2px solid transparent',
                background: isActive ? 'var(--lf-paper)' : 'transparent',
                transition: 'background 0.15s, border-color 0.15s',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
              }}
            >
              <span style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, fontWeight: isActive ? 600 : 500, color: isActive ? 'var(--lf-ink)' : 'var(--lf-muted)' }}>
                {tab.label}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: tab.color }}>
                {tab.rate}% success
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Monte Carlo tab ─────────────────────────────────────────────────── */}
      {simTab === 'mc' && (
        <>
          <Card style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <Eyebrow style={{ marginBottom: 0 }}>Portfolio projection · 1,000 randomized runs</Eyebrow>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)' }}>
                {lifeHorizon} yr horizon · age {currentAge}–{lifeExp}
              </span>
            </div>
            <FanChart bands={displayBands} retireAge={retirementAge} currentAge={currentAge} />
            <div style={{ display: 'flex', gap: 24, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 12, flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 6, background: 'var(--lf-sauce)', opacity: 0.1, marginRight: 6, verticalAlign: 'middle' }}></span>p5–p95</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 6, background: 'var(--lf-sauce)', opacity: 0.28, marginRight: 6, verticalAlign: 'middle' }}></span>p25–p75</span>
              <span style={{ color: 'var(--lf-sauce)' }}><span style={{ display: 'inline-block', width: 12, height: 2, background: 'var(--lf-sauce)', marginRight: 6, verticalAlign: 'middle' }}></span>median (p50)</span>
              <span style={{ marginLeft: 'auto' }}>
                median @ age {lifeExp}: <strong>{formatMoney(displayBands.p50[displayBands.p50.length - 1] || 0, true)}</strong>
                &nbsp;·&nbsp; worst 5%: <strong style={{ color: displayBands.p5[displayBands.p5.length - 1] === 0 ? 'var(--lf-sauce)' : undefined }}>
                  {displayBands.p5[displayBands.p5.length - 1] === 0 ? 'depleted' : formatMoney(displayBands.p5[displayBands.p5.length - 1], true)}
                </strong>
              </span>
            </div>
          </Card>
          <Card style={{ marginBottom: 20 }}>
            <Eyebrow style={{ marginBottom: 10 }}>Distribution of final portfolio values at age {lifeExp}</Eyebrow>
            <DistributionBar finalValues={displayBands.finalValues} />
            <div style={{ display: 'flex', gap: 20, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 4, flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--lf-basil)', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }}></span>portfolio survived</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--lf-sauce)', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }}></span>depleted before end</span>
              <span style={{ marginLeft: 'auto' }}>each bar = % of 1,000 runs</span>
            </div>
          </Card>

          {/* MC failure commentary */}
          {mcSuccessRate < 95 && (() => {
            const failPct = 100 - mcSuccessRate;
            const withdrawalRate = annualWithdrawal / Math.max(portfolioAtRetirement, 1) * 100;
            const horizon = lifeHorizon;
            const isHighWithdrawal = withdrawalRate > 5;
            const isLongHorizon = horizon > 35;
            const isLowEquity = equityFraction < 0.4;

            const fixes: Array<{ label: string; detail: string }> = [];
            if (isHighWithdrawal) fixes.push({
              label: `Reduce withdrawal rate (currently ${withdrawalRate.toFixed(1)}%)`,
              detail: `The 4% rule targets ≤4%. Your ${withdrawalRate.toFixed(1)}% rate means $${(annualWithdrawal / 1000).toFixed(0)}k/yr on a ${formatMoney(portfolioAtRetirement, true)} portfolio. Each extra year of work or $${Math.round(monthlySpend * 0.1 / 100) * 100}/mo in spending cuts meaningfully improves odds.`,
            });
            if (isLongHorizon) fixes.push({
              label: `Long retirement horizon (${horizon} yrs)`,
              detail: `A ${horizon}-year horizon means more years for market downturns to compound. Retiring at ${retirementAge + 2} instead would reduce the horizon to ${horizon - 2} years and let the portfolio grow longer.`,
            });
            if (isLowEquity) fixes.push({
              label: `Low equity allocation (${Math.round(equityFraction * 100)}% stocks)`,
              detail: `Portfolios with <40% in equities often can't outpace inflation and withdrawals over long periods. Consider shifting bonds to equities if your risk tolerance allows.`,
            });
            if (fixes.length === 0) fixes.push({
              label: 'Sequence-of-returns risk',
              detail: `Even with good average returns, a bad market in the first 5–10 years of retirement is the main culprit. Consider keeping 1–2 years of spending in cash to avoid selling equities at a loss during downturns (a "cash buffer" strategy).`,
            });

            return (
              <Card style={{ marginBottom: 20, background: 'rgba(201,84,58,0.04)', border: '1px solid rgba(201,84,58,0.15)' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--lf-sauce)', marginBottom: 12 }}>
                  Why {failPct}% of runs fail · what to do
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {fixes.map((fix, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(201,84,58,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-sauce)', fontWeight: 600 }}>{i + 1}</span>
                      </div>
                      <div>
                        <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--lf-ink)', marginBottom: 3 }}>{fix.label}</div>
                        <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.6 }}>{fix.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}
        </>
      )}

      {/* ── Historical backtest tab ─────────────────────────────────────────── */}
      {simTab === 'backtest' && (
        <>
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--lf-rule)', fontSize: 13, color: 'var(--lf-ink-soft)', fontFamily: "'Geist', system-ui, sans-serif" }}>
          Runs your exact numbers ({formatMoney(portfolioAtRetirement, true)} portfolio · {formatMoney(monthlySpend * 12, true)}/yr withdrawal) against <strong>real historical market returns</strong> starting every year since 1928. Horizon = {lifeHorizon} yrs.
        </div>
        <div className="ret-backtest-wrap" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: 'var(--lf-cream)' }}>
                {['Start', 'Through', 'Era', 'Worst year', 'Final value', 'Result'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 16px',
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
                    color: 'var(--lf-muted)', textTransform: 'uppercase',
                    letterSpacing: '0.1em', fontWeight: 500, whiteSpace: 'nowrap',
                    borderBottom: '1px solid var(--lf-rule)',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {backtestRows.map((row) => (
                <tr key={row.startYear} style={{
                  borderTop: '1px solid var(--lf-rule)',
                  background: row.survived ? 'transparent' : 'rgba(201,84,58,0.04)',
                }}>
                  <td style={{ padding: '10px 16px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-ink)', fontWeight: 600 }}>
                    {row.startYear}
                  </td>
                  <td style={{ padding: '10px 16px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-muted)', fontSize: 13 }}>
                    {row.endYear}
                  </td>
                  <td style={{ padding: '10px 16px', fontFamily: "'Geist', system-ui, sans-serif", color: 'var(--lf-ink-soft)', whiteSpace: 'nowrap' }}>
                    {row.era}
                  </td>
                  <td style={{ padding: '10px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, whiteSpace: 'nowrap' }}>
                    <span style={{ color: row.worstReturn < -0.2 ? 'var(--lf-sauce)' : row.worstReturn < 0 ? 'var(--lf-cheese)' : 'var(--lf-muted)' }}>
                      {row.worstYear} ({row.worstReturn >= 0 ? '+' : ''}{(row.worstReturn * 100).toFixed(1)}%)
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-ink)' }}>
                    {row.survived
                      ? formatMoney(row.finalValue, true)
                      : <span style={{ color: 'var(--lf-sauce)' }}>depleted {row.depletedYear}</span>
                    }
                  </td>
                  <td style={{ padding: '10px 16px', fontFamily: "'JetBrains Mono', monospace" }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: row.survived ? 'var(--lf-pos)' : 'var(--lf-sauce)', fontSize: 13 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: row.survived ? 'var(--lf-pos)' : 'var(--lf-sauce)', flexShrink: 0 }} />
                      {row.survived ? 'survived' : 'depleted'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
        </>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function Retirement() {
  const [, navigate] = useLocation();
  const { setPageContext } = usePageContext();
  const [loading, setLoading] = useState(true);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [view, setView] = useState<'simple' | 'advanced'>('simple');

  // Data from API
  const [currentAge, setCurrentAge] = useState(30);
  const [annualIncome, setAnnualIncome] = useState(0);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState(5000);
  const [allocation, setAllocation] = useState<Record<string, number>>({});
  const [blendedReturn, setBlendedReturn] = useState<number | null>(null);
  const [riskTolerance, setRiskTolerance] = useState<string | null>(null);
  const [filingStatus, setFilingStatus] = useState<string | null>(null);

  // Interactive controls (shared between plan & simulate views)
  const [retirementAge, setRetirementAge] = useState(65);
  const [monthlyRetirementSpend, setMonthlyRetirementSpend] = useState(5000);
  const [selectedStrategy, setSelectedStrategy] = useState('constant_dollar');

  const [lifeExpectancy, setLifeExpectancy] = useState(90);

  // Draft strings for number inputs so typing isn't interrupted by clamping
  const [retAgeStr, setRetAgeStr] = useState('65');
  const [monthlySpendStr, setMonthlySpendStr] = useState('5000');
  const [lifeExpStr, setLifeExpStr] = useState('90');

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getPortfolioAllocation().catch(() => ({ allocation: null, totalValue: 0 })),
      api.getSpendingSummary().catch(() => ({ totalSpending: 0, totalIncome: 0 })),
      api.getPortfolioExposure().catch(() => null),
    ]).then(([balanceData, profileData, portfolioData, spendingData, exposureData]) => {
      const balances = (balanceData as { balances: Array<{ balance?: string; type?: string }> }).balances;
      setHasAccounts(balances.length > 0);

      let assets = 0; let liabilities = 0;
      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type === 'credit' || b.type === 'loan') liabilities += val;
        else assets += val;
      }
      const netWorth = assets - liabilities;
      if (netWorth > 0) setPortfolioValue(netWorth);

      const profile = (profileData as { financialProfile: Record<string, unknown> | null }).financialProfile;
      if (profile) {
        if (profile.age) setCurrentAge(profile.age as number);
        if (profile.annualIncome) setAnnualIncome(profile.annualIncome as number);
        if (profile.retirementAge) setRetirementAge(profile.retirementAge as number);
        if (profile.riskTolerance) setRiskTolerance(profile.riskTolerance as string);
        if (profile.filingStatus) setFilingStatus(profile.filingStatus as string);
      }

      const pd = portfolioData as { allocation: Record<string, number> | null; totalValue: number };
      if (pd.allocation) setAllocation(pd.allocation);

      if (exposureData) {
        const ed = exposureData as { blendedReturn: number };
        if (ed.blendedReturn) setBlendedReturn(ed.blendedReturn);
      }

      const sd = spendingData as { totalSpending: number; totalIncome: number };
      if (sd.totalSpending > 0) {
        const m = Math.round(sd.totalSpending);
        if (m > 0) { setMonthlyExpenses(m); setMonthlyRetirementSpend(m); }
      }
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { setRetAgeStr(String(retirementAge)); }, [retirementAge]);
  useEffect(() => { setMonthlySpendStr(String(monthlyRetirementSpend)); }, [monthlyRetirementSpend]);
  useEffect(() => { setLifeExpStr(String(lifeExpectancy)); }, [lifeExpectancy]);

  useEffect(() => {
    if (!loading && hasAccounts) {
      setPageContext({
        pageId: 'retirement',
        pageTitle: 'Retirement Planning',
        description: 'Retirement readiness overview with projections and modeling.',
        data: { currentAge, retirementAge, portfolioValue, monthlyRetirementSpend, annualIncome, filingStatus, riskTolerance },
      });
    }
  }, [loading, hasAccounts, currentAge, retirementAge, portfolioValue, monthlyRetirementSpend, annualIncome, filingStatus, riskTolerance, setPageContext]);

  // ── Computed values ──────────────────────────────────────────────────────
  const yearsUntilRetirement = Math.max(0, retirementAge - currentAge);
  // Prefer the server-computed blended return (category-level granularity) over the
  // local coarse estimate. Falls back to local computation if exposure API is unavailable.
  const expectedReturn = blendedReturn ?? (Object.keys(allocation).length > 0 ? getExpectedReturn(allocation) : 7.0);
  const annualExpenses = monthlyRetirementSpend * 12;
  const fireNumber = annualExpenses * 25;
  const estimatedTaxRate = 0.25;
  const afterTaxIncome = annualIncome * (1 - estimatedTaxRate);
  const annualSavings = Math.max(0, afterTaxIncome - monthlyExpenses * 12);
  const rate = expectedReturn / 100;
  let portfolioAtRetirement = portfolioValue;
  for (let i = 0; i < yearsUntilRetirement; i++) {
    portfolioAtRetirement = portfolioAtRetirement * (1 + rate) + annualSavings;
  }
  const conservativeRate = rate * 0.6;
  const lifeHorizon = Math.max(1, lifeExpectancy - retirementAge);
  let yearsMoneyLasts = 0; let tempValue = portfolioAtRetirement;
  while (tempValue > 0 && yearsMoneyLasts < lifeHorizon) {
    tempValue = tempValue * (1 + conservativeRate) - annualExpenses;
    if (tempValue > 0) yearsMoneyLasts++;
    else break;
  }
  const monthlyRetirementIncome = Math.round((portfolioAtRetirement * 0.04) / 12);
  const readiness = fireNumber > 0 ? Math.min(100, (portfolioValue / fireNumber) * 100) : 0;
  const readinessLabel =
    readiness >= 80 ? "You're on track!" :
    readiness >= 50 ? 'Getting there — keep saving.' :
    'More savings needed.';
  const projectionData = buildProjectionData(currentAge, retirementAge, portfolioValue, annualSavings, expectedReturn);
  const strategies = [
    { id: 'constant_dollar', label: 'Constant Dollar' },
    { id: 'percent_portfolio', label: '% of Portfolio' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'rules_based', label: 'Rules-Based' },
  ];

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--lf-paper)' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-muted)' }}>
          Loading your financial data...
        </div>
      </div>
    );
  }

  if (!hasAccounts) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--lf-paper)', padding: '24px 28px 48px' }} className="scrollbar-thin">
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Card style={{ padding: '48px 40px', textAlign: 'center', maxWidth: 480 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>&#127968;</div>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 26, color: 'var(--lf-ink)', marginBottom: 12, fontWeight: 400 }}>
              No Accounts Linked
            </h2>
            <p style={{ fontFamily: "'Geist', system-ui, sans-serif", color: 'var(--lf-muted)', marginBottom: 28, lineHeight: 1.6 }}>
              Connect your bank and investment accounts to see your retirement projections based on real data.
            </p>
            <button onClick={() => navigate('/accounts')} style={{ background: 'var(--lf-sauce)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontFamily: "'Geist', system-ui, sans-serif", fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              + Link Your First Account
            </button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--lf-paper)' }} className="scrollbar-thin">
      <style>{`
        @media (max-width: 640px) {
          .ret-hero-grid { grid-template-columns: 1fr !important; }
          .ret-3col { grid-template-columns: 1fr !important; }
          .ret-readiness-grid { grid-template-columns: 1fr !important; }
          .ret-simulate-strip { grid-template-columns: 1fr !important; }
          .ret-5col { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)) !important; }
          .ret-withdrawal-grid { grid-template-columns: 1fr !important; }
          .ret-simulate-hero { grid-template-columns: 1fr !important; gap: 16px !important; }
          .ret-sliders-grid { grid-template-columns: 1fr !important; }
          .ret-backtest-wrap { overflow-x: auto; }
          .ret-hero-big { font-size: 44px !important; }
          .ret-simulate-big { font-size: 56px !important; }
        }
      `}</style>
      <div style={{ padding: 'clamp(16px, 4vw, 40px)', paddingBottom: 'clamp(80px, 12vw, 48px)', maxWidth: 1100, margin: '0 auto', width: '100%', boxSizing: 'border-box' as const }}>

        {/* Page header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, fontWeight: 400, color: 'var(--lf-ink)', margin: 0, lineHeight: 1.1 }}>
            Retirement
          </h1>
          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--lf-muted)', marginTop: 6, marginBottom: 0 }}>
            retire at {retirementAge} · {Math.max(0, retirementAge - currentAge)} years away
          </p>
        </div>

        {/* Shared dark hero card */}
        <div style={{
          background: 'var(--lf-ink)', border: '1px solid var(--lf-ink)',
          borderRadius: 14, padding: 32, marginBottom: 20,
        }}>
          <div className="ret-hero-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 24, alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>
                Projected at retirement · age {retirementAge}
              </div>
              <div className="ret-hero-big" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 64, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lf-paper)' }}>
                {formatMoney(portfolioAtRetirement, true)}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-cheese)', marginTop: 10 }}>
                {yearsUntilRetirement} years to go · {expectedReturn.toFixed(1)}% blended return
              </div>
            </div>
            {[
              { label: 'FIRE number', value: formatMoney(fireNumber, true), sub: '25× annual spend' },
              { label: 'Years money lasts', value: yearsMoneyLasts >= lifeHorizon ? 'lifetime' : `${yearsMoneyLasts}`, sub: `through age ${yearsMoneyLasts >= lifeHorizon ? lifeExpectancy : retirementAge + yearsMoneyLasts}` },
              { label: 'Readiness', value: `${readiness.toFixed(0)}%`, sub: 'of FIRE number', color: readiness >= 80 ? '#9FD18E' : readiness >= 50 ? 'var(--lf-cheese)' : '#E89070' },
            ].map(({ label, value, sub, color }) => (
              <div key={label}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>
                  {label}
                </div>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, letterSpacing: '-0.02em', color: color || 'var(--lf-paper)' }}>
                  {value}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 6 }}>
                  {sub}
                </div>
              </div>
            ))}
          </div>
        </div>

        <PageActions types="retirement" />

        {/* Simple | Advanced toggle — lives under hero */}
        <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--lf-cream)', borderRadius: 999, border: '1px solid var(--lf-rule)', width: 'fit-content', marginBottom: 20 }}>
          {(['simple', 'advanced'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '8px 18px', fontSize: 13, cursor: 'pointer',
              fontFamily: "'Geist', system-ui, sans-serif", fontWeight: 500,
              borderRadius: 999, border: 0,
              background: view === v ? 'var(--lf-ink)' : 'transparent',
              color: view === v ? 'var(--lf-paper)' : 'var(--lf-ink-soft)',
              transition: 'background 0.15s, color 0.15s',
            }}>
              {v === 'simple' ? 'Simple' : 'Advanced'}
            </button>
          ))}
        </div>

        {/* ── SIMPLE VIEW ──────────────────────────────────────────────────────── */}
        {view === 'simple' && (
          <>
            {/* Sliders */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, flexWrap: 'wrap' }} className="ret-sliders-grid">
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-ink-soft)', fontWeight: 500 }}>Retirement Age</label>
                    <input
                      type="number" min={currentAge} max={100} value={retAgeStr}
                      onChange={e => {
                        setRetAgeStr(e.target.value);
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= currentAge && v <= 100) setRetirementAge(v);
                      }}
                      onBlur={() => {
                        const v = parseInt(retAgeStr, 10);
                        const clamped = isNaN(v) ? currentAge : Math.max(currentAge, Math.min(100, v));
                        setRetirementAge(clamped);
                        setRetAgeStr(String(clamped));
                      }}
                      style={{ width: 52, textAlign: 'right', border: '1px solid var(--lf-rule)', borderRadius: 6, padding: '2px 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-sauce)', fontWeight: 600, background: 'transparent' }}
                    />
                  </div>
                  <input type="range" min={currentAge} max={100} step={1} value={retirementAge}
                    onChange={e => setRetirementAge(+e.target.value)}
                    style={{ width: '100%', accentColor: 'var(--lf-sauce)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)', marginTop: 4 }}>
                    <span>{currentAge}</span><span>100</span>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-ink-soft)', fontWeight: 500 }}>Life Expectancy</label>
                    <input
                      type="number" min={retirementAge + 1} max={120} value={lifeExpStr}
                      onChange={e => {
                        setLifeExpStr(e.target.value);
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v > retirementAge && v <= 120) setLifeExpectancy(v);
                      }}
                      onBlur={() => {
                        const v = parseInt(lifeExpStr, 10);
                        const clamped = isNaN(v) ? retirementAge + 1 : Math.max(retirementAge + 1, Math.min(120, v));
                        setLifeExpectancy(clamped);
                        setLifeExpStr(String(clamped));
                      }}
                      style={{ width: 52, textAlign: 'right', border: '1px solid var(--lf-rule)', borderRadius: 6, padding: '2px 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-sauce)', fontWeight: 600, background: 'transparent' }}
                    />
                  </div>
                  <input type="range" min={retirementAge + 1} max={120} step={1} value={lifeExpectancy}
                    onChange={e => setLifeExpectancy(+e.target.value)}
                    style={{ width: '100%', accentColor: 'var(--lf-sauce)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)', marginTop: 4 }}>
                    <span>{retirementAge + 1}</span><span>120</span>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-ink-soft)', fontWeight: 500 }}>Monthly Spending</label>
                    <input
                      type="number" min={500} max={50000} step={500} value={monthlySpendStr}
                      onChange={e => {
                        setMonthlySpendStr(e.target.value);
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 500 && v <= 50000) setMonthlyRetirementSpend(v);
                      }}
                      onBlur={() => {
                        const v = parseInt(monthlySpendStr, 10);
                        const clamped = isNaN(v) ? 500 : Math.max(500, Math.min(50000, v));
                        setMonthlyRetirementSpend(clamped);
                        setMonthlySpendStr(String(clamped));
                      }}
                      style={{ width: 80, textAlign: 'right', border: '1px solid var(--lf-rule)', borderRadius: 6, padding: '2px 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-sauce)', fontWeight: 600, background: 'transparent' }}
                    />
                  </div>
                  <input type="range" min={2000} max={20000} step={500} value={monthlyRetirementSpend}
                    onChange={e => setMonthlyRetirementSpend(+e.target.value)}
                    style={{ width: '100%', accentColor: 'var(--lf-sauce)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)', marginTop: 4 }}>
                    <span>$2k</span><span>$20k</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* KPI cards + readiness ring */}
            <div className="ret-3col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              <Card>
                <Eyebrow>Projected Portfolio</Eyebrow>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color: 'var(--lf-pos)', lineHeight: 1 }}>
                  {formatMoney(portfolioAtRetirement, true)}
                </div>
                <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-muted)', marginTop: 6 }}>At age {retirementAge}</div>
              </Card>
              <Card>
                <Eyebrow>Monthly Income</Eyebrow>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color: 'var(--lf-ink)', lineHeight: 1 }}>
                  {formatMoney(monthlyRetirementIncome)}
                </div>
                <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-muted)', marginTop: 6 }}>Sustainable (4% rule)</div>
                <div style={{ height: 4, background: 'var(--lf-rule)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (monthlyRetirementIncome / Math.max(monthlyRetirementSpend, 1)) * 100)}%`, background: monthlyRetirementIncome >= monthlyRetirementSpend ? 'var(--lf-basil)' : 'var(--lf-sauce)', borderRadius: 2, transition: 'width 0.6s ease' }} />
                </div>
              </Card>
              <Card>
                <Eyebrow>Money Lasts</Eyebrow>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color: yearsMoneyLasts >= lifeHorizon ? 'var(--lf-basil)' : yearsMoneyLasts >= 20 ? 'var(--lf-cheese)' : 'var(--lf-sauce)', lineHeight: 1 }}>
                  {yearsMoneyLasts >= lifeHorizon ? `${lifeHorizon}+` : `${yearsMoneyLasts} yrs`}
                </div>
                <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-muted)', marginTop: 6 }}>
                  {yearsMoneyLasts >= lifeHorizon ? `through age ${lifeExpectancy}+` : `Until age ${retirementAge + yearsMoneyLasts}`}
                </div>
              </Card>
              <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <ReadinessRing pct={readiness} />
                <p style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-muted)', textAlign: 'center', lineHeight: 1.4, margin: 0 }}>
                  {readinessLabel}
                </p>
              </Card>
            </div>

            {/* Projection chart */}
            <Card style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 20px 12px' }}>
                <div>
                  <Eyebrow>Portfolio Projection</Eyebrow>
                  <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-muted)' }}>
                    At {expectedReturn.toFixed(1)}% avg return · {annualSavings > 0 ? `${formatMoney(annualSavings, true)}/yr contributions` : 'no contributions estimated'}
                  </div>
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', textAlign: 'right' }}>
                  Age {currentAge} → {Math.max(retirementAge + 20, 90)}
                </div>
              </div>
              <ProjectionLine data={projectionData} />
            </Card>
          </>
        )}

        {/* ── ADVANCED VIEW ──────────────────────────────────────────────────── */}
        {view === 'advanced' && (
          <SimulateView
            retirementAge={retirementAge}
            setRetirementAge={setRetirementAge}
            monthlySpend={monthlyRetirementSpend}
            setMonthlySpend={setMonthlyRetirementSpend}
            portfolioValue={portfolioValue}
            currentAge={currentAge}
            annualSavings={annualSavings}
            portfolioAtRetirement={portfolioAtRetirement}
            portfolioAllocation={allocation}
            actualBlendedReturn={blendedReturn}
          />
        )}

      </div>
    </div>
  );
}
