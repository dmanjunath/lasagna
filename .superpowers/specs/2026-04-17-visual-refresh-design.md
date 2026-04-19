# Visual Refresh — Design Spec
**Date:** 2026-04-17
**Approach:** Token Swap + Component Polish (Approach B)
**Status:** Approved

---

## Overview

A full visual refresh of the Lasagna app: new color system, typography, logo, surface treatment, and a bespoke Layers page layout. No business logic changes. No layout restructuring beyond the `/priorities` page.

---

## 1. Color System

All colors in `tailwind.config.js` are hardcoded hex (not CSS variables). Update them in place.

### New tokens (`packages/web/tailwind.config.js`)

```js
bg: {
  DEFAULT:  '#090910',
  elevated: '#0f0f1c',
  subtle:   '#14142a',
}

surface: {
  DEFAULT: 'rgba(15, 15, 28, 1)',
  solid:   '#14142a',
  hover:   'rgba(20, 20, 42, 1)',
}

border: {
  DEFAULT: 'rgba(255, 255, 255, 0.07)',
  light:   'rgba(255, 255, 255, 0.04)',
  accent:  'rgba(0, 229, 160, 0.25)',
}

text: {
  DEFAULT:   '#e8e8f4',
  secondary: '#8892a4',
  muted:     '#404060',
}

accent: {
  DEFAULT: '#00e5a0',
  dim:     '#00916a',
  glow:    'rgba(0, 229, 160, 0.12)',
}

// New token
gold: {
  DEFAULT: '#fbbf24',
  dim:     'rgba(251, 191, 36, 0.12)',
}

success: '#00e5a0',
warning: '#fbbf24',
danger:  '#f87171',
```

---

## 2. Typography

Font import lives at **`packages/web/src/index.css` line 1** (`@import url(...)`). `App.tsx` has no font link tag — only edit `index.css`.

### Replace the `@import` line in `index.css`
```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');
```

### Update `tailwind.config.js` fontFamily
```js
fontFamily: {
  sans:    ['Space Grotesk', 'system-ui', 'sans-serif'],
  mono:    ['DM Mono', 'ui-monospace', 'monospace'],
  display: ['Space Grotesk', 'system-ui', 'sans-serif'], // keep key — was Fraunces
}
```

### Typography utility classes in `index.css`
- `.response-label`: add `font-mono` (`DM Mono`), keep `uppercase tracking-widest`
- All other `.response-*` classes: ensure they resolve to `font-sans`; remove any `font-display` references

---

## 3. Logo

Replace `packages/web/src/components/common/Logo.tsx` in full.

### Current component facts
- Has `size`, `className`, `animate` props
- Renders a `motion.svg` with `width={size} height={size}` on an `80×80` viewBox
- Uses `Math.random()` for unique gradient IDs
- Has Framer Motion entry animation controlled by `animate` prop

### New component spec

**Props** (replace existing):
```ts
interface LogoProps {
  width?: number;   // rendered width in px, default 30
  className?: string;
  animate?: boolean; // default true
}
// Height is always proportional: height = Math.round(width * 26 / 36)
```

**Gradient ID**: keep the `Math.random()` approach for uniqueness — `const id = Math.random().toString(36).slice(2, 9)` — use `lasagna-lg-${id}` as gradient id.

**SVG mark**: viewBox `0 0 36 26`, three bars:

| Bar | x | y | width | height | rx |
|-----|---|---|-------|--------|-----|
| Top | 0 | 0 | 13 | 6 | 3 |
| Mid | 0 | 10 | 24 | 6 | 3 |
| Bottom | 0 | 20 | 36 | 6 | 3 |

All bars share one horizontal linear gradient from `#00e5a0` (left) to `#00e5a0` at opacity 0 (right).

**Animation** (`animate` prop = true): stagger each bar in with:
```js
// Per bar, wrap in motion.rect:
initial={{ opacity: 0, scaleX: 0 }}
animate={{ opacity: 1, scaleX: 1 }}
transition={{ duration: 0.4, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
// transformOrigin: 'left center' (so bars grow from the left)
```

**Sidebar usage**: sidebar has no collapsed/expanded toggle — it's always full-width. Update the single call site at `sidebar.tsx:74` from `<Logo size={36} />` to `<Logo width={30} />`.

---

## 4. Surface Treatment — Solid + Glow

Replace the `@layer components` block in `packages/web/src/index.css` with:

