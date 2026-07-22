import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { api } from '../lib/api';
import { useChatStore } from '../lib/chat-store';
import { useAuth } from '../lib/auth';
import { cn, formatMoney } from '../lib/utils';
import { ChevronDown, ChevronUp, Download, Sparkles, Building2, GripVertical, Pencil, Check } from 'lucide-react';
import { LegalDisclaimer } from '../components/common/legal-disclaimer';
import { Button, SegmentedControl, Skeleton } from '../components/uikit';
import { vizVar } from '../components/uikit/viz';
import {
  buildBands, runBacktest, makeRng, computeWithdrawal,
  type WithdrawalStrategy, type BacktestRow, type StrategyParams,
} from '../lib/retirement-engine';

// ── Model constants ──────────────────────────────────────────────────────────
const SEED = 0x9e3779b9;
const INFLATION = 0.03;           // matches the engine's hardcoded MC inflation
const TARGET_SUCCESS = 85;        // "on track" threshold + safe-spend target
const SMILE_DECLINE = 0.99;       // ~1%/yr real spending decline when enabled

// Social Security quick estimate — 2025 bend points + wage cap. A deliberate
// rough cut (assumes current income ≈ career-average indexed earnings); the
// user can overwrite the dollar figure directly.
const SS_WAGE_CAP = 176_100;
function estimateSSMonthly(annualIncome: number, claimAge: number): number {
  if (annualIncome <= 0) return 0;
  const aime = Math.min(annualIncome, SS_WAGE_CAP) / 12;
  const pia =
    0.9 * Math.min(aime, 1226) +
    0.32 * Math.max(0, Math.min(aime, 7391) - 1226) +
    0.15 * Math.max(0, aime - 7391);
  // Claim-age adjustment vs full retirement age 67: −5/9% per month for the
  // first 36 early months, −5/12% beyond; +8%/yr delayed credits to 70.
  const months = Math.round((claimAge - 67) * 12);
  const factor = months >= 0
    ? 1 + Math.min(months, 36) * (0.08 / 12)
    : 1 - Math.min(-months, 36) * (5 / 900) - Math.max(0, -months - 36) * (5 / 1200);
  return Math.round(pia * factor);
}

// Guaranteed-income schedule for the Monte Carlo engine: nominal $/yr at each
// age. SS + other income grow at the model's 3% from retirement (COLA), and
// the spending "smile" is folded in as a reduction against the engine's
// inflation-grown constant-dollar target (need·1.03ᵗ·(1 − 0.99ᵗ) ≥ 0).
function makeGiFn(opts: {
  retireAge: number; ssAnnual: number; ssClaimAge: number;
  otherAnnual: number; otherStartAge: number;
  smile: boolean; annualSpend: number;
}): ((age: number) => number) | undefined {
  const { retireAge, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, smile, annualSpend } = opts;
  if (ssAnnual <= 0 && otherAnnual <= 0 && !smile) return undefined;
  return (age: number) => {
    const t = Math.max(0, age - retireAge);
    const infl = Math.pow(1 + INFLATION, t);
    let gi = 0;
    if (ssAnnual > 0 && age >= ssClaimAge) gi += ssAnnual * infl;
    if (otherAnnual > 0 && age >= otherStartAge) gi += otherAnnual * infl;
    if (smile) gi += annualSpend * infl * (1 - Math.pow(SMILE_DECLINE, t));
    return gi;
  };
}

// Same schedule for the historical backtest — real (first-retirement-year) $
// per withdrawal-year index; the engine applies its own CPI factor.
function makeGiArray(opts: {
  retireAge: number; lifeHorizon: number; ssAnnual: number; ssClaimAge: number;
  otherAnnual: number; otherStartAge: number; smile: boolean; annualSpend: number;
}): number[] | undefined {
  const { retireAge, lifeHorizon, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, smile, annualSpend } = opts;
  if (ssAnnual <= 0 && otherAnnual <= 0 && !smile) return undefined;
  return Array.from({ length: lifeHorizon }, (_, i) => {
    const age = retireAge + i;
    let gi = 0;
    if (ssAnnual > 0 && age >= ssClaimAge) gi += ssAnnual;
    if (otherAnnual > 0 && age >= otherStartAge) gi += otherAnnual;
    if (smile) gi += annualSpend * (1 - Math.pow(SMILE_DECLINE, i));
    return gi;
  });
}

// ── Formatting ───────────────────────────────────────────────────────────────
const fmtShort = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
  : v >= 1e3 ? `$${Math.round(v / 1e3)}k`
  : `$${Math.round(v)}`;
