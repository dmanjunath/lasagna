import { useEffect, useMemo, useRef, useState } from 'react';
import { niceTicks, formatShortMoney } from '../ds/TrendChart';

// ---------------------------------------------------------------------------
// CashflowBars — Monarch-style diverging income/expense bars on --ui-* tokens.
// One column per period: income bar up (viz-2), expenses bar down (viz-4),
// shared zero axis. Click selects a period; hover bubbles the index up so the
// hero value can swap (same contract as the old SpendTrendChart).
// ---------------------------------------------------------------------------

const CHART_H = 210;
const CHART_M = { top: 14, right: 12, bottom: 32, left: 52 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface CashflowPeriod {
  period: string; // 'YYYY-MM' | 'YYYY'
  income: number;
  expenses: number;
  net: number;
}

export function periodLabel(period: string, granularity: 'month' | 'year'): string {
  if (granularity === 'year') return period;
  const m = Number(period.slice(5, 7));
  return `${MONTHS[m - 1] ?? period} ${period.slice(0, 4)}`;
}

export function CashflowBars({
  periods,
  granularity,
  selectedPeriod,
  onSelect,
  onHoverChange,
}: {
  periods: CashflowPeriod[];
  granularity: 'month' | 'year';
  selectedPeriod: string;
  onSelect: (period: string) => void;
  onHoverChange?: (i: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(680);
  const [hoverIdx, setHoverIdxRaw] = useState<number | null>(null);
  const setHoverIdx = (i: number | null) => { setHoverIdxRaw(i); onHoverChange?.(i); };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setChartW(el.clientWidth || 680);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = chartW - CHART_M.left - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;
  const n = periods.length;
  const colW = innerW / Math.max(1, n);
  const barW = Math.min(colW * 0.62, 44);

  // Y domain: [-max(expenses), +max(income)] with ~8% padding. Ticks come from
  // niceTicks over the max magnitude and are mirrored across zero, clipped to
  // the (possibly asymmetric) domain. All-zero data degrades to a ±1 shell.
  const { yMin, yMax, tickVals } = useMemo(() => {
    const maxUp = Math.max(0, ...periods.map((p) => p.income));
    const maxDown = Math.max(0, ...periods.map((p) => p.expenses));
    const maxMag = Math.max(maxUp, maxDown);
    if (maxMag <= 0) return { yMin: -1, yMax: 1, tickVals: [0] };
    const top = (maxUp || maxMag * 0.05) * 1.08;
    const bottom = -(maxDown || maxMag * 0.05) * 1.08;
    const pos = niceTicks(0, maxMag * 1.08, 3).filter((t) => t > 0);
    const vals = new Set<number>([0]);
    for (const t of pos) {
      if (t <= top) vals.add(t);
      if (-t >= bottom) vals.add(-t);
    }
    return { yMin: bottom, yMax: top, tickVals: [...vals].sort((a, b) => a - b) };
  }, [periods]);

  const yAt = (v: number) => CHART_M.top + ((yMax - v) / Math.max(0.0001, yMax - yMin)) * innerH;
  const zeroY = yAt(0);
  const colCenter = (i: number) => CHART_M.left + (i + 0.5) * colW;

  // X labels — month mode: short month, year added on January or the first
  // label; thin to every other column when >8 (keeping the newest labeled).
  // Year mode: every year.
  const xLabels = useMemo(() => {
    const out: Array<{ idx: number; label: string }> = [];
    if (granularity === 'year') {
      periods.forEach((p, i) => out.push({ idx: i, label: p.period }));
      return out;
    }
    periods.forEach((p, i) => {
      if (n > 8 && i % 2 !== (n - 1) % 2) return;
      const m = Number(p.period.slice(5, 7));
      const short = MONTHS[m - 1] ?? p.period;
      const withYear = m === 1 || out.length === 0;
      out.push({ idx: i, label: withYear ? `${short} ’${p.period.slice(2, 4)}` : short });
    });
    return out;
  }, [periods, granularity, n]);

  const pointerToIdx = (clientX: number): number | null => {
    const root = wrapRef.current;
    if (!root || n <= 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = chartW / rect.width;
    const localX = (clientX - rect.left) * scale;
    return Math.min(n - 1, Math.max(0, Math.floor((localX - CHART_M.left) / Math.max(1, colW))));
  };

  const hovered = hoverIdx !== null ? periods[hoverIdx] : null;

  // Hover pill position — clamp the column center so the pill stays inside.
  const PILL_W = 240;
  const pillCx = hoverIdx !== null
    ? Math.max(PILL_W / 2 + 4, Math.min(chartW - PILL_W / 2 - 4, colCenter(hoverIdx)))
    : 0;

  const barRects = (p: CashflowPeriod, i: number) => {
    const cx = colCenter(i);
    const upH = p.income > 0 ? zeroY - yAt(p.income) : 0;
    const downH = p.expenses > 0 ? yAt(-p.expenses) - zeroY : 0;
    // Income and expenses share one aligned column; a hairline inset at the
    // zero axis keeps the two blocks distinct and the axis line visible.
    const inset = 0.75;
    return {
      up: { x: cx - barW / 2, y: zeroY - upH, w: barW, h: Math.max(0, upH - inset) },
      down: { x: cx - barW / 2, y: zeroY + inset, w: barW, h: Math.max(0, downH - inset) },
    };
  };

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        viewBox={`0 0 ${chartW} ${CHART_H}`}
        role="group"
        aria-label="Income and expenses by period"
        className="block w-full touch-none"
        style={{ pointerEvents: 'none' }}
      >
        {/* Column backgrounds — selected always, hovered while pointing. */}
        {periods.map((p, i) => {
          const isSelected = p.period === selectedPeriod;
          const isHovered = hoverIdx === i;
          if (!isSelected && !isHovered) return null;
          const bgW = Math.min(colW - 2, barW + 20);
          return (
            <rect
              key={`bg-${p.period}`}
              x={colCenter(i) - bgW / 2}
              y={CHART_M.top - 4}
              width={bgW}
              height={innerH + 8}
              rx={8}
              fill="var(--ui-brand-softer)"
              fillOpacity={isSelected ? 1 : 0.65}
            />
          );
        })}

        {/* Gridlines + mirrored labels; zero axis solid, others dashed. */}
        {tickVals.map((t) => (
          <g key={t}>
            {t === 0 ? (
              <line
                x1={CHART_M.left} y1={zeroY} x2={chartW - CHART_M.right} y2={zeroY}
                stroke="var(--ui-line-strong)" strokeWidth={1}
              />
            ) : (
              <line
                x1={CHART_M.left} y1={yAt(t)} x2={chartW - CHART_M.right} y2={yAt(t)}
                stroke="var(--ui-hairline)" strokeWidth={1} strokeDasharray="2 5"
              />
            )}
            <text
              x={CHART_M.left - 12} y={yAt(t)} dy="0.32em" textAnchor="end"
              fill="rgb(var(--ui-content-faint))"
              style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatShortMoney(Math.abs(t))}
            </text>
          </g>
        ))}

        {/* Bars — income up, expenses down. */}
        {periods.map((p, i) => {
          const isSelected = p.period === selectedPeriod;
          const opacity = hoverIdx !== null ? (hoverIdx === i ? 1 : 0.35) : (isSelected ? 1 : 0.82);
          const { up, down } = barRects(p, i);
          return (
            <g key={p.period} opacity={opacity} style={{ transition: 'opacity 0.15s' }}>
              {up.h > 0 && (
                <rect x={up.x} y={up.y} width={up.w} height={up.h} rx={Math.min(3, up.w / 2, up.h / 2)} fill="var(--ui-viz-2)" />
              )}
              {down.h > 0 && (
                <rect x={down.x} y={down.y} width={down.w} height={down.h} rx={Math.min(3, down.w / 2, down.h / 2)} fill="var(--ui-viz-4)" />
              )}
            </g>
          );
        })}

        {/* X labels. */}
        {xLabels.map(({ idx, label }) => (
          <text
            key={`${idx}-${label}`} x={colCenter(idx)} y={CHART_H - 8} textAnchor="middle"
            fill="rgb(var(--ui-content-muted))"
            style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
          >
            {label}
          </text>
        ))}

        {/* Invisible per-column targets for keyboard access. */}
        {periods.map((p, i) => (
          <rect
            key={`kb-${p.period}`}
            x={CHART_M.left + i * colW}
            y={CHART_M.top}
            width={colW}
            height={innerH}
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-label={`${periodLabel(p.period, granularity)}: income ${formatShortMoney(p.income)}, spent ${formatShortMoney(p.expenses)}`}
            onFocus={() => setHoverIdx(i)}
            onBlur={() => setHoverIdx(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.period); }
            }}
          />
        ))}
      </svg>

      {/* Hover pill — period label + income/spent/net readout. */}
      {hovered && (
        <div
          data-chart-hover="pill"
          className="ui-tnum pointer-events-none absolute z-10 flex -translate-x-1/2 flex-col gap-0.5 whitespace-nowrap rounded-ui-sm bg-[rgb(var(--ui-panel-raised))] px-2.5 py-1.5 shadow-ui-lg"
          style={{ border: '1px solid var(--ui-line)', left: `${(pillCx / chartW) * 100}%`, top: 2 }}
        >
          <span className="text-[12px] font-bold leading-tight tracking-[-0.01em] text-content">
            {periodLabel(hovered.period, granularity)}
          </span>
          <span className="text-[10.5px] leading-tight text-content-muted">
            Income {formatShortMoney(hovered.income)} · Spent {formatShortMoney(hovered.expenses)} · Net {hovered.net < 0 ? '−' : '+'}{formatShortMoney(Math.abs(hovered.net))}
          </span>
        </div>
      )}

      {/* Pointer overlay — maps x to a column; click selects it. */}
      <div
        className="absolute inset-0"
        style={{ touchAction: 'none', cursor: 'pointer' }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerLeave={() => setHoverIdx(null)}
        onPointerCancel={() => setHoverIdx(null)}
        onClick={(e) => {
          const idx = pointerToIdx(e.clientX);
          if (idx !== null && periods[idx]) onSelect(periods[idx].period);
        }}
      />
    </div>
  );
}
