import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { cn, formatMoney } from '../lib/utils';
import { Building2, Check } from 'lucide-react';
import { PageActions } from '../components/common/page-actions';
import { LegalDisclaimer } from '../components/common/legal-disclaimer';
import {
  CPI_INFLATION, BOND_RETURNS, SP500_RETURNS,
  type WithdrawalStrategy, type BacktestYearData, type BacktestRow,
  computeWithdrawal, eraLabel, runBacktest, buildBands,
} from '../lib/retirement-engine';

// Abbreviated money for KPI tiles — parity with the page's $X.XM/$X.XB figures.
const fmtBig = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
  : formatMoney(v, true);
import { Button, EmptyState, Skeleton, SegmentedControl } from '../components/uikit';

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


// Deterministic RNG (mulberry32). The Monte Carlo engine defaults to
// Math.random, so two independent 1,000-run passes report slightly different
// success rates (e.g. 98% in the KPI strip vs 96% in the simulation focal) for
// the exact same inputs. Seeding makes a run reproducible so every consumer of
// the same inputs shows the same number. The MC algorithm itself is unchanged.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MC_SEED = 0x9e3779b9;

// Largest-remainder rounding: scale a set of parts to integer percentages that
// sum to exactly 100, so the allocation controls never display "totals 101%"
// from rounding each category independently.
function roundTo100(vals: McAlloc): McAlloc {
  const keys = Object.keys(vals) as (keyof McAlloc)[];
  const sum = keys.reduce((s, k) => s + vals[k], 0);
  if (sum <= 0) return { us: 0, intl: 0, bonds: 0, reit: 0, cash: 0 };
  const parts = keys.map(k => {
    const exact = (vals[k] / sum) * 100;
    const floor = Math.floor(exact);
    return { k, floor, rem: exact - floor };
  });
  let remaining = 100 - parts.reduce((s, p) => s + p.floor, 0);
  parts.sort((a, b) => b.rem - a.rem);
  const out = { us: 0, intl: 0, bonds: 0, reit: 0, cash: 0 } as McAlloc;
  parts.forEach((p, i) => { out[p.k] = p.floor + (i < remaining ? 1 : 0); });
  return out;
}

// Largest-remainder rounding over an arbitrary set of parts → integer percents
// summing to exactly 100. Used so the composition legend shows the same integers
// as the allocation slider inputs (e.g. Cash 8%, not a naive per-part 9% that
// makes the legend total 101%).
function intPercents(parts: number[]): number[] {
  const sum = parts.reduce((s, v) => s + v, 0);
  if (sum <= 0) return parts.map(() => 0);
  const rows = parts.map((v, i) => {
    const exact = (v / sum) * 100;
    const floor = Math.floor(exact);
    return { i, floor, rem: exact - floor };
  });
  const remaining = 100 - rows.reduce((s, r) => s + r.floor, 0);
  const order = [...rows].sort((a, b) => b.rem - a.rem);
  const out = parts.map(() => 0);
  rows.forEach(r => { out[r.i] = r.floor; });
  for (let k = 0; k < remaining && k < order.length; k++) out[order[k].i] += 1;
  return out;
}

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
      className={cn('text-[11px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--ui-accent-ink))]', className)}
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

// Local titled section — matches the app's editorial section anchor used on Home
// and Actions (accent dot + glow ring, serif title, optional note, trailing
// hairline rule) so retirement's sections read as designed, not retrofit.
function Section({ title, eyebrow, children, className }: { title?: React.ReactNode; eyebrow?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('mt-8', className)}>
      {(title || eyebrow) && (
        <div className="mb-4 flex items-center gap-3">
          {title && (
            <>
              <span
                className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))] shrink-0"
                style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
                aria-hidden
              />
              <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">{title}</h2>
            </>
          )}
          {eyebrow && <span className="hidden sm:block text-[12px] font-semibold text-content-muted ui-tnum">{eyebrow}</span>}
          <span className="flex-1 h-px bg-hairline min-w-[12px]" aria-hidden />
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
  getValue, getLabel, getSubline, getCurvePoint, hidePill = false, onHoverChange,
}: {
  width: number; height: number; paddingLeft: number; paddingRight: number; count: number;
  getValue: (i: number) => React.ReactNode; getLabel: (i: number) => React.ReactNode;
  getSubline?: (i: number) => React.ReactNode;
  getCurvePoint?: (i: number) => { x: number; y: number } | null;
  hidePill?: boolean;
  onHoverChange?: (i: number | null) => void;
}) {
  const [hoverIdx, setHoverIdxRaw] = useState<number | null>(null);
  const setHoverIdx = (i: number | null) => { setHoverIdxRaw(i); onHoverChange?.(i); };
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

// Measure a chart container's width so fixed-viewBox charts render at true
// device pixels. A fixed viewBox scaled to 100% squishes the chart (and its
// axis labels) to ~40% on a 390px phone; measuring keeps 1 unit ≈ 1px so text
// stays legible and the chart keeps its full height on narrow screens.
function useMeasuredWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, el.clientWidth || fallback));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

