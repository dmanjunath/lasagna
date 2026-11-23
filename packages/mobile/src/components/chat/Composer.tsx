import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { icon, space, themedStyles, type, useTheme } from "@/theme";

/**
 * The message field, pinned at the foot of a conversation: it grows to five
 * lines, Return makes a new line and the arrow sends. While an answer is on
 * its way the arrow becomes Stop. The field and button match Home's Ask card.
 */
export function Composer({ onSend, onStop, pending = false, placeholder, autoFocus }: { onSend: (text: string) => void; onStop?: () => void; pending?: boolean; placeholder: string; autoFocus?: boolean }) {
  const t = useTheme();
  const d = useDesign();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const text = value.trim();
  const canSend = !!text && !pending;
  const send = () => {
    if (!canSend) return;
    setValue("");
    onSend(text);
  };
  return (
    <View style={[styles.bar, { backgroundColor: t.canvas, borderTopColor: t.line }]}>
      <View style={[styles.field, { backgroundColor: t.panel, borderColor: focused ? t.brandInk : t.lineStrong, borderRadius: d.radius.lg }]}>
        <TextInput
          value={value}
          onChangeText={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={t.contentMuted}
          keyboardAppearance={t.keyboard}
          selectionColor={t.brandInk}
          multiline
          autoFocus={autoFocus}
          autoCorrect
          accessibilityLabel="Message"
          style={[styles.input, { color: t.content }]}
        />
        {pending && onStop ? (
          <Pressable onPress={onStop} accessibilityRole="button" accessibilityLabel="Stop" style={({ pressed }) => [styles.send, { backgroundColor: t.content, opacity: pressed ? 0.7 : 1 }]}>
            <SymbolView name="stop.fill" size={icon.sm} tintColor={t.canvas} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        ) : (
          <Pressable
            onPress={send}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            style={({ pressed }) => [styles.send, { backgroundColor: canSend ? t.brandInk : t.canvasSunken, opacity: pressed ? 0.7 : 1 }]}
          >
            <SymbolView name="arrow.up" size={icon.md} weight="bold" tintColor={canSend ? t.brandFg : t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    bar: { paddingHorizontal: space.screen, paddingTop: space.sm, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
    field: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, borderWidth: 1.5, paddingLeft: space.lg, paddingRight: 4, paddingVertical: 4 },
    // Five lines at most, then it scrolls inside.
    input: { ...type.body, flex: 1, minHeight: 44, maxHeight: 132, paddingTop: 11, paddingBottom: 11 },
    send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  }),
);
