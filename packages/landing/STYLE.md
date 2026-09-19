# LasagnaFi landing style guide

The landing page must look like the product. This file records what the app
actually renders, measured from the running app with `getComputedStyle`, not
from reading class names. Everything on the landing page follows it.

Source of truth for the values: `packages/web/src/styles/theme.css` (`--ui-*`)
and `packages/web/src/components/uikit`. Astro cannot import across packages, so
`src/styles/global.css` copies the values. If a token changes in the app, change
it there too.

Measured on: Home, Actions, Financial journey, Retirement, Accounts, Chat.

---

## 1. Color

Light mode only on the landing page. The app also has a dark mode, the landing
page does not.

| Role | Token | Value |
| --- | --- | --- |
| Page background | `--canvas` | `#F7F9FC` |
| Wells, inset tracks, neutral chips | `--canvas-sunken` | `#EEF2F7` |
| Cards | `--panel` | `#FFFFFF` |
| Primary text | `--content` | `#101826` |
| Supporting text | `--content-2` | `#38465A` |
| Metadata | `--muted` | `#5C6B80` |
| Disabled, decoration | `--faint` | `#8693A6` |
| Card border | `--hairline` | `rgba(16, 24, 38, 0.07)` |
| Control border | `--line` | `rgba(16, 24, 38, 0.12)` |
| Green fill | `--brand` | `#05B279` |
| Green text and icons | `--brand-ink` | `#047A54` |
| Green tint background | `--brand-soft` | `rgba(5, 178, 121, 0.12)` |
| Periwinkle | `--accent` / `--accent-ink` | `#6366F1` / `#4F46E5` |
| Gain | `--positive` | `#0D6E67` |
| Loss | `--negative` | `#BE143E` |
| Warning | `--caution` | `#8C5600` |

Category colors, used to tell one kind of money job from another. A row's color
names the subject, it never means good or bad.

| Category | Text | Tint |
| --- | --- | --- |
| Spending | `--sky` `#0369A1` | `rgba(14, 165, 233, 0.15)` |
| Savings | `--brand-ink` `#047A54` | `--brand-soft` |
| Taxes | `--caution` `#8C5600` | `--caution-soft` |
| Investing | `--accent-ink` `#4F46E5` | `--accent-soft` |
| Debt | `--negative` `#BE143E` | `--negative-soft` |

Data-viz series: cash `#14B8A6`, investments `#6366F1`, property `#F59E0B`,
debt `#F4496E`.

A category has two colours doing two jobs, as in the app. The chip beside a row
uses the dark `-ink` value, which has to pass contrast on its own tint. The 3px
bar on the row edge is a solid accent, so it uses the vivid `--bar-*` token of
the same hue. Never a raw hex.

**Rule: no color change part way through a sentence.** A heading is one color.
Color carries meaning on numbers, chips and category bars only.

---

## 2. Radius

The app uses four steps. Do not invent others, and do not use full pills except
where noted.

| Step | Value | Used for |
| --- | --- | --- |
| `--r-sm` | 8px | Neutral meta chips, small tiles, icon squares |
| `--r-md` | 12px | Buttons, rows inside a card, inputs |
| `--r-lg` | 16px | Medium panels |
| `--r-xl` | 22px | Page level cards, pricing tiers, the dark privacy panel |

Full round (`999px`) is only for: the numeric delta chip next to a big number,
status pills such as `DONE` and `YOU ARE HERE`, and legend dots.

**A card is 22px. A row inside that card is 12px.** That pairing is the app's
most recognizable shape.

---

## 3. Elevation

Cards and rows both use `--shadow-sm`, and nothing else:

```
--shadow-sm: 0 1px 2px rgba(20, 33, 61, 0.06), 0 2px 6px rgba(20, 33, 61, 0.05);
```

Every panel in the app carries this one shadow plus a 1px `--hairline` border.
`--shadow-md` and `--shadow-lg` exist for popovers and modals. The landing page
uses them only on the hero card, so it lifts off the page, and on the featured
pricing tier.

Do not stack a heavy shadow on a card. The app never does.

---

## 4. Buttons

Measured from `Open Money`, `View all`, `Generate`, `Add account`.

