import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { cn, formatMoney } from '../lib/utils';
import { Building2 } from 'lucide-react';
import { PageActions } from '../components/common/page-actions';
import { LegalDisclaimer } from '../components/common/legal-disclaimer';
import {
  CPI_INFLATION, BOND_RETURNS, SP500_RETURNS,
  type WithdrawalStrategy, type BacktestYearData, type BacktestRow,
  computeWithdrawal, eraLabel, runBacktest, buildBands,
} from '../lib/retirement-engine';
import { Button, EmptyState, Skeleton } from '../components/uikit';

// ── MC constants ─────────────────────────────────────────────────────────────
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
  us: 'var(--ui-viz-2)',   // periwinkle
  intl: 'var(--ui-viz-5)', // sky
  bonds: 'var(--ui-viz-1)', // teal
  reit: 'var(--ui-viz-3)', // tangerine
  cash: 'var(--ui-viz-7)',  // slate
};


// ── Local helpers (not part of engine) ────────────────────────────────────────
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

// ── Sub-components ────────────────────────────────────────────────────────────
function Eyebrow({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn('text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted', className)}
      style={style}
    >
      {children}
    </div>
  );
}

function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn('rounded-ui-xl border border-line bg-panel shadow-ui-sm', className)}
      style={{ padding: 20, ...style }}
    >
      {children}
    </div>
  );
}

