import { ReactNode, useState } from 'react';

export interface CompositionSegment {
  /** Display label, e.g. "Cash" */
  label: string;
  /** Dollar amount (absolute, sign handled by `negative`) */
  value: number;
  /** Render as a subtractive segment (debt). Renders to the right of the bar in sauce-deep. */
  negative?: boolean;
  /** Optional color override. If omitted (or if it collides with another
   *  segment), the component assigns one from its built-in distinct palette
   *  so adjacent bars never look identical. */
  color?: string;
}

interface CompositionRibbonProps {
  /** Optional eyebrow above the bar, e.g. "By account". */
  leadLabel?: ReactNode;
  /** Optional headline value. Omit when an editorial lede above the
   *  ribbon already states the total — otherwise it renders twice. */
  leadValue?: ReactNode;
  /** Optional headline meta, e.g. "23 accounts" or "9.4% blended return". */
  leadDelta?: ReactNode;
  /** Segments composing the bar */
  segments: CompositionSegment[];
  /** Positive segments below this proportion of the total are bucketed
   *  into a single "Other" block (in both the bar and the legend, so
   *  the two stay in sync). The bucketed items are then listed as
   *  fine print under the Other legend entry. Defaults to 0 — every
   *  segment is enumerated. Set to e.g. 3 only when the page genuinely
   *  has so many sub-1% items that the bar becomes hash-marks. */
  groupBelowPct?: number;
}

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Curated set of visually distinct brand tokens. Order is chosen so the
 *  most common 3–5 segment cases (which is most pages) get maximally
 *  different hues: red → gold → green → brown → grey → ink → cream.
 *  Burgundy and noodle are at the end because they're close to sauce and
 *  cheese respectively — only used when 7+ segments are present. */
const DISTINCT_PALETTE = [
  'var(--lf-sauce)',     // warm red
  'var(--lf-cheese)',    // gold
  'var(--lf-basil)',     // olive green
  'var(--lf-crust)',     // saddle brown
  'var(--lf-muted)',     // warm grey
  'var(--lf-ink-soft)',  // dark ink
  'var(--lf-noodle)',    // cream gold
  'var(--lf-burgundy)',  // deep red
];
/** Debt segments always render in sauce-deep regardless of palette order
 *  so debt stays semantically red across every page. */
const DEBT_COLOR = 'var(--lf-sauce-deep)';

/** Always assign colors from the distinct palette in order. Caller-provided
 *  `color` props are intentionally ignored — page-level color logic used to
 *  produce visually similar tokens (sauce vs burgundy both read as "red"),
 *  so the component owns the palette to keep adjacent segments distinct.
 *  Exception: when the bar mixes positives and debts, debts share a single
 *  red so "this is debt" reads semantically; on a debt-only bar (e.g.
 *  /debt) every account gets its own palette color since there's no
 *  asset/liability contrast to encode. */
function assignDistinctColors(segments: CompositionSegment[]): CompositionSegment[] {
  const hasPositive = segments.some((s) => !s.negative);
  const hasDebt = segments.some((s) => s.negative);
  const mixedSign = hasPositive && hasDebt;

  // When the bar mixes signs, reserve sauce (red) for debt so the red on
  // the bar reads as "this is debt" and isn't confused with an asset class.
  // Positives start one slot in (gold first).
  let paletteIdx = mixedSign ? 1 : 0;
  return segments.map((seg) => {
    if (mixedSign && seg.negative) {
      return { ...seg, color: DEBT_COLOR };
    }
    const color = DISTINCT_PALETTE[paletteIdx % DISTINCT_PALETTE.length];
    paletteIdx++;
    return { ...seg, color };
  });
}

/**
 * Horizontal proportional bar showing financial composition.
 * - Above the bar: optional eyebrow / value / delta.
 * - Bar with hover tooltip (label · value · %).
 * - Below: legend with proportion + dollars per segment.
 *
 * Colors are assigned by the component from a distinct palette so adjacent
 * bars never share a hue. Callers can pass `color` to opt into a specific
 * brand token; if two segments would collide, the second gets reassigned.
 */