```css
@layer components {
  /* ── Primary card surface ── */
  .surface-card {
    background: #0f0f1c;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    position: relative;
    /* No overflow:hidden here — add it per-component when needed */
  }
  .surface-card::before {
    content: '';
    position: absolute;
    /* Stays within card bounds so overflow:hidden on children doesn't clip it */
    top: 0;
    left: 0;
    width: 160px;
    height: 110px;
    background: radial-gradient(ellipse at top left, rgba(0, 229, 160, 0.07) 0%, transparent 65%);
    pointer-events: none;
    border-radius: inherit;
  }

  .surface-card-hover {
    @apply transition-all duration-300;
  }
  .surface-card-hover:hover {
    border-color: rgba(0, 229, 160, 0.2);
    box-shadow:
      0 4px 32px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(0, 229, 160, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    transform: translateY(-1px);
  }

  /* Migration aliases — keeps existing markup working */
  .glass-card {
    background: #0f0f1c;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    position: relative;
  }
  .glass-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 160px;
    height: 110px;
    background: radial-gradient(ellipse at top left, rgba(0, 229, 160, 0.07) 0%, transparent 65%);
    pointer-events: none;
    border-radius: inherit;
  }
  .glass-card-hover {
    @apply transition-all duration-300;
  }
  .glass-card-hover:hover {
    border-color: rgba(0, 229, 160, 0.2);
    box-shadow:
      0 4px 32px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(0, 229, 160, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    transform: translateY(-1px);
  }

  /* stat-card: replace gradient + remove ::before border mask */
  .stat-card {
    background: #0f0f1c;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    position: relative;
  }
  /* stat-card::before is intentionally removed (was a mask border gradient) */

  .accent-glow {
    box-shadow: 0 0 20px rgba(0, 229, 160, 0.2);
  }

  .progress-glow {
    box-shadow: 0 0 12px rgba(0, 229, 160, 0.4);
  }
}
```

---

## 5. Component Updates

### `packages/web/src/components/ui/button.tsx`

**`default` variant:**
```
'bg-accent hover:bg-accent-dim text-bg font-semibold shadow-[0_0_16px_rgba(0,229,160,0.2)] hover:shadow-[0_0_20px_rgba(0,229,160,0.3)] transition-all'
```

**`secondary` variant** (currently `'glass-card glass-card-hover'`):
```
'bg-bg-subtle border border-border text-text hover:border-border-accent hover:bg-surface-hover transition-all duration-200'
```

**Disabled state:** no change (already `opacity-50 pointer-events-none`).

**Focus rings:** no change (already `focus-visible:ring-accent/50` — token update handles the color).

**All other variants** (`ghost`, `outline`, `danger`): no structural changes; accent color refs update automatically from token change.

### `packages/web/src/components/ui/card.tsx`
Replace `glass-card` className with `surface-card` on the root element.

### `packages/web/src/components/common/stat-card.tsx`
Already uses `bg-bg-elevated border border-border` via Tailwind — token changes handle color automatically. Scan for any hardcoded `rgba(52, 199, 89` or `#34c759` and replace with `#00e5a0`.

### `packages/web/src/components/common/metric-tile.tsx`
Same as above — already solid. Scan for hardcoded old green values and replace.

### `packages/web/src/components/layout/sidebar.tsx`
- Root sidebar: ensure it uses `bg-bg` (solid `#090910`) with no `backdrop-blur`
- Active nav item: `border-l-2 border-accent bg-surface` (teal left border + elevated bg)
- Update Logo call site at `sidebar.tsx:74`: `<Logo width={30} />`
- Remove any `glass-card` references

### `packages/web/src/styles/theme.ts`
Two updates:
1. Update accent hex from `#34c759` to `#00e5a0` so chart color injection stays in sync.
2. Update `fonts` export (consumed by any runtime chart axis / label config):
```ts
export const fonts = {
  sans:    ['Space Grotesk', 'system-ui', 'sans-serif'],
  display: ['Space Grotesk', 'system-ui', 'sans-serif'], // was Fraunces
  mono:    ['DM Mono', 'ui-monospace', 'monospace'],     // new
};
```

---

## 6. Layers Page (`/priorities`)

Rewrite `packages/web/src/pages/priorities.tsx` layout. Keep all API calls, types, `formatCurrency`, and state machine logic unchanged.

### Keep unchanged
- `useEffect` / `api.getPriorities()` fetch
- All TypeScript interfaces (`PriorityStep`, `PrioritySummary`, `PriorityData`)
- `iconMap` record
- `formatCurrency` helper
- Loading state (centered spinner)
- Error state (AlertCircle)
- Empty/no-data state (Rocket illustration + CTA buttons)
- Legal disclaimer `<p>` at the bottom

