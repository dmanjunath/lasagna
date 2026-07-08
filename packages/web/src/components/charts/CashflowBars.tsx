import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { niceTicks, formatShortMoney } from '../ds/TrendChart';

// ---------------------------------------------------------------------------
// CashflowBars — Monarch-style diverging income/expense bars on --ui-* tokens.
// One column per period: income bar up (viz-2), expenses bar down (viz-4),
// shared zero axis. Click selects a period; hover bubbles the index up so the
// hero value can swap (same contract as the old SpendTrendChart).
//
// When `visibleCount` is set and there are more periods than fit, the chart
// windows to exactly `visibleCount` whole columns at rest. ALL columns render
// once at absolute coordinates inside a clipped carousel layer translated by
// -windowStart*colW: paging (drag or sideways trackpad scroll) slides the
// layer with a CSS transition instead of re-slicing; a drag follows the
// pointer 1:1 (transition off) and snaps to the nearest whole column on
// release. If `selectedPeriod` moves outside the window (header stepper),
// the window auto-pages to keep it visible. `onHoverChange` always emits
// ABSOLUTE indexes into the full `periods` array.
// ---------------------------------------------------------------------------

const CHART_H = 210;
const CHART_M = { top: 14, right: 12, bottom: 32, left: 52 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Horizontal pointer travel (px) before a drag becomes a pan instead of a hover/click.
const PAN_THRESHOLD = 12;

const PAGE_EASE = 'transform 260ms cubic-bezier(0.22,1,0.36,1)';

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
  visibleCount,
}: {
  periods: CashflowPeriod[];
  granularity: 'month' | 'year';
  selectedPeriod: string;
  onSelect: (period: string) => void;
  onHoverChange?: (i: number | null) => void;
  /** Max columns visible at once; more periods page horizontally. Unset = fit all. */
  visibleCount?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const [containerW, setContainerW] = useState(680);
  // hoverIdx is an ABSOLUTE index into `periods` — spending.tsx does periods[i].
  const [hoverIdx, setHoverIdxRaw] = useState<number | null>(null);
  const setHoverIdx = (i: number | null) => { setHoverIdxRaw(i); onHoverChange?.(i); };
  const setHoverRef = useRef(setHoverIdx);
  setHoverRef.current = setHoverIdx;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth || 680);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = periods.length;
  const windowed = visibleCount !== undefined && n > visibleCount;
  const maxStart = windowed ? n - visibleCount! : 0;
  // Columns visible at once — the window when windowed, everything otherwise.
  const visN = windowed ? visibleCount! : n;

  // Default to the LATEST window; re-snap whenever the data shape changes.
  const [windowStart, setWindowStart] = useState(maxStart);
  useEffect(() => {
    setWindowStart(maxStart);
  }, [n, granularity, visibleCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = windowed ? Math.min(Math.max(0, windowStart), maxStart) : 0;

  const chartW = containerW;
  const innerW = chartW - CHART_M.left - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;
  const colW = innerW / Math.max(1, visN);
  const barW = Math.min(colW * 0.62, 44);

  // Live drag offset (viewBox px from column 0) — null when not dragging.
  // While set, the carousel layer follows the pointer 1:1 with no transition.
  const [dragPx, setDragPx] = useState<number | null>(null);
  const dragPxRef = useRef(0);

  const restPx = start * colW;
  const layerOffset = dragPx ?? restPx;
  const layerStyle = windowed
    ? {
        transform: `translateX(${-layerOffset}px)`,
        transition: dragPx === null ? PAGE_EASE : 'none',
      }
    : undefined;

  // Y domain: [-max(expenses), +max(income)] with ~8% padding, computed over
  // ALL periods so paging never rescales the bars. Ticks come from niceTicks
  // over the max magnitude and are mirrored across zero, clipped to the
  // (possibly asymmetric) domain. All-zero data degrades to a ±1 shell.
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
  // ABSOLUTE column center — carousel-layer coordinates (the layer's translate
  // brings the window into view).
  const colCenter = (ai: number) => CHART_M.left + (ai + 0.5) * colW;

  const selIdx = useMemo(
    () => periods.findIndex((p) => p.period === selectedPeriod),
    [periods, selectedPeriod],
  );

  // Keep-selected-visible: when the selection lands outside the window (e.g.
  // via the header month stepper), page (animated) so it becomes the nearest
  // edge column.
  useEffect(() => {
    if (!windowed || selIdx < 0) return;
    setWindowStart((s) => {
      const cur = Math.min(Math.max(0, s), maxStart);
      if (selIdx < cur) return selIdx;
      if (selIdx >= cur + visN) return selIdx - visN + 1;
      return s;
    });
  }, [selIdx, windowed, maxStart, visN]);

  // X labels — month mode: short month, year added on January or the first
  // in-window label; thin to every other column when >8 visible (keeping the
  // newest labeled). Year mode: every year. Indexes are ABSOLUTE.
  const xLabels = useMemo(() => {
    const out: Array<{ idx: number; label: string }> = [];
    if (granularity === 'year') {
      periods.forEach((p, i) => out.push({ idx: i, label: p.period }));
      return out;
    }
    const thin = visN > 8;
    const labeled = (ai: number) => !thin || (((ai - start) % 2) + 2) % 2 === (visN - 1) % 2;
    let firstInWindow = start;
    while (thin && firstInWindow < n && !labeled(firstInWindow)) firstInWindow++;
    periods.forEach((p, ai) => {
      if (!labeled(ai)) return;
      const m = Number(p.period.slice(5, 7));
      const short = MONTHS[m - 1] ?? p.period;
      const withYear = m === 1 || ai === firstInWindow;
      out.push({ idx: ai, label: withYear ? `${short} ’${p.period.slice(2, 4)}` : short });
    });
    return out;
  }, [periods, granularity, visN, start, n]);

  // Maps a clientX to a WINDOW-relative index (callers add `start` for the
  // absolute one).
  const pointerToIdx = (clientX: number): number | null => {
    const root = wrapRef.current;
    if (!root || visN <= 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = chartW / rect.width;
    const localX = (clientX - rect.left) * scale;
    return Math.min(visN - 1, Math.max(0, Math.floor((localX - CHART_M.left) / Math.max(1, colW))));
  };
  const absIdx = (vi: number | null) => (vi === null ? null : start + vi);

  // --- Paging ---------------------------------------------------------------
  // Live values mirrored into a ref so the native wheel listener (attached
  // once, non-passive so preventDefault works) always sees current state.
  const pageCtx = useRef({ windowed, colW, maxStart, start });
  pageCtx.current = { windowed, colW, maxStart, start };

  const pageTo = (next: number) => {
    const clamped = Math.min(pageCtx.current.maxStart, Math.max(0, next));
    if (clamped === pageCtx.current.start) return false;
    setWindowStart(clamped);
    setHoverRef.current(null);
    return true;
  };

  const wheelAccum = useRef(0);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { windowed, colW } = pageCtx.current;
      if (!windowed) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical intent — not ours
      wheelAccum.current += e.deltaX;
      const steps = Math.trunc(wheelAccum.current / colW);
      if (steps === 0) return;
      wheelAccum.current -= steps * colW;
      if (pageTo(pageCtx.current.start + steps)) e.preventDefault();
      else wheelAccum.current = 0; // hit an edge — drop leftover momentum
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointer drag pans the carousel layer 1:1; a press-and-release without
  // enough horizontal travel stays a hover + click-to-select.
  const dragRef = useRef<{ startX: number; baseX: number; startPx: number; panning: boolean } | null>(null);
  const pannedRef = useRef(false);

  // Release: snap the window to the nearest whole column; clearing dragPx
  // re-enables the transition so the layer eases into place.
  const settleDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.panning) return;
    const { maxStart, colW } = pageCtx.current;
    setWindowStart(Math.min(maxStart, Math.max(0, Math.round(dragPxRef.current / Math.max(1, colW)))));
    setDragPx(null);
  };

  const hovered = hoverIdx !== null ? periods[hoverIdx] : null;
  const hoverInWindow = hoverIdx !== null && hoverIdx >= start && hoverIdx < start + visN;

  // Hover pill position — clamp the column center (in on-screen coords, so
  // minus the layer translate) so the pill stays inside.
  const PILL_W = 240;
  const pillCx = hoverInWindow
    ? Math.max(PILL_W / 2 + 4, Math.min(chartW - PILL_W / 2 - 4, colCenter(hoverIdx!) - restPx))
    : 0;

  const barRects = (p: CashflowPeriod, ai: number) => {
    const cx = colCenter(ai);
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

  const bgW = Math.min(colW - 2, barW + 20);
  const clipRef = windowed ? `url(#${clipId})` : undefined;
  // Remount the carousel layers when the data shape changes so the reset to
  // the latest window snaps instead of animating across the whole range.
  const layerKey = `${granularity}:${n}`;

  const yTickStyle = { fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' } as const;

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        viewBox={`0 0 ${chartW} ${CHART_H}`}
        role="group"
        aria-label="Income and expenses by period"
        className="block w-full"
        style={{ pointerEvents: 'none' }}
      >
        {windowed && (
          <clipPath id={clipId}>
            {/* Plot width, full height — x labels ride along and clip hard too. */}
            <rect x={CHART_M.left} y={0} width={innerW} height={CHART_H} />
          </clipPath>
        )}

        {/* Column backgrounds — selected slides between columns; hover instant. */}
        <g key={`bg-${layerKey}`} clipPath={clipRef}>
          <g style={layerStyle}>
            {selIdx >= 0 && (
              <rect
                data-cashflow-selbg=""
                x={colCenter(selIdx) - bgW / 2}
                y={CHART_M.top - 4}
                width={bgW}
                height={innerH + 8}
                rx={8}
                fill="var(--ui-brand-softer)"
                style={{ transition: 'x 200ms cubic-bezier(0.22,1,0.36,1)' }}
              />
            )}
            {hoverIdx !== null && hoverIdx !== selIdx && (
              <rect
                x={colCenter(hoverIdx) - bgW / 2}
                y={CHART_M.top - 4}
                width={bgW}
                height={innerH + 8}
                rx={8}
                fill="var(--ui-brand-softer)"
                fillOpacity={0.65}
              />
            )}
          </g>
        </g>

        {/* Gridlines + mirrored labels; zero axis solid, others dashed. Fixed —
             they don't translate with the carousel. */}
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
              style={yTickStyle}
            >
              {formatShortMoney(Math.abs(t))}
            </text>
          </g>
        ))}

        {/* Carousel layer — bars, x labels, keyboard targets at absolute coords. */}
        <g key={`fg-${layerKey}`} clipPath={clipRef}>
          <g data-cashflow-layer="" style={layerStyle}>
            {/* Bars — income up, expenses down. */}
            {periods.map((p, ai) => {
              const isSelected = p.period === selectedPeriod;
              const opacity = hoverIdx !== null ? (hoverIdx === ai ? 1 : 0.35) : (isSelected ? 1 : 0.82);
              const { up, down } = barRects(p, ai);
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

            {/* Invisible per-column targets for keyboard access — only the
                 in-window columns are tabbable. */}
            {periods.map((p, ai) => {
              const inWindow = ai >= start && ai < start + visN;
              return (
                <rect
                  key={`kb-${p.period}`}
                  x={CHART_M.left + ai * colW}
                  y={CHART_M.top}
                  width={colW}
                  height={innerH}
                  fill="transparent"
                  role="button"
                  tabIndex={inWindow ? 0 : -1}
                  aria-hidden={inWindow ? undefined : true}
                  aria-label={`${periodLabel(p.period, granularity)}: income ${formatShortMoney(p.income)}, spent ${formatShortMoney(p.expenses)}`}
                  onFocus={() => setHoverIdx(ai)}
                  onBlur={() => setHoverIdx(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.period); }
                  }}
                />
              );
            })}
          </g>
        </g>
      </svg>

      {/* Hover pill — period label + income/spent/net readout. */}
      {hovered && hoverInWindow && (
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

      {/* Pointer overlay — maps x to a column; click selects it; a horizontal
           drag pans the carousel layer 1:1 and snaps on release. pan-y lets
           the browser keep handling vertical page scrolls on touch. */}
      <div
        ref={overlayRef}
        className="absolute inset-0"
        style={{ touchAction: 'pan-y', cursor: 'pointer' }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          dragRef.current = { startX: e.clientX, baseX: e.clientX, startPx: start * colW, panning: false };
          pannedRef.current = false;
          setHoverIdx(absIdx(pointerToIdx(e.clientX)));
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (drag && e.buttons > 0) {
            if (windowed && !drag.panning && Math.abs(e.clientX - drag.startX) > PAN_THRESHOLD) {
              drag.panning = true;
              drag.baseX = e.clientX; // rebase so the pan starts from rest — no threshold jump
              pannedRef.current = true;
              setHoverIdx(null);
            }
            if (drag.panning) {
              const rect = wrapRef.current?.getBoundingClientRect();
              const scale = rect && rect.width > 0 ? chartW / rect.width : 1;
              const next = Math.min(
                maxStart * colW,
                Math.max(0, drag.startPx - (e.clientX - drag.baseX) * scale),
              );
              dragPxRef.current = next;
              setDragPx(next);
              return;
            }
          }
          if (e.pointerType === 'touch' && e.buttons === 0) return;
          setHoverIdx(absIdx(pointerToIdx(e.clientX)));
        }}
        onPointerUp={settleDrag}
        onPointerLeave={() => setHoverIdx(null)}
        onPointerCancel={() => { settleDrag(); setHoverIdx(null); }}
        onClick={(e) => {
          if (pannedRef.current) { pannedRef.current = false; return; }
          const vi = pointerToIdx(e.clientX);
          const p = vi !== null ? periods[start + vi] : undefined;
          if (p) onSelect(p.period);
        }}
      />

    </div>
  );
}
