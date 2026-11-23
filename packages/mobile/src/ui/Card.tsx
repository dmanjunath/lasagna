import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import type { TintRole } from "@lasagna/design";
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
 * Skins: `outlined` (a panel with a hairline edge), `soft` (a quiet filled
 * surface, no edge, and a nested card in the page's own color), `flat` (a
 * panel, no edge), `offset` (a panel with an ink outline and a hard shadow).
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
  const fill = hero ? c.tint[hero].fill : skin === "soft" ? (nested ? c.surface : c.surfaceMuted) : c.surface;
  const edge =
    skin === "outlined"
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
      {children}
    </View>
  );
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