### Page container
Replace `max-w-3xl mx-auto` with no max-width constraint — bands go full-width of the content area. The `SummaryCard` and footer stats keep an inner max-width of `max-w-3xl mx-auto` for readability.

### Replace: `SummaryCard`
Keep all data and JSX structure. Replace `bg-bg-elevated border border-border rounded-xl` with `surface-card`. Add `overflow-hidden` directly to this element (safe here, no ::before clip issue since ::before is positioned within bounds).

### Replace: `StepCard` → `LayerBand`

Each `PriorityStep` renders as a full-width band. Band height: `64px` (fixed, `flex-shrink-0`).

```
<motion.div> (Framer wrapper)
  <div class="relative flex-shrink-0" style="height:64px; overflow:hidden">
    <!-- 1. Track -->
    <div class="absolute inset-0 bg-white/[0.012]" />

    <!-- 2. Fill bar (motion.div, animates width) -->
    <motion.div class="absolute inset-y-0 left-0"
      style="width: {progress}%; background: {gradient}" />

    <!-- 3. Left accent (3px) -->
    <div class="absolute inset-y-0 left-0 w-[3px]" style="{accentStyle}" />

    <!-- 4. Content -->
    <div class="relative flex items-center gap-4 px-7 h-full z-10">
      <span class="font-mono text-[10px] text-muted w-4 hidden sm:block">{order}</span>
      <div class="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0">
        <Icon class="w-4 h-4" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[13px] font-semibold">{title}</div>
        <div class="font-mono text-[10px] text-muted mt-0.5">{subtitle}</div>
      </div>
      <div class="text-right flex-shrink-0">
        <div class="font-mono text-[15px] font-medium">{pct}</div>
        <div class="font-mono text-[10px] text-muted mt-0.5">{amount}</div>
      </div>
    </div>
  </div>
</motion.div>
```

### Band state logic

Determine state before rendering:
```ts
const isComplete = step.status === 'complete';
const isCurrent  = step.id === currentStepId;
const isLocked   = !isComplete && !isCurrent;
const isOdd      = step.order % 2 !== 0;
```

| State | Fill gradient (width = progress%) | Accent bar | Name color | Pct color |
|---|---|---|---|---|
| `isComplete && isOdd` | `linear-gradient(90deg, rgba(0,229,160,0.18), rgba(0,229,160,0.04))` at 100% | `#00e5a0` solid | `#e8e8f4` | `#00e5a0` |
| `isComplete && !isOdd` | `linear-gradient(90deg, rgba(251,191,36,0.15), rgba(251,191,36,0.03))` at 100% | `#fbbf24` solid | `#e8e8f4` | `#fbbf24` |
| `isCurrent` | `linear-gradient(90deg, rgba(0,229,160,0.13), rgba(0,229,160,0.02))` at `step.progress`% | `rgba(0,229,160,0.55)` solid | `#c8c8d8` | `#00e5a0` |
| `isLocked` | none (0%) | dashed `#2a2a40` | `#686888` | `#2e2e48` |

Locked accent bar CSS (inline style):
```css
background: repeating-linear-gradient(
  to bottom, #2a2a40 0px, #2a2a40 4px, transparent 4px, transparent 8px
);
```

Icon container background: `rgba(0,229,160,0.10)` for complete/current; `rgba(255,255,255,0.03)` for locked.
Icon color: `#00e5a0` (or `#fbbf24` for even complete) when active; `#686888` for locked.

### Amount field display rules

`step.current` and `step.target` are `number | null`.

- If `isLocked`: show `—` for both pct and amount
- If `step.target === null || step.current === null`: show pct only; amount shows `—`
- If `step.target === 0`: amount shows `Goal: $0`
- If `isComplete`: amount shows `formatCurrency(step.current)` + ` saved` (or ` paid` for debt steps — check `step.icon === 'credit-card'`)
- If `isCurrent`: amount shows `formatCurrency(step.target - step.current)` + ` left` (for debt/savings) or just `formatCurrency(step.current)` if that makes more sense semantically. Use `step.target - step.current` when `step.target > step.current`, otherwise `formatCurrency(step.current)` + ` saved`

Do not abbreviate to K — use `formatCurrency` (existing helper) as-is.

### Band animations

