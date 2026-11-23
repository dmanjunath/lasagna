import { MenuView, type NativeActionEvent } from "@react-native-menu/menu";
import { withAlpha } from "@lasagna/design";
import { SymbolView } from "expo-symbols";
import { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useTheme as useDesign } from "@/design";
import { hideIdCitations } from "@/lib/chat-text";
import type { ChatTurn } from "@/lib/chat-store";
import { copyText } from "@/lib/clipboard";
import { maskCurrencyInText } from "@/lib/hide-amounts";
import { icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { showToast } from "@/ui/Toast";
import { ChatMarkdown } from "./ChatMarkdown";

/** The assistant's mark beside each reply, so the thread reads as a dialogue (the web's AssistantAvatar). */
function Avatar() {
  const t = useTheme();
  return (
    <View style={[styles.avatar, { backgroundColor: t.accentSoft }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SymbolView name="sparkles" size={icon.sm} tintColor={t.accentInk} />
    </View>
  );
}

/** Long press offers Copy, as Messages does. */
function Copyable({ text, children }: { text: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <MenuView
      shouldOpenOnLongPress
      actions={[{ id: "copy", title: "Copy", image: "doc.on.doc", imageColor: t.content }]}
      onPressAction={({ nativeEvent }: NativeActionEvent) => {
        if (nativeEvent.event !== "copy") return;
        copyText(text);
        showToast({ tone: "positive", title: "Copied" });
      }}
    >
      {children}
    </MenuView>
  );
}

/**
 * One turn of a thread, as the web's message-bubble.tsx draws it: the
 * person's question on the right in a brand-tinted bubble, the answer on the
 * left beside the assistant's mark, on the theme's card. A turn that did not
 * arrive is a distinct error bubble whose button looks for the stored reply.
 * `hidden` is read so the masked copy redraws when amounts hide.
 */
export const MessageBubble = memo(function MessageBubble({
  message: m,
  hidden,
  onRetry,
  checking,
}: {
  message: ChatTurn;
  hidden: boolean;
  /** Only the newest turn may offer recovery: it acts on the last question. */
  onRetry?: () => void;
  checking?: boolean;
}) {
  const t = useTheme();
  const d = useDesign();
  void hidden;

  if (m.role === "user") {
    const text = maskCurrencyInText(m.content);
    return (
      <View style={styles.userRow}>
        <Copyable text={text}>
          <View
            style={[
              styles.userBubble,
              { backgroundColor: t.brandSoft, borderColor: withAlpha(t.brand, 0.3), borderRadius: d.radius.lg, borderBottomRightRadius: d.radius.xs },
            ]}
            accessible
            accessibilityLabel={`You: ${text}`}
            accessibilityHint="Long press to copy."
          >
            <Text style={[styles.userText, { color: t.content }]}>{text}</Text>
          </View>
        </Copyable>
      </View>
    );
  }

  if (m.status === "stopped") {
    return (
      <View style={styles.assistantRow}>
        <Avatar />
        <Text style={[styles.stopped, { color: t.contentMuted }]}>You stopped this answer.</Text>
      </View>
    );
  }

  if (m.status === "error") {
    return (
      <View style={styles.assistantRow}>
        <Avatar />
        <View style={[styles.error, { backgroundColor: t.negativeSoft, borderColor: withAlpha(t.negative, 0.25), borderRadius: d.radius.lg, borderTopLeftRadius: d.radius.xs }]}>
          <View style={styles.errorLine} accessibilityLiveRegion="polite">
            <SymbolView name="exclamationmark.triangle" size={icon.sm} tintColor={t.negative} accessibilityElementsHidden importantForAccessibility="no" />
            <Text style={[styles.errorText, { color: t.contentSecondary }]} accessibilityRole="alert">
              {maskCurrencyInText(m.content)}
            </Text>
          </View>
          {onRetry ? <Button size="compact" variant="secondary" title={checking ? "Checking" : "Get the reply"} icon="arrow.clockwise" iconLeading loading={checking} onPress={onRetry} style={styles.retry} /> : null}
        </View>
      </View>
    );
  }

  const text = maskCurrencyInText(hideIdCitations(m.content));
  if (!text.trim()) return null;
  return (
    <View style={styles.assistantRow}>
      <Avatar />
      <View style={styles.assistantBody}>
        <Copyable text={text}>
          <Card style={[styles.answer, { borderTopLeftRadius: d.radius.xs }]}>
            <ChatMarkdown text={text} />
          </Card>
        </Copyable>
      </View>
    </View>
  );
});

const THINKING_STEPS = ["Thinking…", "Reading your data…", "Crunching numbers…", "Analyzing patterns…", "Preparing response…"];

/** While the answer is being written: three pulsing dots and what the assistant is doing (the web's ThinkingIndicator). */
export function Thinking() {
  const t = useTheme();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % THINKING_STEPS.length), 2400);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.assistantRow} accessible accessibilityLabel="Writing an answer" accessibilityLiveRegion="polite">
      <Avatar />
      <View style={styles.thinking}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <Dot key={i} delay={i * 180} color={t.accent} />
          ))}
        </View>
        <Text style={[styles.thinkingText, { color: t.contentMuted }]}>{THINKING_STEPS[step]}</Text>
      </View>
    </View>
  );
}

function Dot({ delay, color }: { delay: number; color: string }) {
  const reduce = useReducedMotion();
  const o = useSharedValue(reduce ? 0.7 : 0.3);
  useEffect(() => {
    if (reduce) return;
    o.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0.3, { duration: 420 })), -1));
  }, [delay, o, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 2 }] }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = themedStyles(() =>
  StyleSheet.create({
    userRow: { alignItems: "flex-end", paddingLeft: "15%" },
    userBubble: { paddingHorizontal: space.lg, paddingVertical: 10, borderWidth: 1 },
    userText: { ...type.callout },
    assistantRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
    assistantBody: { flex: 1, minWidth: 0 },
    avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
    answer: { paddingVertical: 14 },
    stopped: { ...type.footnote, ...weight.medium, flex: 1, paddingTop: 5 },
    error: { flex: 1, borderWidth: 1, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
    errorLine: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
    errorText: { ...type.subhead, flex: 1 },
    retry: { alignSelf: "flex-start" },
    thinking: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 },
    dots: { flexDirection: "row", gap: 4 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    thinkingText: { ...type.subhead },
  }),
);
