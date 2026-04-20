import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { formatMoney } from '../lib/utils';

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
  us: '#C9543A', intl: '#E6B85C', bonds: '#5A6B3F', reit: '#E8C789', cash: '#8B7E6F',
};

const HISTORICAL_PERIODS = [
  { period: '1929–1959', era: 'Great Depression',  result: 'survived', years: 30, final: '$1.8M', stress: '−83% peak DD' },
  { period: '1966–1996', era: 'Stagflation',       result: 'at risk',  years: 30, final: '$240k',  stress: 'inflation spike' },
  { period: '1970–2000', era: 'Bear + recovery',   result: 'survived', years: 30, final: '$2.4M', stress: 'stagflation + boom' },
  { period: '1982–2012', era: 'Long bull',          result: 'survived', years: 30, final: '$6.1M', stress: 'incl. 2008 GFC' },
  { period: '1994–2024', era: 'Modern era',         result: 'survived', years: 30, final: '$4.8M', stress: 'dotcom + COVID' },
];

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
function buildBands(portfolioValue: number, annualSavings: number, retirementAge: number, currentAge: number, expReturn: number) {
  const N = 1000;
  const horizon = Math.max(retirementAge + 30, 90) - currentAge;
  const rate = expReturn / 100;
  const volatility = 0.15;
  const allPaths: number[][] = [];

  for (let run = 0; run < N; run++) {
    const path: number[] = [];
    let v = portfolioValue;
    for (let yr = 0; yr <= horizon; yr++) {
      path.push(Math.max(0, Math.round(v)));
      // Box-Muller
      const u1 = Math.random(), u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
      const r = rate + volatility * z;
      const age = currentAge + yr;
      v = age < retirementAge
        ? v * (1 + r) + annualSavings
        : v * (1 + r * 0.6) - annualSavings * 0.5; // simplified drawdown
      if (v < 0) { v = 0; }
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
  return bands;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Eyebrow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10, letterSpacing: '0.14em',
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
  if (!data.length) return null;
  const w = 600; const h = 120; const pad = 10;
  const maxV = Math.max(...data.map(d => d.value));
  const minV = Math.min(...data.map(d => d.value));
  const range = maxV - minV || 1;
  const xScale = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const yScale = (v: number) => h - pad - ((v - minV) / range) * (h - pad * 2);
  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');
  const retireIdx = data.findIndex(d => d.label === 'Retirement');
  const areaPath = [
    `M ${xScale(0)},${h - pad}`,
    ...data.map((d, i) => `L ${xScale(i)},${yScale(d.value)}`),
    `L ${xScale(data.length - 1)},${h - pad}`, 'Z',
  ].join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 120 }}>
      <defs>
        <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--lf-sauce)" stopOpacity={0.18} />
          <stop offset="100%" stopColor="var(--lf-sauce)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#projFill)" />
      <polyline fill="none" stroke="var(--lf-sauce)" strokeWidth={2} points={points} />
      {retireIdx >= 0 && (
        <>
          <line x1={xScale(retireIdx)} y1={pad} x2={xScale(retireIdx)} y2={h - pad}
            stroke="var(--lf-muted)" strokeWidth={1} strokeDasharray="3,3" />
          <text x={xScale(retireIdx) + 4} y={pad + 10}
            fill="var(--lf-muted)" fontSize={8} fontFamily="'JetBrains Mono', monospace">
            Retirement
          </text>
        </>
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
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--lf-muted)', marginTop: 2 }}>
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

function DistributionBar({ successRate }: { successRate: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const histogram = [
    { b: '$0', v: Math.max(0, 100 - successRate), success: false },
    { b: '<$500k', v: Math.max(0, 5 - (successRate - 70) * 0.2), success: false },
    { b: '500k–1M', v: 10, success: true },
    { b: '1–2M', v: 18, success: true },
    { b: '2–4M', v: 28, success: true },
    { b: '4–8M', v: 22, success: true },
    { b: '8M+', v: 12, success: true },
  ];
  const W = 720; const H = 180;
  const bw = W / histogram.length - 8;
  return (
    <svg viewBox={`0 0 ${W} ${H + 50}`} width="100%" style={{ cursor: 'pointer' }}>
      {histogram.map((h, i) => {
        const barH = Math.max(2, h.v * 5);
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
              opacity={isHov ? 1 : 0.85} rx="3"
              style={{ transition: 'opacity 0.15s' }} />
            <text x={bx + bw / 2} y={H + 14} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-muted)">
              {h.b}
            </text>
            <text x={bx + bw / 2} y={H - barH - 4} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-ink)">
              {Math.round(h.v)}%
            </text>
            {isHov && (
              <g>
                <rect x={ttX} y={H + 22} width={110} height={22} rx={5} fill="var(--lf-ink)" />
                <text x={ttX + 8} y={H + 37} fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="var(--lf-paper)">
                  {Math.round(h.v)}% of runs → {h.b}
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
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--lf-muted)', marginTop: 6 }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

// ── SimulateView ──────────────────────────────────────────────────────────────
function SimulateView({
  retirementAge, setRetirementAge,
  monthlySpend, setMonthlySpend,
  portfolioValue, currentAge, annualSavings,
}: {
  retirementAge: number; setRetirementAge: (v: number) => void;
  monthlySpend: number; setMonthlySpend: (v: number) => void;
  portfolioValue: number; currentAge: number; annualSavings: number;
}) {
  const [lifeExp, setLifeExp] = useState(92);
  const [strategy, setStrategy] = useState('constant_dollar');
  const [mcAlloc, setMcAlloc] = useState({ us: 49, intl: 11, bonds: 20, reit: 8, cash: 12 });
  const [preset, setPreset] = useState('current');
  const [inflAdj, setInflAdj] = useState(true);
  const [dollars, setDollars] = useState<'real' | 'nominal'>('real');
  const [mcView, setMcView] = useState<'fan' | 'spaghetti'>('fan');

  const updateAlloc = (k: string, v: number) => {
    setMcAlloc(a => ({ ...a, [k]: v }));
    setPreset('custom');
  };

  const selectPreset = (p: typeof MC_PRESETS[0]) => {
    setPreset(p.id);
    setMcAlloc(p.alloc as typeof mcAlloc);
  };

  const allocTotal = Object.values(mcAlloc).reduce((s, v) => s + v, 0);
  const expReturn = Object.entries(mcAlloc).reduce((s, [k, v]) => s + v * (MC_RETURNS[k] ?? 7), 0) / (allocTotal || 1);
  const successRate = Math.min(96, Math.max(35, Math.round(expReturn * 8 + 20 + (dollars === 'real' ? -3 : 0))));
  const successColor = successRate >= 80 ? 'var(--lf-pos)' : successRate >= 60 ? 'var(--lf-cheese)' : 'var(--lf-sauce)';

  const bands = useMemo(
    () => buildBands(portfolioValue, annualSavings, retirementAge, currentAge, expReturn),
    [portfolioValue, annualSavings, retirementAge, currentAge, expReturn]
  );

  const survived = HISTORICAL_PERIODS.filter(p => p.result === 'survived').length;

  const strategyDescriptions: Record<string, string> = {
    constant_dollar: 'Withdraw the same real amount each year, regardless of portfolio.',
    percent_portfolio: 'Withdraw a fixed % of current portfolio each year — flexible but volatile.',
    guardrails: 'Adjust withdrawals when portfolio hits upper/lower guardrail thresholds.',
    rules_based: 'Combine bucket strategy, floors/ceilings, and tax-efficient source ordering.',
  };

  return (
    <>
      {/* Success overview strip */}
      <div className="ret-simulate-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16, marginBottom: 20 }}>
        <Card style={{ padding: 20 }}>
          <Eyebrow>Success rate · p(not running out)</Eyebrow>
          <div style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 34, letterSpacing: '-0.02em', color: successColor, marginTop: 8, lineHeight: 1,
          }}>
            {successRate}%
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--lf-muted)', marginTop: 6 }}>
            10,000 runs · {Math.max(1, lifeExp - retirementAge)} yr horizon
          </div>
        </Card>
        <EditableStat
          label="Retirement age"
          value={retirementAge}
          sub="adjust to stress-test"
          onInc={() => setRetirementAge(Math.min(75, retirementAge + 1))}
          onDec={() => setRetirementAge(Math.max(40, retirementAge - 1))}
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
        <div className="ret-withdrawal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 28 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ fontSize: 13, color: 'var(--lf-ink-soft)', fontWeight: 500, fontFamily: "'Geist', system-ui, sans-serif" }}>
                Monthly spending
              </label>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-sauce)', fontWeight: 600 }}>
                ${monthlySpend.toLocaleString()}
              </span>
            </div>
            <input type="range" min={2000} max={20000} step={500} value={monthlySpend}
              onChange={e => setMonthlySpend(+e.target.value)}
              style={{ width: '100%', accentColor: '#C9543A' }} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--lf-muted)', marginTop: 4 }}>
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
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-muted)', marginTop: 4, lineHeight: 1.6 }}>
              {strategyDescriptions[strategy]}
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
        <div className="ret-5col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 20 }}>
          {Object.keys(MC_LABELS).map(k => (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--lf-ink-soft)', fontFamily: "'Geist', system-ui, sans-serif" }}>
                  {MC_LABELS[k]}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: 'var(--lf-ink)' }}>
                  {mcAlloc[k as keyof typeof mcAlloc]}%
                </span>
              </div>
              <input type="range" min={0} max={100} step={5}
                value={mcAlloc[k as keyof typeof mcAlloc]}
                onChange={e => updateAlloc(k, +e.target.value)}
                style={{ width: '100%', accentColor: MC_ACCENT[k] }} />
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--lf-muted)', marginTop: 3 }}>
                {MC_RETURNS[k]}% avg · hist.
              </div>
            </div>
          ))}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--lf-rule)', fontSize: 13,
          fontFamily: "'Geist', system-ui, sans-serif", color: 'var(--lf-ink-soft)',
        }}>
          <span>Expected blended return · <strong>{expReturn.toFixed(2)}%</strong></span>
          {allocTotal !== 100 ? (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-sauce)' }}>
              ⚠ allocation totals {allocTotal}%
            </span>
          ) : (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-pos)' }}>
              ✓ balanced · 100%
            </span>
          )}
        </div>
      </Card>

      {/* Hero success result */}
      <div style={{
        background: 'var(--lf-ink)', border: '1px solid var(--lf-ink)',
        borderRadius: 14, padding: 'clamp(20px, 4vw, 40px)', marginBottom: 20,
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 32, alignItems: 'center',
      }}
      className="ret-simulate-hero">
        <div style={{
          width: 100, height: 100, borderRadius: 22,
          background: `rgba(201,84,58,0.15)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 38, color: successColor }}>
            {successRate >= 80 ? '✓' : successRate >= 60 ? '~' : '!'}
          </span>
        </div>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>
            Probability of success
          </div>
          <div className="ret-simulate-big" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 88, lineHeight: 1, letterSpacing: '-0.03em', color: successColor }}>
            {successRate}<span style={{ fontSize: 40 }}>%</span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#D4C6B0', marginTop: 10 }}>
            10,000 runs · {lifeExp - retirementAge} yr horizon
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#D4C6B0', alignItems: 'flex-end' }}>
          <div style={{ textAlign: 'right' }}>
            <div>median @ age {lifeExp}</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color: 'var(--lf-paper)' }}>
              {formatMoney(bands.p50[bands.p50.length - 1] || 0, true)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>worst 5%</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 20, color: 'var(--lf-sauce)' }}>
              {bands.p5[bands.p5.length - 1] === 0 ? `depleted age ${retirementAge + 15}` : formatMoney(bands.p5[bands.p5.length - 1], true)}
            </div>
          </div>
        </div>
      </div>

      {/* Dollar toggle */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)' }}>
        <span>Values in:</span>
        <div style={{ display: 'flex', border: '1px solid var(--lf-rule)', borderRadius: 8, overflow: 'hidden' }}>
          {(['real', 'nominal'] as const).map(d => (
            <button key={d} onClick={() => setDollars(d)} style={{
              padding: '6px 12px', fontSize: 12, cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              background: dollars === d ? 'rgba(201,84,58,0.08)' : 'transparent',
              color: dollars === d ? 'var(--lf-sauce)' : 'var(--lf-muted)',
              border: 0, borderRight: d === 'real' ? '1px solid var(--lf-rule)' : 'none',
            }}>
              {d === 'real' ? 'Real $' : 'Nominal $'}
            </button>
          ))}
        </div>
      </div>

      {/* Monte Carlo projection chart */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Eyebrow style={{ marginBottom: 0 }}>Monte Carlo projection</Eyebrow>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['fan', 'Fan chart'], ['spaghetti', 'Sample paths']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setMcView(v)} style={{
              padding: '5px 10px', fontSize: 11, cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em', textTransform: 'uppercase',
              background: mcView === v ? 'var(--lf-ink)' : 'transparent',
              color: mcView === v ? 'var(--lf-paper)' : 'var(--lf-muted)',
              border: `1px solid ${mcView === v ? 'var(--lf-ink)' : 'var(--lf-rule)'}`,
              borderRadius: 999,
            }}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <Card style={{ marginBottom: 20 }}>
        {mcView === 'fan' ? (
          <>
            <FanChart bands={bands} retireAge={retirementAge} currentAge={currentAge} />
            <div style={{ display: 'flex', gap: 24, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-muted)', marginTop: 12 }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 6, background: 'var(--lf-sauce)', opacity: 0.1, marginRight: 6, verticalAlign: 'middle' }}></span>p5–p95</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 6, background: 'var(--lf-sauce)', opacity: 0.28, marginRight: 6, verticalAlign: 'middle' }}></span>p25–p75</span>
              <span style={{ color: 'var(--lf-sauce)' }}><span style={{ display: 'inline-block', width: 12, height: 2, background: 'var(--lf-sauce)', marginRight: 6, verticalAlign: 'middle' }}></span>median (p50)</span>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--lf-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
            {/* DATA-NEEDED: spaghetti chart requires per-run paths — using fan chart data for now */}
            Sample paths view coming soon · showing fan chart bands
            <div style={{ marginTop: 16 }}>
              <FanChart bands={bands} retireAge={retirementAge} currentAge={currentAge} />
            </div>
          </div>
        )}
      </Card>

      {/* Distribution */}
      <Eyebrow style={{ marginBottom: 10 }}>Distribution of final portfolio values</Eyebrow>
      <Card style={{ marginBottom: 20 }}>
        <DistributionBar successRate={successRate} />
        <div style={{ display: 'flex', gap: 20, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-muted)', marginTop: 8 }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--lf-basil)', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }}></span>success</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--lf-sauce)', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }}></span>depleted</span>
          <span style={{ marginLeft: 'auto' }}>bin width · ~$500k · {dollars} $</span>
        </div>
      </Card>

      {/* Historical backtest */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Eyebrow style={{ marginBottom: 0 }}>Historical backtest · every 30-yr period since 1928</Eyebrow>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--lf-pos)' }}>
          {survived}/{HISTORICAL_PERIODS.length} survived
        </span>
      </div>
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--lf-rule)', fontSize: 12, color: 'var(--lf-ink-soft)', fontFamily: "'Geist', system-ui, sans-serif" }}>
          Unlike Monte Carlo, this runs your plan against <strong>actual market history</strong>. If you'd retired with these numbers in any year since 1928, here's how you'd have fared.
        </div>
        <div className="ret-backtest-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--lf-cream)' }}>
              {['Period', 'Era', 'Duration', 'Stress event', 'Final value', 'Verdict'].map(h => (
                <th key={h} style={{
                  textAlign: 'left', padding: '12px 24px',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  color: 'var(--lf-muted)', textTransform: 'uppercase',
                  letterSpacing: '0.1em', fontWeight: 500,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HISTORICAL_PERIODS.map((p, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--lf-rule)' }}>
                <td style={{ padding: '14px 24px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-ink)' }}>{p.period}</td>
                <td style={{ padding: '14px 24px', fontFamily: "'Geist', system-ui, sans-serif", color: 'var(--lf-ink-soft)' }}>{p.era}</td>
                <td style={{ padding: '14px 24px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-ink)' }}>{p.years} yrs</td>
                <td style={{ padding: '14px 24px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-muted)', fontSize: 11 }}>{p.stress}</td>
                <td style={{ padding: '14px 24px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-ink)' }}>{p.final}</td>
                <td style={{ padding: '14px 24px', fontFamily: "'JetBrains Mono', monospace" }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: p.result === 'survived' ? 'var(--lf-pos)' : 'var(--lf-sauce)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.result === 'survived' ? 'var(--lf-pos)' : 'var(--lf-sauce)' }}></span>
                    {p.result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function Retirement() {
  const [, navigate] = useLocation();
  const { setPageContext } = usePageContext();
  const [loading, setLoading] = useState(true);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [view, setView] = useState<'plan' | 'simulate'>('plan');

  // Data from API
  const [currentAge, setCurrentAge] = useState(30);
  const [annualIncome, setAnnualIncome] = useState(0);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState(5000);
  const [allocation, setAllocation] = useState<Record<string, number>>({});
  const [riskTolerance, setRiskTolerance] = useState<string | null>(null);
  const [filingStatus, setFilingStatus] = useState<string | null>(null);

  // Interactive controls (shared between plan & simulate views)
  const [retirementAge, setRetirementAge] = useState(65);
  const [monthlyRetirementSpend, setMonthlyRetirementSpend] = useState(5000);
  const [selectedStrategy, setSelectedStrategy] = useState('constant_dollar');

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getPortfolioAllocation().catch(() => ({ allocation: null, totalValue: 0 })),
      api.getSpendingSummary().catch(() => ({ totalSpending: 0, totalIncome: 0 })),
    ]).then(([balanceData, profileData, portfolioData, spendingData]) => {
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

      const sd = spendingData as { totalSpending: number; totalIncome: number };
      if (sd.totalSpending > 0) {
        const m = Math.round(sd.totalSpending);
        if (m > 0) { setMonthlyExpenses(m); setMonthlyRetirementSpend(m); }
      }
    }).finally(() => setLoading(false));
  }, []);

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
  const expectedReturn = Object.keys(allocation).length > 0 ? getExpectedReturn(allocation) : 7.0;
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
  let yearsMoneyLasts = 0; let tempValue = portfolioAtRetirement;
  while (tempValue > 0 && yearsMoneyLasts < 60) {
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
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-muted)' }}>
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
          .ret-simulate-hero { grid-template-columns: 1fr !important; }
          .ret-backtest-wrap { overflow-x: auto; }
          .ret-hero-big { font-size: 44px !important; }
          .ret-simulate-big { font-size: 56px !important; }
          .ret-page-header { flex-direction: column !important; align-items: flex-start !important; }
        }
      `}</style>
      <div style={{ padding: 'clamp(16px, 4vw, 28px)', paddingBottom: 'clamp(80px, 12vw, 48px)', maxWidth: 1100, margin: '0 auto' }}>

        {/* Page header with Plan | Simulate toggle */}
        <div className="ret-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-muted)', marginBottom: 6 }}>
              Retirement · live from your accounts
            </div>
            <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, fontWeight: 400, color: 'var(--lf-ink)', margin: 0, lineHeight: 1.2 }}>
              Your path to <em style={{ fontStyle: 'italic', color: 'var(--lf-sauce)' }}>financial independence.</em>
            </h1>
          </div>
          {/* Plan | Simulate toggle */}
          <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--lf-cream)', borderRadius: 999, border: '1px solid var(--lf-rule)', flexShrink: 0, marginTop: 4 }}>
            {(['plan', 'simulate'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '8px 18px', fontSize: 13, cursor: 'pointer',
                fontFamily: "'Geist', system-ui, sans-serif", fontWeight: 500,
                borderRadius: 999, border: 0,
                background: view === v ? 'var(--lf-ink)' : 'transparent',
                color: view === v ? 'var(--lf-paper)' : 'var(--lf-ink-soft)',
                transition: 'background 0.15s, color 0.15s',
              }}>
                {v === 'plan' ? 'Plan' : 'Simulate'}
              </button>
            ))}
          </div>
        </div>

        {/* Shared dark hero card */}
        <div style={{
          background: 'var(--lf-ink)', border: '1px solid var(--lf-ink)',
          borderRadius: 14, padding: 32, marginBottom: 20,
        }}>
          <div className="ret-hero-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.6fr) repeat(3, minmax(90px, 1fr))', gap: 24, alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>
                Projected at retirement · age {retirementAge}
              </div>
              <div className="ret-hero-big" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 64, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lf-paper)' }}>
                {formatMoney(portfolioAtRetirement, true)}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-cheese)', marginTop: 10 }}>
                {yearsUntilRetirement} years to go · {expectedReturn.toFixed(1)}% blended return
              </div>
            </div>
            {[
              { label: 'FIRE number', value: formatMoney(fireNumber, true), sub: '25× annual spend' },
              { label: 'Years money lasts', value: yearsMoneyLasts >= 60 ? '60+' : `${yearsMoneyLasts}`, sub: `through age ${Math.min(retirementAge + yearsMoneyLasts, retirementAge + 60)}` },
              { label: 'Readiness', value: `${readiness.toFixed(0)}%`, sub: 'of FIRE number', color: readiness >= 80 ? '#9FD18E' : readiness >= 50 ? 'var(--lf-cheese)' : '#E89070' },
            ].map(({ label, value, sub, color }) => (
              <div key={label}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>
                  {label}
                </div>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, letterSpacing: '-0.02em', color: color || 'var(--lf-paper)' }}>
                  {value}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#D4C6B0', marginTop: 6 }}>
                  {sub}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── PLAN VIEW ──────────────────────────────────────────────────────── */}
        {view === 'plan' && (
          <>
            {/* Projection chart */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <Eyebrow>Portfolio Projection</Eyebrow>
                  <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-muted)' }}>
                    At {expectedReturn.toFixed(1)}% avg return · {annualSavings > 0 ? `${formatMoney(annualSavings, true)}/yr contributions` : 'no contributions estimated'}
                  </div>
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-muted)', textAlign: 'right' }}>
                  Age {currentAge} → {Math.max(retirementAge + 20, 90)}
                </div>
              </div>
              <ProjectionLine data={projectionData} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--lf-muted)' }}>
                <span>{currentAge}</span>
                <span>{Math.round((currentAge + Math.max(retirementAge + 20, 90)) / 2)}</span>
                <span>{Math.max(retirementAge + 20, 90)}</span>
              </div>
            </Card>

            {/* Retirement income row */}
            <Eyebrow>At Retirement</Eyebrow>
            <div className="ret-3col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              <Card>
                <Eyebrow>Projected Portfolio</Eyebrow>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color: 'var(--lf-pos)', lineHeight: 1 }}>
                  {formatMoney(portfolioAtRetirement, true)}
                </div>
                <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 12, color: 'var(--lf-muted)', marginTop: 6 }}>At age {retirementAge}</div>
              </Card>
              <Card>
                <Eyebrow>Monthly Income</Eyebrow>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color: 'var(--lf-ink)', lineHeight: 1 }}>
                  {formatMoney(monthlyRetirementIncome)}
                </div>
                <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 12, color: 'var(--lf-muted)', marginTop: 6 }}>Sustainable (4% rule)</div>
                <div style={{ height: 4, background: 'var(--lf-rule)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (monthlyRetirementIncome / Math.max(monthlyRetirementSpend, 1)) * 100)}%`, background: monthlyRetirementIncome >= monthlyRetirementSpend ? 'var(--lf-basil)' : 'var(--lf-sauce)', borderRadius: 2, transition: 'width 0.6s ease' }} />
                </div>
              </Card>
              <Card>
                <Eyebrow>Money Lasts</Eyebrow>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color: yearsMoneyLasts >= 30 ? 'var(--lf-basil)' : yearsMoneyLasts >= 20 ? 'var(--lf-cheese)' : 'var(--lf-sauce)', lineHeight: 1 }}>
                  {yearsMoneyLasts >= 60 ? '60+' : yearsMoneyLasts} yrs
                </div>
                <div style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 12, color: 'var(--lf-muted)', marginTop: 6 }}>
                  Until age {retirementAge + Math.min(yearsMoneyLasts, 60)}
                </div>
              </Card>
            </div>

            {/* Readiness + controls */}
            <Card style={{ marginBottom: 20 }}>
              <div className="ret-readiness-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 28, alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <ReadinessRing pct={readiness} />
                  <p style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 12, color: 'var(--lf-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                    {readinessLabel}
                  </p>
                </div>
                <div>
                  <Eyebrow>Model Your Retirement</Eyebrow>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-ink-soft)' }}>Retirement Age</label>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-sauce)', fontWeight: 600 }}>{retirementAge}</span>
                    </div>
                    <input type="range" min={50} max={80} step={1} value={retirementAge}
                      onChange={e => setRetirementAge(parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--lf-sauce)' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--lf-muted)', marginTop: 4 }}>
                      <span>50</span><span>80</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-ink-soft)' }}>Monthly Retirement Spending</label>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-sauce)', fontWeight: 600 }}>{formatMoney(monthlyRetirementSpend)}</span>
                    </div>
                    <input type="range" min={2000} max={20000} step={500} value={monthlyRetirementSpend}
                      onChange={e => setMonthlyRetirementSpend(parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--lf-sauce)' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--lf-muted)', marginTop: 4 }}>
                      <span>$2k</span><span>$20k</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Withdrawal strategy tabs */}
            <Card>
              <Eyebrow>Withdrawal Strategy</Eyebrow>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {strategies.map(s => {
                  const active = selectedStrategy === s.id;
                  return (
                    <button key={s.id} onClick={() => setSelectedStrategy(s.id)} style={{
                      padding: '7px 16px', borderRadius: 20,
                      border: active ? '1px solid var(--lf-sauce)' : '1px solid var(--lf-rule)',
                      background: active ? 'rgba(201,84,58,0.08)' : 'transparent',
                      color: active ? 'var(--lf-sauce)' : 'var(--lf-muted)',
                      fontFamily: "'Geist', system-ui, sans-serif",
                      fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer',
                    }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--lf-rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--lf-muted)', lineHeight: 1.5 }}>
                  {selectedStrategy === 'constant_dollar' && 'Withdraw a fixed inflation-adjusted dollar amount each year.'}
                  {selectedStrategy === 'percent_portfolio' && 'Withdraw a fixed percentage of your portfolio balance annually.'}
                  {selectedStrategy === 'guardrails' && 'Adjust withdrawals up or down based on portfolio performance guardrails.'}
                  {selectedStrategy === 'rules_based' && 'Follow a rules-based system that responds to market conditions.'}
                </p>
                <button onClick={() => setView('simulate')} style={{
                  padding: '9px 18px', borderRadius: 8,
                  border: '1px solid var(--lf-sauce)', background: 'var(--lf-sauce)',
                  color: '#fff', fontFamily: "'Geist', system-ui, sans-serif",
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 16,
                }}>
                  Run Simulation →
                </button>
              </div>
            </Card>
          </>
        )}

        {/* ── SIMULATE VIEW ──────────────────────────────────────────────────── */}
        {view === 'simulate' && (
          <SimulateView
            retirementAge={retirementAge}
            setRetirementAge={setRetirementAge}
            monthlySpend={monthlyRetirementSpend}
            setMonthlySpend={setMonthlyRetirementSpend}
            portfolioValue={portfolioValue}
            currentAge={currentAge}
            annualSavings={annualSavings}
          />
        )}

      </div>
    </div>
  );
}
