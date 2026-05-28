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
  /** Segments below this proportion of the total are grouped into a single
   *  "Other" bucket in the bar (still itemized in the legend) so the bar
   *  doesn't render tappable-impossible 2px slivers. Defaults to 3%. */
  groupBelowPct?: number;
}

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * A single horizontal proportional bar showing financial composition.
 * Above the bar: lead value (+ optional eyebrow). Below: legend with
 * proportion + dollars per segment.
 */
export function CompositionRibbon({
  leadLabel,
  leadValue,
  leadDelta,
  segments,
  groupBelowPct = 3,
}: CompositionRibbonProps) {
  const total = segments.reduce((s, seg) => s + Math.abs(seg.value), 0);
  const threshold = (groupBelowPct / 100) * total;

  // Bar segments: combine sub-threshold positive segments into a single
  // "Other" bar block (still listed individually in the legend). Negative
  // segments (debt) are always rendered as their own block regardless of size.
  const barSegments = (() => {
    const big = segments.filter((s) => s.negative || Math.abs(s.value) >= threshold);
    const small = segments.filter((s) => !s.negative && Math.abs(s.value) < threshold);
    if (small.length === 0) return big;
    const otherValue = small.reduce((s, seg) => s + Math.abs(seg.value), 0);
    // Insert "Other" before debts (debts always last so they sit on the right edge).
    const otherSeg: CompositionSegment = {
      label: 'Other',
      value: otherValue,
      color: 'var(--lf-muted)',
    };
    const debts = big.filter((s) => s.negative);
    const positives = big.filter((s) => !s.negative);
    return [...positives, otherSeg, ...debts];
  })();

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
        {barSegments.map((seg, i) => {
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
        {segments.map((seg, i) => {
          const pct = total > 0 ? (Math.abs(seg.value) / total) * 100 : 0;
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
            </span>
          );
        })}
      </div>
    </div>
  );
}