export function CompositionRibbon({
  leadLabel,
  leadValue,
  leadDelta,
  segments,
  groupBelowPct = 0,
}: CompositionRibbonProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const total = segments.reduce((s, seg) => s + Math.abs(seg.value), 0);
  const threshold = groupBelowPct > 0 ? (groupBelowPct / 100) * total : 0;

  // Bar segments: bucket positive segments below threshold into a single
  // "Other". Debt segments are always kept distinct so they sit on the right
  // edge regardless of size. The bucketed items are tracked so we can list
  // them under the legend's Other row.
  const small = segments.filter((s) => !s.negative && Math.abs(s.value) < threshold);
  const big = segments.filter((s) => s.negative || Math.abs(s.value) >= threshold);

  const otherSeg: CompositionSegment | null = small.length > 0
    ? {
        label: 'Other',
        value: small.reduce((s, seg) => s + Math.abs(seg.value), 0),
      }
    : null;

  // Positives first, then "Other", then debts (debts always on the right).
  const positives = big.filter((s) => !s.negative);
  const debts = big.filter((s) => s.negative);
  const orderedSegments: CompositionSegment[] = otherSeg
    ? [...positives, otherSeg, ...debts]
    : big;

  const renderedSegments = assignDistinctColors(orderedSegments);

  const hasLead = leadLabel || leadValue || leadDelta;
  const hovered = hoverIdx !== null ? renderedSegments[hoverIdx] : null;
  const hoveredPct = hovered && total > 0 ? (Math.abs(hovered.value) / total) * 100 : 0;
  // Tooltip x-position: center over the hovered segment, clamped so it
  // doesn't run off either edge of the bar.
  let hoveredCenterPct = 0;
  if (hoverIdx !== null) {
    let left = 0;
    for (let i = 0; i < hoverIdx; i++) {
      left += total > 0 ? (Math.abs(renderedSegments[i].value) / total) * 100 : 0;
    }
    hoveredCenterPct = left + hoveredPct / 2;
  }
  const tipLeftPct = Math.min(94, Math.max(6, hoveredCenterPct));

  return (
    <div className="ds-ribbon">
      {hasLead && (
        <div className="ds-ribbon__head">
          <div className="ds-ribbon__lead">
            {leadLabel && <span className="ds-ribbon__lead-label">{leadLabel}</span>}
            {leadValue && <span className="ds-ribbon__lead-value">{leadValue}</span>}
            {leadDelta && <span className="ds-ribbon__lead-delta">{leadDelta}</span>}
          </div>
        </div>
      )}
      <div
        className="ds-ribbon__bar"
        role="img"
        aria-label={`Composition: ${segments.map(s => `${s.label} ${fmtUsd(s.value)}`).join(', ')}`}
        onPointerLeave={() => setHoverIdx(null)}
      >
        {renderedSegments.map((seg, i) => {
          const pct = total > 0 ? (Math.abs(seg.value) / total) * 100 : 0;
          return (
            <div
              key={`${seg.label}-${i}`}
              className={`ds-ribbon__seg${hoverIdx === i ? ' ds-ribbon__seg--active' : ''}`}
              style={{ width: `${pct}%`, background: seg.color }}
              onPointerEnter={() => setHoverIdx(i)}
              onPointerDown={() => setHoverIdx(i)}
            />
          );
        })}
        {hovered && (
          <div
            className="ds-ribbon__tooltip"
            style={{ left: `${tipLeftPct}%` }}
            role="status"
            aria-live="polite"
          >
            <span className="ds-ribbon__tooltip-label">
              {hovered.negative ? 'Debt · ' : ''}{hovered.label}
            </span>
            <span className="ds-ribbon__tooltip-value">
              {hovered.negative ? '−' : ''}{fmtUsd(Math.abs(hovered.value))}
            </span>
            <span className="ds-ribbon__tooltip-pct">{hoveredPct.toFixed(1)}% of total</span>
          </div>
        )}
      </div>
      <div className="ds-ribbon__legend">
        {renderedSegments.map((seg, i) => {
          const pct = total > 0 ? (Math.abs(seg.value) / total) * 100 : 0;
          const isOther = seg.label === 'Other' && otherSeg !== null && i === positives.length;
          return (
            <span className="ds-ribbon__legend-item" key={`${seg.label}-${i}`}>
              <span className="ds-ribbon__swatch" style={{ background: seg.color }} aria-hidden="true" />
              <span className="ds-ribbon__legend-label">{seg.label}</span>
              <span className="ds-ribbon__legend-value">
                {seg.negative ? '−' : ''}{fmtUsd(Math.abs(seg.value))}
              </span>
              <span style={{ color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {pct.toFixed(0)}%
              </span>
              {isOther && small.length > 0 && (
                <span className="ds-ribbon__legend-sub">
                  {small.map((s, j) => (
                    <span key={`${s.label}-${j}`}>
                      {s.label} {fmtUsd(Math.abs(s.value))}
                      {j < small.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
