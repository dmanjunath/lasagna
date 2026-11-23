import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { icon, themedStyles, type, useTheme } from "@/theme";
import { Card } from "@/ui/Card";
import { Mascot } from "@/ui/Mascot";
import { Sparkle } from "@/ui/Sparkle";

/**
 * The Actions page's closing card. `celebrate` (the list is truly clear) adds
 * its one celebration: the theme's mascot, happy, else a check on the brand
 * tint, with sparkles per the `celebration` skin. While actions remain it is
 * words only.
 */
export function CaughtUpCard({ title, body, celebrate }: { title: string; body: string; celebrate: boolean }) {
  const t = useTheme();
  const d = useDesign();
  return (
    <Card style={styles.card}>
      {celebrate ? (
      <View style={styles.art}>
        <View style={styles.sparkleLeft}>
          <Sparkle size={18} />
        </View>
        {d.mascot ? (
          <Mascot name="happy" width={96} />
        ) : (
          <View style={[styles.check, { backgroundColor: t.brandSoft }]}>
            <SymbolView name="checkmark" size={icon.lg} weight="bold" tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" />
          </View>
        )}
        <View style={styles.sparkleRight}>
          <Sparkle size={24} />
        </View>
      </View>
      ) : null}
      <Text style={[styles.title, { color: t.content }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.body, { color: t.contentMuted }]}>{body}</Text>
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { alignItems: "center", gap: 6, paddingVertical: 24 },
    art: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
    sparkleLeft: { alignSelf: "flex-end", marginRight: 4 },
    sparkleRight: { alignSelf: "flex-start", marginLeft: 4 },
    check: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
    title: { ...type.title, textAlign: "center" },
    body: { ...type.subhead, textAlign: "center" },
  }),
);
