import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { inputType, radius, themedStyles, type, useTheme, weight } from "@/theme";

export function TextField({
  label,
  hint,
  error,
  hintIsError,
  invalid: flagged,
  style,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** The form's error (shown in its banner) is about this field: outline it, without repeating the words. */
  invalid?: boolean;
  /** The hint itself is what went wrong, so it turns red instead of being repeated as an error. */
  hintIsError?: boolean;
}) {
    const t = useTheme();
    const invalid = !!error || !!hintIsError || !!flagged;
    return (
      <View style={styles.wrap}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: t.contentSecondary }]}>{label}</Text>
          {hint ? <Text style={[styles.hint, { color: hintIsError ? t.negative : t.contentMuted }]}>{hint}</Text> : null}
        </View>
        <TextInput
          placeholderTextColor={t.contentFaint}
          keyboardAppearance={t.keyboard}
          selectionColor={t.brandInk}
          accessibilityLabel={label}
          accessibilityHint={hint}
          style={[
            styles.input,
            { color: t.content, backgroundColor: t.panel, borderColor: invalid ? t.negative : t.line },
            style,
          ]}
          {...props}
        />
        {error ? <Text style={[styles.error, { color: t.negative }]}>{error}</Text> : null}
      </View>
    );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  label: { ...type.subhead, ...weight.medium },
  hint: { ...type.footnote },
  input: { ...inputType, minHeight: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 14 },
  error: { ...type.footnote },
}));
