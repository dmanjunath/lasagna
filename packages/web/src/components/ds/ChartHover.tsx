import { useState, useRef, useCallback, ReactNode } from 'react';

/**
 * ChartHover — shared overlay primitive for chart hover affordance.
 *
 * Provides:
 *   • Vertical dashed crosshair that snaps to the nearest x-domain point
 *   • Optional basil dot on the curve at that x
 *   • A "value pill" positioned above the chart, NOT overlapping the line:
 *       bg: var(--lf-ink), color: var(--lf-paper), padded 6/10, rounded 6
 *
 * Touch-friendly: uses Pointer Events with capture + `touch-action: none`.
 *
 * Usage:
 *   <div style={{ position: 'relative' }}>
 *     <svg>...</svg>
 *     <ChartHover
 *       width={chartW}
 *       paddingLeft={PL}
 *       paddingRight={PR}
 *       count={points.length}
 *       getLabel={(i) => points[i].dateLabel}
 *       getValue={(i) => points[i].valueLabel}
 *     />
 *   </div>
 *
 * The overlay is absolute-positioned over the chart and captures pointer events.
 * It draws its own crosshair line inside the overlay so callers don't need to
 * pipe their hover index back into their SVG.
 */
export interface ChartHoverProps {
  /** Total chart width in CSS pixels. */
  width: number;
  /** Total chart height in CSS pixels. */
  height: number;
  /** Horizontal padding from left edge to first x-domain point. */
  paddingLeft: number;
  /** Horizontal padding from right edge to last x-domain point. */
  paddingRight: number;
  /** Number of x-domain points. */
  count: number;
  /** Returns the primary label to show in the pill (e.g. "$42,310"). */
  getValue: (i: number) => ReactNode;
  /** Returns the secondary label to show in the pill (e.g. "Mar 2026"). */
  getLabel: (i: number) => ReactNode;
  /** Optional third line (e.g. "p5: $X · p95: $Y"). */
  getSubline?: (i: number) => ReactNode;
  /**
   * Curve point at index i in chart-CSS-pixel coordinates. When provided,
   * a 4px basil dot is rendered at that location.
   */
  getCurvePoint?: (i: number) => { x: number; y: number } | null;
  /** Optional className for the overlay root. */
  className?: string;
  /** Callback fired when the hover index changes (or null on leave). */
  onHoverChange?: (i: number | null) => void;
  /** Hide the floating value/label pill but keep the crosshair + dot.
   *  Useful when the page already displays the hovered value elsewhere
   *  (e.g. a top-left lead that swaps to the hovered value). */
  hidePill?: boolean;
}

export function ChartHover({
  width,
  height,
  paddingLeft,
  paddingRight,
  count,
  getValue,
  getLabel,
  getSubline,
  getCurvePoint,
  className,
  hidePill = false,
  onHoverChange,
}: ChartHoverProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const setIdx = useCallback(
    (i: number | null) => {
      setHoverIdx(i);
      onHoverChange?.(i);
    },
    [onHoverChange],
  );

  const innerW = Math.max(1, width - paddingLeft - paddingRight);

  const pointerToIdx = useCallback(
    (clientX: number): number | null => {
      const root = rootRef.current;
      if (!root || count <= 0) return null;
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0) return null;
      // Map screen pixels to chart-CSS pixels (the SVG behind scales to root).
      const scale = width / rect.width;
      const localX = (clientX - rect.left) * scale;
      const ratio = (localX - paddingLeft) / innerW;
      return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
    },
    [width, paddingLeft, innerW, count],
  );

  const xAt = (i: number) =>
    count <= 1 ? paddingLeft + innerW / 2 : paddingLeft + (i / (count - 1)) * innerW;

  const hx = hoverIdx !== null ? xAt(hoverIdx) : null;
  const curve = hoverIdx !== null && getCurvePoint ? getCurvePoint(hoverIdx) : null;

  // Pill position in chart-CSS-pixel units. Clamp so it doesn't overflow.
  const PILL_W = 132;
  const PILL_H = 44;
  // Position pill above the dot if possible, else just below the top edge.
  const pillCx = hx ?? 0;
  const pillLeftPx = Math.max(4, Math.min(width - PILL_W - 4, pillCx - PILL_W / 2));
  const pillTopPx = 4;

  // Convert chart-CSS pixels back to CSS % of overlay (overlay matches SVG box).
  const pct = (px: number, denom: number) => `${(px / denom) * 100}%`;

  return (
    <div
      ref={rootRef}
      data-chart-hover="root"
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        touchAction: 'none',
        cursor: 'crosshair',
        userSelect: 'none',
      }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setIdx(pointerToIdx(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'touch' && e.buttons === 0) return;
        setIdx(pointerToIdx(e.clientX));
      }}
      onPointerLeave={() => setIdx(null)}
      onPointerUp={() => { /* keep last hover on tap; release via leave */ }}
      onPointerCancel={() => setIdx(null)}
    >
      {/* Crosshair + dot drawn as DOM, not SVG, so it composes with any chart. */}
      {hx !== null && (
        <>
          <div
            data-chart-hover="rule"
            style={{
              position: 'absolute',
              left: pct(hx, width),
              top: 0,
              bottom: 0,
              width: 1,
              borderLeft: '1px dashed var(--lf-ink-soft)',
              opacity: 0.45,
              transform: 'translateX(-0.5px)',
              pointerEvents: 'none',
            }}
          />
          {curve && (
            <div
              data-chart-hover="dot"
              style={{
                position: 'absolute',
                left: pct(curve.x, width),
                top: pct(curve.y, height),
                width: 8,
                height: 8,
                marginLeft: -4,
                marginTop: -4,
                borderRadius: '50%',
                background: 'var(--lf-data-2)',
                boxShadow: '0 0 0 2px var(--lf-paper)',
                pointerEvents: 'none',
              }}
            />
          )}
          {!hidePill && (
          <div
            data-chart-hover="pill"
            style={{
              position: 'absolute',
              left: pct(pillLeftPx, width),
              top: pct(pillTopPx, height),
              width: PILL_W,
              minHeight: PILL_H,
              padding: '6px 10px',
              background: 'var(--lf-ink)',
              color: 'var(--lf-paper)',
              borderRadius: 6,
              boxShadow: '0 2px 10px rgba(31,26,22,0.18)',
              fontFamily: 'Geist, system-ui, sans-serif',
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
              }}
            >
              {getValue(hoverIdx!)}
            </span>
            <span style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.3 }}>
              {getLabel(hoverIdx!)}
            </span>
            {getSubline && (
              <span style={{ fontSize: 10, opacity: 0.55, lineHeight: 1.3 }}>
                {getSubline(hoverIdx!)}
              </span>
            )}
          </div>
          )}
        </>
      )}
    </div>
  );
}
