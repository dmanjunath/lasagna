/**
 * Skeleton primitives — iter 7 D.
 *
 * Monarch-tier first paint: instead of a blank 300-400ms gap before content
 * lands, render a cached shell with the same outline as the loaded surface.
 * The shimmer is CSS-only (background-position keyframe) so it costs nothing
 * to mount.
 *
 * Use the same outline as the loaded content — matched dimensions, matched
 * rhythm. A skeleton that doesn't match the final layout causes a visible
 * jolt when content swaps in and feels worse than no skeleton at all.
 */
import React from 'react';

interface SkeletonLineProps {
  /** CSS width — '40%' / '120px'. */
  width: string;
  /** Pixel height. Defaults to 14 (matches body text). */
  height?: number;
  /** Optional className for layout positioning. */
  className?: string;
  style?: React.CSSProperties;
}

export function SkeletonLine({ width, height = 14, className, style }: SkeletonLineProps) {
  return (
    <span
      aria-hidden="true"
      className={`ds-skeleton ${className ?? ''}`}
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius: 4,
        verticalAlign: 'middle',
        ...style,
      }}
    />
  );
}

interface SkeletonBlockProps {
  /** Pixel height of the block (width fills parent). */
  height: number;
  className?: string;
  style?: React.CSSProperties;
}

export function SkeletonBlock({ height, className, style }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={`ds-skeleton ${className ?? ''}`}
      style={{
        width: '100%',
        height,
        borderRadius: 8,
        ...style,
      }}
    />
  );
}

/**
 * SkeletonRow — matches the .ds-row layout so AccountRow / holdings rows /
 * tx rows reserve the same space they'll consume once data lands.
 */
export function SkeletonRow({ withFavicon = true }: { withFavicon?: boolean }) {
  return (
    <div className="ds-row ds-row--skeleton" aria-hidden="true">
      {withFavicon && (
        <span
          className="ds-skeleton"
          style={{ width: 28, height: 28, borderRadius: 6, flexShrink: 0 }}
        />
      )}
      <div className="ds-row__main">
        <span className="ds-skeleton" style={{ display: 'block', height: 14, width: '60%', borderRadius: 4, marginBottom: 6 }} />
        <span className="ds-skeleton" style={{ display: 'block', height: 11, width: '40%', borderRadius: 4 }} />
      </div>
      <div className="ds-row__right">
        <span className="ds-skeleton" style={{ display: 'block', height: 14, width: 84, borderRadius: 4, marginBottom: 4 }} />
        <span className="ds-skeleton" style={{ display: 'block', height: 11, width: 56, borderRadius: 4 }} />
      </div>
    </div>
  );
}

/**
 * SkeletonChart — chart-shaped placeholder. Same height as the production
 * chart it stands in for, with a stripe of slightly-darker shimmer to hint
 * at axes / fan / area.
 */
export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <div
      aria-hidden="true"
      className="ds-skeleton ds-skeleton--chart"
      style={{
        width: '100%',
        height,
        borderRadius: 10,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* baseline rule that mimics a chart x-axis so the surface isn't a
          flat box; this gives the eye an outline to lock onto while
          waiting. */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 18,
          height: 1,
          background: 'rgba(31,26,22,0.06)',
        }}
      />
    </div>
  );
}
