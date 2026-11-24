import type React from 'react';
import { useActiveTheme } from '../uikit/design';
import { Mascot } from '../design/Mascot';

/**
 * BrandMark — the real LasagnaFi icon: three amber wavy "layers" lines. No tile
 * or panel behind it; just the glyph, sized to sit next to the wordmark. The
 * three strokes draw themselves in, staggered (the original landing-page
 * animation; see `.brand-wave-path` in theme.css), disabled under
 * prefers-reduced-motion. Same export signature/props
 * as before so existing usages (sidebar, mobile header, login) keep working.
 */
export function BrandMark({ size = 38, animate = true }: { size?: number; animate?: boolean }) {
  // A design whose brand art is its character (Noodle) shows the character here, as the native app does.
  // It is the app's icon tile, as the native BrandMark draws it: the character on the brand fill, a 26% radius.
  const theme = useActiveTheme();
  if (theme?.skin.brandArt === 'mascot' && theme.mascot) {
    return (
      <span
        aria-hidden="true"
        className="inline-grid shrink-0 place-items-center overflow-hidden text-content"
        style={{ width: size, height: size, borderRadius: size * 0.26, background: 'rgb(var(--ui-brand))' }}
      >
        <span className="block" style={{ width: size * 0.84 }}>
          <Mascot theme={theme} className="block h-auto w-full" />
        </span>
      </span>
    );
  }
  // The draw-in is wrong when the mark is taking over from something that
  // already shows it finished — the native splash, for instance. There it reads
  // as the logo erasing and redrawing itself.
  const pathClass = animate ? 'brand-wave-path' : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 1 28 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <g
        transform="translate(0 2)"
        stroke="#F59E0B"
        strokeWidth={2.7}
        strokeLinecap="round"
      >
        <path className={pathClass} d="M2 7 C5 3.5 8 3.5 11 7 S17 10.5 20 7 S23 3.5 26 7" />
        <path className={pathClass} d="M2 12 C5 8.5 8 8.5 11 12 S17 15.5 20 12 S23 8.5 26 12" />
        <path className={pathClass} d="M2 17 C5 13.5 8 13.5 11 17 S17 20.5 20 17 S23 13.5 26 17" />
      </g>
    </svg>
  );
}

/**
 * The name beside the mark. Under a character design it is the app's
 * wordmark (native BrandWordmark): "Lasagna" in the theme's display face at its
 * heaviest, "Fi" in the brand ink. Elsewhere the call site's own wordmark,
 * `children`, unchanged.
 */
export function BrandWordmark({ size, children, className }: { size: number; children: React.ReactNode; className?: string }) {
  const theme = useActiveTheme();
  if (theme?.skin.brandArt !== 'mascot' || !theme.mascot) return <>{children}</>;
  return (
    <span
      className={className}
      style={{ fontFamily: 'var(--ui-display)', fontWeight: 800, fontSize: size, lineHeight: 1, letterSpacing: 0, color: 'rgb(var(--ui-content))' }}
    >
      Lasagna<span style={{ color: 'rgb(var(--ui-brand-ink))' }}>Fi</span>
    </span>
  );
}