const fmtAxis = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${Math.round(v / 1e6)}M`
  : v >= 1e3 ? `$${Math.round(v / 1e3)}k`
  : `$${Math.round(v)}`;

// ── Shared page atoms ────────────────────────────────────────────────────────
function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn('rounded-ui-xl border border-line bg-panel shadow-ui-sm', className)} style={{ padding: 20, ...style }}>
      {children}
    </div>
  );
}

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

// Single-select dropdown styled to match the app's other custom dropdowns
// (trigger button + portaled popover, like the transactions filter menus)
// rather than a native <select> whose option list is the OS's own chrome. The
// menu is portaled to <body> so the verdict card's overflow-hidden can't clip
// it. Closes on select, outside-click, Escape, scroll, or resize.
function MethodDropdown<T extends string>({ value, onChange, options, ariaLabel, triggerTestId }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
  triggerTestId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const menuH = options.length * 38 + 10;
    const up = r.bottom + menuH + 8 > window.innerHeight && r.top - menuH > 8;
    setPos({ top: up ? r.top - menuH - 6 : r.bottom + 6, left: r.left, width: r.width });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    const onReflow = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open]);

  const current = options.find(o => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid={triggerTestId}
        className="ui-focus touch-target relative h-9 w-full appearance-none truncate rounded-ui-md border border-line bg-panel pl-3 pr-9 text-left text-[13px] font-semibold text-content shadow-ui-sm"
      >
        {current?.label ?? ''}
        <ChevronDown size={15} className={cn('pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
          className="max-h-[280px] overflow-y-auto rounded-ui-md border border-line-strong bg-panel-raised py-1 shadow-ui-lg"
        >
          {options.map(opt => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(opt.value); setOpen(false); triggerRef.current?.focus(); }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium transition-colors',
                  active ? 'bg-brand-soft text-brand' : 'text-content hover:bg-canvas-sunken',
                )}
              >
                <Check size={14} className={cn('shrink-0', active ? 'opacity-100' : 'opacity-0')} aria-hidden />
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

// Measure a chart container so fixed-viewBox SVGs render at true device pixels
// (1 viewBox unit ≈ 1 CSS px) — keeps hover math exact and text legible.
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

// ── Hero fan chart ───────────────────────────────────────────────────────────
// All hover visuals (crosshair, marker, tooltip) are drawn as SVG elements in
// the same coordinate system as the curves — the marker sits exactly on the
// median polyline by construction, and tooltip values read from the same
// arrays that painted the bands.
function FanChartV2({ bands, currentAge, retireAge, clipLabel = 'best 5%', percentileLabels = ['5th', '25th', 'Median', '75th', '95th'] }: {
  bands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  currentAge: number;
  retireAge: number;
  clipLabel?: string;
  /** Display names for the p5…p95 arrays, low → high — the historical envelope
   * stores 10th/90th cohort percentiles in the p5/p95 slots. */
  percentileLabels?: [string, string, string, string, string];
}) {
  const [wrapRef, W] = useMeasuredWidth(760);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = bands.p50.length;
  if (n === 0) return null;

  const H = 240;
  const PL = 52; const PR = 16; const PT = 16; const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  // Linear y-axis with an honest clip: cap the ceiling near ~2.4× the median
  // final so the lucky right tail doesn't flatten everything onto $0.
  const maxV = Math.max(...bands.p95, 1);
  const lastI = n - 1;
  const medianFinal = bands.p50[lastI] || 1;
  const p75Final = bands.p75[lastI] || medianFinal;
  const startV = bands.p50[0] || 1000;
  const yMax = Math.max(startV * 1.12, Math.min(maxV, Math.max(p75Final * 1.05, medianFinal * 2.4)));
  const clipped = maxV > yMax * 1.03;

  const xf = (i: number) => PL + (i / Math.max(n - 1, 1)) * chartW;
  const yf = (v: number) => PT + chartH - Math.max(0, Math.min(1, v / yMax)) * chartH;
  const yTicks = [0.25, 0.5, 0.75, 1].map(pct => ({ pct, val: yMax * pct, y: PT + chartH - pct * chartH }));

  const band = (upper: number[], lower: number[]) => {
    let d = `M ${xf(0)},${yf(upper[0])}`;
    for (let i = 1; i < n; i++) d += ` L ${xf(i)},${yf(upper[i])}`;
    for (let i = n - 1; i >= 0; i--) d += ` L ${xf(i)},${yf(lower[i])}`;
    return d + ' Z';
  };
  const line = (arr: number[]) => {
    let d = `M ${xf(0)},${yf(arr[0])}`;
    for (let i = 1; i < n; i++) d += ` L ${xf(i)},${yf(arr[i])}`;
    return d;
  };

  const retireIdx = Math.max(0, retireAge - currentAge);
  const year0 = new Date().getFullYear();

  const idxFromClientX = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((svgX - PL) / chartW) * (n - 1))));
  };

  const hi = hoverIdx;
  const hx = hi !== null ? xf(hi) : 0;
  const hy = hi !== null ? yf(bands.p50[hi]) : 0;
  const TT_W = 158;
  const ttX = hi !== null ? Math.max(PL, Math.min(hx + 10, W - PR - TT_W)) : 0;
  // Every percentile band the chart draws, top (best) → bottom (worst), so the
  // tooltip rows read in the same order as the fan itself.
  const ttRows = hi !== null ? [
    { label: percentileLabels[4], v: bands.p95[hi], median: false },
    { label: percentileLabels[3], v: bands.p75[hi], median: false },
    { label: percentileLabels[2], v: bands.p50[hi], median: true },
    { label: percentileLabels[1], v: bands.p25[hi], median: false },
    { label: percentileLabels[0], v: bands.p5[hi], median: false },
  ] : [];

  return (
    <div ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}
        data-testid="rv2-fan"
        onMouseMove={(e) => setHoverIdx(idxFromClientX(e.clientX, e.currentTarget))}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => setHoverIdx(idxFromClientX(e.touches[0].clientX, e.currentTarget))}
        onTouchEnd={() => setHoverIdx(null)}
      >
        {/* Accumulation tint */}
        {retireIdx > 0 && retireIdx < n && (
          <rect x={xf(0)} y={PT} width={Math.max(0, xf(retireIdx) - xf(0))} height={chartH} className="rv2-accum-zone" />
        )}
        {retireIdx > 0 && (xf(retireIdx) - xf(0)) > 84 && (
          <text x={(xf(0) + xf(retireIdx)) / 2} y={PT + 13} textAnchor="middle" fontFamily="inherit" fontSize={9} letterSpacing="0.06em" fill="rgb(var(--ui-content-muted))">
            SAVING
          </text>
        )}

        {/* Gridlines + y labels */}
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
            {clipLabel} → {fmtShort(maxV)}
          </text>
        )}

        {/* Bands + median */}
        <path d={band(bands.p95, bands.p5)} className="rv2-fan-outer" data-band="p5-p95" />
        <path d={band(bands.p75, bands.p25)} className="rv2-fan-inner" data-band="p25-p75" />
        <path d={line(bands.p50)} fill="none" stroke="rgb(var(--ui-content-secondary))" strokeWidth={1.5} strokeDasharray="5 4" strokeLinecap="round" data-band="p50" />

        {/* Retirement marker */}
        {retireIdx > 0 && retireIdx < n && (
          <>
            <line x1={xf(retireIdx)} x2={xf(retireIdx)} y1={PT} y2={H - PB} stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" strokeWidth={1} />
            <text x={xf(retireIdx) + 5} y={H - PB - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontWeight={600} fontSize={11} fill="rgb(var(--ui-brand-ink))">
              retire {retireAge}
            </text>
          </>
        )}

        {/* X-axis ages */}
        <text x={xf(0)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">age {currentAge}</text>
        <text x={xf(Math.floor((n - 1) / 2))} y={H - 6} textAnchor="middle" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{currentAge + Math.floor((n - 1) / 2)}</text>
        <text x={xf(n - 1)} y={H - 6} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{currentAge + n - 1}</text>

        {/* Hover: crosshair + on-curve marker + tooltip, all in SVG space */}
        {hi !== null && (
          <g data-testid="rv2-fan-hover">
            <line x1={hx} x2={hx} y1={PT} y2={PT + chartH} stroke="rgb(var(--ui-content))" strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />
            <circle data-testid="rv2-fan-marker" cx={hx} cy={hy} r={4.5} fill="var(--ui-viz-2)" stroke="rgb(var(--ui-panel))" strokeWidth={2} />
            <g>
              <rect x={ttX} y={PT + 4} width={TT_W} height={104} rx={8} fill="rgb(var(--ui-content))" opacity={0.94} />
              <text x={ttX + 10} y={PT + 21} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fontWeight={700} fill="rgb(var(--ui-panel))">
                Age {currentAge + hi} · {year0 + hi}
              </text>
              {ttRows.map((r, i) => (
                <g key={r.label} opacity={r.median ? 1 : 0.8}>
                  <text x={ttX + 10} y={PT + 38 + i * 15.5} fontFamily="inherit" fontSize={10.5} fontWeight={r.median ? 700 : 500} fill="rgb(var(--ui-panel))">
                    {r.label}
                  </text>
                  <text x={ttX + TT_W - 10} y={PT + 38 + i * 15.5} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={10.5} fontWeight={r.median ? 700 : 500} fill="rgb(var(--ui-panel))">
                    {fmtShort(r.v)}
                  </text>
                </g>
              ))}
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Blended-return growth chart ──────────────────────────────────────────────
// One deterministic line at the blended expected return — same axes, saving
// tint, retirement marker and hover language as the fan, minus the uncertainty
// bands (there is exactly one path). Values arrive in today's dollars.
function BlendedChartV2({ values, currentAge, retireAge, runsShortAge }: {
  values: number[]; // index 0 = current age
  currentAge: number;
  retireAge: number;
  runsShortAge: number | null;
}) {
  const [wrapRef, W] = useMeasuredWidth(760);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = values.length;
  if (n < 2) return null;

  const H = 240;
  const PL = 52; const PR = 16; const PT = 16; const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const maxV = Math.max(...values, 1) * 1.08;
  const xf = (i: number) => PL + (i / (n - 1)) * chartW;
  const yf = (v: number) => PT + chartH - Math.max(0, Math.min(1, v / maxV)) * chartH;
  const yTicks = [0.25, 0.5, 0.75, 1].map(pct => ({ pct, val: maxV * pct, y: PT + chartH - pct * chartH }));

  let lineD = `M ${xf(0)},${yf(values[0])}`;
  for (let i = 1; i < n; i++) lineD += ` L ${xf(i)},${yf(values[i])}`;
  const areaD = `${lineD} L ${xf(n - 1)},${yf(0)} L ${xf(0)},${yf(0)} Z`;

  const retireIdx = Math.max(0, retireAge - currentAge);
  const year0 = new Date().getFullYear();
  // The line hits $0 the year after the shortfall year's start balance.
  const shortIdx = runsShortAge !== null ? Math.min(runsShortAge - currentAge + 1, n - 1) : null;

  const idxFromClientX = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((svgX - PL) / chartW) * (n - 1))));
  };

  const hi = hoverIdx;
  const hx = hi !== null ? xf(hi) : 0;
  const hy = hi !== null ? yf(values[hi]) : 0;
  const TT_W = 190;
  const ttX = hi !== null ? Math.max(PL, Math.min(hx + 10, W - PR - TT_W)) : 0;

  return (
    <div ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}
        data-testid="rv2-blend"
        onMouseMove={(e) => setHoverIdx(idxFromClientX(e.clientX, e.currentTarget))}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => setHoverIdx(idxFromClientX(e.touches[0].clientX, e.currentTarget))}
        onTouchEnd={() => setHoverIdx(null)}
      >
        {/* Accumulation tint */}
        {retireIdx > 0 && retireIdx < n && (
          <rect x={xf(0)} y={PT} width={Math.max(0, xf(retireIdx) - xf(0))} height={chartH} className="rv2-accum-zone" />
        )}
        {retireIdx > 0 && (xf(retireIdx) - xf(0)) > 84 && (
          <text x={(xf(0) + xf(retireIdx)) / 2} y={PT + 13} textAnchor="middle" fontFamily="inherit" fontSize={9} letterSpacing="0.06em" fill="rgb(var(--ui-content-muted))">
            SAVING
          </text>
        )}

        {/* Gridlines + y labels */}
        {yTicks.map(({ pct, val, y }) => (
          <g key={pct}>
            <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--ui-line)" strokeDasharray="2 4" />
            <text x={PL - 6} y={y + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">
              {fmtAxis(val)}
            </text>
          </g>
        ))}

        {/* The single deterministic path */}
        <path d={areaD} fill="var(--ui-viz-2)" className="rv2-blend-area" data-band="blend-area" />
        <path d={lineD} fill="none" stroke="var(--ui-viz-2)" strokeWidth={2} strokeLinecap="round" data-band="deterministic" />

        {/* Retirement marker */}
        {retireIdx > 0 && retireIdx < n && (
          <>
            <line x1={xf(retireIdx)} x2={xf(retireIdx)} y1={PT} y2={H - PB} stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" strokeWidth={1} />
            <text x={xf(retireIdx) + 5} y={H - PB - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontWeight={600} fontSize={11} fill="rgb(var(--ui-brand-ink))">
              retire {retireAge}
            </text>
          </>
        )}

        {/* Depletion marker when the money runs short */}
        {shortIdx !== null && shortIdx > 0 && (
          <g data-testid="rv2-blend-short">
            <circle cx={xf(shortIdx)} cy={yf(0)} r={4} fill="rgb(var(--ui-negative))" stroke="rgb(var(--ui-panel))" strokeWidth={1.5} />
            <text
              x={xf(shortIdx) > W / 2 ? xf(shortIdx) - 8 : xf(shortIdx) + 8} y={yf(0) - 8}
              textAnchor={xf(shortIdx) > W / 2 ? 'end' : 'start'}
              fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontWeight={600} fontSize={11} fill="rgb(var(--ui-negative))"
            >
              runs out at {runsShortAge}
            </text>
          </g>
        )}

        {/* X-axis ages */}
        <text x={xf(0)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">age {currentAge}</text>
        <text x={xf(Math.floor((n - 1) / 2))} y={H - 6} textAnchor="middle" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{currentAge + Math.floor((n - 1) / 2)}</text>
        <text x={xf(n - 1)} y={H - 6} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{currentAge + n - 1}</text>

        {/* Hover: crosshair + on-curve marker + tooltip */}
        {hi !== null && (
          <g data-testid="rv2-blend-hover">
            <line x1={hx} x2={hx} y1={PT} y2={PT + chartH} stroke="rgb(var(--ui-content))" strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />
            <circle data-testid="rv2-blend-marker" cx={hx} cy={hy} r={4.5} fill="var(--ui-viz-2)" stroke="rgb(var(--ui-panel))" strokeWidth={2} />
            <g>
              <rect x={ttX} y={PT + 4} width={TT_W} height={60} rx={8} fill="rgb(var(--ui-content))" opacity={0.94} />
              <text x={ttX + 10} y={PT + 21} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fontWeight={700} fill="rgb(var(--ui-panel))">
                Age {currentAge + hi} · {year0 + hi}
              </text>
              <text x={ttX + 10} y={PT + 37} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-panel))">
                balance {values[hi] <= 0 ? '$0 — depleted' : fmtShort(values[hi])}
              </text>
              <text x={ttX + 10} y={PT + 53} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={10} opacity={0.75} fill="rgb(var(--ui-panel))">
                today's dollars · deterministic
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Drawdown by account ──────────────────────────────────────────────────────
// Two-level account classification from the Plaid type + subtype:
//  · AcctKind — the comprehensive, user-facing account type (checking, money
//    market, 401(k), Roth IRA, …) used for grouping and display.
//  · Bucket — the tax treatment behind each kind, kept internal: it drives the
//    default liquidation order (taxable → tax-deferred → Roth → HSA) and the
//    header's tax split, exactly as before.
type Bucket = 'taxable' | 'deferred' | 'roth' | 'hsa';
const BUCKET_ORDER_DEFAULT: Bucket[] = ['taxable', 'deferred', 'roth', 'hsa'];
const BUCKET_LABELS: Record<Bucket, string> = {
  taxable: 'Taxable', deferred: 'Tax-deferred', roth: 'Roth', hsa: 'HSA',
};

type AcctKind =
  | 'checking' | 'savings' | 'money_market' | 'cd' | 'cash_mgmt'
  | 'brokerage' | 'crypto' | 'edu_529' | 'other'
  | 'plan_401k' | 'plan_403b' | 'plan_457b' | 'trad_ira' | 'pension' | 'annuity'
  | 'roth_401k' | 'roth_ira' | 'hsa';

// Listed in default liquidation order: cash-like first, then taxable
// investments, then tax-deferred, Roth, and HSA last — the same tax-treatment
// sequence as before, just granular within each treatment.
const KIND_META: Array<{ kind: AcctKind; label: string; bucket: Bucket }> = [
  { kind: 'checking',     label: 'Checking',        bucket: 'taxable' },
  { kind: 'savings',      label: 'Savings',         bucket: 'taxable' },
  { kind: 'money_market', label: 'Money market',    bucket: 'taxable' },
  { kind: 'cd',           label: 'CD',              bucket: 'taxable' },
  { kind: 'cash_mgmt',    label: 'Cash management', bucket: 'taxable' },
  { kind: 'brokerage',    label: 'Brokerage',       bucket: 'taxable' },
  { kind: 'crypto',       label: 'Crypto',          bucket: 'taxable' },
  { kind: 'edu_529',      label: '529 education',   bucket: 'taxable' },
  { kind: 'other',        label: 'Other',           bucket: 'taxable' },
  { kind: 'plan_401k',    label: '401(k)',          bucket: 'deferred' },
  { kind: 'plan_403b',    label: '403(b)',          bucket: 'deferred' },
  { kind: 'plan_457b',    label: '457(b)',          bucket: 'deferred' },
  { kind: 'trad_ira',     label: 'Traditional IRA', bucket: 'deferred' },
  { kind: 'pension',      label: 'Pension',         bucket: 'deferred' },
  { kind: 'annuity',      label: 'Annuity',         bucket: 'deferred' },
  { kind: 'roth_401k',    label: 'Roth 401(k)',     bucket: 'roth' },
  { kind: 'roth_ira',     label: 'Roth IRA',        bucket: 'roth' },
  { kind: 'hsa',          label: 'HSA',             bucket: 'hsa' },
];
const KIND_ORDER_DEFAULT: AcctKind[] = KIND_META.map(m => m.kind);
const KIND_LABELS = Object.fromEntries(KIND_META.map(m => [m.kind, m.label])) as Record<AcctKind, string>;
const KIND_BUCKET = Object.fromEntries(KIND_META.map(m => [m.kind, m.bucket])) as Record<AcctKind, Bucket>;

// Plaid subtypes arrive as "roth 401k" (live) or "roth_401k" (seed data) —
// match whole words on a separator-normalized string. Missing / unrecognized
// subtypes fall to 'other' (taxable, same treatment as before).
function classifyKind(type: string | undefined, subtype: string | null | undefined): AcctKind {
  const st = ` ${(subtype || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const has = (...words: string[]) => words.some(w => st.includes(` ${w} `));
  if (has('hsa', 'health reimbursement arrangement')) return 'hsa';
  if (type === 'depository') {
    if (has('checking')) return 'checking';
    if (has('savings')) return 'savings';
    if (has('money market')) return 'money_market';
    if (has('cd')) return 'cd';
    if (has('cash management', 'paypal', 'prepaid')) return 'cash_mgmt';
    return 'other';
  }
  if (type === 'investment') {
    if (has('roth 401k')) return 'roth_401k';
    if (has('roth')) return 'roth_ira'; // "roth", "roth ira"
    if (has('401k', '401a')) return 'plan_401k';
    if (has('403b')) return 'plan_403b';
    if (has('457b', '457')) return 'plan_457b';
    if (has('ira', 'sep', 'simple', 'keogh', 'sarsep')) return 'trad_ira';
    if (has('pension', 'retirement', 'profit sharing plan')) return 'pension';
    if (has('annuity')) return 'annuity'; // fixed / variable / other annuity
    if (has('529', 'education savings account')) return 'edu_529';
    if (has('crypto', 'crypto exchange', 'non custodial wallet')) return 'crypto';
    if (has('brokerage', 'stock plan', 'mutual fund', 'ugma', 'utma', 'trust', 'isa', 'gic')) return 'brokerage';
    return 'other';
  }
  return 'other';
}

interface DrawAccount { id: string; name: string; kind: AcctKind; bucket: Bucket; balance: number }
interface DrawUnit { key: string; label: string; sub?: string; balance: number }

// Deterministic multi-account drawdown: every unit grows at the expected
// return; each retirement year's net need (spending − guaranteed income) is
// pulled from units in priority order, fully depleting one before touching the
// next. Mirrors the year-by-year table's aggregate math exactly — the split by
// unit is the only new information.
function simulateDrawdown(units: DrawUnit[], opts: {
  currentAge: number; retireAge: number; lifeExp: number; expReturn: number;
  annualSavings: number; annualSpend: number; smile: boolean;
  ssAnnual: number; ssClaimAge: number; otherAnnual: number; otherStartAge: number;
  strategy?: WithdrawalStrategy; strategyParams?: StrategyParams;
}): { rows: Array<{ age: number; balances: number[]; withdrawals: number[]; ss: number; other: number }>; depletedAt: Array<number | null> } | null {
  const k = units.length;
  if (k === 0) return null;
  const { currentAge, retireAge, lifeExp, expReturn, annualSavings, annualSpend, smile, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, strategy = 'constant_dollar', strategyParams } = opts;
  const r = expReturn / 100;
  let vals = units.map(u => u.balance);
  const total0 = vals.reduce((s, v) => s + v, 0);
  // Contributions land pro-rata by current share (same growth rate everywhere,
  // so shares are stable during accumulation).
  const shares = vals.map(v => (total0 > 0 ? v / total0 : 1 / k));
  for (let age = currentAge; age < retireAge; age++) {
    vals = vals.map((v, i) => v * (1 + r) + annualSavings * shares[i]);
  }
  const rows: Array<{ age: number; balances: number[]; withdrawals: number[]; ss: number; other: number }> = [];
  const depletedAt: Array<number | null> = units.map(() => null);
  let retireTotal = 0;
  let prevWd = annualSpend;
  for (let age = retireAge; age <= lifeExp; age++) {
    const withdrawals = units.map(() => 0);
    const t = age - retireAge;
    const infl = Math.pow(1 + INFLATION, t);
    const total = vals.reduce((s, v) => s + v, 0);
    if (t === 0) retireTotal = total;
    // Guaranteed income that year (nominal, same basis as withdrawals) —
    // recorded per row so the bars view can show how spending is funded.
    const ss = ssAnnual > 0 && age >= ssClaimAge ? ssAnnual * infl : 0;
    const other = otherAnnual > 0 && age >= otherStartAge ? otherAnnual * infl : 0;
    rows.push({ age, balances: vals.map(v => Math.max(0, Math.round(v))), withdrawals, ss: Math.round(ss), other: Math.round(other) });
    const need = annualSpend * infl * (smile ? Math.pow(SMILE_DECLINE, t) : 1);
    const gi = ss + other;
    // The withdrawal strategy decides the aggregate portfolio withdrawal from
    // the GI-netted constant-dollar need — the same semantics as the MC and
    // backtest engines (percent and guardrails ignore the net need there too).
    const wd = Math.max(0, computeWithdrawal(strategy, Math.max(0, need - gi), total, retireTotal, prevWd, {
      initialWithdrawal: annualSpend,
      inflationFactor: t > 0 ? 1 + INFLATION : 1,
      cumulativeInflation: infl,
    }, strategyParams));
    prevWd = wd;
    let remaining = wd;
    for (let i = 0; i < k && remaining > 0; i++) {
      const take = Math.min(vals[i], remaining);
      vals[i] -= take;
      remaining -= take;
      withdrawals[i] = Math.round(take);
    }
    vals = vals.map(v => v * (1 + r));
    vals.forEach((v, i) => { if (v <= 0.5 && depletedAt[i] === null) depletedAt[i] = age; });
  }
  return { rows, depletedAt };
}

// Aggregate deterministic year-by-year plan at the blended expected return —
// feeds the "show the work" table, the CSV export, and the Blended-return
// growth mode (its line, hero outcome and sustainable draw). Stops the year
// the money runs out.
interface PlanRow { age: number; year: number; phase: 'saving' | 'retired'; start: number; contribution: number; gi: number; withdrawal: number; end: number }
function simulatePlan(opts: {
  portfolioValue: number; currentAge: number; retireAge: number; lifeExp: number;
  expReturn: number; annualSavings: number; annualSpend: number; smile: boolean;
  ssAnnual: number; ssClaimAge: number; otherAnnual: number; otherStartAge: number;
  strategy?: WithdrawalStrategy; strategyParams?: StrategyParams;
}): PlanRow[] {
  const { portfolioValue, currentAge, retireAge, lifeExp, expReturn, annualSavings, annualSpend, smile, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, strategy = 'constant_dollar', strategyParams } = opts;
  const r = expReturn / 100;
  const year0 = new Date().getFullYear();
  const rows: PlanRow[] = [];
  let v = portfolioValue;
  let retireValue = 0;
  let prevWd = annualSpend;
  for (let age = currentAge; age <= Math.max(lifeExp, retireAge + 1); age++) {
    const start = v;
    if (age < retireAge) {
      v = v * (1 + r) + annualSavings;
      rows.push({ age, year: year0 + (age - currentAge), phase: 'saving', start: Math.round(start), contribution: annualSavings, gi: 0, withdrawal: 0, end: Math.round(v) });
    } else {
      const t = age - retireAge;
      if (t === 0) retireValue = v;
      const infl = Math.pow(1 + INFLATION, t);
      const need = annualSpend * infl * (smile ? Math.pow(SMILE_DECLINE, t) : 1);
      let gi = 0;
      if (ssAnnual > 0 && age >= ssClaimAge) gi += ssAnnual * infl;
      if (otherAnnual > 0 && age >= otherStartAge) gi += otherAnnual * infl;
      // The withdrawal strategy decides the portfolio withdrawal from the
      // GI-netted constant-dollar need — same semantics as the MC and backtest
      // engines (percent and guardrails ignore the net need there too).
      const wd = Math.max(0, computeWithdrawal(strategy, Math.max(0, need - gi), v, retireValue, prevWd, {
        initialWithdrawal: annualSpend,
        inflationFactor: t > 0 ? 1 + INFLATION : 1,
        cumulativeInflation: infl,
      }, strategyParams));
      prevWd = wd;
      v = Math.max(0, (v - wd) * (1 + r));
      rows.push({ age, year: year0 + (age - currentAge), phase: 'retired', start: Math.round(start), contribution: 0, gi: Math.round(gi), withdrawal: Math.round(wd), end: Math.round(v) });
      if (v <= 0) break;
    }
  }
  return rows;
}

// Shared, interactive legend for the drawdown charts: a color swatch + label for
// every series (each account/type, plus Social Security / other income on the
// bars view). Clicking a series toggles it on/off in the chart.
function DrawdownLegend({ units, hidden, onToggle, testId, showSS, showOther }: {
  units: DrawUnit[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  testId: string;
  showSS?: boolean;
  showOther?: boolean;
}) {
  const chip = (key: string, label: string, color: string) => {
    const off = hidden.has(key);
    return (
      <button
        key={key}
        type="button"
        onClick={() => onToggle(key)}
        data-legend-key={key}
        aria-pressed={!off}
        title={off ? `Show ${label}` : `Hide ${label}`}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-content-muted transition hover:text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-content/30"
        style={{ opacity: off ? 0.4 : 1, textDecoration: off ? 'line-through' : 'none', cursor: 'pointer' }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} aria-hidden />
        {label}
      </button>
    );
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1" data-testid={testId}>
      {showSS && chip('gi-ss', 'Social Security', SS_COLOR)}
      {showOther && chip('gi-other', 'Other income', OTHER_INCOME_COLOR)}
      {units.map((u, si) => chip(u.key, u.label, vizVar(si + 1)))}
    </div>
  );
}

// Stacked area of per-unit balances over the retirement horizon. The first
// unit in priority order is the bottom band, so it visibly collapses first.
function DrawdownChart({ units, rows, currentAge, hidden, onToggleSeries }: {
  units: DrawUnit[];
  rows: Array<{ age: number; balances: number[] }>;
  currentAge: number;
  hidden: Set<string>;
  onToggleSeries: (key: string) => void;
}) {
  const [wrapRef, W] = useMeasuredWidth(760);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = rows.length;
  const k = units.length;
  if (n < 2 || k === 0) return null;

  const H = 240;
  const PL = 52; const PR = 16; const PT = 14; const PB = 26;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  // Display in today's dollars, consistent with the growth chart above.
  const real = rows.map(row => {
    const d = Math.pow(1 + INFLATION, row.age - currentAge);
    return row.balances.map(v => v / d);
  });
  // Legend-hidden series are a visual filter only: excluded from the stack,
  // the totals, and the y-axis max so the chart rescales to what's visible.
  const vis = units.map(u => !hidden.has(u.key));
  const totals = real.map(b => b.reduce((s, v, i) => s + (vis[i] ? v : 0), 0));
  const maxV = Math.max(...totals, 1) * 1.08;
  const xf = (i: number) => PL + (i / (n - 1)) * chartW;
  const yf = (v: number) => PT + chartH - Math.max(0, Math.min(1, v / maxV)) * chartH;
  const cum = real.map(b => { let s = 0; return b.map((v, i) => (s += vis[i] ? v : 0)); });

  const areaPath = (si: number) => {
    let d = `M ${xf(0)},${yf(cum[0][si])}`;
    for (let i = 1; i < n; i++) d += ` L ${xf(i)},${yf(cum[i][si])}`;
    for (let i = n - 1; i >= 0; i--) d += ` L ${xf(i)},${yf(si === 0 ? 0 : cum[i][si - 1])}`;
    return d + ' Z';
  };

  const idxFromClientX = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((svgX - PL) / chartW) * (n - 1))));
  };

  const yTicks = [0.25, 0.5, 0.75, 1].map(pct => maxV * pct);
  const hi = hoverIdx;
  const TT_W = 216;
  const ttLeft = hi !== null ? Math.max(PL, Math.min(xf(hi) + 12, W - PR - TT_W)) : 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}
        data-testid="rv2-draw-chart"
        onMouseMove={(e) => setHoverIdx(idxFromClientX(e.clientX, e.currentTarget))}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => setHoverIdx(idxFromClientX(e.touches[0].clientX, e.currentTarget))}
        onTouchEnd={() => setHoverIdx(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={yf(v)} y2={yf(v)} stroke="var(--ui-line)" strokeDasharray="2 4" />
            <text x={PL - 6} y={yf(v) + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{fmtAxis(v)}</text>
          </g>
        ))}
        {units.map((u, si) => vis[si] && (
          <path key={u.key} d={areaPath(si)} fill={vizVar(si + 1)} className="rv2-draw-band" stroke={vizVar(si + 1)} strokeOpacity={0.85} strokeWidth={1} data-draw-band={u.key} />
        ))}
        <text x={xf(0)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">age {rows[0].age}</text>
        <text x={xf(Math.floor((n - 1) / 2))} y={H - 6} textAnchor="middle" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{rows[Math.floor((n - 1) / 2)].age}</text>
        <text x={xf(n - 1)} y={H - 6} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{rows[n - 1].age}</text>
        {hi !== null && (
          <line x1={xf(hi)} x2={xf(hi)} y1={PT} y2={PT + chartH} stroke="rgb(var(--ui-content))" strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />
        )}
      </svg>
      {hi !== null && (
        <div
          data-testid="rv2-draw-tooltip"
          style={{
            position: 'absolute', left: ttLeft, top: PT + 4, width: TT_W, pointerEvents: 'none',
            background: 'rgb(var(--ui-content) / 0.94)', color: 'rgb(var(--ui-panel))',
            borderRadius: 8, padding: '8px 10px', fontSize: 10.5, fontVariantNumeric: 'tabular-nums', lineHeight: 1.45,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Age {rows[hi].age} · total {fmtShort(totals[hi])}</div>
          {units.map((u, si) => vis[si] && (
            <div key={u.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: vizVar(si + 1), flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.label}</span>
              <span style={{ opacity: real[hi][si] < 0.5 ? 0.55 : 1 }}>{real[hi][si] < 0.5 ? 'gone' : fmtShort(real[hi][si])}</span>
            </div>
          ))}
          <div style={{ opacity: 0.7, marginTop: 3, fontSize: 10 }}>today's dollars</div>
        </div>
      )}
      <DrawdownLegend units={units} hidden={hidden} onToggle={onToggleSeries} testId="rv2-draw-legend" />
    </div>
  );
}

// Stacked bars showing how each retirement year's spending is funded — the
// same sim's guaranteed income (Social Security + other, from their start
// ages) at the bottom, then per-unit portfolio withdrawals above. The first
// unit in priority order is the lowest account segment, matching the order
// rows and the area view.
const SS_COLOR = 'rgb(var(--ui-brand))';
const OTHER_INCOME_COLOR = 'color-mix(in srgb, rgb(var(--ui-brand)) 45%, rgb(var(--ui-panel)))';
function DrawdownBarsChart({ units, rows, currentAge, hidden, onToggleSeries }: {
  units: DrawUnit[];
  rows: Array<{ age: number; withdrawals: number[]; ss: number; other: number }>;
  currentAge: number;
  hidden: Set<string>;
  onToggleSeries: (key: string) => void;
}) {
  const [wrapRef, W] = useMeasuredWidth(760);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = rows.length;
  const k = units.length;
  if (n < 1 || k === 0) return null;

  const H = 240;
  const PL = 52; const PR = 16; const PT = 14; const PB = 26;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  // Display in today's dollars, consistent with the account-value view.
  const real = rows.map(row => {
    const d = Math.pow(1 + INFLATION, row.age - currentAge);
    return row.withdrawals.map(v => v / d);
  });
  // Guaranteed income, same deflation — SS reads ~flat in real terms.
  const realGi = rows.map(row => {
    const d = Math.pow(1 + INFLATION, row.age - currentAge);
    return { ss: row.ss / d, other: row.other / d };
  });
  const hasSS = rows.some(r => r.ss > 0);
  const hasOther = rows.some(r => r.other > 0);
  // Legend-hidden series are a visual filter only: dropped from the stack, the
  // totals, and the y-axis max so the bars rescale to what's visible.
  const vis = units.map(u => !hidden.has(u.key));
  const ssVis = !hidden.has('gi-ss');
  const otherVis = !hidden.has('gi-other');
  const totals = real.map((b, i) => b.reduce((s, v, si) => s + (vis[si] ? v : 0), 0) + (ssVis ? realGi[i].ss : 0) + (otherVis ? realGi[i].other : 0));
  const maxV = Math.max(...totals, 1) * 1.08;
  const slot = chartW / n;
  const barW = Math.max(2, Math.min(26, slot * 0.72));
  const xb = (i: number) => PL + i * slot + (slot - barW) / 2;
  const yf = (v: number) => PT + chartH - Math.max(0, Math.min(1, v / maxV)) * chartH;

  const idxFromClientX = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.floor((svgX - PL) / slot)));
  };

  const yTicks = [0.25, 0.5, 0.75, 1].map(pct => maxV * pct);
  const midI = Math.floor((n - 1) / 2);
  const hi = hoverIdx;
  const TT_W = 216;
  const ttLeft = hi !== null ? Math.max(PL, Math.min(xb(hi) + barW + 12, W - PR - TT_W)) : 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}
        data-testid="rv2-draw-bars"
        onMouseMove={(e) => setHoverIdx(idxFromClientX(e.clientX, e.currentTarget))}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => setHoverIdx(idxFromClientX(e.touches[0].clientX, e.currentTarget))}
        onTouchEnd={() => setHoverIdx(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={yf(v)} y2={yf(v)} stroke="var(--ui-line)" strokeDasharray="2 4" />
            <text x={PL - 6} y={yf(v) + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{fmtAxis(v)}</text>
          </g>
        ))}
        {hi !== null && (
          <rect x={PL + hi * slot} y={PT} width={slot} height={chartH} fill="rgb(var(--ui-content))" opacity={0.06} />
        )}
        {real.map((wds, i) => {
          let acc = 0;
          const seg = (v: number, key: string, fill: string) => {
            if (v <= 0) return null;
            const y0 = yf(acc);
            acc += v;
            const y1 = yf(acc);
            return (
              <rect
                key={key} x={xb(i)} y={y1} width={barW} height={Math.max(0.5, y0 - y1)}
                fill={fill} className="rv2-draw-bar" data-draw-bar={key}
              />
            );
          };
          return (
            <g key={rows[i].age}>
              {ssVis && seg(realGi[i].ss, 'gi-ss', SS_COLOR)}
              {otherVis && seg(realGi[i].other, 'gi-other', OTHER_INCOME_COLOR)}
              {wds.map((v, si) => (vis[si] ? seg(v, units[si].key, vizVar(si + 1)) : null))}
            </g>
          );
        })}
        <text x={xb(0)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">age {rows[0].age}</text>
        {midI > 0 && midI < n - 1 && (
          <text x={xb(midI) + barW / 2} y={H - 6} textAnchor="middle" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{rows[midI].age}</text>
        )}
        {n > 1 && (
          <text x={xb(n - 1) + barW} y={H - 6} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }} fontSize={11} fill="rgb(var(--ui-content-muted))">{rows[n - 1].age}</text>
        )}
      </svg>
      {hi !== null && (
        <div
          data-testid="rv2-draw-bars-tooltip"
          style={{
            position: 'absolute', left: ttLeft, top: PT + 4, width: TT_W, pointerEvents: 'none',
            background: 'rgb(var(--ui-content) / 0.94)', color: 'rgb(var(--ui-panel))',
            borderRadius: 8, padding: '8px 10px', fontSize: 10.5, fontVariantNumeric: 'tabular-nums', lineHeight: 1.45,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Age {rows[hi].age} · spending {fmtShort(totals[hi])}</div>
          {hasSS && ssVis && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: SS_COLOR, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Social Security</span>
              <span style={{ opacity: realGi[hi].ss < 0.5 ? 0.55 : 1 }}>{realGi[hi].ss < 0.5 ? '—' : fmtShort(realGi[hi].ss)}</span>
            </div>
          )}
          {hasOther && otherVis && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: OTHER_INCOME_COLOR, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Other income</span>
              <span style={{ opacity: realGi[hi].other < 0.5 ? 0.55 : 1 }}>{realGi[hi].other < 0.5 ? '—' : fmtShort(realGi[hi].other)}</span>
            </div>
          )}
          {units.map((u, si) => vis[si] && (
            <div key={u.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: vizVar(si + 1), flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.label}</span>
              <span style={{ opacity: real[hi][si] < 0.5 ? 0.55 : 1 }}>{real[hi][si] < 0.5 ? '—' : fmtShort(real[hi][si])}</span>
            </div>
          ))}
          <div style={{ opacity: 0.7, marginTop: 3, fontSize: 10 }}>today's dollars</div>
        </div>
      )}
      <DrawdownLegend units={units} hidden={hidden} onToggle={onToggleSeries} showSS={hasSS} showOther={hasOther} testId="rv2-draw-bars-legend" />
    </div>
  );
}

