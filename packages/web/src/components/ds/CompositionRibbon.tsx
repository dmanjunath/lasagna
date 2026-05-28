import { ReactNode } from 'react';

export interface CompositionSegment {
  /** Display label, e.g. "Cash" */
  label: string;
  /** Dollar amount (absolute, sign handled by `negative`) */
  value: number;
  /** Render as a subtractive segment (debt). Renders to the right of the bar in sauce. */
  negative?: boolean;
  /** Color of the segment in the bar */
  color: string;
}

interface CompositionRibbonProps {
  /** Optional eyebrow. If omitted the lead value stands alone (often the
   *  giant number is self-explanatory and a label adds noise). */
  leadLabel?: ReactNode;
  /** Headline value, e.g. "$156,840" */
  leadValue: ReactNode;
  /** Optional headline meta, e.g. "↑ $4,200 this month" */
  leadDelta?: ReactNode;
  /** Segments composing the bar */
  segments: CompositionSegment[];
  /** Positive segments below this proportion of the total are bucketed
   *  into a single "Other" block (in both the bar and the legend, so
   *  the two stay in sync). The bucketed items are then listed as
   *  fine print under the Other legend entry. Set to 0 to disable
   *  auto-bucketing (callers that pre-bucket should do this). */
  groupBelowPct?: number;
}

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Horizontal proportional bar showing financial composition.
 * - Above the bar: lead value (+ optional eyebrow).
 * - Below: legend with proportion + dollars per segment.
 *
 * The legend always reflects what's rendered in the bar. When small
 * segments get bucketed into "Other", they're listed as sub-items
 * beneath the Other legend row so the user can still see them.
 */
export function CompositionRibbon({
  leadLabel,
  leadValue,
  leadDelta,
  segments,
  groupBelowPct = 3,
}: CompositionRibbonProps) {
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
        color: 'var(--lf-muted)',
      }
    : null;

  // Positives first, then "Other", then debts (debts always on the right).
  const positives = big.filter((s) => !s.negative);
  const debts = big.filter((s) => s.negative);
  const renderedSegments: CompositionSegment[] = otherSeg
    ? [...positives, otherSeg, ...debts]
    : big;

  return (
    <div className="ds-ribbon">
      <div className="ds-ribbon__head">
        <div className="ds-ribbon__lead">
          {leadLabel && <span className="ds-ribbon__lead-label">{leadLabel}</span>}
          <span className="ds-ribbon__lead-value">{leadValue}</span>
          {leadDelta && <span className="ds-ribbon__lead-delta">{leadDelta}</span>}
        </div>
      </div>
      <div className="ds-ribbon__bar" role="img" aria-label={`Composition: ${segments.map(s => `${s.label} ${fmtUsd(s.value)}`).join(', ')}`}>
        {renderedSegments.map((seg, i) => {
          const pct = total > 0 ? (Math.abs(seg.value) / total) * 100 : 0;
          return (
            <div
              key={`${seg.label}-${i}`}
              className="ds-ribbon__seg"
              style={{ width: `${pct}%`, background: seg.color }}
              title={`${seg.label}: ${fmtUsd(seg.value)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="ds-ribbon__legend">
        {renderedSegments.map((seg, i) => {
          const pct = total > 0 ? (Math.abs(seg.value) / total) * 100 : 0;
          const isOther = seg === otherSeg;
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
