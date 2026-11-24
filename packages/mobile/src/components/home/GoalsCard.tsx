import type { Goal } from "@/api/home";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { fmtUsd, goalAccent, goalProgress } from "@/lib/home";
import { figures, icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { useTheme as useDesign } from "@/design";
import { Card, CardHeader } from "@/ui/Card";
import { SavingsProgress } from "@/ui/Progress";
import { EmptyState } from "@/ui/State";
import { Skeleton } from "@/ui/Skeleton";
import { Sparkle } from "@/ui/Sparkle";
import { Track } from "@/ui/Track";
import { pressFeedback } from "@/ui/press";

const SHOWN = 4;

/** Up to four active goals, each opening its plan. The first leads with its jar (the theme's progress skin). */
export function GoalsCard({ goals, loading, onOpen, onAll }: { goals: Goal[]; loading: boolean; onOpen: (id: string) => void; onAll: () => void }) {
  const t = useTheme();
  const jar = useDesign().skin.progress === "jar";
  useAmountsHidden();
  const active = goals.filter((g) => g.status === "active");

  if (loading) {
    return (
      <Card style={{ gap: 16 }}>
        <CardHeader title="Goals" />
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ gap: 8 }}>
            <Skeleton width={160} height={14} />
            <Skeleton height={8} />
          </View>
        ))}
      </Card>
    );
  }

  if (active.length === 0) {
    return (
      <Card style={{ gap: 10 }}>
        <CardHeader title="Goals" />
        <EmptyState compact title="No active goals yet" action={{ title: "Set a savings goal", onPress: onAll }} />
      </Card>
    );
  }

  const [lead, ...rest] = active.slice(0, SHOWN);

  const leadP = goalProgress(lead);
  const leadColor = (() => {
    const a = goalAccent(lead.category, lead.name);
    return leadP.reached || a === "brand" ? t.brand : t.viz[a];
  })();
  return (
    <Card style={{ gap: 6 }}>
      <CardHeader
        title="Goals"
        link={active.length > SHOWN ? { title: `See all ${active.length}`, label: `See all ${active.length} goals`, onPress: onAll } : undefined}
      />
      <Card nested style={styles.leadCard}>
        <Pressable
          onPress={() => onOpen(lead.id)}
          accessibilityRole="link"
          accessibilityLabel={`${lead.name}, ${leadP.reached ? "funded" : `${Math.round(leadP.pct)}%`}, ${fmtUsd(leadP.current)} of ${fmtUsd(leadP.target)}`}
          style={({ pressed }) => [styles.lead, pressFeedback(t, pressed)]}
        >
          <View style={styles.leadRow}>
            {/* The jar where the theme's progress skin is one. A bar runs under the text instead. */}
            {jar ? <SavingsProgress pct={leadP.reached ? 100 : leadP.pct} color={leadColor} size={44} /> : null}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.leadName, { color: t.contentMuted }]} numberOfLines={2}>
                {lead.name}
              </Text>
              <View style={styles.leadPctRow}>
                <Text style={[styles.leadPct, { color: t.content }]}>{leadP.reached ? "Funded" : `${Math.round(leadP.pct)}%`}</Text>
                {leadP.reached ? <Sparkle size={18} /> : null}
              </View>
              <Text style={[styles.line, { color: t.contentMuted }]}>
                {fmtUsd(leadP.current)} of {fmtUsd(leadP.target)}
              </Text>
            </View>
            <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
          </View>
          {jar ? null : <SavingsProgress pct={leadP.reached ? 100 : Math.max(leadP.pct, 2)} color={leadColor} />}
        </Pressable>
      </Card>
      {rest.map((g) => {
        const p = goalProgress(g);
        const accent = goalAccent(g.category, g.name);
        const color = accent === "brand" ? t.brand : t.viz[accent];
        const line = p.reached
          ? "Fully funded. Surplus ready to reallocate."
          : p.notStarted
            ? "Not started yet. Kick it off anytime."
            : `${fmtUsd(p.current)} of ${fmtUsd(p.target)}`;
        return (
          <Pressable
            key={g.id}
            onPress={() => onOpen(g.id)}
            accessibilityRole="link"
            accessibilityLabel={`${g.name}, ${p.reached ? "funded" : `${Math.round(p.pct)}%`}, ${line}`}
            style={({ pressed }) => [styles.goal, p.reached && { backgroundColor: t.brandSofter }, pressFeedback(t, pressed)]}
          >
            <View style={styles.goalHead}>
              <View style={styles.nameRow}>
                {p.reached ? <Sparkle size={16} /> : null}
                <Text style={[styles.name, { color: t.content }]} numberOfLines={2}>
                  {g.name}
                </Text>
              </View>
              {p.reached ? (
                <View style={[styles.badge, { backgroundColor: t.brandSoft }]}>
                  <Text style={[styles.badgeText, { color: t.brandInk }]}>Funded</Text>
                </View>
              ) : (
                <Text style={[styles.pct, { color: t.contentMuted }]}>{Math.round(p.pct)}%</Text>
              )}
              <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
            </View>
            <Track pct={p.reached ? 100 : Math.max(p.pct, p.notStarted ? 2 : p.pct)} color={p.reached ? t.brand : color} />
            <Text style={[styles.line, { color: t.contentMuted }]}>{line}</Text>
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  goal: { gap: 8, paddingVertical: 10, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: radius.sm },
  goalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  leadCard: { marginBottom: 4 },
  lead: { padding: 12, gap: 10 },
  leadRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  leadName: { ...type.footnote, ...weight.semibold },
  leadPctRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  leadPct: { ...type.amountL },
  name: { ...type.subhead, ...weight.semibold, flexShrink: 1 },
  pct: { ...type.footnote, ...figures },
  badge: { borderRadius: radius.xs, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { ...type.caption, ...weight.semibold },
  line: { ...type.footnote, fontVariant: ["tabular-nums"] },
}));
