import { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SegmentedControl } from '../uikit';
import { filterByRange, type Range, type TrendPoint } from '../ds';
import { smoothLinePath, niceTicks, pickXLabels, formatShortMoney, tickDecimals } from '../ds/TrendChart';

const fmtUsd = (n: number, frac = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: frac, minimumFractionDigits: frac });

const fmtDate = (iso: string, withYear = false) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });

const RANGES: Range[] = ['1M', '6M', '1Y', 'All'];

/**
 * The shortest range that can actually draw a line, starting from the one the
 * page asked for. The ranges nest (1M ⊆ 6M ⊆ 1Y ⊆ All), so a range that comes
 * back empty can only be filled by a longer one. Returns the asked-for range
 * when no range holds two points, which is the "Building your trend" case.
 */
function drawableRange(history: TrendPoint[], preferred: Range): Range {
  const from = Math.max(0, RANGES.indexOf(preferred));
  for (let i = from; i < RANGES.length; i++) {
    if (filterByRange(history, RANGES[i]).length >= 2) return RANGES[i];
  }
  return preferred;
}

function DeltaChip({ delta }: { delta: number }) {
  const positive = delta >= 0;
  return (
    <span
      className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13px] font-bold ui-tnum"
      style={{
        background: positive ? 'var(--ui-positive-soft)' : 'var(--ui-negative-soft)',
        color: positive ? 'rgb(var(--ui-positive))' : 'rgb(var(--ui-negative))',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {positive ? <path d="M12 7l7 8H5z" /> : <path d="M12 17 5 9h14z" />}
      </svg>
      {positive ? '+' : '−'}{fmtUsd(Math.abs(delta))}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Net-worth trend chart — brand area+line on --ui-* tokens. Mirrors the math
// of the shared ds/TrendChart (smooth spline + nice ticks) but restyled to the
// new palette, with hover crosshair that bubbles the index up to swap the lead.
// ─────────────────────────────────────────────────────────────────────────

const CHART_H = 250;
const CHART_M = { top: 16, right: 12, bottom: 34, left: 68 };

function NetWorthChart({ points, range, onHoverChange }: { points: TrendPoint[]; range: Range; onHoverChange?: (i: number | null) => void }) {
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

  const { yMin, yMax, yTicks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = (rawMax - rawMin) * 0.08 || Math.abs(rawMax) * 0.08 || 1;
    return { yMin: rawMin - pad, yMax: rawMax + pad, yTicks: niceTicks(rawMin - pad, rawMax + pad, 4) };
  }, [points]);

  const xAt = (i: number) => CHART_M.left + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v: number) => CHART_M.top + innerH - ((v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

  const xy = useMemo<Array<[number, number]>>(
    () => points.map((p, i) => [xAt(i), yAt(p.value)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, chartW, yMin, yMax],
  );
  const linePath = useMemo(() => smoothLinePath(xy), [xy]);
  const baseY = (CHART_M.top + innerH).toFixed(2);
  const areaPath = linePath
    ? `${linePath} L ${xAt(points.length - 1).toFixed(2)} ${baseY} L ${xAt(0).toFixed(2)} ${baseY} Z`
    : '';

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const xLabels = useMemo(() => pickXLabels(points, range), [points, range]);

  const pointerToIdx = (clientX: number): number | null => {
    const root = wrapRef.current;
    if (!root || points.length <= 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = chartW / rect.width;
    const localX = (clientX - rect.left) * scale;
    const ratio = (localX - CHART_M.left) / Math.max(1, innerW);
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        viewBox={`0 0 ${chartW} ${CHART_H}`}
        role="img"
        aria-label="Net worth trend chart"
        className="block w-full"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id="nw-area-ui" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity="0.24" />
            <stop offset="55%" stopColor="var(--ui-viz-2)" stopOpacity="0.07" />
            <stop offset="100%" stopColor="var(--ui-viz-2)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="nw-line-ui" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--ui-viz-2)" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={CHART_M.left} y1={yAt(t)} x2={chartW - CHART_M.right} y2={yAt(t)}
              stroke="var(--ui-hairline)" strokeWidth={1} strokeDasharray="2 5"
            />
            <text
              x={CHART_M.left - 12} y={yAt(t)} dy="0.32em" textAnchor="end"
              fill="rgb(var(--ui-content-faint))"
              style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatShortMoney(t, tickDecimals(yTicks))}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#nw-area-ui)" />
        <path
          d={linePath} fill="none" stroke="url(#nw-line-ui)"
          strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
        />

        {!hover && points.length > 0 && (
          <>
            <circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].value)} r={11} fill="var(--ui-viz-2)" fillOpacity={0.12} />
            <circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].value)} r={5.5} fill="var(--ui-viz-2)" stroke="rgb(var(--ui-panel))" strokeWidth={3} />
          </>
        )}
        {hover && hoverIdx !== null && (
          <g>
            <line x1={xAt(hoverIdx)} y1={CHART_M.top} x2={xAt(hoverIdx)} y2={CHART_M.top + innerH} stroke="rgb(var(--ui-content-muted))" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 4" />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={14} fill="var(--ui-viz-2)" fillOpacity={0.16} />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={5.5} fill="var(--ui-viz-2)" stroke="rgb(var(--ui-panel))" strokeWidth={3} />
          </g>
        )}

        {xLabels.map(({ idx, label }) => (
          <text key={`${idx}-${label}`} x={xAt(idx)} y={CHART_H - 10} textAnchor="middle" fill="rgb(var(--ui-content-muted))" style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{label}</text>
        ))}
      </svg>

      {/* Pointer overlay — snaps hover to the nearest x-domain point. */}
      <div
        className="absolute inset-0"
        style={{ touchAction: 'pan-y', cursor: 'crosshair' }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerLeave={() => setHoverIdx(null)}
        onPointerCancel={() => setHoverIdx(null)}
      />
    </div>
  );
}