// Local titled section — replaces the ds Section (eyebrow + editorial title).
function Section({ title, eyebrow, children, className }: { title?: React.ReactNode; eyebrow?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('mt-8', className)}>
      {(title || eyebrow) && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          {title && <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">{title}</h2>}
          {eyebrow && <span className="text-[12px] font-semibold text-content-muted ui-tnum">{eyebrow}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

// Local chart-hover overlay — crosshair + curve dot + floating value pill, on
// the Bright --ui palette. Same API as the former ds ChartHover.
function ChartHover({
  width, height, paddingLeft, paddingRight, count,
  getValue, getLabel, getSubline, getCurvePoint, hidePill = false,
}: {
  width: number; height: number; paddingLeft: number; paddingRight: number; count: number;
  getValue: (i: number) => React.ReactNode; getLabel: (i: number) => React.ReactNode;
  getSubline?: (i: number) => React.ReactNode;
  getCurvePoint?: (i: number) => { x: number; y: number } | null;
  hidePill?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const innerW = Math.max(1, width - paddingLeft - paddingRight);
  const pointerToIdx = (clientX: number): number | null => {
    const root = rootRef.current;
    if (!root || count <= 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const localX = (clientX - rect.left) * (width / rect.width);
    const ratio = (localX - paddingLeft) / innerW;
    return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
  };
  const xAt = (i: number) => (count <= 1 ? paddingLeft + innerW / 2 : paddingLeft + (i / (count - 1)) * innerW);
  const hx = hoverIdx !== null ? xAt(hoverIdx) : null;
  const curve = hoverIdx !== null && getCurvePoint ? getCurvePoint(hoverIdx) : null;
  const PILL_W = 140;
  const pillLeftPx = hx !== null ? Math.max(4, Math.min(width - PILL_W - 4, hx - PILL_W / 2)) : 0;
  const pct = (px: number, denom: number) => `${(px / denom) * 100}%`;
  return (
    <div
      ref={rootRef}
      style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
      onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
      onPointerLeave={() => setHoverIdx(null)}
      onPointerCancel={() => setHoverIdx(null)}
    >
      {hx !== null && (
        <>
          <div style={{ position: 'absolute', left: pct(hx, width), top: 0, bottom: 0, width: 1, borderLeft: '1px dashed rgb(var(--ui-content-muted))', opacity: 0.5, transform: 'translateX(-0.5px)', pointerEvents: 'none' }} />
          {curve && (
            <div style={{ position: 'absolute', left: pct(curve.x, width), top: pct(curve.y, height), width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: '50%', background: 'var(--ui-viz-2)', boxShadow: '0 0 0 2px rgb(var(--ui-panel))', pointerEvents: 'none' }} />
          )}
          {!hidePill && (
            <div style={{ position: 'absolute', left: pct(pillLeftPx, width), top: '4px', width: PILL_W, padding: '6px 10px', background: 'rgb(var(--ui-content))', color: 'rgb(var(--ui-panel))', borderRadius: 8, boxShadow: 'var(--ui-shadow-md)', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em' }}>{getValue(hoverIdx!)}</span>
              <span style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.3 }}>{getLabel(hoverIdx!)}</span>
              {getSubline && <span style={{ fontSize: 10, opacity: 0.55, lineHeight: 1.3 }}>{getSubline(hoverIdx!)}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * ProjectionFan — Plan-tab projection, now showing Monte Carlo bands instead
 * of a single deterministic orange line. Reuses the same `buildBands` engine
 * as the advanced Monte Carlo tab, so the Plan view tells the same story:
 *   • outer band  p5–p95  — basil at 8% opacity (range of plausible outcomes)
 *   • inner band  p25–p75 — basil at 18% opacity (likely outcomes)
 *   • median line p50     — ink-soft dashed (reads as guidance, not "the answer")
 *
 * Note: bands are SVG <path> filled regions, NOT 1000 individual paths — we
 * compute once via buildBands (memoized by caller) and just paint quantiles.
 */
function ProjectionFan({
  bands,
  currentAge,
  retirementAge,
}: {
  bands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  currentAge: number;
  retirementAge: number;
}) {
  const n = bands.p50.length;
  if (n === 0) return null;

  const W = 760; const H = 220;
  const PL = 52; const PR = 16; const PT = 14; const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  // Iter 6: log y-axis so the early years (small absolute $) don't flatten
  // the whole curve to a horizontal line. Iter 5's linear scale made the
  // chart hug $0 for ~80% of the x-axis because p95 at age 90 is several
  // orders of magnitude larger than the starting portfolio. With log
  // scaling, the relative shape of all bands is preserved across the span.
  const maxV = Math.max(...bands.p95, 1);
  const startMin = Math.max(1000, Math.min(...bands.p5.filter(v => v > 0), bands.p50[0] || 1000));
  const lnMin = Math.log(Math.max(1000, startMin));
  const lnMax = Math.log(Math.max(maxV, startMin * 10));
  const lnRange = Math.max(1e-6, lnMax - lnMin);
  const xf = (i: number) => PL + (i / (n - 1)) * chartW;
  const yf = (v: number) => {
    const safe = Math.max(1000, v);
    const t = (Math.log(safe) - lnMin) / lnRange;
    return PT + chartH - Math.min(1, Math.max(0, t)) * chartH;
  };

  // Log gridlines: 4 evenly-spaced ticks in log space.
  const yTicks = [0.25, 0.5, 0.75, 1].map(pct => {
    const lnV = lnMin + pct * lnRange;
    const val = Math.exp(lnV);
    return { pct, val, y: yf(val) };
  });
  const retireIdx = Math.max(0, retirementAge - currentAge);
  const fmt = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`;

  // Banded path: upper edge forward, lower edge back, closed.
  const band = (upper: number[], lower: number[]) => {
    let d = `M ${xf(0)},${yf(upper[0])}`;
    for (let i = 1; i < n; i++) d += ` L ${xf(i)},${yf(upper[i])}`;
    for (let i = n - 1; i >= 0; i--) d += ` L ${xf(i)},${yf(lower[i])}`;
    return d + ' Z';
  };
  const linePath = (arr: number[]) => {
    let d = `M ${xf(0)},${yf(arr[0])}`;
    for (let i = 1; i < n; i++) d += ` L ${xf(i)},${yf(arr[i])}`;
    return d;
  };

  return (
    <div style={{ position: 'relative' }}>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', pointerEvents: 'none' }}
      data-testid="projection-fan"
    >
      {/* Gridlines + Y-axis labels */}
      {yTicks.map(({ pct, val, y }) => (
        <g key={pct}>
          <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--ui-line)" strokeDasharray="2 4" />
          <text x={PL - 6} y={y + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={9} fill="rgb(var(--ui-content-muted))">
            {fmt(val)}
          </text>
        </g>
      ))}

      {/* Retirement marker */}
      {retireIdx > 0 && retireIdx < n && (
        <>
          <line x1={xf(retireIdx)} x2={xf(retireIdx)} y1={PT} y2={H - PB}
            stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" strokeWidth={1} />
          <text x={xf(retireIdx) + 5} y={PT + 14} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={9} fill="rgb(var(--ui-brand))">
            retire {retirementAge}
          </text>
        </>
      )}

      {/* MC bands — outer (p5–p95) under inner (p25–p75), then median.
          Iter 6: switch from CSS `opacity` (which some renderers cache) to the
          SVG `fill-opacity` attribute so the values stick. */}
      <path d={band(bands.p95, bands.p5)} fill="var(--ui-viz-2)" fillOpacity={0.08} data-band="p5-p95" />
      <path d={band(bands.p75, bands.p25)} fill="var(--ui-viz-2)" fillOpacity={0.18} data-band="p25-p75" />
      <path d={linePath(bands.p50)} fill="none" stroke="rgb(var(--ui-content-secondary))" strokeWidth={1.5}
        strokeDasharray="5 4" strokeLinecap="round" data-band="p50" />

      {/* X-axis age labels */}
      <text x={xf(0)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={9} fill="rgb(var(--ui-content-muted))">
        {currentAge}
      </text>
      <text x={xf(Math.floor((n - 1) / 2))} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={9} fill="rgb(var(--ui-content-muted))" textAnchor="middle">
        {currentAge + Math.floor((n - 1) / 2)}
      </text>
      <text x={xf(n - 1)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={9} fill="rgb(var(--ui-content-muted))" textAnchor="end">
        {currentAge + n - 1}
      </text>

    </svg>
    <ChartHover
      width={W}
      height={H}
      paddingLeft={PL}
      paddingRight={PR}
      count={n}
      getValue={(i) => `${fmt(bands.p50[i])} @ ${currentAge + i}`}
      getLabel={(i) => `median (p50) at age ${currentAge + i}`}
      getSubline={(i) => `p5 ${fmt(bands.p5[i])} · p95 ${fmt(bands.p95[i])}`}
      getCurvePoint={(i) => ({ x: xf(i), y: yf(bands.p50[i]) })}
    />
    </div>
  );
}

function ReadinessRing({ pct }: { pct: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 80 ? 'rgb(var(--ui-brand))' : pct >= 50 ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-negative))';
  return (
    <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
      <svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--ui-line)" strokeWidth={8} />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth={8}
          strokeLinecap="round" strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 24, color, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {pct.toFixed(0)}%
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgb(var(--ui-content-muted))', marginTop: 2 }}>
          ready
        </span>
      </div>
    </div>
  );
}

function FanChart({ bands, retireAge, currentAge }: { bands: ReturnType<typeof buildBands>; retireAge: number; currentAge: number }) {
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

  return (
    <div style={{ position: 'relative' }}>
    <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" style={{ display: 'block', pointerEvents: 'none' }}
      data-testid="fan-chart"
    >
      {[0, 1, 2, 3, 4].map(i => (
        <line key={i} x1={0} x2={W} y1={i * H / 4} y2={i * H / 4} stroke="var(--ui-line)" strokeDasharray="2 4" />
      ))}
      <path d={path(bands.p95, bands.p5)} fill="var(--ui-viz-2)" fillOpacity="0.08" data-band="p5-p95" />
      <path d={path(bands.p75, bands.p25)} fill="var(--ui-viz-2)" fillOpacity="0.18" data-band="p25-p75" />
      <path d={path(bands.p50)} stroke="rgb(var(--ui-content-secondary))" strokeWidth="1.5" strokeDasharray="5 4" fill="none" data-band="p50" />
      <line x1={retirePos} x2={retirePos} y1={0} y2={H} stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" />
      <text x={retirePos + 6} y={16} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="10" fill="rgb(var(--ui-brand))">
        retire {retireAge}
      </text>
      <text x={0} y={H + 14} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="10" fill="rgb(var(--ui-content-muted))">
        age {currentAge}
      </text>
      <text x={W / 2} y={H + 14} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="10" fill="rgb(var(--ui-content-muted))" textAnchor="middle">
        age {Math.round(currentAge + (n - 1) / 2)}
      </text>
      <text x={W} y={H + 14} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="10" fill="rgb(var(--ui-content-muted))" textAnchor="end">
        age {currentAge + n - 1}
      </text>
    </svg>
    <ChartHover
      width={W}
      height={H + 20}
      paddingLeft={0}
      paddingRight={0}
      count={n}
      getValue={(i) => `${fmt(bands.p50[i])} @ ${currentAge + i}`}
      getLabel={(i) => `median (p50) at age ${currentAge + i}`}
      getSubline={(i) => `p25 ${fmt(bands.p25[i])} · p75 ${fmt(bands.p75[i])}`}
      getCurvePoint={(i) => ({ x: xf(i), y: yf(bands.p50[i]) })}
    />
    </div>
  );
}

function DistributionBar({ finalValues }: { finalValues: number[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  // Compact labels so the x-axis doesn't overlap on mobile (audit R4).
  const BINS = [
    { label: '$0', min: -Infinity, max: 0, success: false },
    { label: '0–.5M', min: 0, max: 500_000, success: false },
    { label: '.5–1M', min: 500_000, max: 1_000_000, success: true },
    { label: '1–2M', min: 1_000_000, max: 2_000_000, success: true },
    { label: '2–4M', min: 2_000_000, max: 4_000_000, success: true },
    { label: '4–8M', min: 4_000_000, max: 8_000_000, success: true },
    { label: '8M+', min: 8_000_000, max: Infinity, success: true },
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
              fill={h.success ? 'rgb(var(--ui-brand))' : 'rgb(var(--ui-negative))'}
              opacity={isHov ? 1 : 0.82} rx="3"
              style={{ transition: 'opacity 0.15s' }} />
            <text x={bx + bw / 2} y={H + 14} textAnchor="middle"
              fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="10" fill="rgb(var(--ui-content-muted))">
              {h.label}
            </text>
            {h.pct >= 1 && (
              <text x={bx + bw / 2} y={H - barH - 4} textAnchor="middle"
                fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="10" fill="rgb(var(--ui-content))">
                {h.pct.toFixed(1)}%
              </text>
            )}
            {isHov && (
              <g>
                <rect x={ttX} y={H + 22} width={120} height={22} rx={5} fill="rgb(var(--ui-content))" />
                <text x={ttX + 8} y={H + 37} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="10" fill="rgb(var(--ui-panel))">
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



// ── Backtest detail chart ────────────────────────────────────────────────────
function BacktestDetailChart({ yearByYear, dollars }: { yearByYear: BacktestYearData[]; dollars: 'real' | 'nominal' }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!yearByYear.length) return null;
  const W = 720; const H = 220;
  const PL = 60; const PR = 16; const PT = 14; const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const values = yearByYear.map(y => {
    const v = dollars === 'real' && y.cumulativeInflation > 0 ? Math.round(y.endValue / y.cumulativeInflation) : y.endValue;
    return y.phase === 'accumulation' ? y.endValue : v; // accumulation phase has cumulativeInflation=1
  });
  const withdrawals = yearByYear.map(y => dollars === 'real' && y.cumulativeInflation > 0 ? Math.round(y.withdrawal / y.cumulativeInflation) : y.withdrawal);
  const contributions = yearByYear.map(y => y.contribution);
  const maxV = Math.max(...values, 1);
  const n = yearByYear.length;

  // Find retirement boundary
  const retireIdx = yearByYear.findIndex(y => y.phase === 'withdrawal');

  const xf = (i: number) => PL + (i / Math.max(n - 1, 1)) * chartW;
  const yf = (v: number) => PT + chartH - (v / maxV) * chartH;

  const fmt = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`;

  // Accumulation area (green tint)
  const accEnd = retireIdx > 0 ? retireIdx : 0;
  const accAreaPath = accEnd > 0 ? `M ${xf(0)},${yf(0)} ${values.slice(0, accEnd + 1).map((v, i) => `L ${xf(i)},${yf(v)}`).join(' ')} L ${xf(accEnd)},${yf(0)} Z` : '';
  // Withdrawal area (red tint)
  const wdStart = retireIdx >= 0 ? retireIdx : 0;
  const wdAreaPath = `M ${xf(wdStart)},${yf(0)} ${values.slice(wdStart).map((v, i) => `L ${xf(wdStart + i)},${yf(v)}`).join(' ')} L ${xf(n - 1)},${yf(0)} Z`;

  const valueLine = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xf(i)},${yf(v)}`).join(' ');
  const barW = Math.max(2, chartW / n - 1);

  // X-axis labels: show ~5 evenly spaced years
  const xLabels: number[] = [];
  const step = Math.max(1, Math.floor(n / 5));
  for (let i = 0; i < n; i += step) xLabels.push(i);
  if (xLabels[xLabels.length - 1] !== n - 1) xLabels.push(n - 1);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((svgX - PL) / chartW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  const hd = hoverIdx !== null ? yearByYear[hoverIdx] : null;
  const hv = hoverIdx !== null ? values[hoverIdx] : 0;
  const hw = hoverIdx !== null ? withdrawals[hoverIdx] : 0;
  const hc = hoverIdx !== null ? contributions[hoverIdx] : 0;
  const hx = hoverIdx !== null ? xf(hoverIdx) : 0;
  const ttX = hoverIdx !== null ? Math.min(hx, W - 170) : 0;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'rgb(var(--ui-content-muted))', marginBottom: 6, display: 'flex', gap: 16 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 3, background: 'var(--ui-viz-2)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />Portfolio value</span>
        {retireIdx > 0 && <span><span style={{ display: 'inline-block', width: 10, height: 8, background: 'rgb(var(--ui-brand))', borderRadius: 1, marginRight: 4, verticalAlign: 'middle', opacity: 0.15 }} />Accumulation</span>}
        <span><span style={{ display: 'inline-block', width: 10, height: 8, background: 'rgb(var(--ui-caution))', borderRadius: 1, marginRight: 4, verticalAlign: 'middle', opacity: 0.5 }} />Withdrawal</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const svgX = ((e.touches[0].clientX - rect.left) / rect.width) * W;
          const idx = Math.round(((svgX - PL) / chartW) * (n - 1));
          setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
        }}
        onTouchEnd={() => setHoverIdx(null)}
      >
        {/* Y-axis gridlines + labels */}
        {[0.25, 0.5, 0.75, 1].map(pct => (
          <g key={pct}>
            <line x1={PL} x2={W - PR} y1={yf(maxV * pct)} y2={yf(maxV * pct)} stroke="var(--ui-line)" strokeDasharray="2 4" />
            <text x={PL - 6} y={yf(maxV * pct) + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={9} fill="rgb(var(--ui-content-muted))">{fmt(maxV * pct)}</text>
          </g>
        ))}
        {/* Accumulation area (green) */}
        {accAreaPath && <path d={accAreaPath} fill="rgb(var(--ui-brand))" opacity={0.08} />}
        {/* Withdrawal area (red) */}
        <path d={wdAreaPath} fill="rgb(var(--ui-caution))" opacity={0.08} />
        {/* Withdrawal bars */}
        {yearByYear.map((y, i) => {
          if (y.phase === 'accumulation') return null;
          const bH = Math.max(1, (withdrawals[i] / maxV) * chartH);
          return <rect key={i} x={xf(i) - barW / 2} y={PT + chartH - bH} width={barW} height={bH} fill="rgb(var(--ui-caution))" opacity={0.35} rx={1} />;
        })}
        {/* Portfolio line */}
        <path d={valueLine} fill="none" stroke="var(--ui-viz-2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Retirement marker */}
        {retireIdx > 0 && (
          <>
            <line x1={xf(retireIdx)} x2={xf(retireIdx)} y1={PT} y2={PT + chartH} stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" strokeWidth={1} />
            <text x={xf(retireIdx) + 4} y={PT + 12} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={9} fill="rgb(var(--ui-brand))">retire</text>
          </>
        )}
        {/* X-axis labels */}
        {xLabels.map(i => (
          <text key={i} x={xf(i)} y={H - 4} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={9} fill="rgb(var(--ui-content-muted))"
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{yearByYear[i].year}</text>
        ))}
        {/* Hover crosshair + tooltip */}
        {hoverIdx !== null && hd && (
          <g>
            <line x1={hx} x2={hx} y1={PT} y2={PT + chartH} stroke="rgb(var(--ui-content))" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
            <circle cx={hx} cy={yf(hv)} r={4} fill="var(--ui-viz-2)" />
            <rect x={ttX} y={PT} width={166} height={hd.phase === 'accumulation' ? 52 : 66} rx={6} fill="rgb(var(--ui-content))" opacity={0.92} />
            <text x={ttX + 8} y={PT + 14} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={10} fill="rgb(var(--ui-caution))">
              {hd.year} · {hd.phase === 'accumulation' ? 'saving' : 'withdrawing'}
            </text>
            <text x={ttX + 8} y={PT + 28} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={10} fill="rgb(var(--ui-panel))">
              portfolio {fmt(hv)}
            </text>
            <text x={ttX + 8} y={PT + 42} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={10} fill="rgb(var(--ui-panel) / 0.6)">
              return {hd.marketReturn >= 0 ? '+' : ''}{(hd.marketReturn * 100).toFixed(1)}%
            </text>
            {hd.phase === 'withdrawal' && (
              <text x={ttX + 8} y={PT + 56} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={10} fill="rgb(var(--ui-caution))">
                withdrew {fmt(hw)}
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Backtest section with sorting + expandable rows ──────────────────────────
function BacktestSection({ backtestRows, portfolioValue, monthlySpend, lifeHorizon, accumulationYears, dollars }: {
  backtestRows: BacktestRow[];
  portfolioValue: number;
  monthlySpend: number;
  lifeHorizon: number;
  accumulationYears: number;
  dollars: 'real' | 'nominal';
}) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const sorted = useMemo(() => [...backtestRows].sort((a, b) => b.accStartYear - a.accStartYear), [backtestRows]);

  return (
    <>
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--ui-line)', fontSize: 13, color: 'rgb(var(--ui-content-secondary))', fontFamily: 'inherit' }}>
          Starts with {formatMoney(portfolioValue, true)} and <strong>accumulates for {accumulationYears} years</strong> using historical returns + savings, then <strong>withdraws {formatMoney(monthlySpend * 12, true)}/yr</strong> for {lifeHorizon} years. Each row is a different historical starting point.
        </div>
        <div className="ret-backtest-wrap" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: 'rgb(var(--ui-canvas-sunken))' }}>
                {['Start', 'Retired', 'Through', 'At retirement', 'Worst year', 'Final value', 'Result'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 16px',
                    fontVariantNumeric: 'tabular-nums', fontSize: 13,
                    color: 'rgb(var(--ui-content-muted))', textTransform: 'uppercase',
                    letterSpacing: '0.1em', fontWeight: 500, whiteSpace: 'nowrap',
                    borderBottom: '1px solid var(--ui-line)',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <React.Fragment key={row.accStartYear}>
                  <tr
                    onClick={() => setExpandedRow(prev => prev === row.accStartYear ? null : row.accStartYear)}
                    style={{
                      borderTop: '1px solid var(--ui-line)',
                      background: expandedRow === row.accStartYear ? 'rgb(var(--ui-canvas-sunken))' : row.survived ? 'transparent' : 'var(--ui-negative-soft)',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--ui-content))', fontWeight: 600 }}>
                      {row.accStartYear}
                    </td>
                    <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--ui-brand))', fontWeight: 600, fontSize: 13 }}>
                      {row.startYear}
                    </td>
                    <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--ui-content-muted))', fontSize: 13 }}>
                      {row.endYear}
                    </td>
                    <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--ui-content))', fontSize: 13 }}>
                      {formatMoney(row.portfolioAtRetirement, true)}
                    </td>
                    <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums', fontSize: 13, whiteSpace: 'nowrap' }}>
                      <span style={{ color: row.worstReturn < -0.2 ? 'rgb(var(--ui-negative))' : row.worstReturn < 0 ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-content-muted))' }}>
                        {row.worstYear} ({row.worstReturn >= 0 ? '+' : ''}{(row.worstReturn * 100).toFixed(1)}%)
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--ui-content))' }}>
                      {row.survived
                        ? formatMoney(dollars === 'real' ? row.finalValueReal : row.finalValue, true)
                        : <span style={{ color: 'rgb(var(--ui-negative))' }}>depleted {row.depletedYear}</span>
                      }
                    </td>
                    <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: row.survived ? 'rgb(var(--ui-brand))' : 'rgb(var(--ui-negative))', fontSize: 13 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: row.survived ? 'rgb(var(--ui-brand))' : 'rgb(var(--ui-negative))', flexShrink: 0 }} />
                        {row.survived ? 'survived' : 'depleted'}
                      </span>
                    </td>
                  </tr>
                  {expandedRow === row.accStartYear && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <div style={{ padding: '16px 20px', background: 'rgb(var(--ui-canvas-sunken))', borderTop: '1px solid var(--ui-line)' }}>
                          {/* Chart */}
                          <BacktestDetailChart yearByYear={row.yearByYear} dollars={dollars} />
                          {/* Year-by-year table */}
                          <div style={{ overflowX: 'auto', maxHeight: 400 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr>
                                  {['Year', 'Phase', 'Start value', 'End value', 'Contribution / Withdrawal', 'Return'].map(h => (
                                    <th key={h} style={{
                                      textAlign: 'left', padding: '6px 12px',
                                      fontVariantNumeric: 'tabular-nums', fontSize: 11,
                                      color: 'rgb(var(--ui-content-muted))', textTransform: 'uppercase',
                                      letterSpacing: '0.08em', fontWeight: 500,
                                      borderBottom: '1px solid var(--ui-line)', position: 'sticky', top: 0,
                                      background: 'rgb(var(--ui-canvas-sunken))',
                                    }}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {row.yearByYear.map(y => {
                                  const isAcc = y.phase === 'accumulation';
                                  const deflator = !isAcc && dollars === 'real' ? y.cumulativeInflation : 1;
                                  const ev = Math.round(y.endValue / deflator);
                                  const sv = Math.round(y.startValue / deflator);
                                  const flow = isAcc ? y.contribution : Math.round(y.withdrawal / deflator);
                                  return (
                                    <tr key={y.year} style={{
                                      borderTop: '1px solid var(--ui-line)',
                                      background: isAcc ? 'var(--ui-brand-softer)' : undefined,
                                    }}>
                                      <td style={{ padding: '5px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'rgb(var(--ui-content))' }}>{y.year}</td>
                                      <td style={{ padding: '5px 12px', fontVariantNumeric: 'tabular-nums', fontSize: 11, color: isAcc ? 'rgb(var(--ui-brand))' : 'rgb(var(--ui-negative))' }}>
                                        {isAcc ? 'saving' : 'withdraw'}
                                      </td>
                                      <td style={{ padding: '5px 12px', fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--ui-content-secondary))' }}>{formatMoney(sv, true)}</td>
                                      <td style={{ padding: '5px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: y.endValue <= 0 ? 'rgb(var(--ui-negative))' : 'rgb(var(--ui-content))' }}>{formatMoney(ev, true)}</td>
                                      <td style={{ padding: '5px 12px', fontVariantNumeric: 'tabular-nums', color: isAcc ? 'rgb(var(--ui-brand))' : 'rgb(var(--ui-caution))' }}>
                                        {isAcc ? '+' : '-'}{formatMoney(flow, true)}
                                      </td>
                                      <td style={{ padding: '5px 12px', fontVariantNumeric: 'tabular-nums', color: y.marketReturn >= 0 ? 'rgb(var(--ui-brand))' : 'rgb(var(--ui-negative))' }}>
                                        {y.marketReturn >= 0 ? '+' : ''}{(y.marketReturn * 100).toFixed(1)}%
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
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
  lifeExp, setLifeExp,
  portfolioValue, currentAge, annualSavings,
  portfolioAtRetirement,
  portfolioAllocation,
  actualBlendedReturn,
  onRatesChange,
}: {
  retirementAge: number; setRetirementAge: (v: number) => void;
  monthlySpend: number; setMonthlySpend: (v: number) => void;
  lifeExp: number; setLifeExp: (v: number) => void;
  portfolioValue: number; currentAge: number; annualSavings: number;
  portfolioAtRetirement: number;
  portfolioAllocation: Record<string, number>;
  actualBlendedReturn: number | null;
  onRatesChange?: (mc: number, bt: number) => void;
}) {
  const [simTab, setSimTab] = useState<'mc' | 'backtest'>('mc');
  const [strategy, setStrategy] = useState<WithdrawalStrategy>('constant_dollar');
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

  const equityFraction = (mcAlloc.us + mcAlloc.intl + mcAlloc.reit) / Math.max(allocTotal, 1);

  const bands = useMemo(
    () => buildBands(portfolioValue, annualSavings, retirementAge, currentAge, expReturn, annualWithdrawal, equityFraction, inflAdj, strategy),
    [portfolioValue, annualSavings, retirementAge, currentAge, expReturn, annualWithdrawal, equityFraction, inflAdj, strategy]
  );

  const mcSuccessRate = bands.mcSuccessRate;
  const mcSuccessColor = mcSuccessRate >= 80 ? 'rgb(var(--ui-brand))' : mcSuccessRate >= 60 ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-negative))';

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
  const accumulationYears = Math.max(0, retirementAge - currentAge);
  // Generate year-by-year backtest rows for every start year with full data
  const backtestRows = useMemo(() => {
    const totalYears = accumulationYears + lifeHorizon;
    const maxStart = 2024 - totalYears;
    const rows: BacktestRow[] = [];
    for (let yr = 1928; yr <= Math.min(maxStart, 2024); yr++) {
      rows.push(runBacktest(yr, lifeHorizon, portfolioValue, annualWithdrawal, equityFraction, inflAdj, strategy, accumulationYears, annualSavings));
    }
    return rows;
  }, [lifeHorizon, accumulationYears, portfolioValue, annualWithdrawal, equityFraction, inflAdj, strategy, annualSavings]);
  const survived = backtestRows.filter(r => r.survived).length;

  const strategyDescriptions: Record<string, string> = {
    constant_dollar: 'Withdraw the same real amount each year, regardless of portfolio.',
    percent_portfolio: 'Withdraw a fixed % of current portfolio each year — flexible but volatile.',
    guardrails: 'Adjust withdrawals when portfolio hits upper/lower guardrail thresholds.',
  };

  const backtestSuccessRate = backtestRows.length > 0 ? Math.round((survived / backtestRows.length) * 100) : 0;
  const btSuccessColor = backtestSuccessRate >= 80 ? 'rgb(var(--ui-brand))' : backtestSuccessRate >= 60 ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-negative))';

  useEffect(() => { onRatesChange?.(mcSuccessRate, backtestSuccessRate); }, [mcSuccessRate, backtestSuccessRate, onRatesChange]);

  return (
    <>

      {/* Withdrawal strategy */}
      <Eyebrow style={{ marginBottom: 10 }}>Withdrawal strategy</Eyebrow>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {([
            { id: 'constant_dollar' as const, label: 'Constant Dollar (4%)' },
            { id: 'percent_portfolio' as const, label: '% of Portfolio' },
            { id: 'guardrails' as const, label: 'Guyton-Klinger Guardrails' },
          ]).map(s => (
            <button key={s.id} onClick={() => setStrategy(s.id)} style={{
              padding: '8px 14px', fontSize: 13, cursor: 'pointer',
              fontFamily: 'inherit', borderRadius: 8, fontWeight: 500,
              background: strategy === s.id ? 'var(--ui-brand-soft)' : 'rgb(var(--ui-panel))',
              color: strategy === s.id ? 'rgb(var(--ui-brand-ink))' : 'rgb(var(--ui-content-secondary))',
              border: `1px solid ${strategy === s.id ? 'var(--ui-brand-ring)' : 'var(--ui-line)'}`,
            }}>
              {s.label}
            </button>
          ))}
        </div>
        {/* Body copy → Geist (mono only for numeric displays). */}
        <div style={{ fontFamily: 'inherit', fontSize: 14, color: 'rgb(var(--ui-content-secondary))', lineHeight: 1.55, marginBottom: 20 }}>
          {strategyDescriptions[strategy]}
        </div>
        <div className="ret-withdrawal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 28, width: '100%' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <label style={{ fontSize: 13, color: 'rgb(var(--ui-content-secondary))', fontWeight: 500, fontFamily: 'inherit' }}>
                Monthly spending
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={`$${Number(monthlySpendStr || 0).toLocaleString('en-US')}`}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9]/g, '');
                  setMonthlySpendStr(raw);
                  const v = parseInt(raw, 10);
                  if (!isNaN(v) && v >= 500 && v <= 50000) setMonthlySpend(v);
                }}
                onBlur={() => {
                  const v = parseInt(monthlySpendStr, 10);
                  const clamped = isNaN(v) ? 500 : Math.max(500, Math.min(50000, v));
                  setMonthlySpend(clamped);
                  setMonthlySpendStr(String(clamped));
                }}
                style={{ width: 100, textAlign: 'right', border: '1px solid var(--ui-line)', borderRadius: 6, padding: '2px 6px', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-brand-ink))', fontWeight: 600, background: 'transparent' }}
              />
            </div>
            <input type="range" min={2000} max={20000} step={500} value={monthlySpend}
              onChange={e => setMonthlySpend(+e.target.value)}
              style={{ width: '100%', accentColor: 'rgb(var(--ui-brand))' }} />
            <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-content-muted))', marginTop: 4 }}>
              annual withdrawal ≈ {formatMoney(monthlySpend * 12, true)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'rgb(var(--ui-content-secondary))', fontWeight: 500, marginBottom: 8, fontFamily: 'inherit' }}>
              Parameters
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 0', cursor: 'pointer', fontFamily: 'inherit', color: 'rgb(var(--ui-content-secondary))' }}>
              <input type="checkbox" checked={inflAdj} onChange={e => setInflAdj(e.target.checked)} style={{ accentColor: 'rgb(var(--ui-brand))' }} />
              Inflation-adjusted withdrawals
            </label>
            {strategy === 'constant_dollar' && (
              <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'rgb(var(--ui-content-muted))', marginTop: 8, lineHeight: 1.7 }}>
                Withdrawal rate: {portfolioValue > 0 ? ((annualWithdrawal / portfolioValue) * 100).toFixed(1) : '—'}% of current portfolio
              </div>
            )}
            {strategy === 'percent_portfolio' && (
              <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'rgb(var(--ui-content-muted))', marginTop: 8, lineHeight: 1.7 }}>
                <div>Rate: 4% of portfolio each year</div>
                <div>Year 1 withdrawal: {formatMoney(portfolioValue * 0.04, true)}/yr ({formatMoney(Math.round(portfolioValue * 0.04 / 12), true)}/mo)</div>
                {annualWithdrawal !== portfolioValue * 0.04 && (
                  <div style={{ color: annualWithdrawal > portfolioValue * 0.04 ? 'rgb(var(--ui-negative))' : 'rgb(var(--ui-brand))' }}>
                    vs your planned spending: {formatMoney(annualWithdrawal, true)}/yr ({annualWithdrawal > portfolioValue * 0.04 ? '+' : ''}{formatMoney(annualWithdrawal - Math.round(portfolioValue * 0.04), true)})
                  </div>
                )}
              </div>
            )}
            {strategy === 'guardrails' && (() => {
              const initialRate = portfolioValue > 0 ? (annualWithdrawal / portfolioValue) : 0.04;
              const upperPct = (initialRate * 0.8 * 100).toFixed(1);
              const lowerPct = (initialRate * 1.2 * 100).toFixed(1);
              return (
                <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'rgb(var(--ui-content-muted))', marginTop: 8, lineHeight: 1.7 }}>
                  <div>Initial rate: {(initialRate * 100).toFixed(1)}% of portfolio</div>
                  <div>If rate drops below {upperPct}% → increase withdrawal 10%</div>
                  <div>If rate exceeds {lowerPct}% → decrease withdrawal 10%</div>
                  <div>Otherwise → keep previous year's amount</div>
                </div>
              );
            })()}
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
              fontFamily: 'inherit', borderRadius: 8, fontWeight: 500,
              background: preset === p.id ? 'var(--ui-brand-soft)' : 'rgb(var(--ui-panel))',
              color: preset === p.id ? 'rgb(var(--ui-brand-ink))' : 'rgb(var(--ui-content-secondary))',
              border: `1px solid ${preset === p.id ? 'var(--ui-brand-ring)' : 'var(--ui-line)'}`,
            }}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <span style={{
              padding: '8px 14px', fontSize: 13, borderRadius: 8,
              background: 'rgb(var(--ui-canvas-sunken))', color: 'rgb(var(--ui-content-muted))',
              border: '1px solid var(--ui-line)', fontVariantNumeric: 'tabular-nums',
            }}>Custom</span>
          )}
        </div>
        <div className="ret-5col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 20, width: '100%' }}>
          {Object.keys(MC_LABELS).map(k => (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'rgb(var(--ui-content-secondary))', fontFamily: 'inherit' }}>
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
                  style={{ width: 44, textAlign: 'right', border: '1px solid var(--ui-line)', borderRadius: 6, padding: '2px 4px', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600, color: 'rgb(var(--ui-content))', background: 'transparent' }}
                />
              </div>
              <input type="range" min={0} max={100} step={5}
                value={mcAlloc[k as keyof typeof mcAlloc]}
                onChange={e => updateAlloc(k, +e.target.value)}
                style={{ width: '100%', accentColor: MC_ACCENT[k] }} />
              <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-content-muted))', marginTop: 3 }}>
                {MC_RETURNS[k]}% avg · hist.
              </div>
            </div>
          ))}
        </div>
        {/* Stacked allocation bar */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--ui-line)' }}>
          <div style={{ display: 'flex', height: 36, borderRadius: 8, overflow: 'hidden', gap: 1 }}>
            {Object.keys(MC_LABELS).map(k => {
              const pct = allocTotal > 0 ? (mcAlloc[k as keyof McAlloc] / allocTotal) * 100 : 0;
              return pct > 0 ? (
                <div key={k} style={{
                  width: `${pct}%`, background: MC_ACCENT[k], transition: 'width 0.3s ease', minWidth: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {pct >= 10 && (
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, fontWeight: 600, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
                      {MC_LABELS[k]} {mcAlloc[k as keyof McAlloc]}%
                    </span>
                  )}
                </div>
              ) : null;
            })}
          </div>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 12, fontSize: 13,
          fontFamily: 'inherit', color: 'rgb(var(--ui-content-secondary))',
        }}>
          <span>
            Blended return · <strong>{expReturn.toFixed(2)}%</strong>
            {preset !== 'current' && actualBlendedReturn !== null && (
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'rgb(var(--ui-content-muted))', marginLeft: 8 }}>
                (your actual portfolio: {actualBlendedReturn.toFixed(1)}%)
              </span>
            )}
            {preset === 'current' && actualBlendedReturn !== null && (
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'rgb(var(--ui-content-muted))', marginLeft: 8 }}>
                · from your actual holdings
              </span>
            )}
          </span>
          {allocTotal !== 100 && (
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-negative))' }}>
              ⚠ allocation totals {allocTotal}%
            </span>
          )}
        </div>
      </Card>

      {/* ── Real / Nominal toggle — applies to both tabs ───────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-content-muted))' }}>
        <span>Values in:</span>
        <div style={{ display: 'flex', border: '1px solid var(--ui-line)', borderRadius: 8, overflow: 'hidden' }}>
          {(['real', 'nominal'] as const).map((d, i) => (
            <button key={d} onClick={() => setDollars(d)} style={{
              padding: '5px 12px', fontSize: 13, cursor: 'pointer',
              fontVariantNumeric: 'tabular-nums',
              background: dollars === d ? 'var(--ui-brand-soft)' : 'transparent',
              color: dollars === d ? 'rgb(var(--ui-brand-ink))' : 'rgb(var(--ui-content-muted))',
              border: 0, borderRight: i === 0 ? '1px solid var(--ui-line)' : 'none',
              transition: 'background 0.15s, color 0.15s',
            }}>
              {d === 'real' ? 'Real $' : 'Nominal $'}
            </button>
          ))}
        </div>
        {dollars === 'real' && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>inflation-adjusted{simTab === 'backtest' ? ' · historical CPI' : ' · 3%/yr'}</span>
        )}
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '1px solid var(--ui-line)', borderRadius: 10, overflow: 'hidden', background: 'rgb(var(--ui-canvas-sunken))' }}>
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
                borderRight: i === 0 ? '1px solid var(--ui-line)' : 'none',
                borderBottom: isActive ? `2px solid rgb(var(--ui-brand))` : '2px solid transparent',
                background: isActive ? 'rgb(var(--ui-panel))' : 'transparent',
                transition: 'background 0.15s, border-color 0.15s',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
              }}
            >
              <span style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: isActive ? 600 : 500, color: isActive ? 'rgb(var(--ui-content))' : 'rgb(var(--ui-content-muted))' }}>
                {tab.label}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600, color: tab.color }}>
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
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-content-muted))' }}>
                accumulate {currentAge}–{retirementAge} · withdraw {retirementAge}–{lifeExp}
              </span>
            </div>
            <FanChart bands={displayBands} retireAge={retirementAge} currentAge={currentAge} />
            <div style={{ display: 'flex', gap: 24, fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-content-muted))', marginTop: 12, flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 6, background: 'var(--ui-viz-2)', opacity: 0.18, marginRight: 6, verticalAlign: 'middle' }}></span>p5–p95</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 6, background: 'var(--ui-viz-2)', opacity: 0.36, marginRight: 6, verticalAlign: 'middle' }}></span>p25–p75</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 2, background: 'rgb(var(--ui-content-secondary))', marginRight: 6, verticalAlign: 'middle' }}></span>median (p50)</span>
              <span style={{ marginLeft: 'auto' }}>
                median @ age {lifeExp}: <strong>{formatMoney(displayBands.p50[displayBands.p50.length - 1] || 0, true)}</strong>
                &nbsp;·&nbsp; worst 5%: <strong style={{ color: displayBands.p5[displayBands.p5.length - 1] === 0 ? 'rgb(var(--ui-negative))' : undefined }}>
                  {displayBands.p5[displayBands.p5.length - 1] === 0 ? 'depleted' : formatMoney(displayBands.p5[displayBands.p5.length - 1], true)}
                </strong>
              </span>
            </div>
          </Card>
          <Card style={{ marginBottom: 20 }}>
            <Eyebrow style={{ marginBottom: 10 }}>Distribution of final portfolio values at age {lifeExp}</Eyebrow>
            <DistributionBar finalValues={displayBands.finalValues} />
            <div style={{ display: 'flex', gap: 20, fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-content-muted))', marginTop: 4, flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgb(var(--ui-brand))', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }}></span>portfolio survived</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgb(var(--ui-negative))', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }}></span>depleted before end</span>
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
              detail: `The 4% rule targets ≤4%. Your ${withdrawalRate.toFixed(1)}% rate means ${formatMoney(annualWithdrawal, true)}/yr on a ${formatMoney(portfolioAtRetirement, true)} portfolio. Each extra year of work or ${formatMoney(Math.round(monthlySpend * 0.1 / 100) * 100, true)}/mo in spending cuts meaningfully improves odds.`,
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
              <Card style={{ marginBottom: 20, background: 'var(--ui-negative-soft)', border: '1px solid var(--ui-negative-soft)' }}>
                <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgb(var(--ui-negative))', marginBottom: 12 }}>
                  Why {failPct}% of runs fail · what to do
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {fixes.map((fix, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--ui-negative-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'rgb(var(--ui-negative))', fontWeight: 600 }}>{i + 1}</span>
                      </div>
                      <div>
                        <div style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'rgb(var(--ui-content))', marginBottom: 3 }}>{fix.label}</div>
                        <div style={{ fontFamily: 'inherit', fontSize: 13, color: 'rgb(var(--ui-content-secondary))', lineHeight: 1.6 }}>{fix.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}
        </>
      )}

      {/* ���─ Historical backtest tab ─────��───────────────────────────────────── */}
      {simTab === 'backtest' && (
        <BacktestSection
          backtestRows={backtestRows}
          portfolioValue={portfolioValue}
          monthlySpend={monthlySpend}
          lifeHorizon={lifeHorizon}
          accumulationYears={accumulationYears}
          dollars={dollars}
        />
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


  const [lifeExpectancy, setLifeExpectancy] = useState(90);

  // Success rates reported by SimulateView
  const [mcRate, setMcRate] = useState(0);
  const [btRate, setBtRate] = useState(0);
  const handleRatesChange = useMemo(() => (mc: number, bt: number) => { setMcRate(mc); setBtRate(bt); }, []);

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
        if (b.type === 'credit' || b.type === 'loan') liabilities += Math.abs(val);
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
      });
    }
  }, [loading, hasAccounts, setPageContext]);

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

  // Monte Carlo bands for the Plan-tab projection. We derive equityFraction
  // from the live portfolio allocation (us + intl + reits) so the band width
  // tracks the user's actual risk exposure. Memoized to avoid re-running 1000
  // paths on every render (slider tweaks already invalidate the deps).
  const planEquityFraction = useMemo(() => {
    if (!Object.keys(allocation).length) return 0.7;
    const eq = (allocation.usStocks ?? 0) + (allocation.intlStocks ?? 0) + (allocation.reits ?? 0);
    const total = Object.values(allocation).reduce((s, v) => s + v, 0);
    return total > 0 ? eq / total : 0.7;
  }, [allocation]);
  const planBands = useMemo(
    () => buildBands(
      portfolioValue,
      annualSavings,
      retirementAge,
      currentAge,
      expectedReturn,
      annualExpenses,
      planEquityFraction,
      false, // nominal $ — matches the existing "Portfolio projection · nominal $" eyebrow
      'constant_dollar',
    ),
    [portfolioValue, annualSavings, retirementAge, currentAge, expectedReturn, annualExpenses, planEquityFraction],
  );

  if (loading) {
    // Iter 7 D: cached shell so first paint isn't blank ~300ms while the
    // accounts query + MC compute spin up. Same outline as the loaded page
    // (page-bar + projection fan height) so swap-in doesn't jolt.
    return (
      <div className="mx-auto max-w-[1180px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
        <header>
          <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">Retirement</h1>
          <Skeleton className="mt-2 h-3 w-52" />
        </header>
        <Skeleton className="mt-8 h-3 w-32" />
        <Skeleton className="mt-4 h-[320px] w-full rounded-ui-xl" />
      </div>
    );
  }

  if (!hasAccounts) {
    return (
      <div className="mx-auto max-w-[1180px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
        <header className="mb-8">
          <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">Retirement</h1>
          <p className="mt-1.5 text-[14px] font-medium text-content-muted">Link accounts to project your timeline</p>
        </header>
        <EmptyState
          icon={<Building2 size={24} />}
          title="No accounts linked"
          description="Connect your bank and investment accounts to see your retirement projections based on real data."
          action={
            <Button variant="primary" onClick={() => navigate('/accounts')}>
              Link your first account
            </Button>
          }
        />
      </div>
    );
  }

  const readinessTone: 'pos' | 'warn' | 'neg' =
    readiness >= 80 ? 'pos' : readiness >= 50 ? 'warn' : 'neg';

  // Page-scoped responsive helpers — kept inline since they're page-specific.
  return (
    <div className="mx-auto max-w-[1180px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
      <style>{`
        @media (max-width: 800px) {
          .ret-hero-grid { grid-template-columns: repeat(3, 1fr) !important; }
          .ret-sliders-grid { grid-template-columns: 1fr !important; }
          .ret-5col { grid-template-columns: repeat(2, 1fr) !important; }
          .ret-3col { grid-template-columns: 1fr !important; }
        }
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
          .ret-header-row { flex-direction: column !important; align-items: flex-start !important; }
        }
        .ret-view-toggle {
          display: inline-flex;
          padding: 4px;
          gap: 2px;
          background: rgb(var(--ui-canvas-sunken));
          border: 1px solid var(--ui-line);
          border-radius: 999px;
        }
        .ret-view-toggle button {
          padding: 7px 16px;
          font-size: 12px;
          font-weight: 500;
          font-family: inherit;
          color: rgb(var(--ui-content-secondary));
          background: transparent;
          border: 0;
          border-radius: 999px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .ret-view-toggle button.is-active {
          background: rgb(var(--ui-panel));
          color: rgb(var(--ui-brand-ink));
          font-weight: 700;
          box-shadow: var(--ui-shadow-sm);
        }
        .ret-slider-row {
          display: grid;
          gap: 24px;
        }
        .ret-slider-label {
          font-family: inherit;
          font-size: 13px;
          color: rgb(var(--ui-content-secondary));
          font-weight: 500;
        }
        .ret-slider-input {
          width: 64px;
          text-align: right;
          border: 1px solid var(--ui-line);
          border-radius: 6px;
          padding: 2px 6px;
          font-variant-numeric: tabular-nums;
          font-size: 13px;
          /* Typed value reads as content (the user's choice), not a CTA. */
          color: rgb(var(--ui-content));
          font-weight: 600;
          background: transparent;
        }
        /* Iter 4: decouple slider track fill from brand sauce so the slider
           stops reading as a data fill. Thumb stays sauce (carries the "you
           are here" signal); the track is a neutral ink/12% rail. We can't
           split thumb-vs-track with the native accentColor property, so we
           hand-roll the appearance. */
        .ret-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 999px;
          background: var(--ui-line);
          outline: none;
          margin: 8px 0;
          cursor: pointer;
        }
        .ret-slider::-webkit-slider-runnable-track {
          height: 4px;
          background: transparent;
          border-radius: 999px;
        }
        .ret-slider::-moz-range-track {
          height: 4px;
          background: var(--ui-line);
          border-radius: 999px;
        }
        .ret-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgb(var(--ui-brand));
          border: 2px solid rgb(var(--ui-panel));
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
          margin-top: -6px;
          cursor: pointer;
        }
        .ret-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgb(var(--ui-brand));
          border: 2px solid rgb(var(--ui-panel));
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
          cursor: pointer;
        }
        .ret-slider:focus-visible::-webkit-slider-thumb {
          box-shadow: 0 0 0 4px var(--ui-brand-ring);
        }
        .ret-stats { margin: 0 0 40px; }
      `}</style>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <header className="ret-header-row flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
              On track to <span className="ui-tnum">{formatMoney(portfolioAtRetirement, true)}</span> by {retirementAge}
            </h1>
            <p className="mt-1.5 text-[14px] font-medium text-content-muted ui-tnum">
              {Math.max(0, retirementAge - currentAge)} years away · lasts{' '}
              {yearsMoneyLasts >= lifeHorizon ? `${lifeHorizon}+ yrs` : `${yearsMoneyLasts} yr${yearsMoneyLasts === 1 ? '' : 's'}`}
              {'  ·  '}{formatMoney(monthlyRetirementSpend, true)}/mo
            </p>
          </div>
          <div className="ret-view-toggle" role="tablist" aria-label="View mode">
            {(['simple', 'advanced'] as const).map(v => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={view === v ? 'is-active' : ''}
                onClick={() => setView(v)}
              >
                {v === 'simple' ? 'Overview' : 'Detailed'}
              </button>
            ))}
          </div>
        </header>

        {/* Composition ribbon — only when we have a real allocation to show */}
        {Object.keys(allocation).length > 0 && portfolioValue > 0 && (() => {
          const total = Object.values(allocation).reduce((s, v) => s + v, 0);
          if (total <= 0) return null;
          const labelMap: Record<string, string> = {
            usStocks: 'US stocks', us: 'US stocks',
            intlStocks: "Int'l stocks", intl: "Int'l stocks", international: "Int'l stocks",
            bonds: 'Bonds', bond: 'Bonds',
            reits: 'REITs', reit: 'REITs',
            cash: 'Cash',
          };
          const segments = Object.entries(allocation)
            .filter(([, v]) => v > 0)
            .map(([k, v], i) => ({
              label: labelMap[k] ?? k,
              value: Math.round((v / total) * portfolioValue),
              pct: (v / total) * 100,
              color: `var(--ui-viz-${(i % 7) + 1})`,
            }));
          if (segments.length === 0) return null;
          return (
            <Card className="mt-6">
              <div className="flex items-baseline justify-between gap-3">
                <Eyebrow>Portfolio composition</Eyebrow>
                <span className="text-[12.5px] font-bold text-[rgb(var(--ui-brand-ink))] ui-tnum">{expectedReturn.toFixed(1)}% blended return</span>
              </div>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-canvas-sunken" style={{ gap: 1 }}>
                {segments.map((s) => (
                  <div key={s.label} style={{ width: `${s.pct}%`, background: s.color, minWidth: 2 }} title={`${s.label} · ${s.pct.toFixed(0)}%`} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {segments.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-content-secondary ui-tnum">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
                    {s.label} {s.pct.toFixed(0)}%
                  </span>
                ))}
              </div>
            </Card>
          );
        })()}

        {/* Stat strip — secondary KPIs */}
        <div className="ret-stats mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {([
            {
              label: 'Portfolio at retirement',
              value: formatMoney(portfolioAtRetirement, true),
              sub: `age ${retirementAge} · ${expectedReturn.toFixed(1)}% return`,
              tone: undefined as 'pos' | 'warn' | 'neg' | undefined,
            },
            {
              label: 'FIRE number',
              value: formatMoney(fireNumber, true),
              sub: '25× annual spend',
              tone: undefined as 'pos' | 'warn' | 'neg' | undefined,
            },
            {
              label: 'Years money lasts',
              value: yearsMoneyLasts >= lifeHorizon ? 'lifetime' : String(yearsMoneyLasts),
              sub: `through age ${yearsMoneyLasts >= lifeHorizon ? lifeExpectancy : retirementAge + yearsMoneyLasts}`,
              tone: undefined as 'pos' | 'warn' | 'neg' | undefined,
            },
            view === 'simple'
              ? { label: 'Readiness', value: `${readiness.toFixed(0)}%`, sub: readinessLabel, tone: readinessTone }
              : { label: 'Monte Carlo', value: `${mcRate}%`, sub: '1,000 runs', tone: (mcRate >= 80 ? 'pos' : 'neg') as 'pos' | 'neg' },
          ]).map((item) => (
            <div key={item.label} className="border-l-2 border-line pl-3.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">{item.label}</div>
              <div
                className={cn(
                  'mt-1.5 font-editorial text-[24px] font-extrabold leading-none tracking-[-0.02em] ui-tnum',
                  item.tone === 'pos' && 'text-[rgb(var(--ui-brand-ink))]',
                  item.tone === 'warn' && 'text-caution',
                  item.tone === 'neg' && 'text-negative',
                )}
              >
                {item.value}
              </div>
              <div className="mt-1.5 text-[12px] font-medium text-content-muted">{item.sub}</div>
            </div>
          ))}
        </div>

        <LegalDisclaimer variant="projections" />

        <PageActions types="retirement" />

        {/* Assumptions sliders */}
        <Section title="Assumptions">
          <Card>
            <div
              className="ret-slider-row ret-sliders-grid"
              style={{ gridTemplateColumns: view === 'simple' ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)' }}
            >
              <div>
                {/* Label + value chip as a tight inline pair (left-aligned) so the
                    chip doesn't sit visually above the slider's right end-label. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <label className="ret-slider-label">Retirement age</label>
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
                    className="ret-slider-input ui-tnum"
                  />
                </div>
                <input type="range" min={currentAge} max={100} step={1} value={retirementAge}
                  onChange={e => setRetirementAge(+e.target.value)}
                  className="ret-slider" />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span className="text-[11px] font-semibold text-content-muted ui-tnum">{currentAge}</span>
                  <span className="text-[11px] font-semibold text-content-muted ui-tnum">100</span>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <label className="ret-slider-label">Life expectancy</label>
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
                    className="ret-slider-input ui-tnum"
                  />
                </div>
                <input type="range" min={retirementAge + 1} max={120} step={1} value={lifeExpectancy}
                  onChange={e => setLifeExpectancy(+e.target.value)}
                  className="ret-slider" />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span className="text-[11px] font-semibold text-content-muted ui-tnum">{retirementAge + 1}</span>
                  <span className="text-[11px] font-semibold text-content-muted ui-tnum">120</span>
                </div>
              </div>
              {view === 'simple' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <label className="ret-slider-label">Monthly spending</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={
                        // While editing, show raw draft. On blur the canonical value reflows
                        // through monthlySpendStr → setMonthlySpendStr below.
                        monthlySpendStr.startsWith('$')
                          ? monthlySpendStr
                          : `$${Number(monthlySpendStr || 0).toLocaleString('en-US')}`
                      }
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setMonthlySpendStr(raw);
                        const v = parseInt(raw, 10);
                        if (!isNaN(v) && v >= 500 && v <= 50000) setMonthlyRetirementSpend(v);
                      }}
                      onBlur={() => {
                        const v = parseInt(monthlySpendStr, 10);
                        const clamped = isNaN(v) ? 500 : Math.max(500, Math.min(50000, v));
                        setMonthlyRetirementSpend(clamped);
                        setMonthlySpendStr(String(clamped));
                      }}
                      className="ret-slider-input ui-tnum"
                      style={{ width: 96 }}
                    />
                  </div>
                  <input type="range" min={2000} max={20000} step={500} value={monthlyRetirementSpend}
                    onChange={e => setMonthlyRetirementSpend(+e.target.value)}
                    className="ret-slider" />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span className="text-[11px] font-semibold text-content-muted ui-tnum">$2k</span>
                    <span className="text-[11px] font-semibold text-content-muted ui-tnum">$20k</span>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </Section>

        {/* ── SIMPLE VIEW ──────────────────────────────────────────────────────── */}
        {view === 'simple' && (
          <>
            {/* Readiness + Income sub-cards */}
            <Section title="Income & longevity">
              <div
                className="ret-3col"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}
              >
                <Card>
                  <Eyebrow>Sustainable monthly income</Eyebrow>
                  <div className="ui-tnum font-editorial" style={{ fontWeight: 800, fontSize: 28, color: 'rgb(var(--ui-content))', lineHeight: 1.1, marginTop: 8, letterSpacing: '-0.02em' }}>
                    {formatMoney(monthlyRetirementIncome)}
                  </div>
                  <p className="text-[12.5px] text-content-muted" style={{ marginTop: 6 }}>4% rule from projected portfolio</p>
                  <div style={{ height: 4, background: 'var(--ui-line)', borderRadius: 2, marginTop: 12, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, (monthlyRetirementIncome / Math.max(monthlyRetirementSpend, 1)) * 100)}%`,
                      background: monthlyRetirementIncome >= monthlyRetirementSpend ? 'rgb(var(--ui-brand))' : 'rgb(var(--ui-negative))', /* income coverage bar */
                      borderRadius: 2,
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                  <p className="text-[12.5px] text-content-muted" style={{ marginTop: 6 }}>
                    {monthlyRetirementIncome >= monthlyRetirementSpend
                      ? 'covers your planned spending'
                      : `${formatMoney(Math.max(0, monthlyRetirementSpend - monthlyRetirementIncome))} short of plan`}
                  </p>
                </Card>
                <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 220, padding: 24 }}>
                  <ReadinessRing pct={readiness} />
                  <p className="text-[12.5px] text-content-muted" style={{ textAlign: 'center', margin: 0 }}>
                    {readinessLabel}
                  </p>
                </Card>
              </div>
            </Section>

            {/* Projection chart — Monte Carlo bands (1,000 randomized paths).
                Plan tab now shows the same uncertainty as the Advanced tab so
                users don't read a single deterministic line as a guarantee. */}
            <Section title="Projection" eyebrow={`Age ${currentAge} → ${Math.max(retirementAge + 20, 90)}`}>
              <Card style={{ padding: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 20px 12px', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <Eyebrow>Portfolio projection · 1,000 randomized runs</Eyebrow>
                    <p className="text-[13px] leading-relaxed text-content-secondary" style={{ marginTop: 6 }}>
                      At {expectedReturn.toFixed(1)}% avg return · {annualSavings > 0 ? `${formatMoney(annualSavings, true)}/yr contributions` : 'no contributions estimated'}
                    </p>
                    <p className="text-[12.5px] text-content-muted" style={{ marginTop: 4, opacity: 0.7 }}>
                      Bands show the range across 1,000 simulated market outcomes — not a guarantee.
                    </p>
                  </div>
                </div>
                <ProjectionFan bands={planBands} currentAge={currentAge} retirementAge={retirementAge} />
                <div style={{ display: 'flex', gap: 20, fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'rgb(var(--ui-content-muted))', padding: '4px 20px 20px', flexWrap: 'wrap' }}>
                  <span><span style={{ display: 'inline-block', width: 12, height: 6, background: 'var(--ui-viz-2)', opacity: 0.18, marginRight: 6, verticalAlign: 'middle' }} />p5–p95 range</span>
                  <span><span style={{ display: 'inline-block', width: 12, height: 6, background: 'var(--ui-viz-2)', opacity: 0.36, marginRight: 6, verticalAlign: 'middle' }} />p25–p75 likely</span>
                  <span><span style={{ display: 'inline-block', width: 12, height: 1.5, background: 'rgb(var(--ui-content-secondary))', marginRight: 6, verticalAlign: 'middle' }} />median (p50)</span>
                </div>
              </Card>
            </Section>
          </>
        )}

        {/* ── ADVANCED VIEW ──────────────────────────────────────────────────── */}
        {view === 'advanced' && (
          <SimulateView
            retirementAge={retirementAge}
            setRetirementAge={setRetirementAge}
            monthlySpend={monthlyRetirementSpend}
            setMonthlySpend={setMonthlyRetirementSpend}
            lifeExp={lifeExpectancy}
            setLifeExp={setLifeExpectancy}
            portfolioValue={portfolioValue}
            currentAge={currentAge}
            annualSavings={annualSavings}
            portfolioAtRetirement={portfolioAtRetirement}
            portfolioAllocation={allocation}
            actualBlendedReturn={blendedReturn}
            onRatesChange={handleRatesChange}
          />
        )}
      </motion.div>
    </div>
  );
}
