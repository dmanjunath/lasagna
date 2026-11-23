import type { ColorRoles, Skins, TintRole } from "./schema";

// Every text (or icon) color a component draws, and every background it draws
// it on. The theme tests hold each pair to WCAG AA in light and dark: 4.5:1 for
// body text, 3:1 for large text. A translucent background is first laid over
// each surface it can sit on.

type Role = Exclude<keyof ColorRoles, "category" | "chart" | "tint">;

export type ContrastPair = {
  text: Role;
  on: Role;
  over?: Role;
  min: number;
  why: string;
  /** Only for themes whose skins draw this pairing. */
  when?: (skin: Skins) => boolean;
};

const BODY = 4.5;

/** The opaque surfaces text sits on directly. */
const SURFACES: Role[] = ["canvas", "surface", "surfaceRaised", "surfaceMuted"];

const onSurfaces = (text: Role, why: string): ContrastPair[] => SURFACES.map((on) => ({ text, on, min: BODY, why }));

/** A soft card or filled chip sits on surfaceMuted, so tints land on it too. */
const mutedCards = (skin: Skins) => skin.card === "soft" || skin.chip === "filled";

/** A soft tint with its ink, over the surfaces a tinted chip or card can sit on. */
const tinted = (text: Role, tint: Role, why: string): ContrastPair[] => [
  { text, on: tint, over: "canvas", min: BODY, why },
  { text, on: tint, over: "surface", min: BODY, why },
  { text, on: tint, over: "surfaceMuted", min: BODY, why, when: mutedCards },
];

export const CONTRAST_PAIRS: ContrastPair[] = [
  ...onSurfaces("content", "body text"),
  ...onSurfaces("contentSecondary", "supporting text"),
  ...onSurfaces("contentMuted", "meta text, section headers"),
  ...onSurfaces("brandInk", "links, plain buttons, sheet bar actions"),
  ...onSurfaces("accentInk", "accent text"),
  ...onSurfaces("positive", "gains"),
  ...onSurfaces("negative", "losses, field errors"),
  ...onSurfaces("caution", "warnings"),
  ...onSurfaces("info", "info text"),
  ...onSurfaces("sky", "sky tone text"),
  ...onSurfaces("violet", "violet tone text"),
  ...onSurfaces("slate", "slate tone text"),
  { text: "contentSecondary", on: "canvasSunken", min: BODY, why: "segmented control labels" },
  { text: "contentMuted", on: "canvasSunken", min: BODY, why: "text on a well" },
  { text: "content", on: "highlight", min: BODY, why: "sticky-note text" },
  { text: "contentMuted", on: "highlight", min: BODY, why: "sticky-note meta" },
  { text: "brandInk", on: "highlight", min: BODY, why: "sticky-note link" },
  { text: "caution", on: "cautionSoft", over: "highlight", min: BODY, why: "a chip on a sticky note" },
  { text: "onBrand", on: "brandInk", min: BODY, why: "primary button label" },
  { text: "onDanger", on: "dangerSolid", min: BODY, why: "destructive button label" },
  { text: "onSelected", on: "selected", over: "canvas", min: BODY, why: "a chosen chip or pill on the page" },
  { text: "onSelected", on: "selected", over: "surface", min: BODY, why: "a chosen chip on a card" },
  { text: "onThumb", on: "thumb", over: "canvasSunken", min: BODY, why: "a segmented control's chosen label" },
  ...tinted("brandInk", "brandSoft", "brand chip, active tab pill"),
  ...tinted("positive", "positiveSoft", "gain chip"),
  ...tinted("negative", "negativeSoft", "loss chip, error state icon"),
  ...tinted("caution", "cautionSoft", "warning chip"),
  ...tinted("info", "infoSoft", "info chip"),
  ...tinted("accentInk", "accentSoft", "accent chip"),
  ...tinted("sky", "skySoft", "sky chip"),
  ...tinted("violet", "violetSoft", "violet chip"),
  ...tinted("slate", "slateSoft", "slate chip"),
];

/**
 * What a component draws on a role tint's fill (a tinted card, tile or pill):
 * body text stays `content`, and links and gain or loss figures keep their
 * own colors. The tint's own `ink` (its labels and icons) is checked too.
 * A translucent fill is laid over the page and over a card.
 */
export const ON_TINT: Array<{ text: Role | "ink"; why: string }> = [
  { text: "content", why: "figures and body text on a tinted card" },
  { text: "contentSecondary", why: "supporting text on a tinted card" },
  { text: "contentMuted", why: "meta text on a tinted card" },
  { text: "brandInk", why: "a link on a tinted card" },
  { text: "positive", why: "a gain on a tinted card" },
  { text: "negative", why: "a loss on a tinted card" },
  { text: "ink", why: "the tint's own label and icon ink" },
];

export const TINT_UNDER: Role[] = ["canvas", "surface"];

export type { TintRole };