/**
 * Net-worth lead + trend card. The figure leads, the chart reads it back, and
 * hovering the chart swaps the figure (and the change pill) for the hovered
 * day. Shared by Money and Home so both surfaces scrub the same way.
 */
export function NetWorthTrendCard({
  history, netWorth, className, defaultRange = '6M',
}: {
  history: TrendPoint[];
  netWorth: number;
  /** Margin/placement from the page that hosts the card. */
  className?: string;
  /** Range the picker starts on. The user can still switch. */
  defaultRange?: Range;
}) {
  const [range, setRange] = useState<Range>(() => drawableRange(history, defaultRange));
  // A range the reader picked themselves is never overridden, so the empty-range
  // message stays reachable (and recoverable) once they have been there.
  const rangeIsTheirs = useRef(false);
  // History lands after the first paint, so the opening range is resolved again
  // when it does. Nobody should meet an empty card that a longer range can fill.
  // Only an undrawable range is corrected, so later data never moves the reader
  // off a chart they are already looking at.
  useEffect(() => {
    if (rangeIsTheirs.current) return;
    setRange((cur) => (filterByRange(history, cur).length >= 2 ? cur : drawableRange(history, cur)));
  }, [history]);

  // Hover index bubbled up from the chart so the lead can swap its value/delta
  // for the hovered point's value/date.
  const [chartHoverIdx, setChartHoverIdx] = useState<number | null>(null);

  const chartPoints = useMemo(() => filterByRange(history, range), [history, range]);

  const hasChart = chartPoints.length >= 2;
  // The picker keys off the WHOLE history, not the filtered slice: a range that
  // happens to be empty must not take the control that switches away from it.
  const hasRanges = history.length >= 2;
  const hoveredPoint = hasChart && chartHoverIdx !== null ? chartPoints[chartHoverIdx] : null;
  const displayValue = hoveredPoint ? hoveredPoint.value : netWorth;
  // Change pill stays visible while hovering and always reads the diff from the
  // START of the selected period to the currently-shown value (hovered or latest).
  // With no drawn period there is no diff to state: a "+$0 (+0.0%)" printed from
  // a range that holds nothing is a false reading, not a flat one.
  const periodStart = hasChart ? chartPoints[0] : null;
  const periodDelta = periodStart ? displayValue - periodStart.value : null;
  const periodPct = periodStart && periodStart.value !== 0
    ? (periodDelta! / periodStart.value) * 100
    : null;
  const sinceLabel = periodStart ? fmtDate(periodStart.date, true) : null;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7',
        className,
      )}
    >
      {/* atmospheric wash — periwinkle top-right + brand top-left */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 100% 0%, var(--ui-info-soft), transparent 56%),' +
            'radial-gradient(90% 70% at 0% 4%, var(--ui-accent-softer), transparent 60%)',
        }}
      />
      {/* The lead and the range picker share a row only while they both fit.
          `sm:` alone lies about that: the app sidebar can leave this card ~305px
          wide at a 768px viewport, where the row put the picker past the card's
          clipped edge. Wrapping lets the widths decide, whatever the figure. */}
      <div className="relative flex flex-wrap flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {/* Scrubbing the chart shows a past day, so the label says which one.
              Without it the figure silently contradicts every other net-worth
              number on the page. */}
          <div className="text-[13px] font-semibold text-content-muted">
            {hoveredPoint ? `Net worth on ${fmtDate(hoveredPoint.date)}` : 'Net worth'}
          </div>
          <div className="mt-2 font-editorial text-[38px] sm:text-[52px] font-extrabold leading-[0.98] tracking-[-0.035em] ui-tnum">
            {fmtUsd(displayValue)}
          </div>
          {periodDelta !== null && sinceLabel && (
            <div className="mt-3.5 flex items-center gap-2.5 flex-wrap">
              <DeltaChip delta={periodDelta} />
              <span className="text-[13px] font-medium text-content-muted ui-tnum">
                since {sinceLabel}
                {periodPct !== null ? ` (${periodPct < 0 ? '−' : '+'}${Math.abs(periodPct).toFixed(1)}%)` : ''}
              </span>
            </div>
          )}
        </div>
        {hasRanges && (
          <SegmentedControl
            aria-label="Time range"
            value={range}
            onChange={(r) => { rangeIsTheirs.current = true; setRange(r as Range); }}
            options={[
              { value: '1M', label: '1M' },
              { value: '6M', label: '6M' },
              { value: '1Y', label: '1Y' },
              { value: 'All', label: 'All' },
            ]}
          />
        )}
      </div>

      {hasChart ? (
        <div className="relative mt-5 pr-2 sm:pr-0">
          <NetWorthChart points={chartPoints} range={range} onHoverChange={setChartHoverIdx} />
        </div>
      ) : (
        <div role="status" className="mt-5 grid place-items-center rounded-ui-md border border-dashed border-line-strong bg-canvas-sunken/40 px-3 py-10 text-center">
          <div className="mb-2.5 grid h-11 w-11 place-items-center rounded-ui-md bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]">
            <TrendingUp size={20} />
          </div>
          <div className="text-[15px] font-semibold">
            {hasRanges ? 'Nothing in this range' : 'Building your trend'}
          </div>
          <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-content-muted">
            {hasRanges
              ? 'Pick a longer range to see your trend.'
              : 'Your net-worth chart appears once we have a few days of history.'}
          </p>
        </div>
      )}
    </section>
  );
}
