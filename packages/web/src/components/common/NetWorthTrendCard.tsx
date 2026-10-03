import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, TrendingUp } from 'lucide-react';
import { cn, formatStoredDay } from '../../lib/utils';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../lib/hide-amounts';
import { HiddenAmount, SegmentedControl, Skeleton } from '../uikit';
import { filterByRange, type Range, type TrendPoint } from '../ds';
import { smoothLinePath, niceTicks, pickXLabels, formatShortMoney, tickDecimals } from '../ds/TrendChart';

const fmtUsd = (n: number, frac = 0) =>
  isAmountsHidden()
    ? HIDDEN_AMOUNT
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: frac, minimumFractionDigits: frac });

const fmtDate = (iso: string, withYear = false) =>
  formatStoredDay(iso, withYear ? { year: 'numeric' } : undefined);

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

const CHART_H = 200;
const CHART_M = { top: 16, right: 12, bottom: 34, left: 68 };
// A wider slot for the two tick shapes that do not fit the standard one: a
// SIGNED tick ("−$840.00K" is 57.8px at 11px against a 56px slot) and a
// four-digit one ("$1100.00M"). The svg clips rather than overflows, so the
// sign — the glyph that decides what the number means — was simply gone.
//
// Paid only when it is needed. Held permanently it costs 10px of plot width,
// and at 360px that is enough for two pairs of x-axis date labels to collide.
const CHART_M_LEFT_WIDE = 78;
// Longest tick label the standard slot holds, in characters. The face is
// tabular, so the count is a faithful proxy for the width.
const MAX_TICK_CHARS = 8;

/**
 * Narrowest y-window the chart will draw, as a fraction of the series mean.
 *
 * Fitting the window to the data alone turns a rounding error into a cliff: a
 * month in which an $8.7M net worth moved 1% filled the frame top to bottom,
 * the line plunging to the floor and spiking back, immediately beside a caption
 * reading +1.1%. The chart contradicted its own number, on the surface people
 * open when they are anxious about money.
 *
 * So the window has a floor. Below it the domain is widened around the series
 * and a small move draws small. Above it nothing changes, so a real collapse
 * still fills the frame.
 */
const MIN_Y_SPAN_FRACTION = 0.1;

/**
 * A y-axis tick as it is drawn. The true minus, not the hyphen
 * formatShortMoney emits, so a negative net worth reads the way every other
 * figure in the app does. Both glyphs are in the numerals face.
 *
 * One function, because the slot that has to hold this string is measured from
 * it: sized from a different string, the axis silently clips the sign.
 */
function tickLabel(t: number, decimals: number): string {
  return `${t < 0 ? '−' : ''}${formatShortMoney(Math.abs(t), decimals)}`;
}