```css
border-radius: 12px;          /* not a pill */
background:    rgba(5, 178, 121, 0.12);   /* --brand-soft */
color:         #047A54;                   /* --brand-ink  */
font-weight:   700;
font-size:     13.5px;
padding:       0 14px;
height:        36px  (sm)  /  44px (md)  /  48px (lg)
box-shadow:    none;
```

The app has **no solid green button**. The primary action is a green tint with
dark green bold text. Hover lifts by 1px and adds `--shadow-sm` and a 1px green
ring. Active presses down by 1px.

Secondary: `--canvas-sunken` background, `--content` text, 1px `--line` border.
Ghost: transparent, `--content-2` text, `--canvas-sunken` on hover.

Focus ring: `0 0 0 2px var(--canvas), 0 0 0 4px var(--brand-ring)`, where
`--brand-ring` is `rgba(4, 122, 84, 0.9)`. The ring uses the darker green
because the `#05B279` fill tops out at 2.6:1 on the canvas, below the 3:1 that
WCAG 1.4.11 needs.

---

## 5. Cards and rows

**Card** (`Net worth`, `Actions`, `Where your wealth stands`):

```css
background:    #FFFFFF;
border:        1px solid rgba(16, 24, 38, 0.07);
border-radius: 22px;
box-shadow:    var(--shadow-sm);
padding:       24px to 28px;
```

**Row inside a card** (one action, one account, one step):

```css
background:    #FFFFFF;
border:        1px solid rgba(16, 24, 38, 0.07);
border-radius: 12px;
box-shadow:    var(--shadow-sm);
border-left:   3px solid <category color>;   /* action rows only */
```

A row carries, left to right: a 34px icon square in the category tint at 8px
radius, the title at 15px/700, an optional muted sub line at 13px, then chips,
then a chevron.

**Card header**: title at 15px/600 in `--content`, optional description at 13px
in `--muted`, and an optional button on the right.

---

## 6. Chips

Two kinds. Do not mix them up.

**Meta chip** (`Quick`, `Moderate`, `Monte Carlo`): 8px radius,
`--canvas-sunken` background, `--content-2` text, 12.5px/600, padding 2px 8px.

**Category chip** (`Taxes`, `Spending`): 8px radius, category tint background,
category text color, 12.5px/600.

**Number chip** (`-$111,071`): full round, `--negative-soft` or
`--positive-soft` background, `--negative` or `--positive` text, 13px/700,
padding 0 12px.

**Status pill** (`DONE`, `YOU ARE HERE`, `AHEAD`): full round, tint background,
tinted text, 11px/700, uppercase, slight letter spacing.

---

## 7. Type

| Face | Token | Used for |
| --- | --- | --- |
| Bricolage Grotesque | `--display` | Headings and every money figure |
| Plus Jakarta Sans | `--sans` | Body copy, labels, buttons, chips |
| JetBrains Mono | `--mono` | The source panel on Data Privacy, and nothing else |

Measured sizes in the app: page title 34px/700 at `-0.03em`, section heading
19px/700 at `-0.02em`, body 16px/450, small print 13px.

The landing page may go larger in the hero, but it keeps the same faces, the
same 700 weight and the same negative tracking. Money figures always use
`--display` with `font-variant-numeric: tabular-nums`.

Data labels above a figure are uppercase, 11px, 700, `0.06em` tracking,
`--muted`. That is the only uppercase text allowed.

**No kicker text.** The app never puts a small uppercase label above a page
title, so the landing page does not either.

---

## 8. Copy

Write plain, standard technical English. Aim at a reader of about 13 or 14.

- Short sentences. One idea each.
- Active voice. `LasagnaFi reads your accounts`, not `your accounts are read`.
- Common words. `job` not `leverage`, `math` not `quantitative analysis`.
- No marketing speak. No `unlock`, `supercharge`, `game changing`, `effortless`.
- Say the number. `1,000 simulated markets` beats `powerful simulation`.
- No em dashes, en dashes, middots or semicolons. Use commas, periods, colons or
  parentheses.
- Only claim what the app does. The app has 14 steps and runs 1,000 markets, so
  the landing page says 14 and 1,000.

---

## 9. Motion

`--ease: cubic-bezier(0.22, 1, 0.36, 1)`, 150ms to 260ms.

Hover lifts a control by 1px to 2px. Reveal on scroll fades up by 20px. Every
animation is off under `prefers-reduced-motion: reduce`.
