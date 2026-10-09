import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { niceTicks, formatShortMoney } from '../ds/TrendChart';
import { isAmountsHidden } from '../../lib/hide-amounts';

// ---------------------------------------------------------------------------
// CashflowBars — diverging income/expense bars on --ui-* tokens.
// One column per period: income bar up (viz-2), expenses bar down (viz-4),
// shared zero axis, named by the legend under the plot. Click selects a period;
// hover bubbles the index up so the hero value can swap (same contract as the
// old SpendTrendChart).
//
// The axis is SIGNED below zero. Mirrored ticks printed unsigned put "$10K" at
// two heights on one axis meaning two different things, on a chart whose two
// halves are the two numbers people most want to tell apart.
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

// How long a finger must rest on a column before the rest of the plot dims, and
// how far it may drift vertically first before that reads as a page scroll.
const PRESS_RAMP_MS = 150;
const PRESS_SCROLL_SLOP = 10;

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

/**
 * Is this the period the calendar is currently inside?
 *
 * Its figures cover the days so far, not a whole period, which is why its bar
 * is hatched here and why the page above must not compare it to a finished one.
 * Exported so there is ONE definition of "still running" on this screen rather
 * than the chart and its header each deciding separately. Read from the local
 * calendar, the same clock the page's "no stepping into the future" ceiling
 * uses.
 */
