import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Chip } from "@/ui/Chip";
import { RefreshMascot } from "@/ui/PullRefresh";

/** What to ask first (the web's chat-thread-list.tsx DEFAULT_PROMPTS). */
export const STARTER_PROMPTS = ["Summarize my financial situation", "What should I focus on this month?", "Where am I losing money?"];

/**
 * A conversation with nothing in it yet (the web's NewChatHero): the theme's
 * happy mascot where its empty art is the mascot, else the assistant's
 * sparkle tile, the invitation, and ready questions as the theme's chips.
 */
export function ChatIntro({ onAsk }: { onAsk: (prompt: string) => void }) {
  const t = useTheme();
  const d = useDesign();
  const mascot = d.skin.emptyArt === "mascot" && !!d.mascot;
  return (
    <View style={styles.wrap}>
      {mascot ? (
        // The page's one mascot is also the pull to refresh's, so none comes down from the bar.
        <RefreshMascot width={112} />
      ) : (
        <View style={[styles.tile, { backgroundColor: t.accentSoft, borderRadius: d.radius.lg }]}>
          <SymbolView name="sparkles" size={icon.lg} tintColor={t.accentInk} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
      )}
      <Text style={[styles.title, { color: t.content }]} accessibilityRole="header">
        Ask anything about your finances
      </Text>
      <Text style={[styles.body, { color: t.contentMuted }]}>I can analyze your accounts, spending, and plans, then walk you through what to do next.</Text>
      <View style={styles.prompts}>
        <Text style={[styles.label, { color: t.contentMuted }]}>Try asking</Text>
        <View style={styles.chips}>
          {STARTER_PROMPTS.map((p) => (
            <Chip key={p} label={p} icon="arrow.up.right" wrap onPress={() => onAsk(p)} accessibilityLabel={`Ask: ${p}`} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.lg, gap: space.sm },
    tile: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
    title: { ...type.title1, textAlign: "center" },
    body: { ...type.callout, ...weight.medium, textAlign: "center", maxWidth: 340 },
    prompts: { alignSelf: "stretch", alignItems: "center", gap: space.md, marginTop: space.lg },
    label: { ...type.footnote, ...weight.semibold },
    chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.sm },
  }),
);
