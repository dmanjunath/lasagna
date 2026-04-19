/** @type {import('tailwindcss').Config} */

/**
 * Color helper — produces a Tailwind-compatible CSS var reference that
 * supports opacity modifiers (bg-accent/10, text-text/50, etc.).
 * The CSS variable must hold a space-separated RGB triplet: "0 229 160"
 */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    // ─────────────────────────────────────────────────────────────
    // FONT SIZE SCALE
    //
    // Mirrors Tailwind defaults from lg upward (so existing code
    // using text-lg, text-2xl, text-4xl, text-6xl etc. is unchanged).
    // The small sizes (xs, sm, base) are shifted 1px down from Tailwind
    // defaults to match the actual sizes used throughout this codebase:
    //   Tailwind default → our scale
    //   text-xs  12px   → 11px  (matches text-[11px] usage)
    //   text-sm  14px   → 13px  (matches text-[13px] usage)
    //   text-base 16px  → 15px  (matches text-[15px] usage)
    //
    // Semantic intent:
    //   text-2xs   9px — eyebrows, stamps, tiny badge labels
    //   text-xs   11px — compact mono labels, band metadata
    //   text-sm   13px — secondary content, table data, small cards
    //   text-base 15px — primary body copy
    //   text-md   17px — lead paragraphs (gap between base and lg)
    //   text-lg   18px — section subheadings
    //   text-xl   20px — section headings
    //   text-2xl  24px — card heroes, large section titles
    //   text-3xl  30px — page heroes
    //   text-4xl  36px — metric callouts
    //   text-5xl  48px — large hero numbers
    //   text-6xl  60px — full-bleed statement numbers
    //   text-7xl  72px — display (rarely needed)
    // ─────────────────────────────────────────────────────────────
    fontSize: {
      '2xs':  ['9px',   { lineHeight: '1.4',  letterSpacing: '0.08em' }],
      'xs':   ['11px',  { lineHeight: '1.5',  letterSpacing: '0.01em' }],
      'sm':   ['13px',  { lineHeight: '1.5' }],
      'base': ['15px',  { lineHeight: '1.65' }],
      'md':   ['17px',  { lineHeight: '1.55' }],
      'lg':   ['18px',  { lineHeight: '1.4',  letterSpacing: '-0.01em' }],
      'xl':   ['20px',  { lineHeight: '1.35', letterSpacing: '-0.01em' }],
      '2xl':  ['24px',  { lineHeight: '1.3',  letterSpacing: '-0.02em' }],
      '3xl':  ['30px',  { lineHeight: '1.25', letterSpacing: '-0.02em' }],
      '4xl':  ['36px',  { lineHeight: '1.2',  letterSpacing: '-0.03em' }],
      '5xl':  ['48px',  { lineHeight: '1.1',  letterSpacing: '-0.03em' }],
      '6xl':  ['60px',  { lineHeight: '1.05', letterSpacing: '-0.04em' }],
      '7xl':  ['72px',  { lineHeight: '1',    letterSpacing: '-0.04em' }],
      '8xl':  ['96px',  { lineHeight: '1' }],
      '9xl':  ['128px', { lineHeight: '1' }],
    },

    extend: {
      fontFamily: {
        sans:    ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono:    ['DM Mono', 'ui-monospace', 'monospace'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },

      // ─────────────────────────────────────────────────────────
      // COLOR SYSTEM
      // All values reference CSS custom properties defined in
      // index.css :root (dark) and [data-theme="light"] (light).
      // Toggling data-theme on <html> switches every color with
      // zero JS — no class changes, no re-renders.
      //
      // Border and glow tokens use direct var() (not RGB triplets)
      // because they carry their own baked-in opacity.
      // ─────────────────────────────────────────────────────────
      colors: {
        // Page backgrounds
        bg: {
          DEFAULT:  v('--color-bg'),
          elevated: v('--color-bg-elevated'),
          subtle:   v('--color-bg-subtle'),
        },

        // Card / panel surfaces
        surface: {
          DEFAULT: v('--color-surface'),
          hover:   v('--color-surface-hover'),
          solid:   v('--color-bg-subtle'),  // compat alias
        },

        // Borders (full rgba — opacity baked in, no alpha-value pattern)
        border: {
          DEFAULT: 'var(--color-border)',
          light:   'var(--color-border-light)',
          strong:  'var(--color-border-strong)',
          accent:  'var(--color-border-accent)',
        },

        // Text hierarchy
        // text-text           → primary content
        // text-text-secondary → supporting text, labels
        // text-text-muted     → metadata, timestamps  (~4:1 contrast)
        // text-text-disabled  → placeholders, decorative  (intentionally low)
        text: {
          DEFAULT:   v('--color-text'),
          primary:   v('--color-text'),          // alias — used widely as text-text-primary
          secondary: v('--color-text-secondary'),
          muted:     v('--color-text-muted'),
          disabled:  v('--color-text-disabled'),
        },

        // Brand accent (teal in dark mode; darkens automatically in light)
        accent: {
          DEFAULT: v('--color-accent'),
          dim:     v('--color-accent-dim'),
          glow:    'var(--color-accent-glow)',
        },

        // Secondary accent (amber / gold)
        gold: {
          DEFAULT: v('--color-gold'),
          dim:     'var(--color-gold-dim)',
        },

        // Semantic feedback
        success: v('--color-success'),
        warning: v('--color-warning'),
        danger:  v('--color-danger'),
      },

      animation: {
        'fade-in':  'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
