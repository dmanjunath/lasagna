import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { icon, themedStyles, type, useTheme, weight } from "@/theme";
import { TextLink } from "./Card";

type Tone = "caution" | "negative" | "info";

const SYMBOL: Record<Tone, SFSymbol> = {
  caution: "exclamationmark.triangle.fill",
  negative: "exclamationmark.circle.fill",
  info: "info.circle.fill",
};

/**
 * A notice about the page's data, at the top of what it concerns (the web's
 * Alert): a connection that needs to reconnect, a value still being
 * estimated. A tinted panel with the tone's glyph, a title, an optional line
 * of body, at most one action, and an optional close.
 */
export function Banner({
  tone,
  title,
  body,
  action,
  onDismiss,
}: {
  tone: Tone;
  title: string;
  body?: string;
  action?: { title: string; onPress: () => void; label?: string };
  onDismiss?: () => void;
}) {
  const t = useTheme();
  const d = useDesign();
  const fill = tone === "caution" ? t.cautionSoft : tone === "negative" ? t.negativeSoft : t.infoSoft;
  const ink = tone === "caution" ? t.caution : tone === "negative" ? t.negative : t.info;
  return (
    <View style={[styles.banner, { backgroundColor: fill, borderRadius: d.radius.md }]} accessibilityRole="alert">
      <SymbolView name={SYMBOL[tone]} size={icon.md} tintColor={ink} accessibilityElementsHidden importantForAccessibility="no" style={styles.glyph} />
      <View style={styles.main}>
        <Text style={[styles.title, { color: t.content }]}>{title}</Text>
        {body ? <Text style={[styles.body, { color: t.contentSecondary }]}>{body}</Text> : null}
        {action ? (
          <View style={styles.action}>
            <TextLink title={action.title} label={action.label} onPress={action.onPress} />
          </View>
        ) : null}
      </View>
      {onDismiss ? (
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12} style={styles.close}>
          <SymbolView name="xmark" size={icon.sm} weight="semibold" tintColor={t.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    banner: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
    glyph: { marginTop: 1 },
    main: { flex: 1, gap: 2 },
    title: { ...type.subhead, ...weight.semibold },
    body: { ...type.footnote },
    action: { alignSelf: "flex-start", marginTop: 6 },
    close: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  }),
);
