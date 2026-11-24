import { createContext, useContext, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { composite, withAlpha, type TintRole } from "@lasagna/design";
import { useTheme as useDesign } from "@/design";
import { space, themedStyles, type, useTheme, weight } from "@/theme";
import { Skeleton } from "./Skeleton";

/**
 * How far a card's or section's title grows with the text size setting: enough
 * to stay at least as large as the body text it heads (about 1.94x at the
 * accessibility sizes), short of outgrowing the amounts inside the card.
 */
export const CARD_TITLE_MAX_SCALE = 1.8;

/**
 * The app's one card. `nested` is a card inside another card (a smaller
 * radius, no padding of its own). `wash` adds the web card's soft corner tint,
 * on an edged panel only: a soft card is already its own quiet fill.
 *
 * Skins: `outlined` (a panel with a hairline edge), `soft` (the soft card
 * fill with a warm edge and a barely there shadow, lifted off the page, and a
 * nested card in the page's own color), `flat` (a panel, no edge), `offset` (a
 * panel with an ink outline and a hard shadow). A hero wears its role fill,
 * framed like every other card under the soft skin, in a deeper shade of its
 * own tint (heroEdge), so every card on a screen has the same edge.
 *
 * `hero` marks the screen's one summary card and names what the screen is
 * about (net worth, spending, money in, goals), so it wears that role's fill.
 * Every other card stays on the plain surface: one hero per screen (owner
 * decision 2026-11-23). A theme without role colors maps every role to its
 * plain card. Labels on it take `color.tint[role].ink`.
 */
export function Card({ children, style, wash, nested, hero }: { children: ReactNode; style?: StyleProp<ViewStyle>; wash?: string; nested?: boolean; hero?: TintRole }) {
  const d = useDesign();
  const c = d.color;
  const skin = d.skin.card;
  const inHero = useContext(InHero) !== null;
  // A soft nested card is a tile set into its card: the plain surface on a hero's tint, the page's own color on a plain card.
  const fill = hero ? c.tint[hero].fill : skin === "soft" ? (nested ? (inHero ? c.surface : c.canvas) : c.surfaceMuted) : c.surface;
  const edge =
    skin === "soft"
      ? nested
        ? null
        : { borderWidth: 1, borderColor: hero ? heroEdge(c.tint[hero], d.scheme === "dark") : c.hairline, boxShadow: d.shadow.sm }
      : skin === "outlined"
      ? { borderWidth: StyleSheet.hairlineWidth, borderColor: nested ? c.line : c.hairline }
      : skin === "offset"
        ? { borderWidth: d.stroke.outline, borderColor: c.content, boxShadow: nested ? undefined : `3px 3px 0 ${c.content}` }
        : null;
  return (
    <View
      style={[
        nested ? styles.nested : styles.card,
        { backgroundColor: fill, borderRadius: nested ? d.radius.md : d.radius.lg },
        edge,
        wash && skin !== "soft" ? { experimental_backgroundImage: wash } : null,
        style,
      ]}
    >
      {hero ? <InHero.Provider value={hero}>{children}</InHero.Provider> : children}
    </View>
  );
}

/** A hero's edge: its own ink laid over its fill, so any tint (a new one too) gets a deeper shade of itself. */
export function heroEdge(tint: { fill: string; ink: string }, dark: boolean): string {
  return composite(withAlpha(tint.ink, dark ? 0.3 : 0.16), tint.fill);
}

/** The hero a card or row sits inside, if any, so a nested tile or a pressed row picks a fill that reads on the tint. */
const InHero = createContext<TintRole | null>(null);

/** The tint role of the hero this sits inside, or null. */
export function useHeroRole(): TintRole | null {
  return useContext(InHero);
}

/**
 * The fill a pressed row takes: a step off its hero's tint inside a hero (a
 * deeper shade of that tint, like the hero's edge but lighter), else the
 * page's sunken fill.
 */
export function usePressFill(): string {
  const role = useContext(InHero);
  const d = useDesign();
  if (!role || d.skin.card !== "soft") return d.color.canvasSunken;
  const t = d.color.tint[role];
  return composite(withAlpha(t.ink, d.scheme === "dark" ? 0.14 : 0.07), t.fill);
}

/** A plain text link in the brand ink, with a touch target of at least 44pt. */
export function TextLink({ title, onPress, label, muted, disabled }: { title: string; onPress: () => void; label?: string; muted?: boolean; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="link"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}
    >
      <Text style={[styles.link, { color: muted ? t.contentSecondary : t.brandInk }]}>{title}</Text>
    </Pressable>
  );
}

/** A card's title row, with an optional link on the right ("View all" for the full list). */
export function CardHeader({ title, link }: { title: string; link?: { title: string; onPress: () => void; label?: string } }) {
  const t = useTheme();
  // Large text leaves no room for both on one line, so the link moves under the title.
  const stacked = useWindowDimensions().fontScale > 1.3;
  return (
    <View style={[styles.header, stacked && styles.headerStacked]}>
      {/* A title stops growing at 1.2x, like the segmented control, so it never outgrows the figures under it. */}
      <Text style={[styles.title, { color: t.content }]} accessibilityRole="header" maxFontSizeMultiplier={CARD_TITLE_MAX_SCALE}>
        {title}
      </Text>
      {link ? <TextLink {...link} /> : null}
    </View>
  );
}

/** A card's outline while its content loads: a title bar and a few lines. */
export function CardSkeleton({ lines = 3, nested, style }: { lines?: number; nested?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Card nested={nested} style={[{ gap: 12 }, nested && { padding: 14 }, style]}>
      <Skeleton width="40%" height={18} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={12} />
      ))}
    </Card>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: { padding: space.card, overflow: "hidden" },
  nested: { overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headerStacked: { flexDirection: "column", alignItems: "flex-start", gap: 6 },
  title: { ...type.title, flexShrink: 1 },
  link: { ...type.subhead, ...weight.semibold },
}));
