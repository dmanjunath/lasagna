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
  /** Headline label, e.g. "Net worth" */
  leadLabel: ReactNode;
  /** Headline value, e.g. "$156,840" */
  leadValue: ReactNode;
  /** Optional headline meta, e.g. "↑ $4,200 this month" */
  leadDelta?: ReactNode;
  /** Segments composing the bar */
  segments: CompositionSegment[];
}

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * A single horizontal proportional bar showing the user's financial
 * composition (cash + investments fill from the left; debt overhangs
 * as a final segment in sauce). Above the bar: net-worth lead.
 * Below: legend with proportion + dollars per segment.
 *
 * Replaces the "4 KPI cards in a dark hero" pattern.
 */
export function CompositionRibbon({ leadLabel, leadValue, leadDelta, segments }: CompositionRibbonProps) {
  // Bar widths: positive segments share 100%; debt is rendered as part of the bar
  // (proportional to its size relative to total positive). The user sees that
  // their composition is "mostly invested, some cash, a little debt".
  const total = segments.reduce((s, seg) => s + Math.abs(seg.value), 0);
  return (
    <div className="ds-ribbon">
      <div className="ds-ribbon__head">
        <div className="ds-ribbon__lead">
          <span className="ds-ribbon__lead-label">{leadLabel}</span>
          <span className="ds-ribbon__lead-value">{leadValue}</span>
          {leadDelta && <span className="ds-ribbon__lead-delta">{leadDelta}</span>}
        </div>
      </div>
      <div className="ds-ribbon__bar" role="img" aria-label={`Composition: ${segments.map(s => `${s.label} ${fmtUsd(s.value)}`).join(', ')}`}>
        {segments.map((seg) => {
          const pct = total > 0 ? (Math.abs(seg.value) / total) * 100 : 0;
          return (
            <div
              key={seg.label}
              className="ds-ribbon__seg"
              style={{ width: `${pct}%`, background: seg.color }}
              title={`${seg.label}: ${fmtUsd(seg.value)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="ds-ribbon__legend">
        {segments.map((seg) => {
          const pct = total > 0 ? (Math.abs(seg.value) / total) * 100 : 0;
          return (
            <span className="ds-ribbon__legend-item" key={seg.label}>
              <span className="ds-ribbon__swatch" style={{ background: seg.color }} />
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