function NetWorthChart({ points, range, onHoverChange }: { points: TrendPoint[]; range: Range; onHoverChange?: (i: number | null) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideAmounts = isAmountsHidden();

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

  const { yMin, yMax, yTicks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const mean = values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
    // Widen around the MIDDLE of the series, not around zero: the window keeps
    // the line centred, so what grows is the empty room above and below it.
    const mid = (rawMin + rawMax) / 2;
    const half = Math.max((rawMax - rawMin) / 2, (Math.abs(mean) * MIN_Y_SPAN_FRACTION) / 2);
    const lo = mid - half;
    const hi = mid + half;
    const pad = (hi - lo) * 0.08 || 1;
    return { yMin: lo - pad, yMax: hi + pad, yTicks: niceTicks(lo - pad, hi + pad, 4) };
  }, [points]);

  // Money y-axis labels are removed while amounts are hidden rather than
  // replaced by five identical masks, and the left margin they reserved
  // collapses with them. The plotted geometry is untouched: the domain is fit
  // to the data, so 340→400 and 3.4M→4.0M are already pixel-identical.
  //
  // Otherwise the slot is sized to the labels this particular scale produces,
  // so an unsigned four-figure axis keeps every pixel of plot it had.
  const tickChars = useMemo(
    () => Math.max(...yTicks.map((t) => tickLabel(t, tickDecimals(yTicks)).length), 0),
    [yTicks],
  );
  const chartLeft = hideAmounts ? 12 : tickChars > MAX_TICK_CHARS ? CHART_M_LEFT_WIDE : CHART_M.left;

  const innerW = chartW - chartLeft - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;

  const xAt = (i: number) => chartLeft + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v: number) => CHART_M.top + innerH - ((v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

  const xy = useMemo<Array<[number, number]>>(
    () => points.map((p, i) => [xAt(i), yAt(p.value)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, chartW, yMin, yMax, chartLeft],
  );
  const linePath = useMemo(() => smoothLinePath(xy), [xy]);
  const baseY = (CHART_M.top + innerH).toFixed(2);
  const areaPath = linePath
    ? `${linePath} L ${xAt(points.length - 1).toFixed(2)} ${baseY} L ${xAt(0).toFixed(2)} ${baseY} Z`
    : '';

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  // pickXLabels offers five dates whatever the frame is, and on a phone five
  // "Sep 16"-sized labels do not fit the plot: they run together into one smear
  // along the bottom of the chart, worst at the ends, which anchor inward and so
  // sit half a label closer to their neighbour than the spacing suggests. Drop
  // every other date, ends kept, until what is left clears.
  const xLabels = useMemo(() => {
    const all = pickXLabels(points, range);
    const span = Math.max(1, points.length - 1);
    // ~6.1px per character at 11px in this face, plus half a label for the
    // inward-anchored end and a few px so neighbours read as separate tokens.
    const need = Math.max(0, ...all.map((l) => l.label.length)) * 6.1 * 1.5 + 6;
    const tightest = (rows: typeof all) =>
      Math.min(...rows.slice(1).map((l, i) => ((l.idx - rows[i].idx) / span) * innerW));
    let out = all;
    while (out.length > 2 && tightest(out) < need) {
      out = out.filter((_, i) => i % 2 === 0 || i === out.length - 1);
    }
    return out;
  }, [points, range, innerW]);

  const pointerToIdx = (clientX: number): number | null => {
    const root = wrapRef.current;
    if (!root || points.length <= 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = chartW / rect.width;
    const localX = (clientX - rect.left) * scale;
    const ratio = (localX - chartLeft) / Math.max(1, innerW);
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
              x1={chartLeft} y1={yAt(t)} x2={chartW - CHART_M.right} y2={yAt(t)}
              stroke="var(--ui-hairline)" strokeWidth={1} strokeDasharray="2 5"
            />
            {!hideAmounts && (
              <text
                x={chartLeft - 12} y={yAt(t)} dy="0.32em" textAnchor="end"
                fill="rgb(var(--ui-content-faint))"
                style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
              >
                {tickLabel(t, tickDecimals(yTicks))}
              </text>
            )}
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

        {/* The first and last labels sit ON the plot edges, so a centred anchor
            hangs half of each outside the viewBox and the SVG clips it ("Aug 16"
            renders as "ug 16"). Anchoring the ends inward keeps the whole label
            on canvas at any left margin, including the narrow one the chart
            falls back to when the money y-axis is hidden. */}
        {xLabels.map(({ idx, label }) => (
          <text
            key={`${idx}-${label}`}
            x={xAt(idx)}
            y={CHART_H - 10}
            textAnchor={idx === 0 ? 'start' : idx === points.length - 1 ? 'end' : 'middle'}
            fill="rgb(var(--ui-content-muted))"
            style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
          >
            {label}
          </text>
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
  history, netWorth, className, titleClassName, defaultRange = '6M', action,
  historyLoading = false, historyError = false, valueLoading = false,
}: {
  history: TrendPoint[];
  netWorth: number;
  /**
   * History is still in flight. Without this the card meets an empty `history`
   * and states "Building your trend", which is a claim about the data rather
   * than about the request, and it is wrong for the seconds before the request
   * lands. Off by default: a caller that resolves history before mounting the
   * card never needs it.
   */
  historyLoading?: boolean;
  /**
   * The history request failed. Without this the card falls back to "Building
   * your trend", which tells the user they have too little history when in fact
   * we could not ask. It is the same untruth `historyLoading` exists to prevent,
   * one state further along.
   */
  historyError?: boolean;
  /**
   * The net-worth figure itself has not arrived. Lets the host render this card
   * as its own first-paint skeleton instead of hand-building a second copy of
   * this layout beside it, which is how the two drifted apart and cost the page
   * a 34px jump the moment the real card replaced the stand-in.
   */
  valueLoading?: boolean;
  /** Margin/placement from the page that hosts the card. */
  className?: string;
  /**
   * The host page's section-heading treatment for "Net worth". Required, and
   * supplied per page: Home and Money run their sections at different scales,
   * so a size baked in here would be an outlier on one of them.
   */
  titleClassName: string;
  /** Range the picker starts on. The user can still switch. */
  defaultRange?: Range;
  /**
   * Optional link out, shown beside the range picker. The host page supplies it
   * so Money does not render a link to itself, and so the link keeps whatever
   * idiom that page already uses for its other page links.
   */
  action?: ReactNode;
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
  // The scrubbed day leads the caption only when it is a DIFFERENT day from
  // the one the change is measured against. Scrubbing the first point of the
  // period it is the same day, and printing it twice ("on Aug 16, since Aug
  // 16, 2026") reads as two facts when there is one.
  const hoveredLabel = hoveredPoint && hoveredPoint.date !== periodStart?.date
    ? fmtDate(hoveredPoint.date)
    : null;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6',
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
      {/* The controls ride on the label line, not beside the figure. Put beside
          the figure they could not fit next to it at any usable card width, so
          they wrapped to a line of their own and cost the card ~53px of height
          for a row that was mostly empty. The label line has the room. */}
      <div className="relative">
        {/* Label, link and picker on one wrapping line, in this order in the DOM
            so focus follows what the eye follows. The picker carries its own
            `w-full sm:w-auto` (its stretch behaviour), which is what breaks the
            line on a phone: label and link share the first row, the picker
            takes the second and fills it. Wrapping the picker in a positioning
            div instead resolved that width against the div and shrank the rail
            on phones, so it stays a direct child here. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* The card is a section of the page that hosts it, so its title is
              that page's section heading, at that page's scale.

              The heading is FIXED at "Net worth". The scrubbed day it used to
              swap in now reads on the muted line under the figure: at display
              size a longer title wraps this row, and the row jumping height is
              exactly what drops the chart out from under the cursor doing the
              scrubbing.

              `flex-1` right-aligns whatever follows without an auto margin, so
              the link still sits right when there is no history and the picker
              is not rendered at all. */}
          <h2 className={cn('min-w-0 flex-1 truncate', titleClassName)}>Net worth</h2>
          {action}
          {(historyLoading || valueLoading) && !hasRanges && (
            // Holds the picker's place while history is in flight. Without it
            // the control arrives as a new row and pushes the chart down.
            <Skeleton className="h-[38px] w-full sm:w-[187px] rounded-ui-md" />
          )}
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
        {/* Figure and change share a line: stacking them cost ~40px of card
            height for a chip that fits comfortably beside the number. They
            wrap onto separate lines only when the card is too narrow. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* The mask is the COMPONENT here, not the string `fmtUsd` would
              return: a bare "$•••••" inherits the editorial face, whose bullets
              squash into ellipses at this size and read as broken text. */}
          {valueLoading ? (
            // Sized off the same type scale as the figure it stands in for, so
            // the line it sits on does not change height when the value lands.
            <span className="font-editorial text-[32px] sm:text-[40px] leading-[1.05] block">
              <Skeleton className="h-[1em] w-[260px] max-w-full rounded-[11px]" />
            </span>
          ) : (
            <span className="font-editorial text-[32px] sm:text-[40px] font-extrabold leading-[1.05] tracking-[-0.035em] ui-tnum">
              {isAmountsHidden() ? <HiddenAmount /> : fmtUsd(displayValue)}
            </span>
          )}
          {/* Chip and caption are direct children of the row, not a nested
              flex box of their own. Nested, the pair wrapped as a unit onto a
              line of its own and then wrapped AGAIN inside it, so the longer
              scrubbing caption cost the card a third line (+29.5px at 390px)
              and pushed the chart down under the finger doing the scrubbing.
              Flat, the caption is the only thing that moves, onto a full-width
              line that holds it at every width. */}
          {(historyLoading || valueLoading) && periodDelta === null && (
            // Holds the row the delta chip and its "since" line will occupy.
            // They depend on history, so without this the header grows by a
            // whole line at the moment history arrives.
            <Skeleton className="h-7 w-[218px] rounded-full" />
          )}
          {periodDelta !== null && sinceLabel && (
            <>
              {/* Masked, the chip is a tinted arrow around a second copy of the
                  mask already leading the card, so it is dropped rather than
                  filled with bullets. The percentage beside it is
                  scale-invariant, so it stays and carries the change. */}
              {!isAmountsHidden() && <DeltaChip delta={periodDelta} />}
              {/* Scrubbing the chart shows a past day, so this line says which
                  one. Without it the figure silently contradicts every other
                  net-worth number on the page. It rides here rather than in the
                  title because this line already dates the figure, and because
                  the title is a display-size heading that cannot absorb a
                  changing label without moving the controls beside it.

                  The scrubbed day is the only token on the line that changes,
                  and it is what re-dates the figure above, so it carries the
                  full-contrast weight while the period it is measured against
                  stays muted. Set in the same muted grey it read as a third
                  run of dates rather than as the answer to "which day is
                  this?". */}
              <span className="text-[13px] font-medium text-content-muted ui-tnum">
                {hoveredLabel && (
                  <span className="font-semibold text-content">on {hoveredLabel},{' '}</span>
                )}
                since {sinceLabel}
                {periodPct !== null ? ` (${periodPct < 0 ? '−' : '+'}${Math.abs(periodPct).toFixed(1)}%)` : ''}
              </span>
            </>
          )}
        </div>
      </div>

      {hasChart ? (
        <div className="relative mt-4 pr-2 sm:pr-0">
          <NetWorthChart points={chartPoints} range={range} onHoverChange={setChartHoverIdx} />
        </div>
      ) : historyLoading ? (
        // CHART_H, not a guess: a skeleton that reserves the wrong height moves
        // every card below this one when the real chart replaces it.
        <Skeleton style={{ height: CHART_H }} className="mt-4 w-full rounded-ui-md" />
      ) : historyError ? (
        <div
          role="status"
          style={{ minHeight: CHART_H }}
          className="mt-4 grid place-items-center rounded-ui-md border border-dashed border-line-strong bg-canvas-sunken/40 px-3 text-center"
        >
          <div>
            <div className="mx-auto mb-2.5 grid h-11 w-11 place-items-center rounded-ui-md bg-negative-soft text-negative">
              <AlertCircle size={20} />
            </div>
            <div className="text-[15px] font-semibold">Couldn't load your trend</div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ui-focus mt-1.5 inline-flex min-h-touch items-center rounded-ui-sm text-[13px] font-bold text-[rgb(var(--ui-brand-ink))] underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div role="status" className="mt-4 grid place-items-center rounded-ui-md border border-dashed border-line-strong bg-canvas-sunken/40 px-3 py-10 text-center">
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
