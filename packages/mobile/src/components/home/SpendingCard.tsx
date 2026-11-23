import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HIDDEN_AMOUNT, useAmountsHidden } from "@/lib/hide-amounts";
import { fmtUsd, pctVsPrev, type MonthFlow } from "@/lib/home";
import { figures, icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Card, CardHeader } from "@/ui/Card";
import { Note } from "@/ui/Note";
import { Track } from "@/ui/Track";

/** "21% less than this point last month", the change in words, or null without a baseline. */
export function changeWords(flow: MonthFlow): { text: string; pct: number; less: boolean } | null {
  const change = pctVsPrev(flow);
  if (change == null) return null;
  const pct = Math.round(Math.abs(change));
  if (pct === 0) return { text: "About the same as this point last month", pct, less: false };
  return { text: `${pct}% ${change < 0 ? "less" : "more"} than this point last month`, pct, less: change < 0 };
}

/**
 * This month so far, in one card: what went out (and how that compares with
 * the same point last month), what came in and the net, then the top three
 * categories, each opening its transactions. `note` makes a drop in spending
 * the screen's handwritten note.
 */
export function SpendingCard({
  flow,
  month,
  note,
  onAll,
  onCategory,
}: {
  flow: MonthFlow;
  /** "November". */
  month: string;
  note: boolean;
  onAll: () => void;
  onCategory: (id: string) => void;
}) {
  const t = useTheme();
  const hidden = useAmountsHidden();
  const change = changeWords(flow);
  const hasFlow = flow.income > 0 || flow.spending > 0;
  const positive = flow.net >= 0;
  const signed = (sign: string, n: number) => (hidden ? HIDDEN_AMOUNT : `${sign}${fmtUsd(n)}`);
  const colors = [t.viz[0], t.viz[1], t.viz[2]];

  return (
    <Card style={{ gap: 14 }}>
      <CardHeader title={`Spent in ${month}`} link={{ title: "See all", label: `See all spending in ${month}`, onPress: onAll }} />
      {hasFlow ? (
        <>
          <View style={{ gap: 2 }}>
            <Text style={[styles.figure, { color: t.content }]} accessibilityLabel={`Spent ${fmtUsd(flow.spending)}`}>
              {fmtUsd(flow.spending)}
            </Text>
            {change ? (
              note && change.less ? (
                <Note>{`${change.pct}% less than this time last month!`}</Note>
              ) : (
                <Text style={[styles.change, { color: t.contentSecondary }]}>{change.text}</Text>
              )
            ) : null}
          </View>
          <View style={styles.stats}>
            <Stat label="Money in" value={signed("+", flow.income)} color={flow.income > 0 && !hidden ? t.positive : t.content} />
            <Stat label="Net" value={signed(positive ? "+" : "−", Math.abs(flow.net))} color={hidden ? t.content : positive ? t.positive : t.negative} />
          </View>
          {flow.topCats.length > 0 ? (
            <View style={{ marginHorizontal: -8 }}>
              {flow.topCats.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => onCategory(c.id)}
                  accessibilityRole="link"
                  accessibilityLabel={`${c.name}, ${fmtUsd(c.total)}`}
                  style={({ pressed }) => [styles.cat, pressed && { backgroundColor: t.canvasSunken }]}
                >
                  <View style={styles.catHead}>
                    <Text style={[styles.catName, { color: t.content }]} numberOfLines={2}>
                      {c.name}
                    </Text>
                    <Text style={[styles.catAmt, { color: t.contentSecondary }]}>{fmtUsd(c.total)}</Text>
                    <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
                  </View>
                  <Track pct={c.pct} color={colors[i % colors.length]} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={[styles.change, { color: t.contentSecondary }]}>No money in or out yet this month.</Text>
      )}
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const t = useTheme();
  return (
    // A card inside the card, so it stands off the card's fill in every skin.
    <Card nested style={styles.stat}>
      <View accessible accessibilityLabel={`${label}, ${value}`} style={{ gap: 2 }}>
        <Text style={[styles.statLabel, { color: t.contentMuted }]}>{label}</Text>
        <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </View>
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    figure: { ...type.amountXL },
    change: { ...type.subhead },
    stats: { flexDirection: "row", gap: 10 },
    stat: { flex: 1, paddingHorizontal: 14, paddingVertical: 10 },
    statLabel: { ...type.footnote, ...weight.semibold },
    statValue: { ...type.amountM },
    cat: { gap: 7, paddingHorizontal: 8, paddingVertical: 9, borderRadius: radius.sm },
    catHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    catName: { ...type.subhead, ...weight.semibold, flex: 1 },
    catAmt: { ...type.subhead, ...figures },
  }),
);
