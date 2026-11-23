import { MenuView, type NativeActionEvent } from "@react-native-menu/menu";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { formatMoney } from "@/lib/format";
import { cardLine, categoryLabel, progressOf, type Goal } from "@/lib/goals";
import { figures, icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, TextLink } from "@/ui/Card";
import { SavingsProgress } from "@/ui/Progress";
import { Sparkle } from "@/ui/Sparkle";
import { Track } from "@/ui/Track";
import { goalProgressColor, GoalTile } from "./GoalParts";

/**
 * One active goal (goals.tsx GoalCard): its tile or jar, name and percent,
 * saved of target, the bar where the theme draws one, the one status line, and
 * the next step (plan a monthly amount, or reallocate a funded goal's money).
 * Tap opens the goal. Long press offers Edit and Delete.
 */
function GoalCardBase({
  goal: g,
  hidden,
  onOpen,
  onEdit,
  onDelete,
  onPlan,
  onReallocate,
}: {
  goal: Goal;
  /** Read so the card re-renders when amounts hide. */
  hidden: boolean;
  onOpen: (g: Goal) => void;
  onEdit: (g: Goal) => void;
  onDelete: (g: Goal) => void;
  onPlan: (g: Goal) => void;
  onReallocate: (g: Goal) => void;
}) {
  const t = useTheme();
  const d = useDesign();
  const jar = d.skin.progress === "jar";
  // The web's card footer: the next step as a tinted button, "View goal" at the end.
  const footer = d.skin.cardAction === "footer";
  const p = progressOf(g);
  const color = goalProgressColor(t, d.color, g);
  const plan = g.monthlyContribution ? parseFloat(g.monthlyContribution) : 0;
  const line = cardLine(g);
  const n = g.accountIds.length;
  const pctText = `${Math.round(p.pct)}%`;
  const amounts = `${formatMoney(p.current, true)} of ${formatMoney(p.target, true)}`;

  return (
    <MenuView
      shouldOpenOnLongPress
      title={g.name}
      actions={[
        // Icons and colors as on a transaction row's menu.
        { id: "edit", title: "Edit", image: "pencil", imageColor: t.content },
        { id: "delete", title: "Delete", image: "trash", imageColor: t.negative, attributes: { destructive: true } },
      ]}
      onPressAction={({ nativeEvent }: NativeActionEvent) => (nativeEvent.event === "edit" ? onEdit(g) : onDelete(g))}
    >
      <Pressable
        onPress={() => onOpen(g)}
        accessibilityRole="button"
        accessibilityLabel={`${g.name}, ${p.reached ? "funded" : pctText}, ${amounts}. ${line}`}
        accessibilityHint="Opens the goal. Long press to edit or delete."
        accessibilityActions={[
          { name: "edit", label: "Edit" },
          { name: "delete", label: "Delete" },
        ]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === "edit" ? onEdit(g) : onDelete(g))}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Card style={styles.card}>
          <View style={styles.top}>
            {jar ? <SavingsProgress pct={p.reached ? 100 : p.pct} color={color} size={46} /> : <GoalTile iconKey={g.icon} color={color} size={46} />}
            <View style={styles.names}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: t.content }]} numberOfLines={2}>
                  {g.name}
                </Text>
                {p.reached ? <Sparkle size={16} /> : null}
              </View>
              {/* The kind of goal, as a plain label under its name (never a kicker over it). */}
              <Text style={[styles.category, { color: t.contentMuted }]} numberOfLines={1}>
                {categoryLabel(g.category)}
              </Text>
            </View>
            <Text style={[styles.pct, { color: p.reached ? t.brandInk : t.content }]}>{pctText}</Text>
            <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
          </View>

          <View style={styles.amountRow}>
            <Text style={[styles.amount, { color: t.content }]}>
              {formatMoney(p.current, true)}
              <Text style={[styles.of, { color: t.contentMuted }]}>{` of ${formatMoney(p.target, true)}`}</Text>
            </Text>
            {g.isAutoTracked ? (
              <View style={[styles.badge, { backgroundColor: t.brandSoft }]}>
                <Text style={[styles.badgeText, { color: t.brandInk }]}>{`Auto, ${n} account${n === 1 ? "" : "s"}`}</Text>
              </View>
            ) : null}
          </View>

          {/* The bar where the theme has no jar. A goal not started shows a nub, never an empty track. */}
          {jar ? null : <Track pct={p.reached ? 100 : Math.max(p.pct, 2)} color={color} />}

          <Text style={[styles.line, { color: p.reached ? t.content : t.contentSecondary }]}>{line}</Text>

          {footer ? (
            <View style={[styles.footer, { borderTopColor: t.line }]}>
              {p.reached ? (
                <Button variant="tinted" size="compact" icon="arrow.triangle.2.circlepath" iconLeading title="Reallocate surplus" accessibilityLabel={`Reallocate the ${g.name} surplus`} onPress={() => onReallocate(g)} />
              ) : plan > 0 ? null : (
                <Button variant="tinted" size="compact" icon="plus" iconLeading title="Plan monthly contribution" accessibilityLabel={`Plan a monthly contribution to ${g.name}`} onPress={() => onPlan(g)} />
              )}
              <View style={styles.footerEnd}>
                <TextLink title="View goal" label={`View ${g.name}`} onPress={() => onOpen(g)} />
              </View>
            </View>
          ) : p.reached ? (
            // The next step, as a link: the card itself is the tap target, so no button competes with it.
            <View style={styles.next}>
              <TextLink title="Reallocate surplus" label={`Reallocate the ${g.name} surplus`} onPress={() => onReallocate(g)} />
            </View>
          ) : plan > 0 ? null : (
            <View style={styles.next}>
              <TextLink title="Plan monthly contribution" label={`Plan a monthly contribution to ${g.name}`} onPress={() => onPlan(g)} />
            </View>
          )}
        </Card>
      </Pressable>
    </MenuView>
  );
}

export const GoalCard = memo(GoalCardBase);

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { gap: 10 },
    top: { flexDirection: "row", alignItems: "center", gap: 12 },
    names: { flex: 1, gap: 1 },
    category: { ...type.footnote },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    name: { ...type.headline, flexShrink: 1 },
    pct: { ...type.amountM, ...figures },
    amountRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
    amount: { ...type.callout, ...figures },
    of: { ...type.callout, ...weight.medium, fontVariant: ["tabular-nums"] },
    badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { ...type.caption, ...weight.semibold },
    line: { ...type.subhead, ...weight.medium, fontVariant: ["tabular-nums"] },
    next: { alignSelf: "flex-start" },
    footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 2 },
    // "View goal" keeps the trailing end, and drops to its own line when the button fills the row.
    footerEnd: { flexGrow: 1, alignItems: "flex-end", justifyContent: "center", minHeight: 44 },
  }),
);