export function isCurrentPeriod(period: string, granularity: 'month' | 'year'): boolean {
  const now = new Date();
  return period === (granularity === 'year'
    ? String(now.getFullYear())
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
}

/**
 * The period as the readout and the screen reader say it. The hatch on the bar
 * tells a sighted reader the newest column is not a whole period yet; nothing
 * carried that to anyone reading the text, and the text is where the figures
 * are, so it says so too.
 */
function readoutLabel(period: string, granularity: 'month' | 'year', partial: boolean): string {
  const base = periodLabel(period, granularity);
  return partial ? `${base} so far` : base;
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
  // null until the element has been measured. The layout below needs SOME width
  // to compute with, but the carousel must not animate from a guessed one: at
  // the old hardcoded default the first paint laid the columns out at the wrong
  // pitch and the correction one frame later eased across ~400px of chart on
  // every page load — the same wrong-offset-then-ease the window re-snap kills.
  const [containerW, setContainerW] = useState<number | null>(null);
  // hoverIdx is an ABSOLUTE index into `periods` — spending.tsx does periods[i].
  const [hoverIdx, setHoverIdxRaw] = useState<number | null>(null);
  // Keyboard focus previews a column in the hero exactly as a mouse hover does,
  // but it must not open the readout pill: the pill floats over the top of the
  // plot, where it would cover the focus ring's top edge, and every figure in it
  // is already in the KPIs above. It also decides whether the ring PAINTS while
  // a pointer preview is LIVE: a ring left on another column would be a second
  // mark disagreeing with the hero. The element keeps DOM focus throughout —
  // blurring it ejects the user to the top of the tab order in WebKit — and the
  // ring comes back the moment the pointer gives the preview up.
  const [hoverIsKeyboard, setHoverIsKeyboard] = useState(false);
  const setHoverIdx = (i: number | null, fromKeyboard = false) => {
    setHoverIdxRaw(i);
    setHoverIsKeyboard(i !== null && fromKeyboard);
    onHoverChange?.(i);
  };
  const setHoverRef = useRef(setHoverIdx);
  setHoverRef.current = setHoverIdx;

  // Index of the column that currently holds DOM focus, or null.
  const focusedIdx = (): number | null => {
    const root = wrapRef.current;
    const a = document.activeElement;
    if (!root || !a) return null;
    const i = [...root.querySelectorAll('rect[role="button"]')].indexOf(a);
    return i >= 0 ? i : null;
  };

  // The pointer is done previewing. If a column still holds keyboard focus, hand
  // the preview back to it so its ring and the hero reappear together instead of
  // leaving focus unmarked on screen.
  const releaseHover = () => {
    const i = focusedIdx();
    if (i !== null) setHoverIdx(i, true);
    else setHoverIdx(null);
  };
  const releaseHoverRef = useRef(releaseHover);
  releaseHoverRef.current = releaseHover;

  // Press feedback for touch, which has no hover state (see the overlay note
  // below). PURELY visual and PURELY local: it must never reach onHoverChange,
  // or the hero previews the pressed value mid-press and snaps back on release,
  // which is the bug the touch/hover split exists to fix.
  //
  // The band under the finger is instant, like any tap highlight. Dimming every
  // OTHER column is the loud part, so it waits: a page scroll that merely
  // begins on the chart is a pointerdown the browser cancels ~140ms later, and
  // strobing the whole plot on the way past is far more than that gesture
  // deserves. PRESS_RAMP_MS is UIScrollView's delaysContentTouches window for
  // the same reason. Vertical travel disarms it outright — that is a scroll.
  const [pressIdx, setPressIdx] = useState<number | null>(null);
  const [pressHeld, setPressHeld] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPress = () => {
    if (pressTimer.current !== null) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    setPressIdx(null);
    setPressHeld(false);
  };
  useEffect(() => () => { if (pressTimer.current !== null) clearTimeout(pressTimer.current); }, []);

  // Layout effect, not a passive one: this runs before the browser paints, so
  // the very first frame is already at the real width instead of correcting.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => { const w = el.clientWidth; if (w > 0) setContainerW(w); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The period the calendar is CURRENTLY inside, if the chart is showing it.
  // Its bar counts a few days or a few months, not a whole one, and drawn
  // plain it reads as a collapse: the newest column next to a full one says
  // spending fell off a cliff when the month simply has not happened yet. So
  // the column is hatched and the legend names the hatch.
  //
  // Derived from the calendar at render time, the same way the page derives
  // its "no stepping into the future" ceiling. It changes how the newest
  // column is DRAWN and nothing else: which periods arrive, and how they are
  // bucketed, are the caller's.
  const partialIdx = useMemo(
    () => periods.findIndex((p) => isCurrentPeriod(p.period, granularity)),
    [periods, granularity],
  );

  const n = periods.length;
  const windowed = visibleCount !== undefined && n > visibleCount;
  const maxStart = windowed ? n - visibleCount! : 0;
  // Columns visible at once — the window when windowed, everything otherwise.
  const visN = windowed ? visibleCount! : n;

  // Default to the LATEST window; re-snap whenever the data shape changes.
  // The re-snap happens DURING the render that sees the new shape, not in an
  // effect afterwards: an effect lands a paint later, so the remounted layer
  // paints once at translateX(0) and then eases across the whole range — a
  // 260ms pan through months nobody asked for on every Year to Month switch.
  const shapeKey = `${granularity}:${n}`;
  const [windowStart, setWindowStart] = useState(maxStart);
  const [shape, setShape] = useState(shapeKey);
  if (shape !== shapeKey) {
    setShape(shapeKey);
    setWindowStart(maxStart);
  }

  const start = windowed ? Math.min(Math.max(0, windowStart), maxStart) : 0;

  const chartW = containerW ?? 680;
  // Money y-axis labels are removed while amounts are hidden rather than
  // replaced by five identical masks, and the left margin they reserved
  // collapses with them. The plotted geometry is untouched: the domain is fit
  // to the data, so 340→400 and 3.4M→4.0M are already pixel-identical.
  const hideAmounts = isAmountsHidden();
  const chartLeft = hideAmounts ? 12 : CHART_M.left;

  const innerW = chartW - chartLeft - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;
  const colW = innerW / Math.max(1, visN);
  const barW = Math.min(colW * 0.66, 76);

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
  // The keyboard targets can't take the layers' remount-on-resize trick — they
  // hold DOM focus — so they get the same easing declaratively, minus the one
  // render that carries a new width. Recording the applied width in a LAYOUT
  // effect keeps that decision deterministic: it lands before the paint it has
  // to suppress, which a passive effect cannot promise.
  const appliedW = useRef(chartW);
  const resized = appliedW.current !== chartW;
  useLayoutEffect(() => { appliedW.current = chartW; });
  const kbLayerStyle = windowed
    ? {
        transform: `translateX(${-layerOffset}px)`,
        transition: !resized && dragPx === null ? PAGE_EASE : 'none',
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
  const colCenter = (ai: number) => chartLeft + (ai + 0.5) * colW;

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
    return Math.min(visN - 1, Math.max(0, Math.floor((localX - chartLeft) / Math.max(1, colW))));
  };
  const absIdx = (vi: number | null) => (vi === null ? null : start + vi);

  // --- Paging ---------------------------------------------------------------
  // Live values mirrored into a ref so the native wheel listener (attached
  // once, non-passive so preventDefault works) always sees current state.
  const pageCtx = useRef({ windowed, colW, maxStart, start, visN });
  pageCtx.current = { windowed, colW, maxStart, start, visN };

  const pageTo = (next: number) => {
    const clamped = Math.min(pageCtx.current.maxStart, Math.max(0, next));
    if (clamped === pageCtx.current.start) return false;
    setWindowStart(clamped);
    // A pointer hover means nothing once the plot slides out from under it, so
    // the preview falls back the same way it does when the pointer leaves: to a
    // column that still holds focus, or to nothing. A keyboard preview keeps its
    // column, its ring and the hero together, and if the page carries that
    // column out of view the focus-containment effect below moves it to the
    // nearest one still in the window, preview and all.
    if (!hoverIsKeyboardRef.current) releaseHoverRef.current();
    return true;
  };

  // A data-shape change replaces every column, so whatever the preview pointed
  // at is gone — and nothing left on screen can clear it: a removed keyboard
  // target fires no blur, and a pointer parked on the plot fires nothing until
  // it moves. Either way the preview stays latched, dimming the whole plot
  // around a column that no longer exists. Drop it explicitly, whatever set it.
  // (A width change no longer rebuilds them, so it needs no equivalent.)
  const hoverIsKeyboardRef = useRef(false);
  hoverIsKeyboardRef.current = hoverIsKeyboard;
  const hoverIdxRef = useRef<number | null>(null);
  hoverIdxRef.current = hoverIdx;
  useLayoutEffect(() => {
    if (hoverIdxRef.current !== null) setHoverRef.current(null);
  }, [shapeKey]);

  // Whatever moved the window — wheel, drag, the header stepper — DOM focus must
  // not be left on a column outside it. Such a column is clipped off the plot,
  // aria-hidden and untabbable, yet Enter would still commit a period that was
  // never on screen and the next Tab would jump past the whole chart. One
  // invariant here beats a call at each call site.
  useLayoutEffect(() => {
    const i = focusedIdx();
    if (i === null || (i >= start && i < start + visN)) return;
    const rects = wrapRef.current?.querySelectorAll<SVGElement>('rect[role="button"]');
    rects?.[Math.min(start + visN - 1, Math.max(start, i))]?.focus?.();
  }, [start, visN]); // eslint-disable-line react-hooks/exhaustive-deps

  const wheelAccum = useRef(0);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    // Leftover momentum belongs to the old column pitch; re-dividing it by a
    // new one would jump an extra column on the first tick after a resize.
    wheelAccum.current = 0;
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
    // Keyed to the measurement, not to mount: before the width is known this
    // component renders a bare wrapper with no overlay, so a mount-only effect
    // would find nothing to listen on and never retry.
  }, [containerW]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointer drag pans the carousel layer 1:1; a press-and-release without
  // enough horizontal travel stays a hover + click-to-select.
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; startPx: number; panning: boolean } | null>(null);
  const pannedRef = useRef(false);
  // What a touch gesture will commit, decided by the gesture rather than by the
  // click. The synthesized click carries the pointer-DOWN x, not the release x,
  // so resolving the column from it would select wherever the finger first
  // landed while the band tracked where it ended up. `null` outer = a mouse or
  // pen gesture (resolve from the click); `{ idx: null }` = a touch gesture
  // that disqualified itself by scrolling or panning and must commit nothing.
  const touchRef = useRef<{ idx: number | null } | null>(null);

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

  // A width change mid-pan leaves dragPx measured in the OLD column pitch, so
  // the window parks on a column the finger is nowhere near. End the gesture
  // instead of translating it: settleDrag snaps to a whole column, and it is a
  // no-op when nothing is panning.
  useLayoutEffect(() => { settleDrag(); }, [colW]); // eslint-disable-line react-hooks/exhaustive-deps

  const hovered = hoverIdx !== null ? periods[hoverIdx] : null;
  const hoverInWindow = hoverIdx !== null && hoverIdx >= start && hoverIdx < start + visN;
  // The column drawn as "active". Mouse and pen set hoverIdx, a finger sets
  // pressIdx, never both. The readout pill stays on hoverIdx: on a phone every
  // figure in it is already in the KPIs above.
  const activeIdx = hoverIdx ?? pressIdx;
  // Only a settled press joins the hover in dimming the rest of the plot.
  const rampIdx = hoverIdx ?? (pressHeld ? pressIdx : null);

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
  // The column highlight band, and the shape the keyboard target borrows so a
  // focus ring traces the highlight instead of an invisible square around it.
  const bandRect = (ai: number) => ({
    x: colCenter(ai) - bgW / 2,
    y: CHART_M.top - 4,
    width: bgW,
    height: innerH + 8,
    rx: 8,
  });
  const clipRef = windowed ? `url(#${clipId})` : undefined;
  const hatchId = `${clipId}-partial`;
  // Remount the carousel layers whenever the geometry they were laid out for
  // changes — the data shape OR the measured width. A CSS transition can only
  // ease from a value the element already had, so fresh elements simply cannot
  // slide: a resize snaps to the new pitch instead of panning the plot through
  // offsets nobody asked for and tearing the selection band off its bar on the
  // way (the band's transition is shorter than the layer's). Paging and moving
  // the selection keep the same elements, so those still animate. This is a
  // property of the tree, not a timing guess — the same decision made from an
  // effect races the paint that is supposed to be suppressed.
  const layerKey = `${shapeKey}:${chartW}`;

  const yTickStyle = { fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' } as const;

  // Is the in-progress column inside the window the reader can see right now?
  // Unwindowed this is just "does the data reach the current period at all",
  // since start is 0 and visN is every column.
  const partialInWindow = partialIdx >= start && partialIdx < start + visN;

  // Legend. Two colours, no key, and half the chart is below the zero line:
  // without this nothing on the page said which stack was income and which was
  // spending. It sits UNDER the plot, indented to the plot's left edge — the
  // svg is drawn at viewBox scale 1:1 against its measured width, so chartLeft
  // is already CSS pixels — and outside the pointer overlay below, which is
  // inset-0 over its own wrapper and would otherwise turn a click on the word
  // "Income" into a period selection.
  const legend = (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] font-semibold text-content-muted"
      style={{ paddingLeft: chartLeft }}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="h-[11px] w-[11px] shrink-0 rounded-[3.5px]" style={{ background: 'var(--ui-viz-2)' }} />
        Income
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-[11px] w-[11px] shrink-0 rounded-[3.5px]" style={{ background: 'var(--ui-viz-4)' }} />
        Spending
      </span>
      {/* Only while the hatched column is actually on screen. Paged past it,
          this entry keys a mark the plot no longer carries. Paging is a
          discrete, snapped step, so the entry appears and disappears once per
          page rather than flickering, and it is the last item on the line, so
          nothing else moves when it goes. */}
      {partialInWindow && (
        <span className="inline-flex items-center gap-1.5">
          {/* Matches the <pattern> on the bar: stripes running the same way,
              3.5px wide on a 7px pitch, struck in the same panel colour. CSS
              measures its stops ALONG the gradient line, which is normal to the
              stripes, so 135deg here draws the "/" that rotate(45) draws there
              — 45deg would mirror it and the key would contradict the mark. */}
          <span
            className="h-[11px] w-[11px] shrink-0 rounded-[3.5px]"
            style={{
              background: 'rgb(var(--ui-content-faint))',
              backgroundImage:
                'repeating-linear-gradient(135deg, rgb(var(--ui-panel) / 0.62) 0 3.5px, transparent 3.5px 7px)',
            }}
          />
          {granularity === 'year' ? 'Year to date' : 'Month to date'}
        </span>
      )}
    </div>
  );

  // Nothing is drawn until the wrapper has been measured. The layout effect
  // above measures and re-renders before the browser paints, so this frame is
  // never seen — but committing it means the carousel layer mounts with its
  // real offset instead of a guessed one, and a CSS transition has no wrong
  // starting value to ease away from.
  if (containerW === null) {
    return (
      <div>
        <div ref={wrapRef} className="relative select-none" style={{ height: CHART_H }} />
        {legend}
      </div>
    );
  }

  return (
    <div>
      <div ref={wrapRef} className="relative select-none">
        <svg
          viewBox={`0 0 ${chartW} ${CHART_H}`}
          role="group"
          aria-label="Income and expenses by period"
          className="block w-full"
          style={{ pointerEvents: 'none' }}
        >
          {partialIdx >= 0 && (
            <defs>
              {/* Diagonal hatch for the in-progress period. Struck in the PANEL
                  colour, so it lightens the bar in light mode and darkens it in
                  dark, and the bar keeps the hue that says income or spending. */}
              <pattern id={hatchId} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={7} stroke="rgb(var(--ui-panel))" strokeOpacity={0.62} strokeWidth={3.5} />
              </pattern>
            </defs>
          )}

          {windowed && (
            <clipPath id={clipId}>
              {/* Plot width, full height — x labels ride along and clip hard too. */}
              <rect x={chartLeft} y={0} width={innerW} height={CHART_H} />
            </clipPath>
          )}

          {/* Column backgrounds — selected slides between columns; hover instant. */}
          <g key={`bg-${layerKey}`} clipPath={clipRef}>
            <g style={layerStyle}>
              {selIdx >= 0 && (
                // NEUTRAL, not the brand green it used to be. Green is this
                // app's "good" everywhere else, and a green wash behind a column
                // of a chart that is half income and half spending was a second
                // meaning for one colour: on the month you overspent, the chart
                // congratulated you for looking at it. A tint of the content
                // colour inverts with the theme on its own and says only "this
                // is the column the figures above describe".
                <rect
                  data-cashflow-selbg=""
                  {...bandRect(selIdx)}
                  fill="rgb(var(--ui-content) / 0.06)"
                  style={{ transition: 'x 200ms cubic-bezier(0.22,1,0.36,1)' }}
                />
              )}
              {activeIdx !== null && activeIdx !== selIdx && (
                // A press sits alongside the selection band and has to be told
                // apart from it: at a hair's difference in tint the two were ~3/255
                // apart, and the chart could no longer say which column the
                // figures above belong to. So a press takes the heavier tint AND
                // the brand ring — the same outline keyboard focus draws, for the
                // same meaning: this is the column you are aiming at. The ring is
                // the one place brand green survives on this chart, because there
                // it means "you are aiming here", not "this is good". 0.06 → 0.13
                // of the content colour is ~17/255 apart in light and ~20/255 in
                // dark, so the two bands never read as the same mark.
                <rect
                  {...bandRect(activeIdx)}
                  fill="rgb(var(--ui-content) / 0.13)"
                  stroke={hoverIdx === null ? 'var(--ui-brand-ring)' : undefined}
                  strokeWidth={hoverIdx === null ? 1 : undefined}
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
                  x1={chartLeft} y1={zeroY} x2={chartW - CHART_M.right} y2={zeroY}
                  stroke="var(--ui-line-strong)" strokeWidth={1}
                />
              ) : (
                <line
                  x1={chartLeft} y1={yAt(t)} x2={chartW - CHART_M.right} y2={yAt(t)}
                  stroke="var(--ui-hairline)" strokeWidth={1} strokeDasharray="2 5"
                />
              )}
              {!hideAmounts && (
                <text
                  x={chartLeft - 12} y={yAt(t)} dy="0.32em" textAnchor="end"
                  fill="rgb(var(--ui-content-faint))"
                  style={yTickStyle}
                >
                  {t < 0 ? '−' : ''}{formatShortMoney(Math.abs(t))}
                </text>
              )}
            </g>
          ))}

          {/* Carousel layer — bars, x labels, keyboard targets at absolute coords. */}
          <g key={`fg-${layerKey}`} clipPath={clipRef}>
            <g data-cashflow-layer="" style={layerStyle}>
              {/* Bars — income up, expenses down. */}
              {periods.map((p, ai) => {
                const isSelected = p.period === selectedPeriod;
                // A hover moves the hero, so the hovered column is the only one
                // that should stand out. A press does NOT (touch has no hover),
                // so the selected column stays bright through it — otherwise
                // nothing on the chart says which period the figures above are.
                const opacity = rampIdx !== null
                  ? (rampIdx === ai || (hoverIdx === null && isSelected) ? 1 : 0.35)
                  : (isSelected ? 1 : 0.82);
                const { up, down } = barRects(p, ai);
                const upBox = { x: up.x, y: up.y, width: up.w, height: up.h, rx: Math.min(3, up.w / 2, up.h / 2) };
                const downBox = { x: down.x, y: down.y, width: down.w, height: down.h, rx: Math.min(3, down.w / 2, down.h / 2) };
                const partial = ai === partialIdx;
                return (
                  <g key={p.period} opacity={opacity} style={{ transition: 'opacity 0.15s' }}>
                    {up.h > 0 && <rect {...upBox} fill="var(--ui-viz-2)" />}
                    {down.h > 0 && <rect {...downBox} fill="var(--ui-viz-4)" />}
                    {/* Hatch OVER the fill, not instead of it: the column still
                        has to say income or spending, it just also has to say
                        it is not finished. The legend names the texture. */}
                    {partial && up.h > 0 && <rect {...upBox} fill={`url(#${hatchId})`} />}
                    {partial && down.h > 0 && <rect {...downBox} fill={`url(#${hatchId})`} />}
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

            </g>
          </g>

          {/* Invisible per-column targets for keyboard access — only the
               in-window columns are tabbable. They ride the same translate but
               sit OUTSIDE the keyed layers and never animate: these hold DOM
               focus, and rebuilding them on a resize would eject the keyboard
               user to the top of the tab order and — since a removed element
               fires no blur — leave the preview latched with one column lit and
               the hero describing it. They ease with the plot so a focus ring
               never runs ahead of the bar it marks. */}
          <g clipPath={clipRef} className={hoverIdx !== null && !hoverIsKeyboard ? 'ui-focus-off' : undefined}>
            <g style={kbLayerStyle}>
              {periods.map((p, ai) => {
                const inWindow = ai >= start && ai < start + visN;
                return (
                  <rect
                    key={`kb-${p.period}`}
                    {...bandRect(ai)}
                    fill="transparent"
                    className="ui-focus-svg"
                    role="button"
                    aria-current={p.period === selectedPeriod ? 'true' : undefined}
                    tabIndex={inWindow ? 0 : -1}
                    aria-hidden={inWindow ? undefined : true}
                    aria-label={
                      hideAmounts
                        ? readoutLabel(p.period, granularity, ai === partialIdx)
                        : `${readoutLabel(p.period, granularity, ai === partialIdx)}: income ${formatShortMoney(p.income)}, spent ${formatShortMoney(p.expenses)}`
                    }
                    onFocus={() => setHoverIdx(ai, true)}
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

        {/* Hover pill — period label plus the income/spent/net readout.
             Masked, the readout would read "Income $•••••, spent $•••••, net
             $•••••" and the pill would be left stating only the period, which
             the header above it ("SPENT IN JULY 2026") already says. With
             nothing left to tell the reader, the whole pill goes rather than
             half of it. */}
        {hovered && hoverInWindow && !hoverIsKeyboard && !hideAmounts && (
          <div
            data-chart-hover="pill"
            className="ui-tnum pointer-events-none absolute z-10 flex -translate-x-1/2 flex-col gap-0.5 whitespace-nowrap rounded-ui-sm bg-[rgb(var(--ui-panel-raised))] px-2.5 py-1.5 shadow-ui-lg"
            style={{ border: '1px solid var(--ui-line)', left: `${(pillCx / chartW) * 100}%`, top: 2 }}
          >
            <span className="text-[12px] font-bold leading-tight tracking-[-0.01em] text-content">
              {readoutLabel(hovered.period, granularity, hoverIdx === partialIdx)}
            </span>
            <span className="text-[10.5px] leading-tight text-content-muted">
              Income {formatShortMoney(hovered.income)}, spent {formatShortMoney(hovered.expenses)}, net {hovered.net < 0 ? '−' : '+'}{formatShortMoney(Math.abs(hovered.net))}
            </span>
          </div>
        )}

        {/* Pointer overlay — maps x to a column; click selects it; a horizontal
             drag pans the carousel layer 1:1 and snaps on release. pan-y lets
             the browser keep handling vertical page scrolls on touch.

             A finger is not a cursor: touch has no hover state, so touch pointers
             never set hoverIdx. Otherwise pressing a bar previews its value while
             the finger is still down, and WebKit's pointerleave (1ms after
             pointerup, ~5ms BEFORE click) snaps it back — the readout lands on
             the new value, reverts, then animates to it again. A mouse or pen on
             the same device still hovers normally. */}
        <div
          ref={overlayRef}
          className="absolute inset-0"
          style={{ touchAction: 'pan-y', cursor: 'pointer' }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: e.clientX, startPx: start * colW, panning: false };
            pannedRef.current = false;
            if (e.pointerType === 'touch') {
              touchRef.current = { idx: absIdx(pointerToIdx(e.clientX)) };
              setPressIdx(touchRef.current.idx);
              pressTimer.current = setTimeout(() => setPressHeld(true), PRESS_RAMP_MS);
            } else {
              touchRef.current = null;
              setHoverIdx(absIdx(pointerToIdx(e.clientX)));
            }
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (drag && e.buttons > 0) {
              if (windowed && !drag.panning && Math.abs(e.clientX - drag.startX) > PAN_THRESHOLD) {
                drag.panning = true;
                drag.baseX = e.clientX; // rebase so the pan starts from rest — no threshold jump
                pannedRef.current = true;
                if (touchRef.current) touchRef.current = { idx: null };
                setHoverIdx(null);
                clearPress();
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
            if (e.pointerType === 'touch') {
              // Follow the finger, and let the band double as the promise the tap
              // keeps — columns are 44px at 390px and a finger rolls across a
              // boundary easily. Still never hoverIdx: that is the one that
              // bubbles up to the hero.
              if (drag && !drag.panning && touchRef.current) {
                if (Math.abs(e.clientY - drag.startY) > PRESS_SCROLL_SLOP) {
                  // Vertical travel means the page is scrolling, not tapping.
                  // Disqualify the gesture for good: drifting back inside the
                  // slop must not re-light a band or commit a period.
                  touchRef.current = { idx: null };
                  clearPress();
                } else if (touchRef.current.idx !== null) {
                  touchRef.current = { idx: absIdx(pointerToIdx(e.clientX)) };
                  setPressIdx(touchRef.current.idx);
                }
              }
              return;
            }
            setHoverIdx(absIdx(pointerToIdx(e.clientX)));
          }}
          onPointerUp={() => { settleDrag(); clearPress(); }}
          onPointerLeave={() => { releaseHover(); clearPress(); }}
          onPointerCancel={() => { settleDrag(); releaseHover(); clearPress(); }}
          onClick={(e) => {
            if (pannedRef.current) { pannedRef.current = false; return; }
            const touch = touchRef.current;
            touchRef.current = null;
            // Commit what the band promised on touch; fall back to the click's own
            // x for a mouse or pen, whose click lands where the cursor is.
            const ai = touch ? touch.idx : absIdx(pointerToIdx(e.clientX));
            const p = ai !== null ? periods[ai] : undefined;
            if (p) onSelect(p.period);
          }}
        />

      </div>
      {legend}
    </div>
  );
}
