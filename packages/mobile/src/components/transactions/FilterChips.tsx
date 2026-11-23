import * as Haptics from "expo-haptics";
import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { EMPTY_FILTERS, type FilterChip, type TxnFilters } from "@/lib/txn-filters";
import { space, themedStyles, type, useTheme, weight } from "@/theme";
import { Chip } from "@/ui/Chip";

/** The active filters, each removable, plus Clear all once there are two or more, in one row that scrolls sideways. */
function FilterChipsBase({ chips, onChange }: { chips: FilterChip[]; onChange: (f: TxnFilters) => void }) {
  const t = useTheme();
  if (chips.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.wrap}>
      {chips.map((c) => (
        <Chip key={c.key} label={c.label} tone={c.tone === "brand" ? "brand" : undefined} icon="xmark" accessibilityLabel={c.removeLabel} onPress={() => (c.onRemove ? c.onRemove() : onChange(c.next))} />
      ))}
      {chips.length >= 2 ? (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            onChange(EMPTY_FILTERS);
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          hitSlop={{ top: 6, bottom: 6 }}
          style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.clearText, { color: t.brandInk }]}>Clear all</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export const FilterChips = memo(FilterChipsBase);

const styles = themedStyles(() => StyleSheet.create({
  // Runs to the screen's edges, past the page's gutter.
  scroll: { marginHorizontal: -space.screen, flexGrow: 0 },
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: space.screen },
  clear: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  clearText: { ...type.subhead, ...weight.semibold },
}));