function ProjectionFan({
  bands,
  currentAge,
  retirementAge,
}: {
  bands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  currentAge: number;
  retirementAge: number;
}) {
  const [wrapRef, W] = useMeasuredWidth(760);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = bands.p50.length;
  if (n === 0) return null;

  const H = 220;
  const PL = 52; const PR = 16; const PT = 14; const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  // Iter 2 (redesign): LINEAR y-axis with a clip. The prior log axis compressed
  // a ~19× p5–p95 spread into a thin ribbon that over-promised certainty. Linear
  // tells the truth — the median sits far below the lucky right tail — but the
  // raw p95 final ($100M's) would flatten everything to $0. So we clip the
  // ceiling near ~2.4× the median final: the p5–p95 cone opens across most of
  // the frame, the median stays legible mid-chart, and p95 rides the top edge
  // (labelled "→ $X" so the off-frame upside is honest, not hidden).
  const maxV = Math.max(...bands.p95, 1);
  const lastI = n - 1;
  const medianFinal = bands.p50[lastI] || 1;
  const p75Final = bands.p75[lastI] || medianFinal;
  const startV = bands.p50[0] || 1000;
  const yMax = Math.max(startV * 1.12, Math.min(maxV, Math.max(p75Final * 1.05, medianFinal * 2.4)));
  const clipped = maxV > yMax * 1.03;
  const xf = (i: number) => PL + (i / (n - 1)) * chartW;
  const yf = (v: number) => {
    const t = Math.max(0, Math.min(1, v / yMax));
    return PT + chartH - t * chartH;
  };

  // Linear gridlines: 4 evenly-spaced ticks.
  const yTicks = [0.25, 0.5, 0.75, 1].map(pct => ({ pct, val: yMax * pct, y: PT + chartH - pct * chartH }));
  const retireIdx = Math.max(0, retirementAge - currentAge);
  const fmt = (v: number) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
    : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
    : `$${Math.round(v / 1000)}k`;
  // Compact axis labels: always $-prefixed, integer millions so long labels
  // (e.g. $2.9B / $641M) don't clip the leading $ on narrow phones.
  const fmtAxis = (v: number) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
    : v >= 1e6 ? `$${Math.round(v / 1e6)}M`
    : v >= 1e3 ? `$${Math.round(v / 1e3)}k`
    : `$${Math.round(v)}`;

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
    <div ref={wrapRef} style={{ position: 'relative' }}>
    {/* De-dup: the 40px card headline already owns the median-at-end. The
        default (non-hover) readout leads with a neutral inspect prompt — no
        number — so "$113.1M" is stated exactly once when idle. On hover it
        shows the hovered age's median + p5/p95.
        Inset the readout to the card's 20px content gutter so it lines up with
        the padded header above (the svg keeps its own internal y-axis gutter). */}
    <div style={{ padding: '0 20px' }}>
      <ChartReadout
        idx={hoverIdx}
        value={hoverIdx !== null ? `${fmt(bands.p50[hoverIdx])}` : 'Hover any age'}
        label={hoverIdx !== null ? `median at age ${currentAge + hoverIdx}` : 'to trace the median and its range'}
        sub={hoverIdx !== null ? `p5 ${fmt(bands.p5[hoverIdx])} · p95 ${fmt(bands.p95[hoverIdx])}` : undefined}
      />
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', pointerEvents: 'none' }}
      data-testid="projection-fan"
    >
      {/* Accumulation phase — a shaded zone before retirement so the low-value
          left half reads as an intentional "still building" phase, not dead
          space. Drawn first (behind gridlines + bands). Its right edge is the
          retirement divider, so the eye parses accumulate → draw-down. */}
      {retireIdx > 0 && retireIdx < n && (
        <rect x={xf(0)} y={PT} width={Math.max(0, xf(retireIdx) - xf(0))} height={chartH} className="ret-accum-zone" />
      )}
      {/* Only label the zone when it's wide enough to hold the word (far-off
          retirement); a 4-year sliver stays a clean tint. */}
      {retireIdx > 0 && (xf(retireIdx) - xf(0)) > 74 && (
        <text x={(xf(0) + xf(retireIdx)) / 2} y={PT + 12} textAnchor="middle" fontFamily="inherit" fontSize={9} letterSpacing="0.06em" fill="rgb(var(--ui-content-muted))">
          ACCUMULATING
        </text>
      )}

      {/* Gridlines + Y-axis labels */}
      {yTicks.map(({ pct, val, y }) => (
        <g key={pct}>
          <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--ui-line)" strokeDasharray="2 4" />
          <text x={PL - 6} y={y + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">
            {fmtAxis(val)}{pct === 1 && clipped ? '+' : ''}
          </text>
        </g>
      ))}

      {/* p95 rides above the clipped ceiling — label the off-frame upside so the
          clip is honest, not a hidden plateau. */}
      {clipped && (
        <text x={W - PR} y={PT + 11} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={10} fill="rgb(var(--ui-accent-ink))">
          best 5% → {fmt(maxV)}
        </text>
      )}

      {/* MC bands — outer (p5–p95) under inner (p25–p75), then median.
          Iter 6: switch from CSS `opacity` (which some renderers cache) to the
          SVG `fill-opacity` attribute so the values stick. */}
      <path d={band(bands.p95, bands.p5)} className="ret-fan-outer" data-band="p5-p95" />
      <path d={band(bands.p75, bands.p25)} className="ret-fan-inner" data-band="p25-p75" />
      <path d={linePath(bands.p50)} fill="none" stroke="rgb(var(--ui-content-secondary))" strokeWidth={1.5}
        strokeDasharray="5 4" strokeLinecap="round" data-band="p50" />

      {/* Retirement marker — drawn ON TOP of the bands with its label anchored
          at the TOP of the plot (not the baseline, where it used to collide with
          the flat median). A small filled pill keeps it legible over the fan. */}
      {retireIdx > 0 && retireIdx < n && (
        <>
          <line x1={xf(retireIdx)} x2={xf(retireIdx)} y1={PT} y2={H - PB}
            stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" strokeWidth={1} />
          <text x={xf(retireIdx) + 5} y={PT + 12} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontWeight={600} fontSize={11} fill="rgb(var(--ui-brand-ink))">
            retire {retirementAge}
          </text>
        </>
      )}

      {/* X-axis age labels */}
      <text x={xf(0)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">
        {currentAge}
      </text>
      <text x={xf(Math.floor((n - 1) / 2))} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))" textAnchor="middle">
        {currentAge + Math.floor((n - 1) / 2)}
      </text>
      <text x={xf(n - 1)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))" textAnchor="end">
        {currentAge + n - 1}
      </text>

    </svg>
    <ChartHover
      width={W}
      height={H}
      paddingLeft={PL}
      paddingRight={PR}
      count={n}
      hidePill
      onHoverChange={setHoverIdx}
      getValue={(i) => `${fmt(bands.p50[i])} @ ${currentAge + i}`}
      getLabel={(i) => `median (p50) at age ${currentAge + i}`}
      getSubline={(i) => `p5 ${fmt(bands.p5[i])} · p95 ${fmt(bands.p95[i])}`}
      getCurvePoint={(i) => ({ x: xf(i), y: yf(bands.p50[i]) })}
    />
    </div>
  );
}

