import { actionArea } from "@web/lib/action-destination";
import type { ActionRow } from "@web/lib/action-rows";
import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { createContext, useContext, useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { useTheme as useDesign } from "@/design";
import { openChat } from "@/lib/chat";
import { formatCurrencyExact, formatStoredDay } from "@/lib/format";
import { maskCurrencyInText, useAmountsHidden } from "@/lib/hide-amounts";
import { actionChatPrompt, actionDestination, datesLine, EFFORT_LABEL, rowFigure, txnCountLine } from "@/lib/home-actions";
import { openPath } from "@/lib/navigation";
import { figures, icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Sparkle } from "@/ui/Sparkle";
import { toneStyle } from "./tone";

/** The divider between rows in a block of actions: the block sets it for the fill it sits on. */
export const ActionRowLine = createContext<string | null>(null);

// The row's glyph on the accent-bar skin, by its tag (type, else category).
const TAG_SYMBOL: Record<string, SFSymbol> = {
  tax: "doc.text",
  debt: "flame",
  portfolio: "chart.line.uptrend.xyaxis",
  invest: "chart.line.uptrend.xyaxis",
  retirement: "target",
  savings: "banknote",
  spending: "creditcard",
  behavioral: "creditcard",
};

/**
 * One action. Skins: `highlight` (on the sticky-note tint: a circle that marks
 * it done, the title and its value pill), `accentBar` (a card with the area's
 * colored edge and glyph, and the area, value and effort as chips; Done is
 * among the verbs). A tap on the row opens the detail and the other verbs.
 */
export function ActionItem({
  row,
  first,
  onComplete,
  onSnooze,
  onDismiss,
  here,
}: {
  row: ActionRow;
  first: boolean;
  /** The page the row sits on: its link there is left off (it would open this page again). */
  here?: string;
  onComplete: () => Promise<void>;
  onSnooze: () => void;
  onDismiss: () => void;
}) {
  const t = useTheme();
  const d = useDesign();
  const line = useContext(ActionRowLine) ?? d.color.line;
  useAmountsHidden(); // re-render the masked copy on toggle
  const [open, setOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const area = actionArea(row.type, row.category);
  const tone = toneStyle(t, area.tone);
  const figure = rowFigure(row);
  const linked = actionDestination(row);
  const destination = linked && here && linked.href.split(/[?#]/)[0] === here ? null : linked;
  const title = maskCurrencyInText(row.title);
  const bar = d.skin.actionCard === "accentBar";
  const tag = (row.type ?? row.category ?? "general").toLowerCase();

  // The API cannot reopen a done action, so the tick asks first.
  const confirmComplete = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message: "Marking it done takes it off your list for good.", options: ["Mark done", "Cancel"], cancelButtonIndex: 1 },
      (i) => {
        if (i === 0) void complete();
      },
    );
  const complete = async () => {
    setCompleting(true);
    try {
      await onComplete();
    } finally {
      setCompleting(false);
    }
  };
  // The API cannot bring a dismissed action back, so this one asks first (M-4).
  const confirmDismiss = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message: "This removes it from your actions for good.", options: ["Remove action", "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => {
        if (i === 0) onDismiss();
      },
    );

  const content = (
    <>
      <View style={[styles.head, bar && styles.headBar]}>
        {bar ? (
          <View style={[styles.glyph, { backgroundColor: tone.soft }]}>
            <SymbolView name={TAG_SYMBOL[tag] ?? "sparkles"} size={icon.sm} weight="semibold" tintColor={tone.ink} accessibilityElementsHidden importantForAccessibility="no" />
          </View>
        ) : (
        <Pressable
          onPress={confirmComplete}
          disabled={completing}
          accessibilityRole="button"
          accessibilityLabel={`Mark done: ${title}`}
          hitSlop={8}
          style={({ pressed }) => [
            styles.check,
            { borderColor: t.contentMuted, backgroundColor: completing ? t.brand : d.color.surface, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          {completing ? <ActivityIndicator size="small" color={t.brandFg} /> : null}
        </Pressable>
        )}
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setOpen((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={figure ? `${title}, ${maskCurrencyInText(figure)}` : title}
          accessibilityHint={open ? "Hides the details" : "Shows the details"}
          style={({ pressed }) => [styles.main, bar && styles.mainBar, { opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.title, { color: t.content }]}>{title}</Text>
            {row.evidence ? <Text style={[styles.evidence, { color: t.contentSecondary }]}>{maskCurrencyInText(row.evidence)}</Text> : null}
            {/* The value on its own line, whole: the server's words ("$178/yr extra return") never clip. */}
            {bar ? (
              // The chips run under the chevron, which sits beside the title, so a narrow phone keeps them on one line.
              <View style={[styles.pills, { marginRight: -(icon.sm + 10) }]}>
                <Pill text={area.label} bg={tone.soft} fg={tone.ink} />
                {figure ? <Pill text={maskCurrencyInText(figure)} bg={tone.soft} fg={tone.ink} /> : null}
                {row.effort ? <Pill text={EFFORT_LABEL[row.effort]} bg={t.canvasSunken} fg={t.contentSecondary} /> : null}
              </View>
            ) : figure ? (
              <View style={[styles.value, { backgroundColor: t.cautionSoft }]}>
                <Text style={[styles.valueText, { color: t.caution }]}>{maskCurrencyInText(figure)}</Text>
              </View>
            ) : null}
          </View>
          <SymbolView
            name={open ? "chevron.up" : "chevron.down"}
            size={icon.sm}
            weight="semibold"
            tintColor={t.contentMuted}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
      </View>

      {open ? (
        <Animated.View entering={FadeIn.duration(160)} style={[styles.body, bar && styles.bodyBar]}>
          <Text style={[styles.desc, { color: t.contentSecondary }]}>{maskCurrencyInText(row.description)}</Text>
          {bar ? (
            row.isSpendCut ? (
              <View style={styles.pills}>
                <Pill text="Spend cut" bg={t.canvasSunken} fg={t.contentSecondary} />
              </View>
            ) : null
          ) : (
            <View style={styles.pills}>
              <Pill text={area.label} bg={tone.soft} fg={tone.ink} />
              {row.effort ? <Pill text={EFFORT_LABEL[row.effort]} bg={d.color.surface} fg={t.contentSecondary} /> : null}
              {row.isSpendCut ? <Pill text="Spend cut" bg={d.color.surface} fg={t.contentSecondary} /> : null}
            </View>
          )}
          <Text style={[styles.dates, { color: t.contentMuted }]}>{datesLine(row.createdAt, row.updatedAt)}</Text>

          {row.transactions.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={[styles.dates, { color: t.contentMuted }]}>{txnCountLine(row.transactions.length, row.txnCount || row.transactions.length, row.txnScope)}</Text>
              <View style={[styles.txns, { backgroundColor: d.color.surface }]}>
                {row.transactions.map((x, i) => (
                  <View key={x.id} style={[styles.txn, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.txnName, { color: t.content }]} numberOfLines={1}>
                        {x.merchant}
                      </Text>
                      <Text style={[styles.dates, { color: t.contentMuted }]}>{formatStoredDay(x.date)}</Text>
                    </View>
                    <Text style={[styles.txnAmt, { color: x.isIncome ? t.positive : t.content }]}>
                      {x.isIncome ? "+" : ""}
                      {formatCurrencyExact(Math.abs(x.amount))}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {destination ? <Button size="compact" title={destination.label} icon="arrow.right" onPress={() => openPath(destination.href)} /> : null}
          <Button
            size="compact"
            variant="secondary"
            title={d.mascot ? `Ask ${d.mascot.name} about this` : "Ask about this"}
            icon="bubble.left"
            onPress={() => openChat(actionChatPrompt(row), row.title)}
          />
          <View style={styles.verbs}>
            {bar ? <Button size="compact" variant="plain" title="Done" accessibilityLabel="Mark done" loading={completing} onPress={confirmComplete} style={styles.verb} /> : null}
            <Button size="compact" variant="plain" title="Snooze" accessibilityLabel="Snooze a month" onPress={onSnooze} style={styles.verb} />
            <Button size="compact" variant="plain" title="Not for me" onPress={confirmDismiss} style={styles.verb} />
          </View>
        </Animated.View>
      ) : null}
    </>
  );

  return bar ? (
    <Animated.View layout={LinearTransition.duration(180)}>
      <Card nested>
        <View style={[styles.edge, { backgroundColor: tone.solid }]} />
        {content}
      </Card>
    </Animated.View>
  ) : (
    <Animated.View layout={LinearTransition.duration(180)} style={!first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line }}>
      {content}
    </Animated.View>
  );
}

/** An action marked done on this visit: ticked, struck through, with a sparkle. */
export function DoneItem({ title, first }: { title: string; first: boolean }) {
  const t = useTheme();
  const d = useDesign();
  const line = useContext(ActionRowLine) ?? d.color.line;
  const bar = d.skin.actionCard === "accentBar";
  const row = (
    <Animated.View
      entering={FadeIn.duration(220)}
      accessible
      accessibilityLabel={`${maskCurrencyInText(title)}, done`}
      style={[styles.head, bar ? styles.headBar : !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line }]}
    >
      <View style={[styles.check, { borderColor: t.brand, backgroundColor: t.brand }]}>
        <SymbolView name="checkmark" size={icon.sm} weight="bold" tintColor={t.brandFg} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <Text style={[styles.title, styles.doneTitle, { color: t.contentMuted }]} numberOfLines={2}>
        {maskCurrencyInText(title)}
      </Text>
      <Sparkle size={20} />
      <Text style={[styles.doneLabel, { color: t.brandInk }]}>Done</Text>
    </Animated.View>
  );
  return bar ? <Card nested>{row}</Card> : row;
}

function Pill({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  const d = useDesign();
  // Outlined-chip themes (Classic) keep the original's soft-square tag; filled-chip themes use pills.
  const corner = d.skin.chip === "outlined" ? d.radius.sm : d.radius.pill;
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderRadius: corner }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    head: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 10 },
    headBar: { paddingLeft: 16, paddingRight: 12 },
    edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
    glyph: { width: 26, height: 26, borderRadius: radius.xs, alignItems: "center", justifyContent: "center" },
    bodyBar: { paddingLeft: 16, paddingRight: 14 },
    check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
    main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
    mainBar: { alignItems: "flex-start" },
    title: { ...type.subhead, ...weight.semibold },
    doneTitle: { flex: 1, textDecorationLine: "line-through" },
    doneLabel: { ...type.subhead, ...figures },
    evidence: { ...type.footnote },
    value: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    valueText: { ...type.footnote, ...figures },
    body: { paddingLeft: 40, paddingBottom: 14, gap: 10 },
    desc: { ...type.subhead },
    pills: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
    pill: { paddingHorizontal: 6, paddingVertical: 3 },
    pillText: { ...type.caption },
    dates: { ...type.footnote },
    txns: { borderRadius: radius.sm, overflow: "hidden" },
    txn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
    txnName: { ...type.subhead, ...weight.semibold },
    txnAmt: { ...type.subhead, ...figures },
    verbs: { flexDirection: "row", gap: 4 },
    verb: { flex: 1, paddingHorizontal: 4 },
  }),
);
