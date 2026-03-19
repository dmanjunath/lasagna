/**
 * theme.ts — Design token reference for programmatic use
 *
 * CSS custom properties are the source of truth for all colors.
 * This file exports:
 *   cssVars   — variable names, for constructing `var(--color-X)` at runtime
 *   colors    — resolved dark-mode hex values, for use in chart configs,
 *               canvas rendering, or anywhere CSS vars can't reach
 *   fonts     — font family stacks
 *
 * For light mode: check document.documentElement.dataset.theme and switch
 * to the lightColors export if needed in chart/canvas contexts.
 */

// ── CSS variable names ────────────────────────────────────────────────────────
export const cssVars = {
  bg:              '--color-bg',
  bgElevated:      '--color-bg-elevated',
  bgSubtle:        '--color-bg-subtle',
  surface:         '--color-surface',
  surfaceHover:    '--color-surface-hover',
  text:            '--color-text',
  textSecondary:   '--color-text-secondary',
  textMuted:       '--color-text-muted',
  textDisabled:    '--color-text-disabled',
  accent:          '--color-accent',
  accentDim:       '--color-accent-dim',
  accentGlow:      '--color-accent-glow',
  gold:            '--color-gold',
  goldDim:         '--color-gold-dim',
  border:          '--color-border',
  borderLight:     '--color-border-light',
  borderStrong:    '--color-border-strong',
  borderAccent:    '--color-border-accent',
  success:         '--color-success',
  warning:         '--color-warning',
  danger:          '--color-danger',
  cardGlow:        '--card-glow',
  shadowCard:      '--shadow-card',
} as const;

// ── Dark mode resolved values ─────────────────────────────────────────────────
// Used for chart color injection (Recharts, Vega) where CSS vars don't apply.
export const colors = {
  bg: {
    DEFAULT:  '#090910',
    elevated: '#0f0f1c',
    subtle:   '#14142a',
  },
  surface: {
    DEFAULT: '#0f0f1c',
    hover:   '#14142a',
  },
  border: {
    DEFAULT: 'rgba(255, 255, 255, 0.07)',
    light:   'rgba(255, 255, 255, 0.04)',
    strong:  'rgba(255, 255, 255, 0.12)',
    accent:  'rgba(0, 229, 160, 0.25)',
  },
  text: {
    DEFAULT:   '#e8e8f4',
    secondary: '#a8b4c4',
    muted:     '#6868a0',
    disabled:  '#3e3e58',
  },
  accent: {
    DEFAULT: '#00e5a0',
    dim:     '#00916a',
    glow:    'rgba(0, 229, 160, 0.12)',
  },
  gold: {
    DEFAULT: '#fbbf24',
    dim:     'rgba(251, 191, 36, 0.12)',
  },
  success: '#00e5a0',
  warning: '#fbbf24',
  danger:  '#f87171',
} as const;

// ── Light mode resolved values ────────────────────────────────────────────────
// For chart contexts when data-theme="light" is active.
export const lightColors = {
  bg: {
    DEFAULT:  '#f7f7fb',
    elevated: '#ffffff',
    subtle:   '#eeeef6',
  },
  surface: {
    DEFAULT: '#ffffff',
    hover:   '#f0f0f8',
  },
  border: {
    DEFAULT: 'rgba(0, 0, 0, 0.08)',
    light:   'rgba(0, 0, 0, 0.04)',
    strong:  'rgba(0, 0, 0, 0.15)',
    accent:  'rgba(0, 145, 106, 0.30)',
  },
  text: {
    DEFAULT:   '#0d0d1e',
    secondary: '#4a5270',
    muted:     '#6e7191',
    disabled:  '#b0b0cc',
  },
  accent: {
    DEFAULT: '#00916a',
    dim:     '#005d44',
    glow:    'rgba(0, 145, 106, 0.10)',
  },
  gold: {
    DEFAULT: '#fbbf24',
    dim:     'rgba(251, 191, 36, 0.15)',
  },
  success: '#00916a',
  warning: '#ca8a04',
  danger:  '#f87171',
} as const;

// ── Font stacks ───────────────────────────────────────────────────────────────
export const fonts = {
  sans:    ['Space Grotesk', 'system-ui', 'sans-serif'],
  display: ['Space Grotesk', 'system-ui', 'sans-serif'],
  mono:    ['DM Mono', 'ui-monospace', 'monospace'],
} as const;

// ── Type scale reference ──────────────────────────────────────────────────────
// Mirrors tailwind.config.js fontSize. Use these names in className, not px.
// text-2xs  9px  — eyebrow labels, stamps
// text-xs  11px  — compact mono labels, band metadata
// text-sm  13px  — secondary body, small cards
// text-base 15px — primary body copy
// text-md  17px  — lead paragraphs
// text-lg  20px  — section subheadings
// text-xl  24px  — section headings
// text-2xl 28px  — metric values
// text-3xl 36px  — page heroes
// text-4xl 48px  — dashboard hero number
// text-5xl 60px  — statement numbers
export const typeScale = {
  '2xs':  '9px',
  'xs':   '11px',
  'sm':   '13px',
  'base': '15px',
  'md':   '17px',
  'lg':   '20px',
  'xl':   '24px',
  '2xl':  '28px',
  '3xl':  '36px',
  '4xl':  '48px',
  '5xl':  '60px',
} as const;