// Compact value/date readout anchored above a fan chart (mirrors the /money
// pattern). Reserves a fixed height so hovering never shifts the layout, and
// keeps the tooltip out of the plot area where it used to cover the bands on
// narrow phones.
function ChartReadout({ idx, value, label, sub }: { idx: number | null; value: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', minHeight: 22, marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', color: idx !== null ? 'rgb(var(--ui-content))' : 'rgb(var(--ui-content-secondary))' }}>{value}</span>
      <span style={{ fontSize: 12, color: 'rgb(var(--ui-content-muted))' }}>{label}</span>
      {sub != null && sub !== '' && <span style={{ fontSize: 12, color: 'rgb(var(--ui-content-muted))', opacity: 0.75 }}>· {sub}</span>}
    </div>
  );
}

function FanChart({ bands, retireAge, currentAge }: { bands: ReturnType<typeof buildBands>; retireAge: number; currentAge: number }) {
  const [wrapRef, W] = useMeasuredWidth(760);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = bands.p50.length;
  const H = 220;
  const PL = 52; const PR = 16; const PT = 14; const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  // Linear y-axis with a clip (matches the Overview projection). The ceiling is
  // capped near ~2.4× the median final so the p5–p95 cone opens honestly instead
  // of the right tail flattening every other band onto $0. buildBands untouched.
  const maxV = Math.max(...bands.p95, 1);
  const lastI = n - 1;
  const medianFinal = bands.p50[lastI] || 1;
  const p75Final = bands.p75[lastI] || medianFinal;
  const startV = bands.p50[0] || 1000;
  const yMax = Math.max(startV * 1.12, Math.min(maxV, Math.max(p75Final * 1.05, medianFinal * 2.4)));
  const clipped = maxV > yMax * 1.03;
  const xf = (i: number) => PL + (i / Math.max(n - 1, 1)) * chartW;
  const yf = (v: number) => {
    const t = Math.max(0, Math.min(1, v / yMax));
    return PT + chartH - t * chartH;
  };
  const yTicks = [0.25, 0.5, 0.75, 1].map(pct => ({ pct, val: yMax * pct, y: PT + chartH - pct * chartH }));

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
  const retirePos = retireOffset < n ? xf(retireOffset) : xf(n - 1);

  const fmt = (v: number) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
    : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
    : `$${Math.round(v / 1000)}k`;
  const fmtAxis = (v: number) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
    : v >= 1e6 ? `$${Math.round(v / 1e6)}M`
    : v >= 1e3 ? `$${Math.round(v / 1e3)}k`
    : `$${Math.round(v)}`;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
    <ChartReadout
      idx={hoverIdx}
      value={hoverIdx !== null ? `${fmt(bands.p50[hoverIdx])}` : `${fmt(bands.p50[n - 1])}`}
      label={hoverIdx !== null ? `median at age ${currentAge + hoverIdx}` : `median at age ${currentAge + n - 1}`}
      sub={hoverIdx !== null ? `p25 ${fmt(bands.p25[hoverIdx])} · p75 ${fmt(bands.p75[hoverIdx])}` : 'projected range · hover to inspect'}
    />
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', pointerEvents: 'none' }}
      data-testid="fan-chart"
    >
      {/* Gridlines + Y-axis $ labels */}
      {yTicks.map(({ pct, val, y }) => (
        <g key={pct}>
          <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--ui-line)" strokeDasharray="2 4" />
          <text x={PL - 6} y={y + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">
            {fmtAxis(val)}{pct === 1 && clipped ? '+' : ''}
          </text>
        </g>
      ))}
      {clipped && (
        <text x={W - PR} y={PT + 11} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={10} fill="rgb(var(--ui-accent-ink))">
          best 5% → {fmt(maxV)}
        </text>
      )}
      <path d={path(bands.p95, bands.p5)} className="ret-fan-outer" data-band="p5-p95" />
      <path d={path(bands.p75, bands.p25)} className="ret-fan-inner" data-band="p25-p75" />
      <path d={path(bands.p50)} stroke="rgb(var(--ui-content-secondary))" strokeWidth="1.5" strokeDasharray="5 4" strokeLinecap="round" fill="none" data-band="p50" />
      {retireOffset > 0 && retireOffset < n && (
        <>
          <line x1={retirePos} x2={retirePos} y1={PT} y2={H - PB} stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" strokeWidth={1} />
          <text x={retirePos + 5} y={H - PB - 5} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="11" fill="rgb(var(--ui-brand))">
            retire {retireAge}
          </text>
        </>
      )}
      {/* X-axis age labels */}
      <text x={xf(0)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="11" fill="rgb(var(--ui-content-muted))">
        age {currentAge}
      </text>
      <text x={xf(Math.floor((n - 1) / 2))} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="11" fill="rgb(var(--ui-content-muted))" textAnchor="middle">
        {Math.round(currentAge + (n - 1) / 2)}
      </text>
      <text x={xf(n - 1)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize="11" fill="rgb(var(--ui-content-muted))" textAnchor="end">
        {currentAge + n - 1}
      </text>
    </svg>
    <ChartHover
      width={W}
      height={H}
      paddingLeft={PL}
      paddingRight={PR}
      count={n}
      hidePill
      onHoverChange={setHoverIdx}
      getValue={(i) => `${fmt(bands.p50[i])} @ ${currentAge + i}`}
      getLabel={(i) => `median (p50) at age ${currentAge + i}`}
      getSubline={(i) => `p25 ${fmt(bands.p25[i])} · p75 ${fmt(bands.p75[i])}`}
      getCurvePoint={(i) => ({ x: xf(i), y: yf(bands.p50[i]) })}
    />
    </div>
  );
}

function DistributionBar({ finalValues }: { finalValues: number[] }) {
  const [wrapRef, W] = useMeasuredWidth(720);
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
  const H = 160;
  const bw = W / histogram.length - 8;
  return (
    <div ref={wrapRef}>
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
    </div>
  );
}



// ── Backtest detail chart ────────────────────────────────────────────────────
function BacktestDetailChart({ yearByYear, dollars }: { yearByYear: BacktestYearData[]; dollars: 'real' | 'nominal' }) {
  const [wrapRef, W] = useMeasuredWidth(720);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!yearByYear.length) return null;
  const H = 220;
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
    <div ref={wrapRef} style={{ marginBottom: 12 }}>
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
            <text x={PL - 6} y={yf(maxV * pct) + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{fmt(maxV * pct)}</text>
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
            <text x={xf(retireIdx) + 4} y={PT + 12} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-brand))">retire</text>
          </>
        )}
        {/* X-axis labels */}
        {xLabels.map(i => (
          <text key={i} x={xf(i)} y={H - 4} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))"
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
  // Detect decimal format (total ≤ 1.0) and scale to percentages, then round
  // with largest-remainder so the parts sum to exactly 100 (avoids the
  // "totals 101%" artifact from rounding each category independently).
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  const scale = total <= 1.0 ? 100 : 1;
  return roundTo100({
    us: result.us * scale,
    intl: result.intl * scale,
    bonds: result.bonds * scale,
    reit: result.reit * scale,
    cash: result.cash * scale,
  });
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
    () => buildBands(portfolioValue, annualSavings, retirementAge, currentAge, expReturn, annualWithdrawal, equityFraction, inflAdj, strategy, makeRng(MC_SEED)),
    [portfolioValue, annualSavings, retirementAge, currentAge, expReturn, annualWithdrawal, equityFraction, inflAdj, strategy]
  );

  const mcSuccessRate = bands.mcSuccessRate;
  const mcSuccessColor = mcSuccessRate >= 80 ? 'rgb(var(--ui-brand-ink))' : mcSuccessRate >= 60 ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-negative))';

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
  const btSuccessColor = backtestSuccessRate >= 80 ? 'rgb(var(--ui-brand-ink))' : backtestSuccessRate >= 60 ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-negative))';

  useEffect(() => { onRatesChange?.(mcSuccessRate, backtestSuccessRate); }, [mcSuccessRate, backtestSuccessRate, onRatesChange]);

  return (
    <>

      {/* Withdrawal strategy */}
      <Eyebrow style={{ marginBottom: 10 }}>Withdrawal strategy</Eyebrow>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 20 }}>
          <SegmentedControl
            tone="brand"
            value={strategy}
            onChange={(v) => setStrategy(v)}
            options={[
              { value: 'constant_dollar', label: 'Constant 4%' },
              { value: 'percent_portfolio', label: '% of Portfolio' },
              { value: 'guardrails', label: 'Guardrails' },
            ]}
            aria-label="Withdrawal strategy"
          />
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
              className="ret-slider" />
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
              minHeight: 40, padding: '9px 16px', fontSize: 13, cursor: 'pointer',
              fontFamily: 'inherit', borderRadius: 999, fontWeight: 600,
              background: preset === p.id ? 'var(--ui-brand-soft)' : 'rgb(var(--ui-panel))',
              color: preset === p.id ? 'rgb(var(--ui-brand-ink))' : 'rgb(var(--ui-content-secondary))',
              border: `1px solid ${preset === p.id ? 'var(--ui-brand-ring)' : 'var(--ui-line)'}`,
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <span style={{
              minHeight: 40, display: 'inline-flex', alignItems: 'center', padding: '9px 16px', fontSize: 13, borderRadius: 999,
              background: 'rgb(var(--ui-canvas-sunken))', color: 'rgb(var(--ui-content-muted))',
              border: '1px solid var(--ui-line)', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
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
                className="ret-slider" />
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
          {/* Only flag a *meaningful* imbalance (user slider edits, >1%). A ≤1%
              rounding drift is normalized away and never surfaces an alarm. */}
          {Math.abs(allocTotal - 100) > 1 && (
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-caution))' }}>
              allocation totals {allocTotal}%
            </span>
          )}
        </div>
      </Card>

      {/* ── Method + values toggles (SegmentedControl, tight to content) ────── */}
      <Eyebrow style={{ marginBottom: 10 }}>Simulation</Eyebrow>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <SegmentedControl
          tone="brand"
          value={simTab}
          onChange={(v) => setSimTab(v)}
          options={[
            { value: 'mc', label: 'Monte Carlo' },
            { value: 'backtest', label: 'Historical Backtest' },
          ]}
          aria-label="Simulation method"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'rgb(var(--ui-content-muted))' }}>Values in</span>
          <SegmentedControl
            size="sm"
            value={dollars}
            onChange={(v) => setDollars(v)}
            options={[
              { value: 'real', label: 'Real $' },
              { value: 'nominal', label: 'Nominal $' },
            ]}
            aria-label="Values shown in real or nominal dollars"
          />
        </div>
      </div>

      {/* ── Focal probability — the confident number for the active method ──── */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <span className="font-editorial ui-tnum" style={{ fontSize: 52, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em', color: simTab === 'mc' ? mcSuccessColor : btSuccessColor }}>
            {simTab === 'mc' ? mcSuccessRate : backtestSuccessRate}%
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: 'rgb(var(--ui-content))' }}>
              {simTab === 'mc' ? 'chance your money lasts through age ' + lifeExp : 'of historical retirements survived'}
            </div>
            <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--ui-content-muted))', marginTop: 3, lineHeight: 1.5 }}>
              {simTab === 'mc'
                ? `${mcSuccessRate}% of 1,000 simulated market paths end with money left`
                : `${survived} of ${backtestRows.length} start years (1928–${1928 + Math.max(backtestRows.length - 1, 0)}) lasted the full ${lifeHorizon} years`}
              {dollars === 'real' && ` · shown in today's dollars${simTab === 'backtest' ? ' (historical CPI)' : ' (3%/yr)'}`}
            </div>
          </div>
        </div>
      </Card>

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
              <span><span className="ret-sw-outer" style={{ display: 'inline-block', width: 12, height: 6, marginRight: 6, verticalAlign: 'middle' }}></span>p5–p95</span>
              <span><span className="ret-sw-inner" style={{ display: 'inline-block', width: 12, height: 6, marginRight: 6, verticalAlign: 'middle' }}></span>p25–p75</span>
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
              <Card style={{ marginBottom: 20, background: 'var(--ui-negative-soft)', border: '1px solid rgb(var(--ui-negative) / 0.35)' }}>
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
  // Liquid (penalty-free, accessible-now) slice of the accessible portfolio —
  // cash + taxable brokerage/crypto, net of debt. `portfolioValue` is the full
  // accessible base (liquid + retirement accounts). The gap between them is the
  // money locked behind the 59½ early-withdrawal penalty.
  const [liquidValue, setLiquidValue] = useState(0);
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
      const balances = (balanceData as { balances: Array<{ balance?: string; type?: string; subtype?: string }> }).balances;
      setHasAccounts(balances.length > 0);

      // Only count what a retiree can *actually* spend. Primary-home equity and
      // illiquid alternatives (PE / hedge / angel) are excluded — you can't fund
      // groceries with your house. Tax-advantaged retirement accounts are kept
      // but tracked separately from liquid savings, because they carry a 10%
      // early-withdrawal penalty before 59½ (surfaced downstream).
      // Match retirement accounts by keyword — real subtypes vary (roth, ira,
      // roth_ira, 401k, 403b, 457, sep_ira, hsa…), so a fixed set misses some.
      const RET_RE = /401k|403b|457|ira|roth|sep|simple|pension|hsa|annuity/;
      let liquid = 0; let retirement = 0; let liabilities = 0;
      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        const t = b.type; const st = (b.subtype || '').toLowerCase();
        if (t === 'credit') { liabilities += Math.abs(val); continue; }
        // Mortgage is debt against the (excluded) home — drop it with the home
        // so we don't subtract it from liquid savings. Other loans still count.
        if (t === 'loan') { if (st !== 'mortgage') liabilities += Math.abs(val); continue; }
        if (t === 'real_estate' || t === 'alternative') continue; // illiquid — not spendable
        if (t === 'investment') {
          if (st === '529') continue; // education-earmarked, not retirement-spendable
          if (RET_RE.test(st)) { retirement += val; continue; }
        }
        liquid += val; // depository + taxable investment (brokerage/crypto/utma/…)
      }
      // Non-mortgage debt is served from accessible money, not locked accounts.
      const liquidNet = Math.max(0, liquid - liabilities);
      const accessible = liquidNet + retirement;
      if (accessible > 0) { setPortfolioValue(accessible); setLiquidValue(liquidNet); }

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
  // Safe withdrawal (4%) split by accessibility. `liquidFrac` is today's
  // accessible-vs-total ratio; growth is uniform so it carries to retirement.
  const RETIREMENT_ACCESS_AGE = 59.5;
  const retirementAccountsLocked = retirementAge < RETIREMENT_ACCESS_AGE;
  const liquidFrac = portfolioValue > 0 ? Math.min(1, liquidValue / portfolioValue) : 1;
  // Income from accessible savings alone (no penalty), and the full figure
  // including retirement accounts (haircut 10% when tapped before 59½).
  const monthlyIncomeLiquid = Math.round((portfolioAtRetirement * liquidFrac * 0.04) / 12);
  const penaltyFactor = retirementAccountsLocked ? 0.9 : 1;
  const monthlyRetirementIncome = Math.round(
    (portfolioAtRetirement * (liquidFrac + (1 - liquidFrac) * penaltyFactor) * 0.04) / 12,
  );
  // Only surface the dual figure when retirement accounts are both locked AND a
  // meaningful slice of the base — otherwise X≈Y and the caveat is just noise.
  const showAccessSplit = retirementAccountsLocked && liquidFrac < 0.97 && monthlyIncomeLiquid < monthlyRetirementIncome;
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
      makeRng(MC_SEED), // seed the plan-band MC so the headline % + median $ are stable across reloads
    ),
    [portfolioValue, annualSavings, retirementAge, currentAge, expectedReturn, annualExpenses, planEquityFraction],
  );

  // Overview projection is shown in TODAY'S dollars (real) so the nominal
  // $95M/$500M end-values don't mislead the reader. Deflate each band by 3%/yr
  // from the current age — the same transform the Detailed simulation uses.
  // mcSuccessRate is unaffected (deflation never turns a surviving path into a
  // depleted one), so it stays sourced from the untouched planBands.
  const planBandsReal = useMemo(() => {
    const deflate = (v: number, t: number) => Math.round(v / Math.pow(1.03, t));
    return {
      ...planBands,
      p5: planBands.p5.map(deflate),
      p25: planBands.p25.map(deflate),
      p50: planBands.p50.map(deflate),
      p75: planBands.p75.map(deflate),
      p95: planBands.p95.map(deflate),
    };
  }, [planBands]);

  if (loading) {
    // Iter 7 D: cached shell so first paint isn't blank ~300ms while the
    // accounts query + MC compute spin up. Same outline as the loaded page
    // (page-bar + projection fan height) so swap-in doesn't jolt. The header
    // must match the loaded page exactly — a different heading here reads as
    // a flash when the data resolves quickly.
    return (
      <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
        <header>
          <div className="flex items-center gap-2.5">
            <span
              className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
              aria-hidden
            />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Retirement</span>
          </div>
          <h1 className="mt-2 font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
            Will your money last?
          </h1>
          <Skeleton className="mt-2.5 h-3 w-52" />
        </header>
        <Skeleton className="mt-8 h-3 w-32" />
        <Skeleton className="mt-4 h-[320px] w-full rounded-ui-xl" />
      </div>
    );
  }

  if (!hasAccounts) {
    return (
      <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
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

  // Assumptions + advanced simulation extracted to nodes so Detailed can lead
  // with them (right under the hero) while Overview keeps them at the bottom —
  // without rendering either block twice.
  const assumptionsSection = (
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
  );

  const simulateSection = (
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
  );

  // Page-scoped responsive helpers — kept inline since they're page-specific.
  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
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
          /* iOS-minimum tap target for the Overview/Detailed toggle. */
          .ret-view-toggle button {
            min-height: 44px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
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
        /* Only own the bottom gap — leave margin-top to the element's mt-6
           utility (24px). Setting margin:0 here used to zero that top gap, so
           the KPI strip collided with the Assumptions card above it. */
        .ret-stats { margin-bottom: 32px; }
        /* Fan-chart bands. Light mode needs more ink than dark — the pale
           periwinkle washed out to near-invisible in light, so the two bands
           couldn't be told apart. Dark keeps the original (already legible)
           values. */
        .ret-fan-outer { fill: var(--ui-viz-2); fill-opacity: 0.18; }
        .ret-fan-inner { fill: var(--ui-viz-2); fill-opacity: 0.34; }
        .dark .ret-fan-outer { fill-opacity: 0.12; }
        .dark .ret-fan-inner { fill-opacity: 0.20; }
        /* Accumulation-phase backdrop (pre-retirement). A faint green wash so the
           low-value left half reads as "still building", not empty. */
        .ret-accum-zone { fill: rgb(var(--ui-brand)); fill-opacity: 0.09; }
        .dark .ret-accum-zone { fill-opacity: 0.10; }
        /* Legend swatches track the band opacities per theme. */
        .ret-sw-outer { background: var(--ui-viz-2); opacity: 0.30; }
        .ret-sw-inner { background: var(--ui-viz-2); opacity: 0.55; }
        .dark .ret-sw-outer { opacity: 0.18; }
        .dark .ret-sw-inner { opacity: 0.36; }
      `}</style>

      {/* Header sits outside the fade wrapper: the loading shell already
          painted this exact heading, so animating it from opacity 0 would
          blank and re-reveal it — the flash we're avoiding. */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
              aria-hidden
            />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Retirement</span>
          </div>
          <h1 className="mt-2 font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
            Will your money last?
          </h1>
          <p className="mt-1.5 text-[14px] font-medium text-content-muted ui-tnum">
            {yearsUntilRetirement} year{yearsUntilRetirement === 1 ? '' : 's'} to retirement · planning through age {lifeExpectancy}
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

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >

        {/* ── HERO ANSWER — the one confident number: are you on track? ──────── */}
        {(() => {
          // Detailed mode leads with the advanced tools, so the hero collapses to
          // a compact single-row answer (number + status + one-line summary) and
          // drops the coverage bar. Overview keeps the full readiness moment.
          const compact = view === 'advanced';
          const readinessColor =
            readiness >= 80 ? 'rgb(var(--ui-brand-ink))' : readiness >= 50 ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-negative))';
          const covered = monthlyRetirementIncome >= monthlyRetirementSpend;
          const coveragePct = Math.min(100, (monthlyRetirementIncome / Math.max(monthlyRetirementSpend, 1)) * 100);
          const pill =
            readinessTone === 'pos'
              ? { bg: 'var(--ui-brand-soft)', fg: 'rgb(var(--ui-brand-ink))' }
              : readinessTone === 'warn'
              ? { bg: 'var(--ui-caution-soft)', fg: 'rgb(var(--ui-caution))' }
              : { bg: 'var(--ui-negative-soft)', fg: 'rgb(var(--ui-negative))' };
          return (
            <section
              data-hero
              className="relative mt-8 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7"
            >
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'radial-gradient(95% 85% at 0% 0%, var(--ui-accent-softer), transparent 60%),' +
                    'radial-gradient(80% 70% at 100% 8%, var(--ui-info-soft), transparent 62%)',
                }}
              />
              <div
                className={cn('relative', !compact && 'ret-readiness-grid grid items-center gap-7 sm:gap-9')}
                style={!compact ? { gridTemplateColumns: 'minmax(0, 1fr) 236px' } : undefined}
              >
                {/* lead — the answer (single readiness moment: big % + coverage bar) */}
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">Retirement readiness</div>
                  <div className="mt-2 flex items-end gap-3 flex-wrap">
                    <span
                      className={cn(
                        'font-editorial font-extrabold leading-[0.82] tracking-[-0.03em] ui-tnum',
                        compact ? 'text-[40px] sm:text-[48px]' : 'text-[56px] sm:text-[68px]',
                      )}
                      style={{ color: readinessColor }}
                    >
                      {readiness.toFixed(0)}%
                    </span>
                    <span
                      className="mb-2 inline-flex items-center h-7 px-3 rounded-full text-[12.5px] font-bold"
                      style={{ background: pill.bg, color: pill.fg }}
                    >
                      {readinessLabel}
                    </span>
                  </div>
                  {compact ? (
                    <p className="mt-3 text-[13.5px] leading-[1.5] text-content-secondary max-w-[54ch]">
                      Funding retirement at age <span className="ui-tnum">{retirementAge}</span> through{' '}
                      <span className="ui-tnum">{lifeExpectancy}</span>.{' '}
                      {covered
                        ? 'Safe income covers your plan in full.'
                        : `${formatMoney(Math.max(0, monthlyRetirementSpend - monthlyRetirementIncome))}/mo short of plan.`}{' '}
                      Adjust the levers below to explore.
                    </p>
                  ) : (
                    <>
                      <p className="mt-4 text-[15px] leading-[1.55] text-content-secondary max-w-[50ch]">
                        On track to fully fund retirement by age{' '}
                        <span className="ui-tnum">{retirementAge}</span>. At a 4% safe withdrawal rate, that's{' '}
                        {yearsMoneyLasts >= lifeHorizon
                          ? 'enough income to last a full lifetime.'
                          : `enough to last roughly ${yearsMoneyLasts} year${yearsMoneyLasts === 1 ? '' : 's'}.`}
                      </p>
                      {/* coverage — does the safe income cover the plan? The big
                          readiness figure already owns "100%"; this bar is a
                          labeled status (check / shortfall), never a second
                          "100%". */}
                      <div className="mt-5 max-w-[440px]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold text-content-muted">Safe income vs your {formatMoney(monthlyRetirementSpend)}/mo plan</span>
                          {covered ? (
                            <span className="inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: 'rgb(var(--ui-brand-ink))' }}>
                              <Check size={13} strokeWidth={3} aria-hidden /> Covered
                            </span>
                          ) : (
                            <span className="text-[12.5px] font-extrabold ui-tnum" style={{ color: 'rgb(var(--ui-negative))' }}>
                              {coveragePct.toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div className="h-[9px] rounded-full bg-canvas-sunken overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(coveragePct, 3)}%`,
                              background: covered ? 'rgb(var(--ui-brand))' : 'rgb(var(--ui-negative))',
                              transition: 'width 0.6s ease',
                            }}
                          />
                        </div>
                        <div className="mt-2 text-[12px] font-semibold text-content-muted ui-tnum">
                          {covered
                            ? 'Your safe income meets the plan every month'
                            : `${formatMoney(Math.max(0, monthlyRetirementSpend - monthlyRetirementIncome))}/mo short of plan`}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {/* right — supporting KPIs fill the hero width (was dead space).
                    Simple view only; Detailed's compact hero leads with tools. */}
                {!compact && (
                  <div className="ret-readiness-kpis grid grid-cols-1 gap-4 sm:border-l sm:border-line sm:pl-7">
                    {[
                      { label: 'Portfolio at retirement', value: fmtBig(portfolioAtRetirement), sub: `age ${retirementAge}` },
                      { label: 'Safe monthly income', value: formatMoney(monthlyRetirementIncome, true) + (showAccessSplit ? '*' : ''), sub: showAccessSplit ? `${formatMoney(monthlyIncomeLiquid, true)}/mo from savings alone` : '4% rule · projected' },
                      { label: 'Years money lasts', value: yearsMoneyLasts >= lifeHorizon ? 'lifetime' : String(yearsMoneyLasts), sub: `through age ${yearsMoneyLasts >= lifeHorizon ? lifeExpectancy : retirementAge + yearsMoneyLasts}` },
                    ].map((k) => (
                      <div key={k.label}>
                        <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">{k.label}</div>
                        <div className="mt-1 font-editorial text-[22px] font-extrabold leading-none tracking-[-0.02em] ui-tnum text-content">{k.value}</div>
                        <div className="mt-1 text-[11.5px] font-medium text-content-muted">{k.sub}</div>
                      </div>
                    ))}
                    {showAccessSplit && (
                      <p className="text-[11px] leading-[1.45] text-content-muted">
                        * Includes retirement accounts — a 10% penalty applies to withdrawals before 59½.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* Composition + Actions surface directly under the hero (both views) —
            allocation and next-steps read as the at-a-glance layer, before the
            deeper levers/projection/tools below. */}
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
          const raw = Object.entries(allocation)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => ({
              label: labelMap[k] ?? k,
              value: Math.round((v / total) * portfolioValue),
              pct: (v / total) * 100,
            }))
            .sort((a, b) => b.pct - a.pct);
          if (raw.length === 0) return null;
          // Collapse the sub-1.5% long tail into one neutral "Other" segment so
          // the bar doesn't fan out into a rainbow of unreadable slivers (same
          // treatment as /portfolio). Only collapses when it removes ≥2 slivers.
          const MIN_PCT = 1.5;
          const small = raw.filter(s => s.pct < MIN_PCT);
          const big = raw.filter(s => s.pct >= MIN_PCT);
          const kept = small.length >= 2 ? big : raw;
          const otherPct = small.length >= 2 ? small.reduce((s, x) => s + x.pct, 0) : 0;
          const otherVal = small.length >= 2 ? small.reduce((s, x) => s + x.value, 0) : 0;
          const segments = [
            ...kept.map((s, i) => ({ ...s, color: `var(--ui-viz-${(i % 7) + 1})` })),
            ...(otherPct > 0 ? [{ label: 'Other', value: otherVal, pct: otherPct, color: 'rgb(var(--ui-content-muted))' }] : []),
          ];
          if (segments.length === 0) return null;
          // Display integers via largest-remainder so the legend sums to 100 and
          // matches the allocation slider inputs (Cash 8%, not 9%).
          const dispPct = intPercents(segments.map(s => s.pct));
          return (
            <Section
              title="Portfolio composition"
              eyebrow={<span className="text-[rgb(var(--ui-brand-ink))] font-bold ui-tnum">{expectedReturn.toFixed(1)}% blended return</span>}
            >
            <Card>
              <div className="flex h-3 overflow-hidden rounded-full bg-canvas-sunken" style={{ gap: 1, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32)' }}>
                {segments.map((s, i) => (
                  <div key={s.label} style={{ width: `${s.pct}%`, background: s.color, minWidth: 2 }} title={`${s.label} · ${dispPct[i]}%`} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {segments.map((s, i) => (
                  <span key={s.label} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-content-secondary ui-tnum">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
                    {s.label} {dispPct[i]}%
                  </span>
                ))}
              </div>
            </Card>
            </Section>
          );
        })()}

        <div className="mt-8">
          <PageActions types="retirement" />
        </div>

        {/* ── DETAILED LEADS WITH THE ADVANCED TOOLS ─────────────────────────
            In Detailed mode the point of the page is the simulation + controls,
            so surface them directly under the hero (assumptions → withdrawal +
            allocation controls → Monte Carlo / Backtest) instead of burying them
            beneath the full Overview stack. The KPI strip / composition / legal /
            actions below then read as supporting context, not the main event. */}
        {view === 'advanced' && (
          <div className="mt-8">
            {assumptionsSection}
            <div className="mt-8">
              {simulateSection}
            </div>
          </div>
        )}

        {/* Overview: levers first, then the projection they drive — so the inputs
            precede the output and the chart updates just below as you adjust. */}
        {view === 'simple' && assumptionsSection}

        {/* ── PROJECTION — the centerpiece: "will your money last?" ──────────── */}
        {view === 'simple' && (() => {
          const lasts = planBands.mcSuccessRate;
          const runsOut = 100 - lasts;
          const lastI = planBandsReal.p50.length - 1;
          const medianEnd = planBandsReal.p50[lastI] || 0;
          const p5End = planBandsReal.p5[lastI] || 0;
          // Compact $ (M/B) so the headline + spread read like the chart axis
          // ("$113.1M"), not a 9-digit string ($113,097,620).
          const abbr = (v: number) =>
            v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
            : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
            : v >= 1e3 ? `$${Math.round(v / 1e3)}k`
            : `$${Math.round(v)}`;
          // Magnitude context so the median reads as a consequence, not a demo:
          // how many multiples of today's portfolio, at what withdrawal rate
          // (annual spend ÷ current portfolio — the same "% of current
          // portfolio" definition the Detailed tab uses).
          const mult = portfolioValue > 0 ? medianEnd / portfolioValue : 0;
          const multStr = mult >= 10 ? `${Math.round(mult)}×` : `${mult.toFixed(1)}×`;
          const wr = portfolioValue > 0 ? (annualExpenses / portfolioValue) * 100 : 0;
          return (
          <Section title="Projection" eyebrow={`Today's dollars · age ${currentAge} → ${Math.max(retirementAge + 30, 90)}`}>
            <Card style={{ padding: 0 }}>
              <div style={{ padding: '20px 20px 12px' }}>
                {/* Anchor the median outcome in context — the believable proof.
                    The readiness hero owns the headline %, and the section header
                    owns the "today's dollars" framing, so the card leads straight
                    with the dollar median + honest spread — no third label. */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span className="font-editorial ui-tnum" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em', color: 'rgb(var(--ui-content))' }}>
                    {abbr(medianEnd)}
                  </span>
                  <span className="text-[15px] font-semibold text-content" style={{ minWidth: 0 }}>
                    median portfolio at age {lifeExpectancy}
                  </span>
                </div>
                <p className="text-[12.5px] text-content-muted" style={{ marginTop: 8, lineHeight: 1.55 }}>
                  <span className="ui-tnum" style={{ color: 'rgb(var(--ui-content-secondary))', fontWeight: 600 }}>≈{multStr}</span> your {abbr(portfolioValue)} today at a ~{wr.toFixed(1)}% withdrawal rate, in today's dollars.
                  {' '}Even the worst 5% of paths end near <span className="ui-tnum" style={{ color: 'rgb(var(--ui-content-secondary))', fontWeight: 600 }}>{abbr(p5End)}</span> —{' '}
                  {runsOut <= 0 ? 'money lasts in every simulated path.' : `money runs out in ${runsOut}% of 1,000 paths.`}
                  {' '}Not a guarantee.
                </p>
              </div>
              <ProjectionFan bands={planBandsReal} currentAge={currentAge} retirementAge={retirementAge} />
              <div style={{ display: 'flex', gap: 20, fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'rgb(var(--ui-content-muted))', padding: '4px 20px 20px', flexWrap: 'wrap' }}>
                <span><span className="ret-sw-outer" style={{ display: 'inline-block', width: 12, height: 6, marginRight: 6, verticalAlign: 'middle' }} />p5–p95 range</span>
                <span><span className="ret-sw-inner" style={{ display: 'inline-block', width: 12, height: 6, marginRight: 6, verticalAlign: 'middle' }} />p25–p75 likely</span>
                <span><span style={{ display: 'inline-block', width: 12, height: 1.5, background: 'rgb(var(--ui-content-secondary))', marginRight: 6, verticalAlign: 'middle' }} />median (p50)</span>
              </div>
            </Card>
          </Section>
          );
        })()}

        {/* ── SUPPORTING KPIs (Detailed only) ────────────────────────────────
            Overview surfaces these in the hero's right column, so the strip
            would double-print them. Detailed's compact hero has no KPI column,
            so the strip carries them here (plus Monte Carlo). */}
        {view === 'advanced' && (
        <div data-stats className="ret-stats mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {([
            {
              label: 'Portfolio at retirement',
              value: fmtBig(portfolioAtRetirement),
              sub: `age ${retirementAge}`,
              tone: undefined as 'pos' | 'warn' | 'neg' | undefined,
            },
            {
              label: 'FIRE number',
              value: fmtBig(fireNumber),
              sub: '25× annual spend',
              tone: undefined as 'pos' | 'warn' | 'neg' | undefined,
            },
            {
              label: 'Years money lasts',
              value: yearsMoneyLasts >= lifeHorizon ? 'lifetime' : String(yearsMoneyLasts),
              sub: `through age ${yearsMoneyLasts >= lifeHorizon ? lifeExpectancy : retirementAge + yearsMoneyLasts}`,
              tone: undefined as 'pos' | 'warn' | 'neg' | undefined,
            },
            { label: 'Monte Carlo', value: `${mcRate}%`, sub: '1,000 runs', tone: (mcRate >= 80 ? 'pos' : 'neg') as 'pos' | 'neg' },
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
        )}

        <LegalDisclaimer variant="projections" />
      </motion.div>
    </div>
  );
}
