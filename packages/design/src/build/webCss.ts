import type { ColorRoles, Scheme, Theme } from "../schema";
import { composite, parseColor, toTriplet, withAlpha } from "../color";
import { toCss } from "./toCss";

// A design system as the web app's stylesheet: the theme's --ui-* variables
// (toCss), its fonts, and its component skins on the web's own components,
// all scoped to html[data-design="<id>"]. The web app ships it for every
// non-default design, and the native app injects the same CSS into the
// hosted web pages it shows, so both draw a page the same way.

/** A Google Fonts css2 URL for every family the theme uses, at the weights it uses. */
export function fontsUrl(theme: Theme): string {
  const weights = new Map<string, Set<number>>();
  for (const role of Object.values(theme.font)) {
    const set = weights.get(role.family) ?? new Set<number>();
    for (const w of Object.keys(role.faces)) set.add(Number(w));
    weights.set(role.family, set);
  }
  const families = [...weights.entries()].map(
    ([family, set]) => `family=${family.replace(/ /g, "+")}:wght@${[...set].sort((a, b) => a - b).join(";")}`,
  );
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

/**
 * The web's text faces are literals (Tailwind's font-sans, .ui-root), so the
 * body face is mapped onto them here. Headings already read --ui-display.
 */
const FONT_CSS = [
  "html[data-design],html[data-design] body,html[data-design] .ui-root,html[data-design] .font-sans,html[data-design] .font-serif{font-family:var(--ui-font-body),system-ui,sans-serif}",
].join("");

/**
 * The theme's stylesheet for the web page. Each light block is raised to
 * html[data-design] so it outranks theme.css's own :root block wherever the
 * two land in the document.
 */
export function themeCss(theme: Theme): string {
  return (
    toCss(theme).replace(/^\[data-design=/gm, "html[data-design=") +
    numeralsCss(theme) +
    FONT_CSS +
    skinCss(theme) +
    titleCss(theme) +
    legacyCss(theme) +
    heroCss(theme) +
    surfaceCss(theme)
  );
}

// Web classes (packages/web) the skins restyle. A card is a panel with the
// large radii, a primary button the brand-ink fill (uikit Button).
const CARD = ":is(.bg-panel,.bg-panel-raised):is(.rounded-ui-lg,.rounded-ui-xl)";
const PRIMARY = 'button[class~="bg-[rgb(var(--ui-brand-ink))]"],a[class~="bg-[rgb(var(--ui-brand-ink))]"]';
const SECONDARY = ":is(button,a).bg-brand-soft.font-bold";
const CHIP = "button.bg-panel.border-line-strong:is(.rounded-full,.rounded-ui-md)";

/**
 * The theme's component skins, on the web's own components. The web draws
 * Classic's skins already (outlined cards, rounded buttons, outlined chips,
 * the accent bar), so a skin only adds rules where it differs from those.
 * Every theme gets the plain canvas the native screens have (no glow wash).
 */
export function skinCss(theme: Theme): string {
  const h = `html[data-design="${theme.meta.id}"]`;
  const { card, button, chip, actionCard } = theme.skin;
  const out = [`${h} .app-wash{background-image:none!important}`];
  if (card !== "outlined") {
    const fill = card === "soft" ? "var(--ui-surface-muted)" : "var(--ui-panel)";
    const edge = card === "offset" ? "border:var(--ui-stroke-outline) solid rgb(var(--ui-content))!important;box-shadow:3px 3px 0 rgb(var(--ui-content))!important" : "border-color:transparent!important;box-shadow:none!important";
    out.push(
      // No corner wash on a filled card, as the native soft card has none.
      `${h} ${CARD}{background-color:rgb(${fill})!important;${card === "soft" ? "background-image:none!important;" : ""}${edge};border-radius:var(--ui-r-lg)!important}`,
      // The decorative corner glows some cards lay over their fill.
      ...(card === "soft" ? [`${h} ${CARD}>.pointer-events-none.absolute[style*="radial-gradient"]{display:none!important}`] : []),
      // A card inside a card: the page's own surface, as the native nested card.
      `${h} ${CARD} ${CARD}{background-color:rgb(var(--ui-panel))!important;box-shadow:none!important}`,
      // The soft skin's surfaces (surfaceCss): a white card on the warm page, edged and softly lifted.
      ...(card === "soft"
        ? [
            `${h} ${CARD}{background-color:var(--ui-card)!important;border:1px solid var(--ui-card-edge)!important;box-shadow:var(--ui-card-shadow)!important}`,
            `${h} ${CARD} ${CARD}{background-color:var(--ui-card-nested)!important;box-shadow:none!important}`,
          ]
        : []),
      // Flat fills for chart segments (the debt bar's gloss).
      `${h} [role="img"]>div[style*="linear-gradient"]{background-image:none!important}`,
      `${h} [role="img"][style*="inset"]{box-shadow:none!important}`,
      // The same gloss on the Portfolio allocation bar's segments (buttons, so outside [role="img"]).
      `${h} [style*="linear-gradient(170deg"]{background-image:none!important}`,
    );
  }
  if (button !== "rounded") {
    out.push(`${h} :is(${PRIMARY}),${h} ${SECONDARY}{border-radius:var(--ui-r-pill)!important}`);
    if (button === "chunky") out.push(`${h} :is(${PRIMARY}){box-shadow:0 4px 0 rgb(var(--ui-brand-edge))!important;margin-bottom:4px}`);
  }
  if (chip === "filled") out.push(`${h} ${CHIP}{background-color:rgb(var(--ui-surface-muted))!important;border-color:transparent!important;border-radius:var(--ui-r-pill)!important}`);
  // The goal cards' left rail is the accent-bar skin.
  if (actionCard !== "accentBar") out.push(`${h} article.g-rise>span.absolute.inset-y-0.left-0{display:none!important}`);
  // Transactions' day headings sit on the sunken fill, so they read as bands under the rows, not stripes.
  out.push(`${h} [data-day-band]{background-color:rgb(var(--ui-canvas-sunken))!important}`);
  // A band is square and the list card clips it to its corners (clip, not hidden, so the bands stay sticky): no sliver at the
  // card's top corners, and no rounded "tab" when the first band sits under the phone sort row.
  out.push(`${h} [data-day-band]{border-radius:0!important}${h} [data-txn-list]{overflow:clip}`);
  // Spending's period controls on a phone: Month / Year and the stepper share one row, as on native. The row
  // wraps only when it can't fit (large text), and the stepper then takes its own line.
  out.push(`@media (max-width:639px){${h} [data-period-row]{flex-direction:row!important;flex-wrap:wrap;align-items:center!important;justify-content:space-between}${h} [data-period-row]>[role=radiogroup]{flex:0 0 auto!important}${h} [data-period-stepper]{margin-left:auto;gap:0!important}${h} [data-period-stepper]>span{min-width:0!important;font-size:14px!important}}`);
  out.push(segmentedCss(theme), headingCss(theme), chatListCss(theme));
  return out.join("");
}

/** A card's look under the theme's card skin, as declarations. */
function cardDecl(theme: Theme): string {
  switch (theme.skin.card) {
    case "soft":
      return "background-color:var(--ui-card);border:1px solid var(--ui-card-edge);box-shadow:var(--ui-card-shadow)";
    case "flat":
      return "background-color:rgb(var(--ui-panel));border:0;box-shadow:none";
    case "offset":
      return "background-color:rgb(var(--ui-panel));border:var(--ui-stroke-outline) solid rgb(var(--ui-content));box-shadow:3px 3px 0 rgb(var(--ui-content))";
    default:
      return "background-color:rgb(var(--ui-panel));border:1px solid var(--ui-line);box-shadow:var(--ui-shadow-sm)";
  }
}

/**
 * The web's segmented control (uikit SegmentedControl) as the native page-top
 * toggles: separate pills where the chip skin is filled (the selected one in
 * the selected tint, the rest on the sunken fill), else a rounded track.
 */
function segmentedCss(theme: Theme): string {
  const h = `html[data-design="${theme.meta.id}"]`;
  const seg = `${h} main [role="radiogroup"].bg-canvas-sunken`;
  if (theme.skin.pill === "raised") {
    // Raised pills (owner decision 2026-11-23): the selected one unmistakable, filled in the brand ink over a soft
    // edge shadow (the chunky button's gentle cousin), the rest flat on the card fill with a hairline. On a hero the
    // selected one wears the hero's own ink, so a range pill on the denim net worth card reads as part of it.
    const rest = "var(--ui-card,rgb(var(--ui-panel)))";
    const edge = "var(--ui-card-edge,var(--ui-line))";
    return (
      `${seg}{display:inline-flex!important;flex-wrap:wrap;gap:8px!important;width:auto!important;border:0!important;padding:0 0 2px!important;background:transparent!important;box-shadow:none!important}` +
      `${seg}>[role="radio"]{flex:0 0 auto!important;min-height:36px!important;height:auto!important;padding:6px 14px!important;border-radius:var(--ui-r-pill)!important;background-color:${rest}!important;border:1px solid ${edge}!important;color:rgb(var(--ui-content))!important;font-weight:500!important;box-shadow:none!important;transition:background-color .15s ease,translate .15s ease,box-shadow .15s ease}` +
      `${seg}>[role="radio"][aria-checked="true"]{background-color:rgb(var(--ui-brand-ink))!important;border-color:transparent!important;color:rgb(var(--ui-brand-fg))!important;font-weight:700!important;box-shadow:0 2px 0 rgb(var(--ui-brand-edge)),0 3px 8px rgba(0,0,0,0.08)!important}` +
      HERO_ROLES.map(
        (role) =>
          `${h} [data-hero="${role}"] [role="radiogroup"].bg-canvas-sunken>[role="radio"][aria-checked="true"]{background-color:var(--ui-tint-${role}-ink)!important;color:rgb(var(--ui-brand-fg))!important;box-shadow:0 2px 0 color-mix(in srgb,var(--ui-tint-${role}-ink),#000 22%),0 3px 8px rgba(0,0,0,0.08)!important}`,
      ).join("") +
      // The Spending Money out / Money in switch: the selected side wears its role, never the brand green on Money out.
      `${h} main [data-money-switch] [role="radiogroup"]>[role="radio"][aria-checked="true"]:nth-child(1){background-color:var(--ui-tint-spend-ink)!important;box-shadow:0 2px 0 color-mix(in srgb,var(--ui-tint-spend-ink),#000 22%),0 3px 8px rgba(0,0,0,0.08)!important}` +
      `${h} main [data-money-switch] [role="radiogroup"]>[role="radio"][aria-checked="true"]:nth-child(2){background-color:var(--ui-tint-income-ink)!important;box-shadow:0 2px 0 color-mix(in srgb,var(--ui-tint-income-ink),#000 22%),0 3px 8px rgba(0,0,0,0.08)!important}` +
      `${seg}>[role="radio"]:not([aria-checked="true"]):hover{background-color:var(--ui-row-hover,color-mix(in srgb,${rest},rgb(var(--ui-canvas-sunken)) 50%))!important;border-color:color-mix(in srgb,${edge},rgb(var(--ui-content)) 12%)!important}` +
      `@media (prefers-reduced-motion:no-preference){${seg}>[role="radio"]:not([aria-checked="true"]):hover{translate:0 -1px}}` +
      `${seg}>[role="radio"]:focus-visible{outline:none!important;box-shadow:0 0 0 2px rgb(var(--ui-canvas)),0 0 0 4px var(--ui-brand-ring)!important}`
    );
  }
  if (theme.skin.chip === "filled") {
    return (
      `${seg}{display:inline-flex!important;flex-wrap:wrap;gap:8px!important;width:auto!important;border:0!important;padding:0!important;background:transparent!important;box-shadow:none!important}` +
      `${seg}>[role="radio"]{flex:0 0 auto!important;min-height:36px!important;height:auto!important;padding:6px 14px!important;border-radius:var(--ui-r-pill)!important;background-color:rgb(var(--ui-canvas-sunken))!important;color:rgb(var(--ui-content))!important;font-weight:500!important;box-shadow:none!important}` +
      `${seg}>[role="radio"][aria-checked="true"]{background-color:var(--ui-selected)!important;color:var(--ui-on-selected)!important;font-weight:600!important}` +
      // A step darker on hover, read off the fill itself so it holds on any page color.
      `${seg}>[role="radio"]:not([aria-checked="true"]):hover{background-color:color-mix(in srgb,rgb(var(--ui-canvas-sunken)),rgb(var(--ui-content)) 7%)!important}` +
      // The no-shadow rule above would hide .ui-focus's ring: put it back.
      `${seg}>[role="radio"]:focus-visible{outline:none!important;box-shadow:0 0 0 2px rgb(var(--ui-canvas)),0 0 0 4px var(--ui-brand-ring)!important}`
    );
  }
  const r = "var(--ui-r-sm)";
  return (
    `${seg}{display:flex!important;width:100%!important;border:0!important;padding:2px!important;border-radius:${r}!important;background-color:rgb(var(--ui-canvas-sunken))!important}` +
    `${seg}>[role="radio"]{flex:1 1 0!important;height:44px!important;border-radius:${r}!important;font-weight:500;color:rgb(var(--ui-content-secondary))}` +
    `${seg}>[role="radio"][aria-checked="true"]{background-color:var(--ui-thumb)!important;color:var(--ui-on-thumb)!important;font-weight:600!important;box-shadow:var(--ui-shadow-sm)!important}`
  );
}

/**
 * A page's own display headline ("How fast can you be debt-free?") sits under
 * the injected page title, so it steps down to a card title's size there.
 */
function headingCss(theme: Theme): string {
  const h = `html[data-design="${theme.meta.id}"][data-lf-title]`;
  const t = theme.type.title2;
  return `${h} main :is(h1,h2).font-editorial{font-size:${t.size}px!important;line-height:${t.lineHeight}px!important;letter-spacing:${t.letterSpacing}px!important}`;
}

/** Chat's conversation list (chat-thread-list.tsx), in a card like a native grouped list. */
function chatListCss(theme: Theme): string {
  const h = `html[data-design="${theme.meta.id}"]`;
  return `${h} main p.pt-2.pb-2.font-semibold.text-content-muted+div.flex.flex-col{${cardDecl(theme).replace(/;/g, "!important;")}!important;border-radius:var(--ui-r-lg)!important;overflow:hidden;padding:4px 0}`;
}

/** Where the page's title sits: the gutter plus a card's padding, as a native title. */
const titleInset = (theme: Theme) => theme.space.screen + theme.space.card;

/**
 * The page's title as the first thing in its content (main::before, so no
 * node is added to the web app's tree): a tab root's large title, or a pushed
 * screen's smaller one, in the theme's display face. It scrolls with the page.
 */
function titleCss(theme: Theme): string {
  const h = `html[data-design="${theme.meta.id}"]`;
  const style = (k: "largeTitle" | "title1") => {
    const t = theme.type[k];
    return `font-size:${t.size}px;line-height:${t.lineHeight}px;font-weight:${t.weight};letter-spacing:${t.letterSpacing}px;font-family:var(--ui-font-${t.role}),system-ui,sans-serif`;
  };
  return (
    `${h}[data-lf-title] main::before{content:var(--lf-title);display:block;color:rgb(var(--ui-content));padding:${TITLE_PAD_TOP}px ${titleInset(theme)}px 4px;${style("title1")}}` +
    `${h}.lf-root[data-lf-title] main::before{${style("largeTitle")}}`
  );
}

/** The title's top padding, which the native bar's fade measures from. */
export const TITLE_PAD_TOP = 2;

/**
 * Digits-only aliases the web's theme.css already declares, by the family they
 * take their digits from ("LF Numerals" is Figtree's digits).
 */
const WEB_NUMERAL_ALIASES: Record<string, string> = { Figtree: "LF Numerals" };

/**
 * The web sets figures inside headings in the numeric face by putting a
 * digits-only face first in --ui-display. A theme whose numeric face differs
 * from its display face keeps that, so its numbers read as they do natively.
 */
function numeralsCss(theme: Theme): string {
  const numeric = theme.font.numeric.family;
  const alias = WEB_NUMERAL_ALIASES[numeric];
  if (!alias || numeric === theme.font.display.family) return "";
  return `html[data-design="${theme.meta.id}"]{--ui-display:"${alias}","${theme.font.display.family}"}`;
}


// ── The web's legacy palette ─────────────────────────────────────────────────

/**
 * The web still paints some surfaces (charts, older cards) with its legacy
 * --color-*, --lf-* and --data-* variables, which the accent themes set under
 * :root[data-theme] and the custom accent writes inline. Under a design they
 * take the design's roles instead, so nothing keeps the default look. Raised
 * to html:root (and !important, over the inline custom accent) so they win.
 */
export function legacyCss(theme: Theme): string {
  const id = theme.meta.id;
  const decl = (scheme: Scheme) => {
    const c = theme.color[scheme];
    const t = (role: keyof ColorRoles) => toTriplet(c[role] as string);
    const v = (role: keyof ColorRoles) => c[role] as string;
    const vars: Record<string, string> = {
      "--color-bg": t("canvas"),
      "--color-bg-elevated": t("surface"),
      "--color-bg-subtle": t("canvasSunken"),
      "--color-surface": t("surface"),
      "--color-surface-hover": t("surfaceRaised"),
      "--color-text": t("content"),
      "--color-text-secondary": t("contentSecondary"),
      "--color-text-muted": t("contentMuted"),
      "--color-text-disabled": t("contentFaint"),
      "--color-accent": t("brand"),
      "--color-accent-dim": t("brandInk"),
      "--color-gold": toTriplet(c.tint.goal.accent),
      "--color-success": t("positive"),
      "--color-warning": t("caution"),
      "--color-danger": t("negative"),
      "--color-border": v("hairline"),
      "--color-border-light": v("hairline"),
      "--color-border-strong": v("line"),
      "--color-border-accent": v("brandRing"),
      "--color-accent-glow": v("brandSofter"),
      "--color-gold-dim": v("cautionSoft"),
      "--lf-paper": v("canvas"),
      "--lf-surface": v("surface"),
      "--lf-cream": v("surfaceMuted"),
      "--lf-cream-deep": v("canvasSunken"),
      "--lf-ink": v("content"),
      "--lf-ink-soft": v("contentSecondary"),
      "--lf-muted": v("contentMuted"),
      "--lf-rule": v("line"),
      "--lf-rule-soft": v("hairline"),
      "--lf-rule-neutral": v("hairline"),
      "--lf-sauce": v("brand"),
      "--lf-sauce-deep": v("brandInk"),
      "--lf-cheese": c.tint.goal.accent,
      "--lf-basil": v("positive"),
      "--lf-noodle": v("contentFaint"),
      "--lf-crust": v("slate"),
      "--lf-burgundy": v("negative"),
      "--lf-pos": v("positive"),
      "--lf-neg": v("negative"),
      "--data-cash": c.tint.income.accent,
      "--data-investments": c.tint.wealth.accent,
      "--data-assets": v("violet"),
      "--data-debt": c.tint.spend.accent,
      "--card-glow": "transparent",
      "--shadow-card": theme.shadow[scheme].sm,
      "--shadow-card-hover": theme.shadow[scheme].md,
      "--shadow-accent-glow": "none",
      "--shadow-accent-glow-hover": "none",
    };
    c.chart.slice(0, 5).forEach((col, i) => (vars[`--lf-data-${i + 1}`] = col));
    // Money in and money out in charts take the role colors, as the native charts do.
    vars["--ui-chart-in"] = c.tint.income.accent;
    vars["--ui-chart-out"] = c.tint.spend.accent;
    // Spending's ranked share bars: the role accent, see-through, so a bar reads on any card color.
    vars["--ui-share-in"] = `color-mix(in srgb,${c.tint.income.accent} 26%,transparent)`;
    vars["--ui-share-out"] = `color-mix(in srgb,${c.tint.spend.accent} 26%,transparent)`;
    // Debt's composition bar: one sauce ramp, darkest first, so accounts read apart without new meanings (red is cost,
    // yellow is attention: a third color would claim one of them).
    [100, 78, 58, 42, 30, 20].forEach((p, i) => {
      vars[`--ui-debt-${i + 1}`] = `color-mix(in srgb,${c.tint.spend.accent} ${p}%,${c.tint.spend.fill})`;
    });
    return Object.entries(vars)
      .map(([k, val]) => `${k}:${val}!important`)
      .join(";");
  };
  return `html:root[data-design="${id}"]{${decl("light")}}html:root.dark[data-design="${id}"]{${decl("dark")}}`;
}

// ── Hero cards ───────────────────────────────────────────────────────────────

/** The roles a page's hero card can take (data-hero="<role>" on the card). */
export const HERO_ROLES = ["wealth", "spend", "income", "goal", "action"] as const;
export type HeroRole = (typeof HERO_ROLES)[number];

/**
 * One tinted card per page, its hero, in the page's role color: the web marks
 * the card with data-hero="<role>" and the design decides how it looks. A
 * design whose tints are its surface (Classic) leaves the card as it is.
 */
export function heroCss(theme: Theme): string {
  const h = `html[data-design="${theme.meta.id}"]`;
  return HERO_ROLES.map(
    (role) =>
      `${h} [data-hero][data-hero="${role}"]{background-color:var(--ui-tint-${role})!important;background-image:none!important;${
        // Under the soft skin a hero is framed like every other card, in a deeper shade of its own tint (surfaceCss).
        theme.skin.card === "soft"
          ? `border:1px solid var(--ui-tint-${role}-edge)!important;box-shadow:var(--ui-card-shadow)!important`
          : "border-color:transparent!important;box-shadow:none!important"
      }}` +
      `${h} [data-hero="${role}"] :is([class*="hover:bg-canvas-sunken"],[class*="hover:bg-brand-softer"]):hover,${h} [data-hero="${role}"] article[data-action-id]:hover{background-color:var(--ui-tint-${role}-hover)!important}` +
      `${h} [data-hero="${role}"] [data-hero-label]{color:var(--ui-tint-${role}-ink)!important}` +
      // A link on a tinted hero takes neutral ink: brand green inside the red Money out tile would claim a meaning.
      `${h} [data-hero="${role}"] [data-hero-link]{color:rgb(var(--ui-content-secondary))!important}`,
  ).join("") +
    // A pill or badge on a hero (Journey's "On track" link) can't take a soft tint that is the hero's own fill: it
    // takes the card fill, the web's chipOnCard.
    `${h} [data-hero] :is(.bg-brand-soft,.bg-caution-soft,.bg-canvas-sunken,.bg-positive-soft).rounded-full{background-color:var(--ui-card,rgb(var(--ui-panel)))!important}` +
    // A hero that groups cards (Actions' first band) gets a card's frame around them.
    `${h} [data-hero-frame]{padding:16px;border-radius:var(--ui-r-lg)}`;
}

// ── What the web's first-paint script needs ──────────────────────────────────

/** Per design: its fonts and its assistant's name, for index.html's inline script. */
export function designBoot(themes: readonly Theme[]): Record<string, { fonts: string; assistant: string | null }> {
  return Object.fromEntries(themes.map((t) => [t.meta.id, { fonts: fontsUrl(t), assistant: t.mascot?.name ?? null }]));
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

/** The lighter of two opaque colors. */
const lighter = (a: string, b: string) => {
  const sum = (c: string) => {
    const { r, g, b: bl } = parseColor(c);
    return r + g + bl;
  };
  return sum(a) >= sum(b) ? a : b;
};
/** The darker of two opaque colors. */
const darker = (a: string, b: string) => (lighter(a, b) === a ? b : a);

/**
 * Where the card skin is soft (Noodle), the page is warm and the cards sit on
 * it (owner decision 2026-11-23, "warm page, white cards"): a warm page that
 * the sidebar and the phone top bar share (both read --ui-canvas), cards a step
 * lighter with a warm edge and a soft shadow, rows that tint and clickable
 * cards that lift under the pointer. Every value comes from the theme's roles.
 */
export function surfaceCss(theme: Theme): string {
  if (theme.skin.card !== "soft") return "";
  const id = theme.meta.id;
  const h = `html[data-design="${id}"]`;
  const decl = (scheme: Scheme) => {
    const c = theme.color[scheme];
    const dark = scheme === "dark";
    // The theme's own canvas once it differs from its cards, else the warm inset a step under them.
    const page = c.canvas !== c.surface ? c.canvas : c.surfaceInset;
    const card = lighter(c.surface, c.surfaceMuted);
    // Tracks and page-top pills sit on the page itself, so they take the deeper of the two wells.
    const sunken = dark ? c.canvasSunken : darker(c.canvasSunken, c.surfaceInset);
    const vars: Record<string, string> = {
      "--ui-canvas": toTriplet(page),
      "--ui-canvas-sunken": toTriplet(sunken),
      "--color-bg": toTriplet(page),
      "--color-bg-subtle": toTriplet(sunken),
      "--lf-paper": page,
      "--lf-cream-deep": sunken,
      "--ui-card": card,
      "--ui-card-nested": composite(withAlpha(page, 0.5), card),
      "--ui-card-edge": c.hairline,
      "--ui-card-shadow": theme.shadow[scheme].sm,
      "--ui-card-shadow-hover": theme.shadow[scheme].md,
      "--ui-row-hover": dark ? c.surfaceRaised : composite(withAlpha(page, 0.6), card),
      // The sidebar is a panel beside the warm page, edged on its page side.
      "--ui-sidebar": card,
    };
    // A hero's edge and row hover: a deeper shade of its own tint, so any tint (a new wealth color too) gets one.
    for (const [role, t] of Object.entries(c.tint)) {
      vars[`--ui-tint-${role}-edge`] = composite(withAlpha(t.ink, dark ? 0.3 : 0.16), t.fill);
      vars[`--ui-tint-${role}-hover`] = composite(withAlpha(t.ink, dark ? 0.14 : 0.07), t.fill);
    }
    return Object.entries(vars)
      .map(([k, v]) => `${k}:${v}!important`)
      .join(";");
  };
  // Every clickable card lifts, heroes too: the same frame, the same response.
  const lift = `:is(:is(a,button,[role="button"],article.g-rise,.cursor-pointer)${CARD},:is(a,button,[role="button"],.cursor-pointer)[data-hero])`;
  return (
    `html:root[data-design="${id}"]{${decl("light")}}html:root.dark[data-design="${id}"]{${decl("dark")}}` +
    `${h} :is(${CARD},[data-hero]){transition:box-shadow .15s ease,translate .15s ease}` +
    // A white panel beside the warm page: no top wash (the Classic sidebar fades its sunken fill in), edged on the page side.
    `${h} [data-sidebar]{background-color:var(--ui-sidebar)!important;border-right-color:var(--ui-card-edge)!important}${h} [data-sidebar]>aside{background-image:none!important}` +
    // Every card answers the pointer the same way (its shadow deepens), heroes included; a clickable one also lifts.
    `${h} :is(${CARD},[data-hero]):not([data-hero-frame]):not(${CARD} ${CARD}):hover{box-shadow:var(--ui-card-shadow-hover)!important}` +
    // translate, not transform: entrance animations hold transform, and translate composes with them.
    `@media (prefers-reduced-motion:no-preference){${h} ${lift}:hover{translate:0 -1px}}` +
    // Rows inside a card tint on hover, a step off the card rather than the darker page track.
    // One warm tint everywhere: rows the web marks with the brand hover (Accounts, Journey) take it too, never basil,
    // wherever they sit. A hero's rows outrank this with their own tint (heroCss is more specific).
    `${h} ${CARD}:not([data-hero]) [class*="hover:bg-canvas-sunken"]:hover,${h} [class*="hover:bg-brand-softer"]:hover,${h} article[data-action-id]:hover{background-color:var(--ui-row-hover)!important}`
  );
}
