/**
 * BrandMark — the real LasagnaFi icon: three amber wavy "layers" lines. No tile
 * or panel behind it; just the glyph, sized to sit next to the wordmark. The
 * three strokes draw themselves in, staggered (the original landing-page
 * animation; see `.brand-wave-path` in theme.css), disabled under
 * prefers-reduced-motion. Same export signature/props
 * as before so existing usages (sidebar, mobile header, login) keep working.
 */
export function BrandMark({ size = 38 }: { size?: number }) {
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
        <path className="brand-wave-path" d="M2 7 C5 3.5 8 3.5 11 7 S17 10.5 20 7 S23 3.5 26 7" />
        <path className="brand-wave-path" d="M2 12 C5 8.5 8 8.5 11 12 S17 15.5 20 12 S23 8.5 26 12" />
        <path className="brand-wave-path" d="M2 17 C5 13.5 8 13.5 11 17 S17 20.5 20 17 S23 13.5 26 17" />
      </g>
    </svg>
  );
}
