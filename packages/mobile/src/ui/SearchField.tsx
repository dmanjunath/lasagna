import { SymbolView } from "expo-symbols";
import { StyleSheet, TextInput, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { inputType, space, themedStyles } from "@/theme";
import { TextLink } from "./Card";

/** A list's own search, at the top of a picker page: the system search field's look, in the theme's colors. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const d = useDesign();
  const c = d.color;
  return (
    <View style={[styles.field, { backgroundColor: c.surfaceInset, borderRadius: d.radius.md }]}>
      <SymbolView name="magnifyingglass" size={d.icon.size.sm} tintColor={c.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.contentFaint}
        selectionColor={c.brandInk}
        accessibilityLabel={placeholder}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        autoCapitalize="none"
        style={[styles.input, { color: c.content }]}
      />
    </View>
  );
}

/** Select all and Select none for a multi-select list: two text buttons, the shown rows only while a search narrows them. */
export function SelectAllRow({ onAll, onNone, allDisabled, noneDisabled }: { onAll: () => void; onNone: () => void; allDisabled?: boolean; noneDisabled?: boolean }) {
  return (
    <View style={styles.selectRow}>
      <TextLink title="Select all" onPress={onAll} disabled={allDisabled} />
      <TextLink title="Select none" onPress={onNone} disabled={noneDisabled} />
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    field: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, minHeight: 40 },
    input: { ...inputType, flex: 1, minHeight: 40 },
    // The links line up with the rows' text under them.
    selectRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 16, paddingHorizontal: space.rowInset },
  }),
);
