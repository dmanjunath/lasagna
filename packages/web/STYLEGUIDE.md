# LasagnaFi Typography & Style Guide

## Fonts

| Role | Font | Tailwind | Usage |
|------|------|----------|-------|
| **Display** | Instrument Serif | `font-serif` | Page titles (h1), section titles (h2), hero numbers (net worth, totals). Never for body text, labels, or badges. |
| **Body** | Geist | (default sans) | All body copy, buttons, form inputs, account names, descriptions. The default — don't specify a class. |
| **Mono** | JetBrains Mono | `font-mono` | Eyebrow labels, data badges, metadata lines (sync time, account masks), code blocks. |

## Type Scale

| Element | Classes | Example |
|---------|---------|---------|
| **Page hero number** | `font-serif text-4xl md:text-5xl font-medium tabular-nums` | $6,278,549 |
| **Page title (h1)** | `font-serif text-2xl font-medium` | Hey Dheeraj |
| **Section title (h2)** | `font-serif text-lg font-medium` | Cash, Investments |
| **Card title (h3)** | `text-base font-medium` | (sans — no serif for small headings) |
| **Body** | `text-sm` | Account descriptions, insight text |
| **Eyebrow label** | `font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted` | NET WORTH, SNAPSHOT |
| **Data badge** | `font-mono text-[10px] uppercase tracking-[0.14em]` | SAVINGS, CHECKING |
| **Metadata line** | `font-mono text-[11px] text-text-muted` | Chase · ··2691 · 1d ago |
| **Tab/nav label** | `font-mono text-[10px] uppercase tracking-wide` | HOME, MONEY |

## Rules

1. **Serif is for display only** — h1, h2, hero numbers. Never badges, avatars, or small text.
2. **One tracking value for eyebrows**: `tracking-[0.14em]`. Not 0.16em, not tracking-wider.
3. **One eyebrow size**: `text-[11px]`. Not text-xs, not text-[10px] (exception: nav tab labels use text-[10px]).
4. **No inline fontFamily** — use Tailwind classes. `font-serif`, `font-mono`, or default sans.
5. **Uppercase only on eyebrows and badges** — never on account names, section titles, or body text.
6. **Tabular nums on all money values** — `tabular-nums` class so columns align.
