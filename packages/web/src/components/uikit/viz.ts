/**
 * Data-viz categorical palette for the new system. These resolve to the
 * `--ui-viz-*` CSS variables, so they automatically swap between the light and
 * dark sets. Pass `getVizColors()` to a chart library (Recharts/Vega) at render
 * time, or read a single category by key.
 *
 * Order is meaningful for the finance domain:
 *   cash · investments · property · debt · other (+2 spare)
 * The hues are warm-harmonious, distinguishable in both modes, and chosen to
 * stay separable for common color-vision deficiencies (green/amber/blue/rust/
 * mauve span hue, lightness AND warmth, not just hue).
 */
export const VIZ_KEYS = [
  'cash',
  'investments',
  'property',
  'debt',
  'other',
  'extra1',
  'extra2',
] as const;

export type VizKey = (typeof VIZ_KEYS)[number];

const VAR_BY_INDEX = [
  '--ui-viz-1',
  '--ui-viz-2',
  '--ui-viz-3',
  '--ui-viz-4',
  '--ui-viz-5',
  '--ui-viz-6',
  '--ui-viz-7',
] as const;

/** Resolve the computed hex for a viz slot (1-based) from the live theme. */
export function vizColor(index: number): string {
  const cssVar = VAR_BY_INDEX[(index - 1) % VAR_BY_INDEX.length];
  if (typeof window === 'undefined') return '#000';
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
}

/** A CSS var() reference, for use in inline styles that follow theme changes. */
export function vizVar(index: number): string {
  return `var(${VAR_BY_INDEX[(index - 1) % VAR_BY_INDEX.length]})`;
}

export const VIZ_CATEGORY_LABELS: Record<VizKey, string> = {
  cash: 'Cash',
  investments: 'Investments',
  property: 'Property',
  debt: 'Debt',
  other: 'Other',
  extra1: 'Extra 1',
  extra2: 'Extra 2',
};
