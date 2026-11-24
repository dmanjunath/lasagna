import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { assetSegments, debtSegments, fmtUsd, plural, type CompSegment, type NetBreakdown } from "@/lib/home";
import { useTheme as useDesign } from "@/design";
import { hasRoleColor } from "@/design/tint";
import { figures, themedStyles, type, useTheme, weight } from "@/theme";
import { HeroAmount } from "@/ui/HeroAmount";
import { Card, CardHeader } from "@/ui/Card";
import { SegmentBar } from "@/ui/Track";

type Colored = CompSegment & { color: string };

/** What the net worth is made of: assets less debt, then each side itemized. */
export function NetWorthCard({ breakdown: b, onView }: { breakdown: NetBreakdown; onView: () => void }) {
  const t = useTheme();
  const c = useDesign().color;
  // On a card in net worth's own color the label wears its ink and the figure stays ink, as in the mockup.
  const own = hasRoleColor(c, "wealth");
  useAmountsHidden();
  const assetColor: Record<string, string> = { cash: t.viz[0], inv: t.viz[1], prop: t.viz[4] };
  const debtColor: Record<string, string> = { cc: t.creditCard, loans: t.viz[3] };
  const assets = assetSegments(b).map((s) => ({ ...s, color: assetColor[s.key] }));
  const debts = debtSegments(b).map((s) => ({ ...s, color: debtColor[s.key] }));

  return (
    <Card
      style={{ gap: 18 }}
      wash={`radial-gradient(120% 80% at 100% 0%, ${t.infoSoft}, transparent 56%), radial-gradient(90% 70% at 0% 8%, ${t.accentSofter}, transparent 60%)`}
    >
      <CardHeader title="Net worth" link={{ title: "See all", label: "See all accounts", onPress: onView }} />
      <View style={{ gap: 10 }}>
        <Line label="Assets" value={fmtUsd(b.assetTotal)} color={t.content} labelColor={t.contentMuted} />
        <Line label="Debt" value={fmtUsd(b.debts)} color={t.negative} labelColor={t.negative} />
        <View style={[styles.total, { borderTopColor: t.line }]}>
          {/* The hero figure: a tap hides or shows every amount. */}
          <HeroAmount label={`Net worth, ${fmtUsd(b.netWorth)}`} style={{ alignSelf: "stretch" }}>
            <Line label="Net worth" value={fmtUsd(b.netWorth)} color={own ? t.content : t.brandInk} labelColor={own ? c.tint.wealth.ink : t.brandInk} big />
          </HeroAmount>
        </View>
      </View>
      <View style={[styles.comp, { borderTopColor: t.line }]}>
        <Column title="What you own" count={b.cashCount + b.investmentsCount + b.assetsCount} segments={assets} total={b.assetTotal} />
        <Column title="What you owe" count={b.debtsCount} segments={debts} total={b.debts} />
      </View>
    </Card>
  );
}

function Line({ label, value, color, labelColor, big }: { label: string; value: string; color: string; labelColor: string; big?: boolean }) {
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={[styles.lineLabel, { color: labelColor }]}>{label}</Text>
      <Text style={[big ? styles.bigNum : styles.num, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** One side of the equation: a proportional bar, then a legend row per segment. */
function Column({ title, count, segments, total }: { title: string; count: number; segments: Colored[]; total: number }) {
  const t = useTheme();
  const stacked = useWindowDimensions().fontScale > 1.3;
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.colHead}>
        <Text style={[styles.colTitle, { color: t.contentMuted }]} numberOfLines={1}>{title}</Text>
        <Text style={[styles.colCount, { color: t.contentMuted }]} numberOfLines={1}>{plural(count, "account")}</Text>
      </View>
      {segments.length > 0 ? <SegmentBar segments={segments} /> : null}
      <View style={{ gap: 8 }}>
        {segments.map((s) => {
          const pct = Math.round((s.value / (total || 1)) * 100);
          return (
            <View key={s.key} style={styles.legend} accessible accessibilityLabel={`${s.label}, ${fmtUsd(s.value)}, ${pct}%, ${plural(s.count, "account")}`}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              {stacked ? (
                // Large text: the label gets the full width, the meta and value share the line under it.
                <View style={styles.legendStack}>
                  <Text style={[styles.legendLabel, { color: t.content }]} numberOfLines={1}>{s.label}</Text>
                  <View style={styles.legend}>
                    <Text style={[styles.legendMeta, styles.legendGrow, { color: t.contentMuted }]} numberOfLines={1}>
                      {pct}%, {plural(s.count, "account")}
                    </Text>
                    <Text style={[styles.legendValue, { color: t.content }]} numberOfLines={1}>{fmtUsd(s.value)}</Text>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={[styles.legendLabel, { color: t.content }]} numberOfLines={1}>{s.label}</Text>
                  <Text style={[styles.legendMeta, styles.legendGrow, { color: t.contentMuted }]} numberOfLines={1}>
                    {pct}%, {plural(s.count, "account")}
                  </Text>
                  <Text style={[styles.legendValue, { color: t.content }]} numberOfLines={1}>{fmtUsd(s.value)}</Text>
                </>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  lineLabel: { ...type.subhead, ...weight.semibold },
  num: { ...type.amount, flexShrink: 1 },
  bigNum: { ...type.display, flexShrink: 1 },
  total: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  comp: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18, gap: 22 },
  colHead: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", columnGap: 8 },
  colTitle: { ...type.footnote, ...weight.semibold },
  colCount: { ...type.footnote },
  legend: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { ...type.subhead, ...weight.semibold },
  legendStack: { flex: 1, gap: 2 },
  legendGrow: { flex: 1 },
  legendMeta: { ...type.footnote },
  legendValue: { ...type.subhead, ...figures },
}));
