import type { Scheme, Theme } from "@lasagna/design";
import { toCss } from "@lasagna/design/build/toCss";

// The active design system, handed to the hosted web app in the web fallback
// so a web page looks like the native screens around it: the theme's --ui-*
// variables (packages/design toCss, the same ones the web's theme.css names),
// data-design and .dark on <html>, and the theme's fonts.

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
  return toCss(theme).replace(/^\[data-design=/gm, "html[data-design=") + numeralsCss(theme) + FONT_CSS + skinCss(theme) + titleCss(theme);
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
      // Flat fills for chart segments (the debt bar's gloss).
      `${h} [role="img"]>div[style*="linear-gradient"]{background-image:none!important}`,
      `${h} [role="img"][style*="inset"]{box-shadow:none!important}`,
    );
  }
  if (button !== "rounded") {
    out.push(`${h} :is(${PRIMARY}),${h} ${SECONDARY}{border-radius:var(--ui-r-pill)!important}`);
    if (button === "chunky") out.push(`${h} :is(${PRIMARY}){box-shadow:0 4px 0 rgb(var(--ui-brand-edge))!important;margin-bottom:4px}`);
  }
  if (chip === "filled") out.push(`${h} ${CHIP}{background-color:rgb(var(--ui-surface-muted))!important;border-color:transparent!important;border-radius:var(--ui-r-pill)!important}`);
  // The goal cards' left rail is the accent-bar skin.
  if (actionCard !== "accentBar") out.push(`${h} article.g-rise>span.absolute.inset-y-0.left-0{display:none!important}`);
  out.push(segmentedCss(theme), headingCss(theme), chatListCss(theme));
  return out.join("");
}

/** A card's look under the theme's card skin, as declarations. */
function cardDecl(theme: Theme): string {
  switch (theme.skin.card) {
    case "soft":
      return "background-color:rgb(var(--ui-surface-muted));border:0;box-shadow:none";
    case "flat":
      return "background-color:rgb(var(--ui-panel));border:0;box-shadow:none";
    case "offset":
      return "background-color:rgb(var(--ui-panel));border:var(--ui-stroke-outline) solid rgb(var(--ui-content));box-shadow:3px 3px 0 rgb(var(--ui-content))";
    default:
      return "background-color:rgb(var(--ui-panel));border:1px solid var(--ui-line);box-shadow:var(--ui-shadow-sm)";
  }
}

/**
 * The web's segmented control (uikit SegmentedControl) as the native one:
 * the full width, a sunken track, 44pt segments, the selected one raised on
 * the theme's thumb. A capsule where the chip skin is filled, else rounded.
 */
function segmentedCss(theme: Theme): string {
  const h = `html[data-design="${theme.meta.id}"]`;
  const r = theme.skin.chip === "filled" ? "var(--ui-r-pill)" : "var(--ui-r-sm)";
  const seg = `${h} main [role="radiogroup"].bg-canvas-sunken`;
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

/** Sets (or clears) the page's in-content title. Runs before load and again on a title change. */
export function titleScript(title: string, root: boolean): string {
  const t = JSON.stringify(title);
  return `(function(){var h=document.documentElement;
  if(${t}){h.style.setProperty('--lf-title',${JSON.stringify(JSON.stringify(title))});h.setAttribute('data-lf-title','');}else{h.removeAttribute('data-lf-title');}
  h.classList.toggle('lf-root',${root});})();`;
}

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

// packages/web/src/components/uikit/mode.ts's key. The web app reads it at boot
// to choose light or dark, so it follows the app rather than its own default.
const MODE_KEY = "lf-ui-mode";

/**
 * Applies a theme and scheme to the page: before it loads (the elements go
 * into <html> and move to the end of <head> once it exists, so they come
 * after the web's stylesheet), and again on any later change without a reload.
 */
export function designScript(theme: Theme, scheme: Scheme): string {
  const args = JSON.stringify({ id: theme.meta.id, dark: scheme === "dark", css: themeCss(theme), fonts: fontsUrl(theme), assistant: theme.mascot?.name ?? null });
  return `(function(d){
  try{localStorage.setItem('${MODE_KEY}',d.dark?'dark':'light')}catch(e){}
  var h=document.documentElement;
  h.setAttribute('data-design',d.id);
  // The assistant's name in the web's copy ("Ask Noodle"): the theme's mascot, else the web's own default.
  if(d.assistant)h.setAttribute('data-assistant',d.assistant);else h.removeAttribute('data-assistant');
  // Marks the page as running inside the iOS app, so the web hands chat requests to the native Chat tab.
  h.setAttribute('data-shell','native');
  h.classList.toggle('dark',d.dark);
  h.style.colorScheme=d.dark?'dark':'light';
  var s=document.getElementById('lf-design');
  if(!s){s=document.createElement('style');s.id='lf-design';}
  s.textContent=d.css;
  var l=document.getElementById('lf-design-fonts');
  if(!l){l=document.createElement('link');l.id='lf-design-fonts';l.rel='stylesheet';window.__lfFontsCss=new Promise(function(r){l.onload=r;l.onerror=r;});}
  if(l.getAttribute('href')!==d.fonts)l.setAttribute('href',d.fonts);
  function place(){var p=document.head||h;p.appendChild(l);p.appendChild(s);}
  place();
  if(!document.head||document.readyState==='loading')document.addEventListener('DOMContentLoaded',place,{once:true});
})(${args});`;
}
