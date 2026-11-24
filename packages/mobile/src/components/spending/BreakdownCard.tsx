import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CategoryMedallion, categoryToneIndex } from "@/components/CategoryMedallion";
import { formatMoney } from "@/lib/format";
import { paceVerdict, rowIds, rowPace, type BreakdownRow } from "@/lib/spending";
import type { CategoryDisplay } from "@/lib/taxonomy";
import { useTheme as useDesign } from "@/design";
import { figures, icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card } from "@/ui/Card";
import { SectionHeader } from "@/ui/Form";
import { ScopePills } from "@/components/transactions/ScopeRow";
import { Track } from "@/ui/Track";
import { pressFeedback } from "@/ui/press";

export type Side = "expenses" | "income";

/**
 * Where the money went, as ranked bars (each bar sized against the largest
 * row): one row per group, with its largest category's tile. Every row opens
 * in place, the same way: to its categories (each opening its own
 * transactions) when it has several, then to all its transactions. A lone row
 * has nothing to rank against, so it shows no bar. A section header, then the
 * card with the Money out / Money in side. The order is set in the Filters sheet.
 */
function BreakdownCardBase({
  side,
  onSide,
  sides,
  rows,
  hidden,
  displayOf,
  onDrill,
  periodKey,
}: {
  side: Side;
  onSide: (s: Side) => void;
  /** Which sides have rows. The switch shows only when both do. */
  sides: Side[];
  rows: BreakdownRow[];
  /** Re-renders the amounts on a hide toggle. */
  hidden: boolean;
  displayOf: (categoryId: string | null) => CategoryDisplay;
  onDrill: (categoryIds: string[], label: string) => void;
  /** The month shown ("2026-11"), for the pace marker. A year has none. */
  periodKey?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState<Set<string | null>>(() => new Set());
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;
  const income = side === "income";
  const d = useDesign();
  const roleColor = d.color.tint[income ? "income" : "spend"].accent;
  // Each expense bar wears its category's color in every theme, so the list is not one alarm color. Income rows keep the side's role color.
  const barColor = (label: string) => (income ? roleColor : d.color.category[categoryToneIndex(label)].ink);
  void hidden;
  // Against its usual month (meaningful color, owner 2026-11-23): only running ahead of the usual pace is
  // worth a word, in sauce. Under pace is the quiet default, so it says nothing (a caption on most rows is noise).
  // Money out only, and only when amounts show (a pace is about money).
  const ahead = (v: "good" | "bad" | null) => v === "bad" && !income && !hidden && !!periodKey;
  // An arrow and words as a caption, so it never reads as the same signal as a red category bar.
  const pace = (v: "good" | "bad" | null) =>
    ahead(v) ? (
      <View style={styles.paceRow}>
        <SymbolView name="arrow.up.right" size={icon.xs} weight="bold" tintColor={t.negative} accessibilityElementsHidden importantForAccessibility="no" />
        <Text style={[styles.pace, { color: t.negative }]}>Above your usual pace</Text>
      </View>
    ) : null;
  const paceWords = (v: "good" | "bad" | null) => (ahead(v) ? ", above your usual pace" : "");

  // The section's header, then the card. Its order is the Filters sheet's Sort, so the card has one control row, the side.
  return (
    <View style={styles.section}>
      <SectionHeader>Breakdown</SectionHeader>
      <Card style={{ gap: 12 }}>
        {sides.length > 1 ? (
          <ScopePills<Side>
            onCard
            accessibilityLabel="Money out or money in"
            value={side}
            onChange={onSide}
            options={[
              { value: "expenses", label: "Money out", tint: "spend" },
              { value: "income", label: "Money in", tint: "income" },
            ]}
          />
        ) : null}
        <View style={{ marginHorizontal: -space.card + 8 }}>
          {rows.map((row) => {
            const ids = rowIds(row);
            const expandable = ids.length > 0;
            const isOpen = expandable && open.has(row.key);
            const several = row.children.length > 1;
            // A group has no tile of its own, so it shows its largest category's, as that category's rows do.
            const display = displayOf(row.children[0]?.id ?? null);
            const color = barColor(display.label);
            const amount = formatMoney(row.total, true);
            const rowVerdict = periodKey ? rowPace(row, periodKey) : null;
            return (
              <View key={row.key ?? "other"}>
                <Pressable
                  disabled={!expandable}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setOpen((cur) => {
                      const next = new Set(cur);
                      if (next.has(row.key)) next.delete(row.key);
                      else next.add(row.key);
                      return next;
                    });
                  }}
                  accessibilityRole={expandable ? "button" : "text"}
                  accessibilityState={expandable ? { expanded: isOpen } : undefined}
                  accessibilityLabel={`${row.label}, ${amount}${paceWords(rowVerdict)}`}
                  accessibilityHint={expandable ? (isOpen ? "Hides the details" : several ? `Shows its ${row.children.length} categories` : "Shows a link to its transactions") : undefined}
                  style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
                >
                  <CategoryMedallion display={display} income={income} />
                  <View style={styles.main}>
                    <View style={styles.head}>
                      <Text style={[styles.name, { color: t.content }]} numberOfLines={2}>
                        {row.label}
                      </Text>
                      <Text style={[styles.amt, { color: t.content }]} numberOfLines={1}>{amount}</Text>
                    </View>
                    {rows.length > 1 ? <Track pct={(row.total / max) * 100} color={color} /> : null}
                    {pace(rowVerdict)}
                  </View>
                  {expandable ? (
                    <SymbolView
                      name={isOpen ? "chevron.up" : "chevron.down"}
                      size={icon.sm}
                      weight="semibold"
                      tintColor={t.contentFaint}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  ) : (
                    <View style={{ width: icon.sm }} />
                  )}
                </Pressable>
                {isOpen ? (
                  <View style={styles.children}>
                    {(several ? row.children : []).map((c) => {
                      // A category named like its group is the group's own: say so, so it doesn't read as a repeat.
                      const label = c.label === row.label ? `${c.label} (general)` : c.label;
                      const childAmount = formatMoney(c.total, true);
                      const childVerdict = periodKey ? paceVerdict(c.total, c.usual, periodKey) : null;
                      return (
                        <Pressable
                          key={c.id ?? "other"}
                          disabled={c.id === null}
                          onPress={() => c.id && onDrill([c.id], c.label)}
                          accessibilityRole={c.id ? "link" : "text"}
                          accessibilityLabel={`${label}, ${childAmount}${paceWords(childVerdict)}`}
                          accessibilityHint={c.id ? "Opens its transactions" : undefined}
                          style={({ pressed }) => [styles.child, pressFeedback(t, pressed)]}
                        >
                          <View style={styles.main}>
                            <View style={styles.head}>
                              <Text style={[styles.childName, { color: t.contentSecondary }]} numberOfLines={2}>
                                {label}
                              </Text>
                              <Text style={[styles.childAmt, { color: t.content }]} numberOfLines={1}>{childAmount}</Text>
                            </View>
                            <Track pct={(c.total / max) * 100} color={color} height={6} />
                            {pace(childVerdict)}
                          </View>
                          <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={c.id ? t.contentFaint : "transparent"} accessibilityElementsHidden importantForAccessibility="no" />
                        </Pressable>
                      );
                    })}
                    <Pressable
                      onPress={() => onDrill(ids, row.label)}
                      accessibilityRole="link"
                      accessibilityLabel={`All ${row.label} transactions`}
                      style={({ pressed }) => [styles.all, { opacity: pressed ? 0.5 : 1 }]}
                    >
                      <Text style={[styles.allText, { color: t.brandInk }]}>{`All ${row.label} transactions`}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

export const BreakdownCard = memo(BreakdownCardBase);

const styles = themedStyles(() =>
  StyleSheet.create({
    section: { gap: 8 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, paddingVertical: 9, borderRadius: radius.sm, minHeight: 56 },
    main: { flex: 1, gap: 7 },
    head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
    name: { ...type.subhead, ...weight.semibold, flex: 1 },
    amt: { ...type.subhead, ...figures },
    children: { paddingLeft: 54 + 10 },
    child: { flexDirection: "row", alignItems: "center", gap: 12, paddingRight: 10, paddingVertical: 8, minHeight: 44, borderRadius: radius.sm },
    childName: { ...type.footnote, ...weight.medium, flex: 1 },
    childAmt: { ...type.footnote, ...figures },
    all: { minHeight: 44, justifyContent: "center" },
    allText: { ...type.subhead, ...weight.semibold },
    paceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: -3 },
    pace: { ...type.caption },
  }),
);