// ── Summary chip (closed inputs section) ─────────────────────────────────────
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-canvas-sunken px-2.5 py-0.5 text-[12px] font-semibold text-content-secondary ui-tnum whitespace-nowrap">
      {children}
    </span>
  );
}

// ── Lever (the one field pattern for every numeric input) ────────────────────
// Input-only — no slider. Each field is a label, a generous number box, then
// one helper line that carries the caption plus a subtle allowed-range hint.
// While typing, in-range values commit live (the sim re-runs as you type);
// blur (or Enter) clamps to [min, max] and snaps the field back to the
// canonical formatted value. The helper row is always rendered (min-height
// reserved) so side-by-side fields stay equal-height across the grid.
function Lever({ label, ariaLabel, min, max, value, onChange, testId, prefix, suffix, decimals = 0, caption }: {
  label: React.ReactNode; ariaLabel?: string; min: number; max: number;
  value: number; onChange: (v: number) => void; testId?: string;
  prefix?: string; suffix?: string; decimals?: number; caption?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const fmt = (v: number) => (decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US'));
  const parse = (s: string) => (decimals > 0 ? parseFloat(s) : parseInt(s, 10));
  const clean = (s: string) => (decimals > 0 ? s.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1') : s.replace(/[^0-9]/g, ''));
  const commit = () => {
    const v = parse(draft ?? '');
    const clamped = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : value;
    onChange(decimals > 0 ? Math.round(clamped * 10 ** decimals) / 10 ** decimals : Math.round(clamped));
    setDraft(null);
  };
  // Compact range hint — replaces the old slider min/max ticks.
  const hint = (v: number) =>
    prefix === '$'
      ? (v >= 1000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${v.toLocaleString('en-US')}`)
      : `${fmt(v)}${suffix === '%' ? '%' : ''}`;
  const aria = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  return (
    <div className="rv2-field" data-testid={testId}>
      <span className="rv2-field__label">{label}</span>
      <span className="rv2-input">
        {prefix && <span className="rv2-input__affix">{prefix}</span>}
        <input
          type="text" inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          value={draft !== null ? draft : fmt(value)}
          onChange={e => {
            const raw = clean(e.target.value);
            setDraft(raw);
            const v = parse(raw);
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label={aria}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        {suffix && <span className="rv2-input__affix">{suffix}</span>}
      </span>
      <div className="rv2-field__help">
        {caption}{caption && ' · '}<span className="rv2-field__range">{hint(min)}–{hint(max)}</span>
      </div>
    </div>
  );
}

// ── Standalone numeric field (same commit/clamp behavior as Lever's input) ───
function NumInput({ value, onChange, min, max, money = false, prefix, suffix, width, testId, 'aria-label': ariaLabel }: {
  value: number; onChange: (v: number) => void; min: number; max: number;
  money?: boolean; prefix?: string; suffix?: string; width?: string;
  testId?: string; 'aria-label': string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const fmt = (v: number) => (money ? v.toLocaleString('en-US') : String(v));
  const commit = () => {
    const v = parseInt(draft ?? '', 10);
    onChange(Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : value);
    setDraft(null);
  };
  return (
    <span className="rv2-pair">
      {prefix && <span className="rv2-pair__affix">{prefix}</span>}
      <input
        type="text" inputMode="numeric"
        value={draft !== null ? draft : fmt(value)}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9]/g, '');
          setDraft(raw);
          const v = parseInt(raw, 10);
          if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        aria-label={ariaLabel}
        data-testid={testId}
        style={{ width: width ?? `${fmt(max).length + 1.5}ch` }}
      />
      {suffix && <span className="rv2-pair__affix">{suffix}</span>}
    </span>
  );
}

// ── Portfolio composition (real holdings) ────────────────────────────────────
// Fixed label/color/return metadata for the allocation categories the API
// returns — same palette the /retirement page uses for its allocation bar.
const ALLOC_META: Array<{ key: string; label: string; color: string; ret: number }> = [
  { key: 'usStocks', label: 'US stocks', color: 'var(--ui-viz-2)', ret: 10.0 },
  { key: 'intlStocks', label: "Int'l stocks", color: 'var(--ui-viz-5)', ret: 7.5 },
  { key: 'bonds', label: 'Bonds', color: 'var(--ui-viz-1)', ret: 5.0 },
  { key: 'reits', label: 'REITs', color: 'var(--ui-viz-3)', ret: 9.5 },
  { key: 'cash', label: 'Cash', color: 'var(--ui-viz-7)', ret: 2.0 },
];

// Preset risk profiles from the /retirement advanced view (SimulateView) —
// same names and asset mixes, expressed on the API's allocation keys. Picking
// one (or editing it into "Custom") replaces the real portfolio as the source
// of the sim's expected return + equity fraction.
type CompPreset = 'current' | 'conservative' | 'balanced' | 'growth' | 'aggressive' | 'custom';
const COMP_PRESETS: Array<{ id: CompPreset; label: string; alloc: Record<string, number> }> = [
  { id: 'conservative', label: 'Conservative', alloc: { usStocks: 30, intlStocks: 10, bonds: 50, reits: 5, cash: 5 } },
  { id: 'balanced',     label: 'Balanced',     alloc: { usStocks: 45, intlStocks: 15, bonds: 30, reits: 5, cash: 5 } },
  { id: 'growth',       label: 'Growth',       alloc: { usStocks: 60, intlStocks: 20, bonds: 15, reits: 5, cash: 0 } },
  { id: 'aggressive',   label: 'Aggressive',   alloc: { usStocks: 70, intlStocks: 20, bonds: 5,  reits: 5, cash: 0 } },
];

// Largest-remainder rounding → integer percents summing to exactly 100, so the
// legend never reads "totals 101%" (same treatment as /retirement).
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

// ── Main page ────────────────────────────────────────────────────────────────
// Admin-only for now: the page is registered on its route, but non-admins are
// bounced back to the standard retirement planner (nav links are hidden too).
export function RetirementV2() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!loading && !user?.isAdmin) navigate('/retirement');
  }, [loading, user, navigate]);
  if (!user?.isAdmin) return null;
  return <RetirementV2Inner />;
}

function RetirementV2Inner() {
  const [, navigate] = useLocation();
  const { openChat } = useChatStore();
  const [loading, setLoading] = useState(true);
  const [hasAccounts, setHasAccounts] = useState(false);

  // Prefilled data (with spec fallbacks)
  const [currentAge, setCurrentAge] = useState(40);
  const [annualIncome, setAnnualIncome] = useState(0);
  const [buckets, setBuckets] = useState<Record<Bucket, number>>({ taxable: 0, deferred: 0, roth: 0, hsa: 0 });
  const [accounts, setAccounts] = useState<DrawAccount[]>([]);
  const [allocation, setAllocation] = useState<Record<string, number> | null>(null);
  const [derivedEquity, setDerivedEquity] = useState<number | null>(null);
  const [blendedReturn, setBlendedReturn] = useState<number | null>(null);
  // Liquid/investable savings only (real estate, alternatives and debt are
  // excluded at classification time) — this is what every simulation draws on.
  const portfolioValue = buckets.taxable + buckets.deferred + buckets.roth + buckets.hsa;

  // What-if levers
  const [retireAge, setRetireAge] = useState(65);
  const [monthlySpend, setMonthlySpend] = useState(5000);
  const [ssClaimAge, setSsClaimAge] = useState(67);
  const [monthlySavings, setMonthlySavings] = useState(0);

  // Social Security benefit — estimated from income until the user edits it.
  const [ssMonthly, setSsMonthly] = useState(0);
  const [ssTouched, setSsTouched] = useState(false);

  // Inputs & assumptions (collapsible; two tabbed sub-sections)
  const [inputsOpen, setInputsOpen] = useState(false);
  const [inputsTab, setInputsTab] = useState<'you' | 'portfolio'>('you');
  const inputsRef = useRef<HTMLDivElement>(null);
  const [baseEquityPct, setBaseEquityPct] = useState(60);
  const [equityTouched, setEquityTouched] = useState(false);
  const [baseReturn, setBaseReturn] = useState(6.5);
  const [returnTouched, setReturnTouched] = useState(false);
  // Composition switch: 'current' = the real portfolio (baseEquityPct /
  // baseReturn above); a preset or custom mix derives both from customAlloc.
  const [compPreset, setCompPreset] = useState<CompPreset>('current');
  const [customAlloc, setCustomAlloc] = useState<Record<string, number>>({ ...COMP_PRESETS[1].alloc });
  const [lifeExp, setLifeExp] = useState(90);
  const [strategy, setStrategy] = useState<WithdrawalStrategy>('constant_dollar');
  // Strategy-specific inputs (each strategy keeps its own state, so switching
  // back and forth never loses a value). Percent-of-portfolio rate, and the
  // Guyton-Klinger guardrail params + safety limits ($0 = no floor/ceiling).
  const [pctRate, setPctRate] = useState(4);
  const [gkInitialRate, setGkInitialRate] = useState(4);
  const [gkBand, setGkBand] = useState(20);
  const [gkAdjust, setGkAdjust] = useState(10);
  const [gkFloorMonthly, setGkFloorMonthly] = useState(0);
  const [gkCeilingMonthly, setGkCeilingMonthly] = useState(0);
  const [smile, setSmile] = useState(false);
  const [method, setMethod] = useState<'mc' | 'hist' | 'blend'>('mc');
  const [otherMonthly, setOtherMonthly] = useState(0);
  const [otherStartAge, setOtherStartAge] = useState(65);

  const [tableOpen, setTableOpen] = useState(false);

  // Drawdown-by-account: liquidation priority order + chart view
  const [drawMode, setDrawMode] = useState<'type' | 'account'>('type');
  const [drawView, setDrawView] = useState<'spend' | 'value'>('value');
  const [typeOrder, setTypeOrder] = useState<AcctKind[]>(KIND_ORDER_DEFAULT);
  const [accountOrder, setAccountOrder] = useState<string[]>([]);
  // Legend-toggled (hidden) drawdown series, shared across the bar/area views and
  // keyed by the stable series key so it survives reordering.
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const toggleSeries = (key: string) => {
    setHiddenSeries(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  // Drag-and-drop reordering of the priority list (up/down buttons remain the
  // touch / keyboard fallback — HTML5 DnD doesn't fire on touch).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Prefill from real data ─────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getPortfolioAllocation().catch(() => ({ allocation: null, totalValue: 0 })),
      api.getSpendingSummary().catch(() => null),
      api.getPortfolioExposure().catch(() => null),
    ]).then(([balanceData, profileData, portfolioData, spendingData, exposureData]) => {
      // Balances → per-account list + tax buckets (the /accounts/balances rows
      // carry subtype at runtime, same source the /plaid/items list uses).
      const balances = (balanceData as { balances: Array<{ accountId: string; name: string; balance?: string | null; type?: string; subtype?: string | null }> }).balances;
      setHasAccounts(balances.length > 0);
      const accts: DrawAccount[] = [];
      const sums: Record<Bucket, number> = { taxable: 0, deferred: 0, roth: 0, hsa: 0 };
      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type !== 'investment' && b.type !== 'depository') continue; // exclude property/alts/loans/credit
        if (!(val > 0)) continue;
        const kind = classifyKind(b.type, b.subtype);
        const bucket = KIND_BUCKET[kind];
        sums[bucket] += val;
        accts.push({ id: b.accountId, name: b.name, kind, bucket, balance: Math.round(val) });
      }
      const investable = sums.taxable + sums.deferred + sums.roth + sums.hsa;
      if (investable > 0) {
        setBuckets({ taxable: Math.round(sums.taxable), deferred: Math.round(sums.deferred), roth: Math.round(sums.roth), hsa: Math.round(sums.hsa) });
      }
      setAccounts(accts);
      setAccountOrder(
        accts
          .slice()
          .sort((a, b) =>
            KIND_ORDER_DEFAULT.indexOf(a.kind) - KIND_ORDER_DEFAULT.indexOf(b.kind) || b.balance - a.balance)
          .map(a => a.id),
      );

      // Profile → age / retirement age / income
      const profile = (profileData as { financialProfile: { age?: number | null; dateOfBirth?: string | null; annualIncome?: number | null; retirementAge?: number | null; employerMatchPercent?: number | null } | null }).financialProfile;
      let age = 40;
      let income = 0;
      let matchPct = 0;
      if (profile) {
        if (profile.age) age = profile.age;
        else if (profile.dateOfBirth) {
          const dob = new Date(profile.dateOfBirth);
          if (!Number.isNaN(dob.getTime())) age = Math.max(18, Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000)));
        }
        if (profile.annualIncome) income = Number(profile.annualIncome);
        if (profile.retirementAge) setRetireAge(profile.retirementAge);
        if (profile.employerMatchPercent) matchPct = Number(profile.employerMatchPercent);
      }
      setCurrentAge(age);
      setAnnualIncome(income);

      // Spending → desired retirement spend default (monthly)
      const sd = spendingData as { totalSpending?: number } | null;
      const monthly = sd && sd.totalSpending && sd.totalSpending > 0 ? Math.round(sd.totalSpending) : 5000;
      setMonthlySpend(Math.max(1000, Math.min(30000, monthly)));

      // Savings estimate: after-tax income minus current spending, plus a rough
      // employer match — just a starting point for the lever.
      if (income > 0) {
        const annualSavings = Math.max(0, income * 0.75 - monthly * 12) + income * (matchPct / 100);
        setMonthlySavings(Math.max(0, Math.min(15000, Math.round(annualSavings / 12 / 50) * 50)));
      }

      // Allocation → composition + equity fraction; exposure → blended return
      const pd = portfolioData as { allocation: Record<string, number> | null };
      let allocBlend: number | null = null;
      if (pd.allocation) {
        const a = pd.allocation;
        const total = Object.values(a).reduce((s, v) => s + v, 0);
        if (total > 0) {
          setAllocation(a);
          const eq = ((a.usStocks ?? 0) + (a.intlStocks ?? 0) + (a.reits ?? 0)) / total;
          setDerivedEquity(Math.round(eq * 100));
          setBaseEquityPct(Math.round(eq * 100));
          allocBlend = ALLOC_META.reduce((s, m) => s + (a[m.key] ?? 0) * m.ret, 0) / total;
          // Seed the custom-composition editor from the real mix, so "Custom"
          // starts where the user actually is.
          const ints = intPercents(ALLOC_META.map(m => a[m.key] ?? 0));
          setCustomAlloc(Object.fromEntries(ALLOC_META.map((m, i) => [m.key, ints[i]])));
        }
      }
      const ed = exposureData as { blendedReturn?: number } | null;
      // Prefer the server-computed blended return (holding-level granularity);
      // fall back to the historical-average blend of the real allocation.
      const blend = ed && ed.blendedReturn ? ed.blendedReturn : allocBlend;
      if (blend !== null) {
        setBlendedReturn(Math.round(blend * 10) / 10);
        setBaseReturn(Math.round(blend * 10) / 10);
      }
    }).finally(() => setLoading(false));
  }, []);

  // SS benefit tracks the claim-age estimate until the user overrides it.
  useEffect(() => {
    if (ssTouched) return;
    setSsMonthly(estimateSSMonthly(annualIncome, ssClaimAge));
  }, [annualIncome, ssClaimAge, ssTouched]);

  // ── Effective composition ──────────────────────────────────────────────────
  // 'current' uses the real-portfolio-derived (and hand-adjustable) equity % +
  // expected return; a preset/custom allocation derives both from the same
  // allocation-weighted historical averages the old /retirement advanced view
  // uses — every consumer below (chips, sims, drawdown, labels) reads these.
  const isCustomComp = compPreset !== 'current';
  const customTotal = ALLOC_META.reduce((s, m) => s + (customAlloc[m.key] ?? 0), 0);
  const customReturn = Math.round((ALLOC_META.reduce((s, m) => s + (customAlloc[m.key] ?? 0) * m.ret, 0) / (customTotal || 1)) * 10) / 10;
  const customEquityPct = Math.round((((customAlloc.usStocks ?? 0) + (customAlloc.intlStocks ?? 0) + (customAlloc.reits ?? 0)) / (customTotal || 1)) * 100);
  const equityPct = isCustomComp ? customEquityPct : baseEquityPct;
  const expReturn = isCustomComp ? customReturn : baseReturn;

  const selectCompPreset = (p: typeof COMP_PRESETS[number]) => {
    setCompPreset(p.id);
    setCustomAlloc({ ...p.alloc });
  };
  const updateCustomAlloc = (key: string, v: number) => {
    setCustomAlloc(prev => ({ ...prev, [key]: v }));
    setCompPreset('custom');
  };

  // ── Simulation inputs ──────────────────────────────────────────────────────
  const annualSavings = monthlySavings * 12;
  const ssAnnual = ssMonthly * 12;
  const otherAnnual = otherMonthly * 12;
  const equityFraction = equityPct / 100;
  const effRetireAge = Math.max(retireAge, currentAge); // engine guard
  const horizonEndAge = Math.max(effRetireAge + 30, 90);

  // Projected portfolio at retirement on the deterministic expected-return
  // path — gives the guardrails strategy its year-one dollar spend (initial
  // withdrawal rate × portfolio at retirement).
  const projRetireValue = useMemo(() => {
    let v = portfolioValue;
    for (let age = currentAge; age < effRetireAge; age++) v = v * (1 + expReturn / 100) + annualSavings;
    return v;
  }, [portfolioValue, currentAge, effRetireAge, expReturn, annualSavings]);

  // The spending figure the sims run on: the user's $/mo for constant dollar,
  // or the guardrails initial rate applied to the projected retirement
  // portfolio. (Percent-of-portfolio ignores the spending figure entirely —
  // the engine withdraws pctRate × current value each year.)
  const monthlySpendEff = strategy === 'guardrails'
    ? Math.max(0, Math.round((gkInitialRate / 100) * projRetireValue / 12))
    : monthlySpend;
  const annualSpend = monthlySpendEff * 12;

  // User strategy parameters, threaded into every engine call. undefined for
  // constant dollar → the engine's historical defaults.
  const strategyParams = useMemo<StrategyParams | undefined>(() => {
    if (strategy === 'percent_portfolio') return { percentRate: pctRate / 100 };
    if (strategy === 'guardrails') {
      const p: StrategyParams = { gkInitialRate: gkInitialRate / 100, gkBand: gkBand / 100, gkAdjust: gkAdjust / 100 };
      if (gkFloorMonthly > 0) p.gkFloor = gkFloorMonthly * 12;
      if (gkCeilingMonthly > 0) p.gkCeiling = gkCeilingMonthly * 12;
      return p;
    }
    return undefined;
  }, [strategy, pctRate, gkInitialRate, gkBand, gkAdjust, gkFloorMonthly, gkCeilingMonthly]);

  const giFn = useMemo(
    () => makeGiFn({ retireAge: effRetireAge, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, smile, annualSpend }),
    [effRetireAge, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, smile, annualSpend],
  );

  // Main Monte Carlo (seeded → stable across renders/consumers)
  const bands = useMemo(
    () => buildBands(portfolioValue, annualSavings, effRetireAge, currentAge, expReturn, annualSpend, equityFraction, true, strategy, makeRng(SEED), giFn, strategyParams),
    [portfolioValue, annualSavings, effRetireAge, currentAge, expReturn, annualSpend, equityFraction, strategy, giFn, strategyParams],
  );

  // Display bands in today's dollars (deflate 3%/yr from current age)
  const realBands = useMemo(() => {
    const deflate = (v: number, t: number) => Math.round(v / Math.pow(1 + INFLATION, t));
    return {
      p5: bands.p5.map(deflate), p25: bands.p25.map(deflate), p50: bands.p50.map(deflate),
      p75: bands.p75.map(deflate), p95: bands.p95.map(deflate),
    };
  }, [bands]);

  // Historical backtest (advanced method toggle)
  const backtestRows = useMemo<BacktestRow[] | null>(() => {
    if (method !== 'hist') return null;
    const lifeHorizon = Math.max(1, lifeExp - effRetireAge);
    const accYears = Math.max(0, effRetireAge - currentAge);
    const giArr = makeGiArray({ retireAge: effRetireAge, lifeHorizon, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, smile, annualSpend });
    const maxStart = 2024 - (accYears + lifeHorizon);
    const rows: BacktestRow[] = [];
    for (let yr = 1928; yr <= maxStart; yr++) {
      rows.push(runBacktest(yr, lifeHorizon, portfolioValue, annualSpend, equityFraction, true, strategy, accYears, annualSavings, giArr, strategyParams));
    }
    return rows;
  }, [method, lifeExp, effRetireAge, currentAge, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, smile, annualSpend, portfolioValue, equityFraction, strategy, strategyParams, annualSavings]);

  const histRate = useMemo(() => {
    if (!backtestRows || backtestRows.length === 0) return null;
    return Math.round((backtestRows.filter(r => r.survived).length / backtestRows.length) * 100);
  }, [backtestRows]);

  // Historical cohort envelope for the growth chart: each cohort's aligned
  // year-by-year portfolio value (the same runs behind the historical success
  // rate), deflated to the engine's own real frame (actual CPI across that
  // cohort's withdrawal years), summarized as 10th–90th + 25th–75th percentile
  // bands + the median cohort — the same visual language as the MC fan.
  const histBands = useMemo(() => {
    if (method !== 'hist' || !backtestRows || backtestRows.length === 0) return null;
    const L = Math.max(2, lifeExp - currentAge + 1);
    const paths = backtestRows.map(row => {
      const path: number[] = [portfolioValue];
      for (const y of row.yearByYear) {
        path.push(Math.round(y.endValue / (y.phase === 'withdrawal' ? y.cumulativeInflation : 1)));
      }
      while (path.length < L) path.push(0); // depleted cohorts stay at $0
      return path.slice(0, L);
    });
    const out = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
    const q = (vals: number[], pct: number) => vals[Math.floor((pct / 100) * (vals.length - 1))];
    for (let i = 0; i < L; i++) {
      const vals = paths.map(p => p[i]).sort((a, b) => a - b);
      out.p5.push(q(vals, 10)); // outer band = 10th–90th across cohorts
      out.p25.push(q(vals, 25));
      out.p50.push(q(vals, 50));
      out.p75.push(q(vals, 75));
      out.p95.push(q(vals, 90));
    }
    return out;
  }, [method, backtestRows, lifeExp, currentAge, portfolioValue]);

  const prob = method === 'hist' && histRate !== null ? histRate : bands.mcSuccessRate;

  // Median depletion age ("money lasts to age N"); null = beyond the horizon.
  const medianLastsTo = useMemo(() => {
    const idx = bands.p50.findIndex((v, i) => v <= 0 && currentAge + i >= effRetireAge);
    return idx === -1 ? null : currentAge + idx;
  }, [bands, currentAge, effRetireAge]);

  // ── Safe spend + suggestions (debounced — ~20 extra MC runs) ───────────────
  const [safeSpend, setSafeSpend] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ label: string; prob: number }> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const runProb = (over: Partial<{ retireAge: number; monthlySpend: number; ssClaimAge: number; monthlySavings: number; ssMonthly: number }>) => {
        const ra = Math.max(over.retireAge ?? retireAge, currentAge);
        const ms = over.monthlySpend ?? monthlySpendEff;
        const claim = over.ssClaimAge ?? ssClaimAge;
        const ssm = over.ssMonthly ?? (ssTouched ? ssMonthly : estimateSSMonthly(annualIncome, claim));
        const sav = (over.monthlySavings ?? monthlySavings) * 12;
        const gi = makeGiFn({ retireAge: ra, ssAnnual: ssm * 12, ssClaimAge: claim, otherAnnual, otherStartAge, smile, annualSpend: ms * 12 });
        return buildBands(portfolioValue, sav, ra, currentAge, expReturn, ms * 12, equityFraction, true, strategy, makeRng(SEED), gi, strategyParams).mcSuccessRate;
      };

      // Safe spend: binary-search the max monthly spend holding ≥ target
      // success. Floored to a $100 grid so typing this exact value into the
      // spending input reproduces ≥ target.
      let safe: number;
      if (runProb({ monthlySpend: 500 }) < TARGET_SUCCESS) safe = 0;
      else if (runProb({ monthlySpend: 40000 }) >= TARGET_SUCCESS) safe = 40000;
      else {
        let lo = 500, hi = 40000;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (runProb({ monthlySpend: mid }) >= TARGET_SUCCESS) lo = mid; else hi = mid;
        }
        safe = Math.floor(lo / 100) * 100;
      }
      setSafeSpend(safe);

      // Suggestions: concrete moves that push toward the target.
      const current = runProb({});
      if (current >= TARGET_SUCCESS) {
        setSuggestions([]);
        return;
      }
      const candidates: Array<{ label: string; prob: number }> = [];
      if (retireAge + 1 <= 75) candidates.push({ label: `Retire at ${retireAge + 1} (one more year)`, prob: runProb({ retireAge: retireAge + 1 }) });
      if (retireAge + 2 <= 75) candidates.push({ label: `Retire at ${retireAge + 2} (two more years)`, prob: runProb({ retireAge: retireAge + 2 }) });
      const spend5 = Math.round(monthlySpendEff * 0.95 / 50) * 50;
      const spend10 = Math.round(monthlySpendEff * 0.90 / 50) * 50;
      candidates.push({ label: `Spend ${formatMoney(spend5, true)}/mo (−5%)`, prob: runProb({ monthlySpend: spend5 }) });
      candidates.push({ label: `Spend ${formatMoney(spend10, true)}/mo (−10%)`, prob: runProb({ monthlySpend: spend10 }) });
      if (ssClaimAge < 70 && (ssTouched ? ssMonthly : estimateSSMonthly(annualIncome, 70)) > 0) {
        candidates.push({ label: 'Delay Social Security to 70', prob: runProb({ ssClaimAge: 70 }) });
      }
      if (retireAge > currentAge) {
        candidates.push({ label: `Save ${formatMoney(monthlySavings + 500, true)}/mo (+$500)`, prob: runProb({ monthlySavings: monthlySavings + 500 }) });
      }
      setSuggestions(
        candidates
          .filter(c => c.prob >= current + 2)
          .sort((a, b) => b.prob - a.prob)
          .slice(0, 3),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [portfolioValue, currentAge, retireAge, monthlySpendEff, ssClaimAge, monthlySavings, ssMonthly, ssTouched, annualIncome, otherAnnual, otherStartAge, smile, expReturn, equityFraction, strategy, strategyParams]);

  // ── Year-by-year deterministic plan (table + CSV + blended growth mode) ────
  const planRows = useMemo(
    () => simulatePlan({ portfolioValue, currentAge, retireAge: effRetireAge, lifeExp, expReturn, annualSavings, annualSpend, smile, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, strategy, strategyParams }),
    [portfolioValue, currentAge, effRetireAge, lifeExp, annualSavings, annualSpend, expReturn, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, smile, strategy, strategyParams],
  );

  // Blended-return mode: the single deterministic path's outcome — no
  // probability, just whether the money lasts through the plan-through age.
  const detRanShortAge = useMemo(() => {
    const short = planRows.find(r => r.phase === 'retired' && r.end <= 0);
    return short ? short.age : null;
  }, [planRows]);
  const detEndReal = useMemo(() => {
    // Start-of-final-year balance — the same frame as the chart's last point.
    const last = planRows[planRows.length - 1];
    return last && last.end > 0 ? Math.round(last.start / Math.pow(1 + INFLATION, last.age - currentAge)) : 0;
  }, [planRows, currentAge]);
  // The blended growth line, in today's dollars — start-of-year balances, held
  // at $0 after depletion so the axis still runs to the plan-through age.
  const blendSeries = useMemo(() => {
    const L = Math.max(2, lifeExp - currentAge + 1);
    return Array.from({ length: L }, (_, i) => Math.round((planRows[i]?.start ?? 0) / Math.pow(1 + INFLATION, i)));
  }, [planRows, lifeExp, currentAge]);
  // Deterministic sustainable draw: the max monthly spend whose single path
  // still lasts through the plan-through age (binary search on the same $100
  // grid as the Monte Carlo safe-spend; cheap — the sim is one pass per probe).
  const detSafeSpend = useMemo(() => {
    if (method !== 'blend') return null;
    const lasts = (spendMonthly: number) => {
      const rows = simulatePlan({ portfolioValue, currentAge, retireAge: effRetireAge, lifeExp, expReturn, annualSavings, annualSpend: spendMonthly * 12, smile, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, strategy, strategyParams });
      return !rows.some(r => r.phase === 'retired' && r.end <= 0);
    };
    if (!lasts(500)) return 0;
    if (lasts(40000)) return 40000;
    let lo = 500, hi = 40000;
    for (let i = 0; i < 13; i++) {
      const mid = (lo + hi) / 2;
      if (lasts(mid)) lo = mid; else hi = mid;
    }
    return Math.floor(lo / 100) * 100;
  }, [method, portfolioValue, currentAge, effRetireAge, lifeExp, expReturn, annualSavings, smile, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, strategy, strategyParams]);

  const exportCsv = () => {
    const head = 'Age,Year,Phase,Start balance,Contribution,Guaranteed income,Portfolio withdrawal,Return %,End balance';
    const lines = planRows.map(r =>
      [r.age, r.year, r.phase, r.start, r.contribution, r.gi, r.withdrawal, expReturn.toFixed(1), r.end].join(','),
    );
    const blob = new Blob([[head, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'retirement-plan.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Drawdown by account: priority-ordered units + deterministic sim ────────
  // Per-kind totals of the linked accounts — the comprehensive by-type grouping
  // (also feeds the Portfolio tab's account-type chips).
  const kindSums = useMemo(() => {
    const sums: Partial<Record<AcctKind, number>> = {};
    for (const a of accounts) sums[a.kind] = (sums[a.kind] ?? 0) + a.balance;
    return sums;
  }, [accounts]);

  const drawUnits = useMemo<DrawUnit[]>(() => {
    const bucketSums: Record<Bucket, number> = { taxable: 0, deferred: 0, roth: 0, hsa: 0 };
    for (const a of accounts) bucketSums[a.bucket] += a.balance;
    if (drawMode === 'type') {
      const units: DrawUnit[] = typeOrder
        .filter(k => (kindSums[k] ?? 0) > 0)
        .map(k => ({ key: k, label: KIND_LABELS[k], sub: BUCKET_LABELS[KIND_BUCKET[k]], balance: kindSums[k]! }));
      // Bucket money entered by hand with no matching real account (the
      // no-linked-accounts path) → one synthetic unit per bucket.
      for (const b of BUCKET_ORDER_DEFAULT) {
        if (bucketSums[b] === 0 && buckets[b] > 0) units.push({ key: `synthetic-${b}`, label: `${BUCKET_LABELS[b]} savings`, balance: buckets[b] });
      }
      return units;
    }
    // By specific account: real balances, scaled per-bucket so edited bucket
    // totals stay consistent with the aggregate simulation.
    const byId = new Map(accounts.map(a => [a.id, a]));
    const units: DrawUnit[] = [];
    for (const id of accountOrder) {
      const a = byId.get(id);
      if (!a) continue;
      const scaled = bucketSums[a.bucket] > 0 ? a.balance * (buckets[a.bucket] / bucketSums[a.bucket]) : 0;
      if (scaled > 0.5) units.push({ key: a.id, label: a.name, sub: KIND_LABELS[a.kind], balance: Math.round(scaled) });
    }
    // Bucket money entered by hand with no matching real account → synthetic
    // unit at the end of the order.
    for (const b of BUCKET_ORDER_DEFAULT) {
      if (bucketSums[b] === 0 && buckets[b] > 0) units.push({ key: `synthetic-${b}`, label: `${BUCKET_LABELS[b]} savings`, balance: buckets[b] });
    }
    return units;
  }, [drawMode, typeOrder, accountOrder, accounts, buckets, kindSums]);

  const drawdown = useMemo(
    () => simulateDrawdown(drawUnits, {
      currentAge, retireAge: effRetireAge, lifeExp, expReturn,
      annualSavings, annualSpend, smile, ssAnnual, ssClaimAge, otherAnnual, otherStartAge,
      strategy, strategyParams,
    }),
    [drawUnits, currentAge, effRetireAge, lifeExp, expReturn, annualSavings, annualSpend, smile, ssAnnual, ssClaimAge, otherAnnual, otherStartAge, strategy, strategyParams],
  );

  const moveDrawUnit = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= drawUnits.length) return;
    const a = drawUnits[idx].key;
    const b = drawUnits[j].key;
    const swap = <T,>(order: T[], ka: T, kb: T): T[] => {
      const ia = order.indexOf(ka); const ib = order.indexOf(kb);
      if (ia < 0 || ib < 0) return order;
      const next = order.slice();
      next[ia] = order[ib]; next[ib] = order[ia];
      return next;
    };
    if (drawMode === 'type') setTypeOrder(o => swap(o, a as AcctKind, b as AcctKind));
    else setAccountOrder(o => swap(o, a, b));
  };

  // Drop the dragged unit at the target's position. Works on the underlying
  // order array (which may hold keys hidden from the visible list): remove the
  // dragged key, then re-insert before (dragging up) or after (dragging down)
  // the target key.
  const dropDrawUnit = (from: number, to: number) => {
    if (from === to || !drawUnits[from] || !drawUnits[to]) return;
    const fromKey = drawUnits[from].key;
    const toKey = drawUnits[to].key;
    const after = from < to;
    const reorder = <T,>(order: T[], ka: T, kb: T): T[] => {
      const next = order.slice();
      const ia = next.indexOf(ka);
      if (ia < 0) return order;
      next.splice(ia, 1);
      const ib = next.indexOf(kb);
      if (ib < 0) return order;
      next.splice(after ? ib + 1 : ib, 0, ka);
      return next;
    };
    if (drawMode === 'type') setTypeOrder(o => reorder(o, fromKey as AcctKind, toKey as AcctKind));
    else setAccountOrder(o => reorder(o, fromKey, toKey));
  };

  // ── Verdict framing ────────────────────────────────────────────────────────
  // Blended return is one deterministic path — no probability. Its verdict is
  // simply whether the money lasts through the plan-through age.
  const isBlend = method === 'blend';
  const detOnTrack = detRanShortAge === null;
  const verdict = isBlend
    ? (detOnTrack ? 'On track' : 'At risk')
    : prob >= TARGET_SUCCESS ? 'On track' : prob >= 70 ? 'Needs attention' : 'At risk';
  const verdictColor = isBlend
    ? (detOnTrack ? 'rgb(var(--ui-brand-ink))' : 'rgb(var(--ui-negative))')
    : prob >= TARGET_SUCCESS ? 'rgb(var(--ui-brand-ink))' : prob >= 70 ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-negative))';
  const verdictBg = isBlend
    ? (detOnTrack ? 'var(--ui-brand-soft)' : 'var(--ui-negative-soft)')
    : prob >= TARGET_SUCCESS ? 'var(--ui-brand-soft)' : prob >= 70 ? 'var(--ui-caution-soft)' : 'var(--ui-negative-soft)';

  // Ask Lasagna — opens the chat sidebar seeded with this plan's key numbers
  // (same mechanism as the /retirement hero button) so the conversation starts
  // from what the user is looking at.
  const askLasagnaPrompt = isBlend
    ? `I want to assess my retirement plan. On one projected path at my ${expReturn.toFixed(1)}% expected return — retiring at ${effRetireAge} with ${formatMoney(portfolioValue, true)} saved, spending ${formatMoney(monthlySpendEff, true)}/mo — the dashboard says "${verdict}": ${detOnTrack ? `the money lasts through age ${lifeExp}` : `the money runs out at age ${detRanShortAge}`}. Can you walk me through what's driving that?`
    : `I want to assess my retirement plan. The dashboard says "${verdict}" — a ${prob}% chance my money lasts through age ${method === 'hist' ? lifeExp : horizonEndAge}, retiring at ${effRetireAge} with ${formatMoney(portfolioValue, true)} saved and spending ${formatMoney(monthlySpendEff, true)}/mo. Can you walk me through what's driving that?`;

  // The pencil on the Monthly spending KPI: open the inputs panel (on the "You"
  // tab, where the spending control lives), scroll the spending field to the
  // middle of the view, then briefly flash its border so it's obvious what to
  // edit. Falls back to the strategy's own rate field, or the panel top.
  const editSpending = () => {
    setInputsTab('you');
    setInputsOpen(true);
    window.setTimeout(() => {
      const field =
        document.querySelector<HTMLElement>('[data-testid="rv2-lever-spend"] .rv2-input') ??
        document.querySelector<HTMLElement>('[data-testid="rv2-pct-rate"] .rv2-input') ??
        document.querySelector<HTMLElement>('[data-testid="rv2-gk-rate"] .rv2-input');
      if (!field) { inputsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.classList.remove('rv2-flash');
      void field.offsetWidth; // reflow so a repeat click restarts the animation
      field.classList.add('rv2-flash');
      window.setTimeout(() => field.classList.remove('rv2-flash'), 2200);
    }, 70);
  };

  // Rendered twice: top-right on desktop, above the KPI grid on mobile — the
  // parent wrappers handle which one shows at each breakpoint.
  const renderAskLasagna = (testId: string) => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => openChat(askLasagnaPrompt)}
      className="touch-target inline-flex items-center gap-1.5 h-9 px-3.5 rounded-ui-md text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow]"
    >
      <Sparkles className="h-[15px] w-[15px]" />
      Ask Lasagna
    </button>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
        <header>
          <h1 className="font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
            Retirement
          </h1>
          <Skeleton className="mt-2.5 h-3 w-52" />
        </header>
        <Skeleton className="mt-8 h-[180px] w-full rounded-ui-xl" />
        <Skeleton className="mt-6 h-[300px] w-full rounded-ui-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <style>{`
        .rv2-fan-outer { fill: var(--ui-viz-2); fill-opacity: 0.18; }
        .rv2-fan-inner { fill: var(--ui-viz-2); fill-opacity: 0.34; }
        .dark .rv2-fan-outer { fill-opacity: 0.12; }
        .dark .rv2-fan-inner { fill-opacity: 0.20; }
        .rv2-accum-zone { fill: rgb(var(--ui-brand)); fill-opacity: 0.08; }
        .dark .rv2-accum-zone { fill-opacity: 0.10; }
        .rv2-blend-area { fill-opacity: 0.14; }
        .dark .rv2-blend-area { fill-opacity: 0.10; }
        .rv2-kpi-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 18px 24px; }
        .rv2-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 40px; }
        @media (max-width: 800px) {
          .rv2-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .rv2-grid2 { grid-template-columns: 1fr; }
        }
        /* On narrow phones the 2-col KPI cell is too tight for the full method
           labels, so let the method dropdown take its own full-width row. */
        @media (max-width: 480px) {
          .rv2-kpi-method-cell { grid-column: 1 / -1; }
        }
        .rv2-subhead {
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
          color: rgb(var(--ui-content-muted)); margin-bottom: 14px;
        }
        /* One consistent field unit: label, a generous number input, helper.
           The helper row is always present (min-height) so paired cells stay
           equal-height and inputs line up across columns. */
        .rv2-group + .rv2-group { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--ui-hairline); }
        .rv2-field { display: flex; flex-direction: column; min-width: 0; }
        .rv2-field__head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; margin-bottom: 8px; min-height: 30px;
        }
        .rv2-field__label { font-size: 13px; font-weight: 500; color: rgb(var(--ui-content-secondary)); min-width: 0; }
        .rv2-field > .rv2-field__label { display: block; margin-bottom: 8px; }
        .rv2-input {
          display: flex; align-items: center; gap: 8px;
          height: 48px; padding: 0 14px;
          border: 1px solid var(--ui-line); border-radius: var(--ui-r-md);
          background: rgb(var(--ui-canvas-sunken));
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .rv2-input:focus-within { border-color: rgb(var(--ui-brand)); box-shadow: 0 0 0 3px var(--ui-brand-ring); }
        /* Transient border flash when the Monthly spending pencil jumps here:
           holds the brand ring for ~1.2s then eases off over ~1s. */
        .rv2-input.rv2-flash { animation: rv2-flash 2.2s ease-out; }
        @keyframes rv2-flash {
          0%, 55% { border-color: rgb(var(--ui-brand)); box-shadow: 0 0 0 3px var(--ui-brand-ring); }
          100%    { border-color: var(--ui-line); box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
        }
        @media (prefers-reduced-motion: reduce) { .rv2-input.rv2-flash { animation: none; } }
        .rv2-input input {
          flex: 1; min-width: 0; width: 100%;
          border: 0; background: transparent; outline: none; padding: 0;
          font: inherit; font-size: 17px; font-weight: 600;
          font-variant-numeric: tabular-nums; color: rgb(var(--ui-content));
        }
        .rv2-input__affix { font-size: 13.5px; font-weight: 600; color: rgb(var(--ui-content-muted)); flex-shrink: 0; }
        .rv2-field__range { font-variant-numeric: tabular-nums; white-space: nowrap; opacity: 0.85; }
        .rv2-field__help {
          margin-top: 6px; min-height: 18px;
          font-size: 12px; line-height: 1.5; color: rgb(var(--ui-content-muted));
        }
        .rv2-draw-band { fill-opacity: 0.55; }
        .dark .rv2-draw-band { fill-opacity: 0.42; }
        .rv2-draw-bar { fill-opacity: 0.8; }
        .dark .rv2-draw-bar { fill-opacity: 0.65; }
        .rv2-draw-item { transition: border-color 0.12s, opacity 0.12s, box-shadow 0.12s; }
        .rv2-draw-item[draggable="true"] { cursor: grab; }
        .rv2-draw-item[draggable="true"]:active { cursor: grabbing; }
        .rv2-draw-item--dragging { opacity: 0.45; }
        .rv2-draw-item--over { border-color: rgb(var(--ui-brand)); box-shadow: 0 0 0 3px var(--ui-brand-ring); }
        .rv2-drag-grip {
          display: inline-flex; align-items: center; flex-shrink: 0;
          margin: 0 -6px 0 -4px; color: rgb(var(--ui-content-muted)); opacity: 0.55;
        }
        .rv2-draw-item:hover .rv2-drag-grip { opacity: 1; }
        .rv2-order-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 24px; height: 24px; border-radius: var(--ui-r-sm);
          border: 1px solid var(--ui-line); background: rgb(var(--ui-panel));
          color: rgb(var(--ui-content-muted)); cursor: pointer;
        }
        .rv2-order-btn:hover:not(:disabled) { color: rgb(var(--ui-content)); border-color: rgb(var(--ui-brand)); }
        .rv2-order-btn:disabled { opacity: 0.35; cursor: default; }
        .rv2-pair {
          display: inline-flex; align-items: center;
          border: 1px solid var(--ui-line); border-radius: var(--ui-r-sm);
          background: rgb(var(--ui-canvas-sunken));
          padding: 0 8px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .rv2-pair:focus-within { border-color: rgb(var(--ui-brand)); box-shadow: 0 0 0 3px var(--ui-brand-ring); }
        .rv2-pair input {
          border: 0; background: transparent; outline: none;
          text-align: right; padding: 5px 0; min-width: 0;
          font: inherit; font-weight: 600; font-size: 13px;
          font-variant-numeric: tabular-nums; color: rgb(var(--ui-content));
        }
        .rv2-pair__affix { font-size: 12px; font-weight: 600; color: rgb(var(--ui-content-muted)); padding: 0 2px; }
        /* iOS zooms any focused input under 16px — bump only on touch devices. */
        @media (hover: none) and (pointer: coarse) {
          .rv2-pair input { font-size: 16px; }
        }
        .rv2-reset {
          font: inherit; font-size: 12px; font-weight: 600; color: rgb(var(--ui-accent-ink));
          background: none; border: 0; padding: 0; cursor: pointer;
        }
        .rv2-reset:hover { text-decoration: underline; }
        /* Composition preset pills — same treatment as the /retirement advanced view. */
        .rv2-preset {
          min-height: 36px; padding: 8px 15px; font-family: inherit; font-size: 13px; font-weight: 600;
          border-radius: 999px; cursor: pointer;
          background: rgb(var(--ui-panel)); color: rgb(var(--ui-content-secondary));
          border: 1px solid var(--ui-line);
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .rv2-preset--active {
          background: var(--ui-brand-soft); color: rgb(var(--ui-brand-ink)); border-color: var(--ui-brand-ring);
        }
        .rv2-preset--custom {
          display: inline-flex; align-items: center; cursor: default;
          background: rgb(var(--ui-canvas-sunken)); color: rgb(var(--ui-content-muted));
        }
        .rv2-comp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px 24px; }
        .rv2-table th { text-align: right; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; color: rgb(var(--ui-content-muted)); border-bottom: 1px solid var(--ui-line); white-space: nowrap; }
        .rv2-table th:first-child, .rv2-table td:first-child { text-align: left; }
        .rv2-table td { text-align: right; padding: 6px 12px; font-variant-numeric: tabular-nums; font-size: 12.5px; border-top: 1px solid var(--ui-hairline); color: rgb(var(--ui-content-secondary)); white-space: nowrap; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header>
        <h1 className="font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
          Retirement
        </h1>
        <p className="mt-1.5 text-[14px] font-medium text-content-muted ui-tnum">
          {formatMoney(portfolioValue, true)} in liquid savings
          {portfolioValue > 0 && (
            <> · {formatMoney(buckets.taxable, true)} taxable · {formatMoney(buckets.deferred, true)} tax-deferred · {formatMoney(buckets.roth, true)} Roth{buckets.hsa > 0 && <> · {formatMoney(buckets.hsa, true)} HSA</>}</>
          )}
        </p>
      </header>

      {!hasAccounts && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-ui-lg border border-line bg-canvas-sunken px-4 py-3">
          <Building2 size={18} className="text-content-muted shrink-0" />
          <span className="text-[13px] text-content-secondary flex-1 min-w-[220px]">
            No linked accounts yet — these numbers start from example defaults. Connect your accounts to plan with real balances.
          </span>
          <Button variant="secondary" size="sm" onClick={() => navigate('/accounts')}>Link accounts</Button>
        </div>
      )}

      {/* ── 1 · Verdict band ───────────────────────────────────────────────── */}
      <section
        data-testid="rv2-verdict"
        className="relative mt-7 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(95% 85% at 0% 0%, var(--ui-accent-softer), transparent 60%),' +
              'radial-gradient(80% 70% at 100% 8%, var(--ui-info-soft), transparent 62%)',
          }}
        />
        <div className="relative">
          {/* hero header — eyebrow on the left; Ask Lasagna on the right (desktop
              only). The method toggle now lives in the Method KPI below, and on
              mobile Ask Lasagna drops in just above the KPI grid. */}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">{isBlend ? 'Plan outcome · deterministic' : 'Chance of success'}</div>
            <div className="hidden sm:flex flex-wrap items-center gap-2.5" data-testid="rv2-hero-controls">
              {renderAskLasagna('rv2-ask-lasagna')}
            </div>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span data-testid="rv2-verdict-word" className="font-editorial text-[36px] sm:text-[44px] font-extrabold tracking-[-0.025em] leading-[0.9]" style={{ color: verdictColor }}>
              {verdict}
            </span>
            {isBlend ? (
              <span className="inline-flex items-center h-7 px-3 rounded-full text-[13px] font-bold ui-tnum" style={{ background: verdictBg, color: verdictColor }} data-testid="rv2-outcome">
                {detOnTrack ? `Fully funded — lasts through age ${lifeExp}` : `Runs short at age ${detRanShortAge}`}
              </span>
            ) : (
              <span className="inline-flex items-center h-7 px-3 rounded-full text-[13px] font-bold ui-tnum" style={{ background: verdictBg, color: verdictColor }} data-testid="rv2-prob">
                {prob}%
              </span>
            )}
          </div>
          <p className="mt-3 text-[13.5px] leading-[1.55] text-content-secondary max-w-[62ch]">
            {isBlend ? (
              <>
                One projected path at your blended <span className="ui-tnum">{expReturn.toFixed(1)}%</span> expected return — retiring at <span className="ui-tnum">{effRetireAge}</span> on {formatMoney(monthlySpendEff, true)}/mo, with no market randomness.
                {' '}
                <span data-testid="rv2-lasts">
                  {detOnTrack
                    ? <>You'd reach age <span className="ui-tnum">{lifeExp}</span> with about <span className="ui-tnum font-semibold">{fmtShort(detEndReal)}</span> left in today's dollars.</>
                    : <>The money runs out at age <span className="ui-tnum font-semibold">{detRanShortAge}</span> — <span className="ui-tnum">{lifeExp - (detRanShortAge ?? lifeExp)}</span> years short of your plan-through age <span className="ui-tnum">{lifeExp}</span>.</>}
                </span>
              </>
            ) : (
              <>
                {method === 'hist' && backtestRows
                  ? <>Your plan survived <span className="ui-tnum font-semibold">{prob}%</span> of {backtestRows.length} historical start-years (1928 on), retiring at <span className="ui-tnum">{effRetireAge}</span> and planning through age <span className="ui-tnum">{lifeExp}</span>.</>
                  : <>The chance your money lasts to age <span className="ui-tnum">{horizonEndAge}</span> without cutting spending — across 1,000 simulated market paths, retiring at <span className="ui-tnum">{effRetireAge}</span> on {formatMoney(monthlySpendEff, true)}/mo.</>}
                {' '}
                <span data-testid="rv2-lasts">
                  {medianLastsTo === null
                    ? <>On the median path your money is still funded at age <span className="ui-tnum">{horizonEndAge}</span>.</>
                    : <>On the median path your money runs out at age <span className="ui-tnum font-semibold">{medianLastsTo}</span>.</>}
                </span>
              </>
            )}
          </p>
          <div className="mt-4 sm:hidden">
            {renderAskLasagna('rv2-ask-lasagna-mobile')}
          </div>
          <div className="rv2-kpi-grid mt-6 pt-5 border-t border-line">
            <div className="min-w-0" data-testid="rv2-kpi-years">
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">Years to retirement</div>
              <div className="mt-1.5 font-editorial text-[26px] sm:text-[30px] font-extrabold leading-none tracking-[-0.02em] ui-tnum text-content">
                {Math.max(0, effRetireAge - currentAge)}
              </div>
              <div className="mt-1.5 text-[12px] font-medium text-content-muted ui-tnum">retiring at {effRetireAge}</div>
            </div>
            <div className="min-w-0" data-testid="rv2-kpi-spend">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">Monthly spending</span>
                <button
                  type="button"
                  onClick={editSpending}
                  aria-label="Edit monthly spending"
                  data-testid="rv2-kpi-spend-edit"
                  className="inline-flex items-center justify-center h-5 w-5 rounded-ui-sm text-content-muted hover:text-content hover:bg-canvas-sunken transition-colors"
                >
                  <Pencil className="h-[13px] w-[13px]" />
                </button>
              </div>
              <div className="mt-1.5 font-editorial text-[26px] sm:text-[30px] font-extrabold leading-none tracking-[-0.02em] ui-tnum text-content">
                {formatMoney(monthlySpendEff, true)}<span className="text-[14px] font-bold text-content-muted">/mo</span>
              </div>
              <div className="mt-1.5 text-[12px] font-medium text-content-muted">in today's dollars</div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">Sustainable draw</div>
              <div className="mt-1.5 font-editorial text-[26px] sm:text-[30px] font-extrabold leading-none tracking-[-0.02em] ui-tnum text-content" data-testid="rv2-safe-spend">
                {isBlend && detSafeSpend !== null
                  ? <>{detSafeSpend >= 40000 ? '$40k+' : `${formatMoney(detSafeSpend, true)}`}</>
                  : <>{safeSpend === null ? '…' : safeSpend >= 40000 ? '$40k+' : `${formatMoney(safeSpend, true)}`}</>}<span className="text-[14px] font-bold text-content-muted">/mo</span>
              </div>
              <div className="mt-1.5 text-[12px] font-medium text-content-muted">
                {isBlend && detSafeSpend !== null ? `lasts through age ${lifeExp} at ${expReturn.toFixed(1)}%` : `from liquid savings, at ${TARGET_SUCCESS}% success`}
              </div>
            </div>
            <div className="min-w-0" data-testid="rv2-kpi-length">
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">Length of retirement</div>
              <div className="mt-1.5 font-editorial text-[26px] sm:text-[30px] font-extrabold leading-none tracking-[-0.02em] ui-tnum text-content">
                {Math.max(0, lifeExp - effRetireAge)}<span className="text-[14px] font-bold text-content-muted"> yrs</span>
              </div>
              <div className="mt-1.5 text-[12px] font-medium text-content-muted ui-tnum">age {effRetireAge} → {lifeExp}</div>
            </div>
            <div className="min-w-0 rv2-kpi-method-cell" data-testid="rv2-kpi-method">
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">Simulation method</div>
              <div className="mt-2">
                <MethodDropdown
                  value={method}
                  onChange={setMethod}
                  ariaLabel="Chance-of-success method"
                  triggerTestId="rv2-method-trigger"
                  options={[
                    { value: 'mc', label: 'Monte Carlo' },
                    { value: 'hist', label: 'Historical' },
                    { value: 'blend', label: 'Blended return' },
                  ]}
                />
              </div>
              <div className="mt-2 text-[12px] font-medium text-content-muted ui-tnum">
                {method === 'hist' ? `${backtestRows?.length ?? 0} start-years since 1928` : isBlend ? `one projected path at ${expReturn.toFixed(1)}%/yr` : '1,000 simulated paths'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · Inputs & assumptions (You / Portfolio) ─────────────────────── */}
      <div ref={inputsRef} className="scroll-mt-4">
      <Section title="Inputs & assumptions" eyebrow="every edit re-runs the simulation live">
        <Card style={{ padding: 0 }}>
          <button
            type="button"
            data-testid="rv2-inputs-toggle"
            onClick={() => setInputsOpen(o => !o)}
            aria-expanded={inputsOpen}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 cursor-pointer text-left"
          >
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
              <span className="text-[13.5px] font-semibold text-content shrink-0">{inputsOpen ? 'Edit your plan' : 'Your plan at a glance'}</span>
              {!inputsOpen && (
                <span className="flex flex-wrap gap-1.5" data-testid="rv2-inputs-chips">
                  <Chip>{expReturn.toFixed(1)}% return</Chip>
                  <Chip>retire at {retireAge}</Chip>
                  <Chip>{equityPct}% stocks · {100 - equityPct}% bonds</Chip>
                  <Chip>
                    {strategy === 'percent_portfolio'
                      ? `${pctRate}%/yr withdrawal`
                      : strategy === 'guardrails'
                        ? `guardrails · ${gkInitialRate}% start`
                        : `${formatMoney(monthlySpend, true)}/mo spending`}
                  </Chip>
                </span>
              )}
            </span>
            <ChevronDown size={16} className={cn('text-content-muted transition-transform shrink-0', inputsOpen && 'rotate-180')} />
          </button>
          {inputsOpen && (
          <div className="px-5 pb-6 border-t border-line pt-4" data-testid="rv2-inputs-body">
          <SegmentedControl
            tone="brand"
            stretch={false}
            value={inputsTab}
            onChange={setInputsTab}
            options={[
              { value: 'you', label: 'You' },
              { value: 'portfolio', label: 'Portfolio' },
            ]}
            aria-label="Edit section"
          />

          {inputsTab === 'you' && (
          <div className="mt-6" data-testid="rv2-inputs-you">
            <div className="rv2-group">
              <div className="rv2-subhead">Your timeline</div>
              <div className="rv2-grid2">
                <Lever
                  label="Current age" testId="rv2-input-age"
                  min={18} max={80} value={currentAge} onChange={setCurrentAge}
                  caption="Where the simulation starts."
                />
                <Lever
                  label="Retirement age" testId="rv2-lever-retire"
                  min={Math.min(currentAge + 1, 75)} max={75} value={retireAge} onChange={setRetireAge}
                  caption="When saving stops and withdrawals begin."
                />
                <Lever
                  label="Plan through age" testId="rv2-adv-lifeexp"
                  min={Math.max(effRetireAge + 5, 80)} max={105} value={lifeExp} onChange={setLifeExp}
                  caption="Life expectancy — how long the money needs to last."
                />
                <Lever
                  label="Monthly savings until retirement" testId="rv2-lever-save" prefix="$" suffix="/mo"
                  min={0} max={15000} value={monthlySavings} onChange={setMonthlySavings}
                  caption="What you put away each month before retiring."
                />
              </div>
            </div>

            <div className="rv2-group" data-testid="rv2-withdrawal">
              <div className="rv2-subhead">Retirement withdrawal</div>
              <div className="rv2-field" style={{ marginBottom: 20 }}>
                <span className="rv2-field__label">Withdrawal strategy</span>
                <div>
                  <SegmentedControl
                    tone="brand" size="sm"
                    value={strategy}
                    onChange={setStrategy}
                    options={[
                      { value: 'constant_dollar', label: 'Constant $' },
                      { value: 'percent_portfolio', label: '% portfolio' },
                      { value: 'guardrails', label: 'Guardrails' },
                    ]}
                    aria-label="Withdrawal strategy"
                  />
                </div>
                <div className="rv2-field__help">
                  {strategy === 'constant_dollar' && 'Same inflation-adjusted amount every year.'}
                  {strategy === 'percent_portfolio' && `Withdraw ${pctRate}% of the portfolio's current value each year — flexible but variable.`}
                  {strategy === 'guardrails' && `Guyton-Klinger: spending flexes ±${gkAdjust}% when the withdrawal rate drifts ±${gkBand}% past your initial rate, so the portfolio lasts.`}
                </div>
              </div>
              <div className="rv2-grid2">
                {strategy === 'constant_dollar' && (
                  <Lever
                    label="Monthly spending in retirement" testId="rv2-lever-spend" prefix="$" suffix="/mo"
                    min={1000} max={30000} value={monthlySpend} onChange={setMonthlySpend}
                    caption="In today's dollars."
                  />
                )}
                {strategy === 'percent_portfolio' && (
                  <Lever
                    label="Withdrawal rate" testId="rv2-pct-rate" suffix="%" decimals={1}
                    min={1} max={12} value={pctRate} onChange={setPctRate}
                    caption="Share of the portfolio's current value withdrawn each year."
                  />
                )}
                {strategy === 'guardrails' && (
                  <>
                    <Lever
                      label="Initial withdrawal rate" testId="rv2-gk-rate" suffix="%" decimals={1}
                      min={2} max={10} value={gkInitialRate} onChange={setGkInitialRate}
                      caption={<>Year-one spending ≈ <span className="ui-tnum">{formatMoney(monthlySpendEff, true)}/mo</span> of your projected portfolio at {effRetireAge}.</>}
                    />
                    <Lever
                      label="Guardrail band" testId="rv2-gk-band" prefix="±" suffix="%"
                      min={5} max={50} value={gkBand} onChange={setGkBand}
                      caption="How far the withdrawal rate may drift before spending adjusts."
                    />
                    <Lever
                      label="Spending raise / cut" testId="rv2-gk-adjust" prefix="±" suffix="%"
                      min={5} max={30} value={gkAdjust} onChange={setGkAdjust}
                      caption="The adjustment applied when a guardrail is crossed."
                    />
                    <Lever
                      label="Spending floor" testId="rv2-gk-floor" prefix="$" suffix="/mo"
                      min={0} max={20000} value={gkFloorMonthly} onChange={setGkFloorMonthly}
                      caption="Never cut below this — $0 = no floor. Today's dollars."
                    />
                    <Lever
                      label="Spending ceiling" testId="rv2-gk-ceiling" prefix="$" suffix="/mo"
                      min={0} max={40000} value={gkCeilingMonthly} onChange={setGkCeilingMonthly}
                      caption="Never raise above this — $0 = no ceiling. Today's dollars."
                    />
                  </>
                )}
              </div>
              <label className="mt-5 flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={smile} onChange={e => setSmile(e.target.checked)} className="mt-0.5 accent-[rgb(var(--ui-brand))]" data-testid="rv2-adv-smile" />
                <span>
                  <span className="rv2-field__label">Spending "smile" (−1%/yr real)</span>
                  <span className="block text-[12px] text-content-muted leading-[1.5]">Retirees typically spend a little less each year through their 70s.</span>
                </span>
              </label>
            </div>

            <div className="rv2-group">
              <div className="rv2-subhead">Social Security</div>
              <div className="rv2-grid2">
                <Lever
                  label="Claim age" testId="rv2-lever-claim"
                  min={62} max={70} value={ssClaimAge} onChange={setSsClaimAge}
                  caption="When your benefit starts — the estimate updates as you change this."
                />
                <Lever
                  label="Monthly benefit" testId="rv2-ss" prefix="$" suffix="/mo"
                  ariaLabel="Estimated Social Security monthly benefit"
                  min={0} max={10000} value={ssMonthly}
                  onChange={v => { setSsMonthly(v); setSsTouched(true); }}
                  caption={
                    ssTouched ? (
                      <>Your own figure. <button type="button" className="rv2-reset" onClick={() => setSsTouched(false)}>Reset to the estimate for claiming at {ssClaimAge}</button>.</>
                    ) : annualIncome > 0 ? (
                      <>Estimated benefit if you claim at {ssClaimAge}, from your {formatMoney(annualIncome, true)} income. Edit it, or check ssa.gov.</>
                    ) : (
                      <>No income on file — enter your estimated benefit from ssa.gov.</>
                    )
                  }
                />
              </div>
            </div>

            <div className="rv2-group" data-testid="rv2-other">
              <div className="rv2-subhead">Other guaranteed income</div>
              <div className="rv2-grid2">
                <Lever
                  label="Monthly amount" testId="rv2-other-income" prefix="$" suffix="/mo"
                  ariaLabel="Other guaranteed monthly income"
                  min={0} max={20000} value={otherMonthly} onChange={setOtherMonthly}
                  caption="Pension, annuity or rental income — on top of Social Security."
                />
                <Lever
                  label="Starts at age" testId="rv2-other-age"
                  ariaLabel="Other income start age"
                  min={50} max={90} value={otherStartAge} onChange={setOtherStartAge}
                  caption="When this income begins."
                />
              </div>
            </div>
          </div>
          )}

          {inputsTab === 'portfolio' && (
          <div className="mt-6" data-testid="rv2-inputs-portfolio">
            <div className="rv2-group">
            <div className="flex items-baseline justify-between gap-3">
              <span className="rv2-subhead" style={{ marginBottom: 0 }}>Starting portfolio</span>
              <span className="text-[15px] font-bold text-content ui-tnum" data-testid="rv2-portfolio-total">{formatMoney(portfolioValue, true)}</span>
            </div>
            {hasAccounts ? (
              <>
                <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="rv2-portfolio-kinds">
                  {KIND_ORDER_DEFAULT.filter(k => (kindSums[k] ?? 0) > 0).map(k => (
                    <Chip key={k}>{KIND_LABELS[k]} {formatMoney(kindSums[k]!, true)}</Chip>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-content-muted leading-[1.5]">
                  Liquid, investable balances from your linked accounts — the drawdown view below draws on the same accounts.
                </p>
              </>
            ) : (
              <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                <NumInput
                  value={buckets.taxable}
                  onChange={v => setBuckets(prev => ({ ...prev, taxable: v }))}
                  min={0} max={50000000} money prefix="$" width="10ch"
                  testId="rv2-bucket-taxable" aria-label="Starting savings"
                />
                <span className="text-[12px] text-content-muted">no linked accounts yet — enter your investable savings</span>
              </div>
            )}
            </div>

            <div className="rv2-group">
            <div className="rv2-subhead">Composition &amp; allocation</div>
            <div className="mb-4 flex flex-wrap gap-2" data-testid="rv2-comp-presets">
              <button
                type="button"
                className={cn('rv2-preset', !isCustomComp && 'rv2-preset--active')}
                data-testid="rv2-comp-preset-current"
                onClick={() => setCompPreset('current')}
              >
                My portfolio
              </button>
              {COMP_PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={cn('rv2-preset', compPreset === p.id && 'rv2-preset--active')}
                  data-testid={`rv2-comp-preset-${p.id}`}
                  onClick={() => selectCompPreset(p)}
                >
                  {p.label}
                </button>
              ))}
              {compPreset === 'custom' && (
                <span className="rv2-preset rv2-preset--custom" data-testid="rv2-comp-preset-custom">Custom</span>
              )}
            </div>
            {!isCustomComp ? (() => {
              const total = allocation ? Object.values(allocation).reduce((s, v) => s + v, 0) : 0;
              if (!allocation || total <= 0) {
                return (
                  <p className="text-[12.5px] text-content-muted leading-[1.55]">
                    No holdings data yet — assuming {equityPct}% stocks / {100 - equityPct}% bonds. Adjust below, or pick a preset mix above.
                  </p>
                );
              }
              const segs = ALLOC_META.map(m => ({ ...m, pct: ((allocation[m.key] ?? 0) / total) * 100 })).filter(s => s.pct > 0);
              const disp = intPercents(segs.map(s => s.pct));
              return (
                <div data-testid="rv2-composition-bar">
                  <div className="flex h-3 overflow-hidden rounded-full bg-canvas-sunken" style={{ gap: 1 }}>
                    {segs.map((s, i) => (
                      <div key={s.key} style={{ width: `${s.pct}%`, background: s.color, minWidth: 2 }} title={`${s.label} · ${disp[i]}%`} />
                    ))}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                    {segs.map((s, i) => (
                      <span key={s.key} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-content-secondary ui-tnum">
                        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
                        {s.label} {disp[i]}%
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-content-muted leading-[1.5] ui-tnum">
                    your actual holdings
                    {blendedReturn !== null && <> · {blendedReturn.toFixed(1)}% blended historical return</>}
                    {derivedEquity !== null && <> · {derivedEquity}% in stocks &amp; REITs</>}
                  </p>
                </div>
              );
            })() : (
              <div data-testid="rv2-comp-editor">
                <div className="rv2-comp-grid">
                  {ALLOC_META.map(m => (
                    <Lever
                      key={m.key}
                      label={
                        <span className="inline-flex items-center gap-1.5 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: m.color }} aria-hidden />
                          <span className="truncate">{m.label}</span>
                        </span>
                      }
                      ariaLabel={`${m.label} allocation percent`}
                      testId={`rv2-comp-${m.key}`} suffix="%"
                      min={0} max={100} value={customAlloc[m.key] ?? 0}
                      onChange={v => updateCustomAlloc(m.key, v)}
                      caption={<span className="ui-tnum">{m.ret.toFixed(1)}% hist. avg</span>}
                    />
                  ))}
                </div>
                <div className="mt-4 flex overflow-hidden rounded-ui-md" style={{ height: 30, gap: 1 }} data-testid="rv2-comp-bar">
                  {ALLOC_META.map(m => {
                    const pct = customTotal > 0 ? ((customAlloc[m.key] ?? 0) / customTotal) * 100 : 0;
                    return pct > 0 ? (
                      <div key={m.key} style={{ width: `${pct}%`, background: m.color, transition: 'width 0.3s ease', minWidth: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {pct >= 14 && (
                          <span style={{ fontSize: 10.5, fontWeight: 600, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.35)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {m.label} {customAlloc[m.key] ?? 0}%
                          </span>
                        )}
                      </div>
                    ) : null;
                  })}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-content-secondary">
                  <span className="ui-tnum" data-testid="rv2-comp-derived">
                    Blended return <strong>{customReturn.toFixed(1)}%</strong> · {customEquityPct}% stocks &amp; REITs
                    {blendedReturn !== null && <span className="text-content-muted"> (your actual portfolio: {blendedReturn.toFixed(1)}%)</span>}
                  </span>
                  {Math.abs(customTotal - 100) > 1 && (
                    <span className="ui-tnum" style={{ color: 'rgb(var(--ui-caution))' }}>allocation totals {customTotal}%</span>
                  )}
                </div>
                <p className="mt-2 text-[12px] text-content-muted leading-[1.5]">
                  This mix drives the simulation's expected return and stock fraction (allocation-weighted historical
                  averages) while active — switch back to "My portfolio" to use your real holdings.
                </p>
              </div>
            )}
            </div>

            {!isCustomComp && (
            <div className="rv2-group">
            <div className="rv2-subhead">Simulation assumptions</div>
            <div className="rv2-grid2">
              <Lever
                label="Stocks in portfolio" testId="rv2-adv-equity" suffix="%"
                min={0} max={100} value={baseEquityPct}
                onChange={v => { setBaseEquityPct(v); setEquityTouched(true); }}
                caption={derivedEquity === null ? undefined : equityTouched && baseEquityPct !== derivedEquity ? (
                  <>adjusted · <button type="button" className="rv2-reset" onClick={() => { setBaseEquityPct(derivedEquity); setEquityTouched(false); }}>reset to your actual {derivedEquity}%</button></>
                ) : (
                  'from your actual allocation'
                )}
              />
              <Lever
                label="Expected return (nominal)" testId="rv2-adv-return" suffix="%" decimals={1}
                min={3} max={11} value={baseReturn}
                onChange={v => { setBaseReturn(Math.round(v * 10) / 10); setReturnTouched(true); }}
                caption={blendedReturn === null ? undefined : returnTouched && baseReturn !== blendedReturn ? (
                  <>adjusted · <button type="button" className="rv2-reset" onClick={() => { setBaseReturn(blendedReturn); setReturnTouched(false); }}>reset to blended {blendedReturn.toFixed(1)}%</button></>
                ) : (
                  "blended from your holdings' historical averages"
                )}
              />
            </div>
            </div>
            )}
          </div>
          )}

          </div>
          )}
        </Card>
      </Section>
      </div>

      {/* ── 3 · Portfolio growth (re-renders per selected method) ──────────── */}
      <Section
        title="Portfolio growth"
        eyebrow={
          method === 'hist'
            ? `today's dollars · Historical · ${backtestRows?.length ?? 0} cohorts (from ${backtestRows?.[0]?.accStartYear ?? 1928}) · age ${currentAge} → ${lifeExp}`
            : isBlend
              ? `today's dollars · Blended return · deterministic · age ${currentAge} → ${lifeExp}`
              : `today's dollars · Monte Carlo, 1,000 paths · age ${currentAge} → ${currentAge + bands.p50.length - 1}`
        }
      >
        <Card>
          {method === 'hist' ? (
            histBands ? (
              <>
                <FanChartV2 bands={histBands} currentAge={currentAge} retireAge={effRetireAge} clipLabel="best cohorts" percentileLabels={['10th', '25th', 'Median', '75th', '90th']} />
                <div style={{ display: 'flex', gap: 20, fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: 'rgb(var(--ui-content-muted))', paddingTop: 12, flexWrap: 'wrap' }} data-testid="rv2-growth-legend-hist">
                  <span><span className="rv2-fan-outer" style={{ display: 'inline-block', width: 12, height: 6, marginRight: 6, verticalAlign: 'middle', background: 'var(--ui-viz-2)', opacity: 0.3 }} />10th–90th cohort range</span>
                  <span><span style={{ display: 'inline-block', width: 12, height: 6, marginRight: 6, verticalAlign: 'middle', background: 'var(--ui-viz-2)', opacity: 0.55 }} />25th–75th</span>
                  <span><span style={{ display: 'inline-block', width: 12, height: 1.5, background: 'rgb(var(--ui-content-secondary))', marginRight: 6, verticalAlign: 'middle' }} />median cohort</span>
                  <span style={{ marginLeft: 'auto' }}>
                    {backtestRows?.length ?? 0} retirements 1928 on · median at {lifeExp}: <strong>{fmtShort(histBands.p50[histBands.p50.length - 1] || 0)}</strong>
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-content-muted">Not enough market history for this horizon — switch method or shorten the plan.</p>
            )
          ) : isBlend ? (
            <>
              <BlendedChartV2 values={blendSeries} currentAge={currentAge} retireAge={effRetireAge} runsShortAge={detRanShortAge} />
              <div style={{ display: 'flex', gap: 20, fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: 'rgb(var(--ui-content-muted))', paddingTop: 12, flexWrap: 'wrap' }} data-testid="rv2-growth-legend-blend">
                <span><span style={{ display: 'inline-block', width: 12, height: 2, background: 'var(--ui-viz-2)', marginRight: 6, verticalAlign: 'middle', borderRadius: 1 }} />one projected path at {expReturn.toFixed(1)}%/yr — no market randomness</span>
                <span style={{ marginLeft: 'auto' }}>
                  {detRanShortAge !== null
                    ? <>runs out at age <strong>{detRanShortAge}</strong></>
                    : <>at {lifeExp}: <strong>{fmtShort(blendSeries[blendSeries.length - 1] || 0)}</strong></>}
                </span>
              </div>
            </>
          ) : (
            <>
              <FanChartV2 bands={realBands} currentAge={currentAge} retireAge={effRetireAge} />
              <div style={{ display: 'flex', gap: 20, fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: 'rgb(var(--ui-content-muted))', paddingTop: 12, flexWrap: 'wrap' }} data-testid="rv2-growth-legend-mc">
                <span><span className="rv2-fan-outer" style={{ display: 'inline-block', width: 12, height: 6, marginRight: 6, verticalAlign: 'middle', background: 'var(--ui-viz-2)', opacity: 0.3 }} />p5–p95 range</span>
                <span><span style={{ display: 'inline-block', width: 12, height: 6, marginRight: 6, verticalAlign: 'middle', background: 'var(--ui-viz-2)', opacity: 0.55 }} />p25–p75 likely</span>
                <span><span style={{ display: 'inline-block', width: 12, height: 1.5, background: 'rgb(var(--ui-content-secondary))', marginRight: 6, verticalAlign: 'middle' }} />median</span>
                <span style={{ marginLeft: 'auto' }}>
                  median at {currentAge + realBands.p50.length - 1}: <strong>{fmtShort(realBands.p50[realBands.p50.length - 1] || 0)}</strong>
                </span>
              </div>
            </>
          )}
        </Card>
        {/* Methodology footnote (relocated from the removed Chance-of-success
            tab — the method toggle itself now lives in the hero). */}
        <p className="mt-3 text-[12px] text-content-muted leading-[1.55]">
          Inflation is fixed at 3%/yr in the Monte Carlo and blended-return models (the historical backtest uses actual CPI).
          The Monte Carlo always runs to age {horizonEndAge}; "plan through age" (under You) drives the historical backtest, the blended-return path, drawdown view and table.
        </p>
      </Section>

      {/* ── 4 · Portfolio drawdown by account ──────────────────────────────── */}
      <Section title="Portfolio drawdown by account" eyebrow={`deterministic at ${expReturn.toFixed(1)}%/yr · today's dollars`}>
        <Card>
          <div data-testid="rv2-draw">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                tone="brand" size="sm"
                value={drawMode}
                onChange={setDrawMode}
                options={[
                  { value: 'type', label: 'By account type' },
                  { value: 'account', label: 'By specific account' },
                ]}
                aria-label="Withdrawal order granularity"
              />
              <span className="text-[12px] font-medium text-content-muted">drag to reorder — withdrawals come from the top of the list first</span>
            </div>
            {drawUnits.length > 0 && (
              <div className="mt-3.5 flex flex-col gap-1.5" data-testid="rv2-draw-order">
                {drawUnits.map((u, i) => (
                  <div
                    key={u.key}
                    data-testid="rv2-draw-row"
                    draggable={drawUnits.length > 1}
                    onDragStart={e => {
                      setDragIdx(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', u.key); // Firefox needs data to start a drag
                    }}
                    onDragOver={e => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverIdx !== i) setDragOverIdx(i);
                    }}
                    onDragLeave={e => {
                      // dragleave also fires when crossing into the row's own
                      // children — only clear when truly leaving the row.
                      if (dragOverIdx === i && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverIdx(null);
                    }}
                    onDrop={e => {
                      e.preventDefault();
                      if (dragIdx !== null) dropDrawUnit(dragIdx, i);
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                    className={cn(
                      'rv2-draw-item flex items-center gap-3 rounded-ui-md border border-line bg-canvas-sunken px-3 py-2',
                      dragIdx === i && 'rv2-draw-item--dragging',
                      dragOverIdx === i && dragIdx !== null && dragIdx !== i && 'rv2-draw-item--over',
                    )}
                  >
                    {drawUnits.length > 1 && (
                      <span className="rv2-drag-grip" aria-hidden>
                        <GripVertical size={14} />
                      </span>
                    )}
                    <span className="w-4 text-[12px] font-bold text-content-muted ui-tnum shrink-0">{i + 1}</span>
                    <span className="w-[10px] h-[10px] rounded-[3px] shrink-0" style={{ background: vizVar(i + 1) }} aria-hidden />
                    <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-content">
                      {u.label}
                      {u.sub && <span className="ml-2 text-[11.5px] font-medium text-content-muted" data-testid="rv2-draw-sub">{u.sub}</span>}
                    </span>
                    <span className="text-[12.5px] ui-tnum text-content-secondary shrink-0">{formatMoney(u.balance, true)}</span>
                    {drawdown && (
                      <span
                        className="hidden sm:inline text-[11.5px] font-semibold ui-tnum shrink-0"
                        style={{ color: drawdown.depletedAt[i] !== null ? 'rgb(var(--ui-caution))' : 'rgb(var(--ui-brand-ink))' }}
                        data-testid="rv2-draw-depletes"
                      >
                        {drawdown.depletedAt[i] !== null ? `runs out at ${drawdown.depletedAt[i]}` : `lasts past ${lifeExp}`}
                      </span>
                    )}
                    {drawUnits.length > 1 && (
                      <span className="flex gap-1 shrink-0">
                        <button type="button" className="rv2-order-btn" aria-label={`Draw from ${u.label} earlier`} data-testid="rv2-draw-up" disabled={i === 0} onClick={() => moveDrawUnit(i, -1)}>
                          <ChevronUp size={14} />
                        </button>
                        <button type="button" className="rv2-order-btn" aria-label={`Draw from ${u.label} later`} data-testid="rv2-draw-down" disabled={i === drawUnits.length - 1} onClick={() => moveDrawUnit(i, 1)}>
                          <ChevronDown size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {drawUnits.length === 1 && (
              <p className="mt-2 text-[12px] text-content-muted">Only one source of savings — nothing to reorder yet.</p>
            )}
            {drawdown && drawUnits.length > 0 ? (
              <div className="mt-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <SegmentedControl
                    tone="brand" size="sm"
                    value={drawView}
                    onChange={setDrawView}
                    options={[
                      { value: 'spend', label: 'Spending by account' },
                      { value: 'value', label: 'Account value' },
                    ]}
                    aria-label="Drawdown chart view"
                  />
                  <span className="text-[12px] font-medium text-content-muted">
                    {drawView === 'spend' ? 'how each year’s spending is funded — guaranteed income + account withdrawals' : 'what each account is still worth'}
                  </span>
                </div>
                {drawView === 'spend'
                  ? <DrawdownBarsChart units={drawUnits} rows={drawdown.rows} currentAge={currentAge} hidden={hiddenSeries} onToggleSeries={toggleSeries} />
                  : <DrawdownChart units={drawUnits} rows={drawdown.rows} currentAge={currentAge} hidden={hiddenSeries} onToggleSeries={toggleSeries} />}
              </div>
            ) : (
              <p className="mt-4 text-[13px] text-content-muted">
                Nothing to draw down yet — link accounts or enter savings under Inputs & assumptions above.
              </p>
            )}
            <p className="mt-3 text-[12px] text-content-muted leading-[1.55]" data-testid="rv2-draw-note">
              The order changes which accounts run out when — not your chance of success. There's no tax model yet, so
              sequencing has no tax impact here; this is the median path at your {expReturn.toFixed(1)}% expected return,
              with each year's net need (spending − guaranteed income) drawn top-down.
            </p>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0 }}>
          <div className="w-full flex items-center justify-between gap-3 px-5 py-4">
            <button
              type="button"
              data-testid="rv2-table-toggle"
              onClick={() => setTableOpen(o => !o)}
              aria-expanded={tableOpen}
              className="flex-1 flex items-center justify-between gap-3 cursor-pointer text-left"
            >
              <span className="text-[13.5px] font-semibold text-content">
                Show the work — one row per year
                <span className="ml-2.5 text-[12px] font-medium text-content-muted ui-tnum">deterministic at {expReturn.toFixed(1)}%/yr · nominal $</span>
              </span>
              <ChevronDown size={16} className={cn('text-content-muted transition-transform', tableOpen && 'rotate-180')} />
            </button>
            <Button variant="ghost" size="sm" onClick={exportCsv} data-testid="rv2-csv">
              <Download size={14} className="mr-1.5" /> CSV
            </Button>
          </div>
          {tableOpen && (
            <div className="border-t border-line overflow-x-auto" style={{ maxHeight: 420, overflowY: 'auto' }} data-testid="rv2-table">
              <table className="rv2-table w-full" style={{ borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'rgb(var(--ui-panel))', zIndex: 1 }}>
                  <tr>
                    <th>Age</th><th>Year</th><th>Phase</th><th>Start</th><th>Saved</th><th>Guaranteed income</th><th>Withdrawal</th><th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {planRows.map(r => (
                    <tr key={r.age} style={r.phase === 'saving' ? { background: 'var(--ui-brand-softer)' } : undefined}>
                      <td style={{ fontWeight: 600, color: 'rgb(var(--ui-content))' }}>{r.age}</td>
                      <td>{r.year}</td>
                      <td style={{ fontSize: 11.5, color: r.phase === 'saving' ? 'rgb(var(--ui-brand-ink))' : 'rgb(var(--ui-content-muted))' }}>{r.phase}</td>
                      <td>{formatMoney(r.start, true)}</td>
                      <td>{r.contribution > 0 ? `+${formatMoney(r.contribution, true)}` : '—'}</td>
                      <td>{r.gi > 0 ? formatMoney(r.gi, true) : '—'}</td>
                      <td style={{ color: r.withdrawal > 0 ? 'rgb(var(--ui-caution))' : undefined }}>{r.withdrawal > 0 ? `−${formatMoney(r.withdrawal, true)}` : '—'}</td>
                      <td style={{ fontWeight: 600, color: r.end <= 0 ? 'rgb(var(--ui-negative))' : 'rgb(var(--ui-content))' }}>{formatMoney(r.end, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      {/* ── 5 · What would make this work ──────────────────────────────────── */}
      <Section title="What would make this work">
        <Card>
          <div data-testid="rv2-suggestions">
          {suggestions === null ? (
            <div className="text-[13px] text-content-muted">Crunching alternatives…</div>
          ) : prob >= TARGET_SUCCESS ? (
            <div className="flex items-center gap-3">
              <Sparkles size={18} className="shrink-0" style={{ color: 'rgb(var(--ui-brand-ink))' }} />
              <p className="text-[13.5px] leading-[1.55] text-content-secondary">
                You're at <span className="ui-tnum font-bold" style={{ color: 'rgb(var(--ui-brand-ink))' }}>{prob}%</span> — on track.
                {safeSpend !== null && safeSpend > monthlySpendEff && (
                  <> You could spend up to <span className="ui-tnum font-semibold">{formatMoney(safeSpend, true)}/mo</span> and stay at the {TARGET_SUCCESS}% target.</>
                )}
              </p>
            </div>
          ) : suggestions.length === 0 ? (
            <p className="text-[13.5px] leading-[1.55] text-content-secondary">
              No single lever gets this plan to {TARGET_SUCCESS}% on its own — try combining a later retirement with lower spending, or revisit the assumptions above.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {suggestions.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-3 rounded-ui-md border border-line bg-canvas-sunken px-4 py-3">
                  <span className="text-[13.5px] font-medium text-content">{s.label}</span>
                  <span className="text-[13.5px] font-bold ui-tnum shrink-0" style={{ color: s.prob >= TARGET_SUCCESS ? 'rgb(var(--ui-brand-ink))' : 'rgb(var(--ui-caution))' }}>
                    → {s.prob}%
                  </span>
                </div>
              ))}
              <p className="text-[12px] text-content-muted mt-1">Each move re-simulated on its own, everything else unchanged.</p>
            </div>
          )}
          </div>
        </Card>
      </Section>

      <p className="mt-8 text-[12px] leading-[1.6] text-content-muted">
        Coming later: tax-aware withdrawals & Roth conversions, spouse / couples planning, and healthcare & long-term-care costs.
        Today's model is pre-tax and single-earner — treat results as a planning range, not a guarantee.
      </p>
      <LegalDisclaimer variant="projections" />
    </div>
  );
}
