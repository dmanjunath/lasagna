import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { icon, themedStyles, type, useTheme, weight } from "@/theme";

/** Offered under a row right after its category changed: make the move a rule. */
function CreateRuleBarBase({
  merchantText,
  categoryLabel,
  onCreate,
  onDismiss,
}: {
  merchantText: string;
  categoryLabel: string;
  onCreate: () => void;
  onDismiss: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: t.brandSofter }]}>
      <View style={styles.main}>
        <Text style={[styles.text, { color: t.contentMuted }]}>
          Always categorize “{merchantText}” as <Text style={[weight.semibold, { color: t.content }]}>{categoryLabel}</Text>?
        </Text>
        <Pressable onPress={onCreate} accessibilityRole="button" accessibilityLabel="Create rule" hitSlop={8} style={({ pressed }) => [styles.create, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.createText, { color: t.brandInk }]}>Create rule</Text>
          <SymbolView name="arrow.right" size={icon.xs} weight="semibold" tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      </View>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={10} style={styles.dismiss}>
        <SymbolView name="xmark" size={icon.sm} weight="semibold" tintColor={t.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
    </View>
  );
}

export const CreateRuleBar = memo(CreateRuleBarBase);

const styles = themedStyles(() => StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 8, paddingVertical: 10 },
  main: { flex: 1, gap: 6 },
  text: { ...type.subhead },
  create: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 32 },
  createText: { ...type.subhead, ...weight.semibold },
  dismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
}));
