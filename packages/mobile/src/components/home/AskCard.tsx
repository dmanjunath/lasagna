import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { icon, inputType, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Card, CardHeader } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

/**
 * A question box and a few ready questions. Sending either switches to the
 * chat tab and asks there, so the answer lives in the chat history. Named
 * as the chat screen is, which the theme names.
 */
export function AskCard({ prompts, onAsk }: { prompts: Array<{ label: string; prompt: string }>; onAsk: (text: string) => void }) {
  const t = useTheme();
  const { chatTitle } = useDesign();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const text = value.trim();
  const submit = () => {
    if (!text) return;
    setValue("");
    onAsk(text);
  };
  return (
    <Card style={{ gap: 12 }}>
      <CardHeader title={chatTitle} />
      <View style={[styles.field, { backgroundColor: t.panel, borderColor: focused ? t.brandInk : t.line }]}>
        <TextInput
          value={value}
          onChangeText={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={submit}
          placeholder="Ask about your money"
          placeholderTextColor={t.contentMuted}
          keyboardAppearance={t.keyboard}
          selectionColor={t.brandInk}
          returnKeyType="send"
          enablesReturnKeyAutomatically
          autoCorrect
          accessibilityLabel="Your question"
          style={[styles.input, { color: t.content }]}
        />
        <Pressable
          onPress={submit}
          disabled={!text}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !text }}
          style={({ pressed }) => [styles.send, { backgroundColor: text ? t.brandInk : t.canvasSunken, opacity: pressed ? 0.7 : 1 }]}
        >
          <SymbolView name="arrow.up" size={icon.md} weight="bold" tintColor={text ? t.brandFg : t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      </View>
      {prompts.length > 0 ? (
        <View style={styles.prompts}>
          {prompts.map((p) => (
            <Chip key={p.label} label={p.label} icon="bubble.left" onCard onPress={() => onAsk(p.prompt)} accessibilityLabel={`Ask: ${p.label}`} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Pages worth a tap from home that no card above already links to, named by where they go. */
export function ShortcutsCard({ links, onOpen }: { links: Array<{ id: string; label: string; href: string }>; onOpen: (href: string) => void }) {
  const t = useTheme();
  if (links.length === 0) return null;
  return (
    <Card style={{ gap: 4 }}>
      <CardHeader title="Shortcuts" />
      {links.map((l, i) => (
        <Pressable
          key={l.id}
          onPress={() => onOpen(l.href)}
          accessibilityRole="link"
          accessibilityLabel={l.label}
          style={({ pressed }) => [styles.link, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Text style={[styles.linkLabel, { color: t.content }]}>{l.label}</Text>
          <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      ))}
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    field: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, borderRadius: radius.pill, borderWidth: 1.5, paddingLeft: 18, paddingRight: 4 },
    input: { ...inputType, flex: 1, minHeight: 48 },
    send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    prompts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    link: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
    linkLabel: { ...type.callout, ...weight.medium, flex: 1 },
  }),
);