```ts
// Band entry (Framer Motion)
initial={{ opacity: 0, x: -12 }}
animate={{ opacity: 1, x: 0 }}
transition={{ duration: 0.3, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}

// Fill bar width
initial={{ width: '0%' }}
animate={{ width: `${isLocked ? 0 : step.progress}%` }}
transition={{ duration: 0.7, delay: index * 0.05 + 0.1, ease: [0.16, 1, 0.3, 1] }}
```

### Separators
`<div class="h-px bg-white/[0.03]" />` between each band.

### Watermark
Inside the page header `<div>` (which is `position: relative`). The header has no `max-width` in the new layout — bands are full width. Watermark is `position: absolute; top: 16px; right: 0; opacity: 0.06`:
```tsx
<svg width="90" style={{ position:'absolute', top:16, right:0, opacity:0.06 }} viewBox="0 0 36 26" fill="none">
  <defs>
    <linearGradient id="lasagna-wm" x1="0" y1="0" x2="36" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#00e5a0"/>
      <stop offset="100%" stopColor="#00e5a0" stopOpacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0"  width="13" height="6" rx="3" fill="url(#lasagna-wm)"/>
  <rect x="0" y="10" width="24" height="6" rx="3" fill="url(#lasagna-wm)"/>
  <rect x="0" y="20" width="36" height="6" rx="3" fill="url(#lasagna-wm)"/>
</svg>
```
Use static id `lasagna-wm` here (only renders once on the page, no collision risk).

### Footer stats row
Rendered below all bands, above the legal disclaimer. Not a `surface-card` — just a `border-t border-white/[0.04]` row with padding. Use `max-w-3xl mx-auto` to match the header width:

```tsx
<div className="border-t border-white/[0.04] mt-2">
  <div className="max-w-3xl mx-auto px-7 py-4 flex items-center justify-between">
    <FooterStat label="Complete"    value={completeCount}   color="#00e5a0" />
    <FooterStat label="In Progress" value={inProgressCount} color="#e8e8f4" />
    <FooterStat label="Locked"      value={lockedCount}     color="#2e2e48" />
    <FooterStat label="FI Target"   value={`Age ${summary.retirementAge}`} color="#fbbf24" />
  </div>
</div>
```

Derived values (no new API fields):
```ts
const completeCount    = steps.filter(s => s.status === 'complete').length;
const inProgressCount  = steps.filter(s => s.id === currentStepId && s.status !== 'complete').length;
const lockedCount      = steps.filter(s => s.id !== currentStepId && s.status !== 'complete').length;
```

`FooterStat` is a small local component: label in `font-mono text-[9px] text-muted uppercase tracking-widest`, value in `text-[16px] font-bold`.

Legal disclaimer `<p>` renders after the footer row, unchanged.

### Mobile (< 640px)
- Band height stays `64px`
- Order number: `hidden sm:block`
- Amount row: show only pct (hide amount text) — `hidden sm:block` on the amount div

---

## 7. Files Changed

| File | Change |
|---|---|
| `packages/web/tailwind.config.js` | Color tokens + font tokens |
| `packages/web/src/index.css` | Font `@import`, full `@layer components` block replacement |
| `packages/web/src/styles/theme.ts` | Update `#34c759` → `#00e5a0` |
| `packages/web/src/components/common/Logo.tsx` | Full rewrite — new SVG mark, new props |
| `packages/web/src/components/ui/button.tsx` | `default` + `secondary` variant updates |
| `packages/web/src/components/ui/card.tsx` | `glass-card` → `surface-card` |
| `packages/web/src/components/common/stat-card.tsx` | Scan + replace any hardcoded old green hex |
| `packages/web/src/components/common/metric-tile.tsx` | Scan + replace any hardcoded old green hex |
| `packages/web/src/components/layout/sidebar.tsx` | Solid bg, teal active state, updated Logo call |
| `packages/web/src/pages/priorities.tsx` | Full layout rewrite (data/API layer unchanged) |

---

## `glass-card` Usage Audit

`glass-card` is used in ~60 places across the codebase (pages, chart blocks, plan components, settings). The migration alias in `index.css` means all existing markup continues to work visually without touching each file — the alias replaces `backdrop-blur-xl` + translucent gradient with a solid `#0f0f1c` surface + teal corner glow. This is intentional: all cards are placed over the solid `#090910` page background, so there is nothing meaningful to blur through. The visual change (solid vs. translucent) is acceptable for every usage. No per-file changes are required for these usages.

---

## Out of Scope
- Chart components (Recharts/Vega color injection via `theme.ts` picks up automatically)
- Backend / API changes
- Light mode
- Any page other than `/priorities`
