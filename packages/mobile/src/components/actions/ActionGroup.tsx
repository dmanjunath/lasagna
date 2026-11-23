import type { ActionRow } from "@web/lib/action-rows";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ActionItem, ActionRowLine, DoneItem } from "@/components/home/ActionItem";
import { useTheme as useDesign } from "@/design";
import { maskCurrencyInText, useAmountsHidden } from "@/lib/hide-amounts";
import { figures, space, themedStyles, type, useTheme } from "@/theme";
import { Card, CARD_TITLE_MAX_SCALE } from "@/ui/Card";
import { Skeleton } from "@/ui/Skeleton";

/**
 * A titled run of action rows, in the same skin as Home's Actions card:
 * `highlight` sets them in one card block, `accentBar` lists them as separate
 * cards. `hero` makes the block the screen's hero, on the action tint (the
 * Actions screen's first group). `count` sits beside the title, `lead` under it.
 */
export function ActionGroup({
  title,
  count,
  lead,
  rows,
  done = [],
  onComplete,
  onSnooze,
  onDismiss,
  here,
  hero,
}: {
  title: string;
  count?: number;
  lead?: string | null;
  rows: ActionRow[];
  done?: ActionRow[];
  onComplete: (row: ActionRow) => Promise<void>;
  onSnooze: (id: string) => void;
  onDismiss: (id: string) => void;
  /** The page the group sits on: a row's link to this same page is left off. */
  here?: string;
  hero?: boolean;
}) {
  const t = useTheme();
  const d = useDesign();
  useAmountsHidden(); // the lead's figures re-mask on toggle
  const bar = d.skin.actionCard === "accentBar";
  return (
    <ActionBlock bar={bar} hero={hero}>
      <View style={[styles.head, bar && styles.inset]}>
        <Text style={[styles.title, { color: t.content }]} accessibilityRole="header" maxFontSizeMultiplier={CARD_TITLE_MAX_SCALE}>
          {title}
        </Text>
        {count != null ? (
          <Text style={[styles.count, { color: t.contentMuted }]} maxFontSizeMultiplier={CARD_TITLE_MAX_SCALE} accessibilityLabel={`${count} ${count === 1 ? "action" : "actions"}`}>
            {count}
          </Text>
        ) : null}
      </View>
      {lead ? <Text style={[styles.lead, bar && styles.inset, { color: t.contentSecondary }]}>{maskCurrencyInText(lead)}</Text> : null}
      <View style={bar && styles.list}>
        {rows.map((r, i) => (
          <ActionItem key={r.id} row={r} first={i === 0} here={here} onComplete={() => onComplete(r)} onSnooze={() => onSnooze(r.id)} onDismiss={() => onDismiss(r.id)} />
        ))}
        {done.map((r, i) => (
          <DoneItem key={r.id} title={r.title} first={rows.length === 0 && i === 0} />
        ))}
      </View>
    </ActionBlock>
  );
}

/** The group's container: plain under `accentBar`, else one card, on the action tint when it is the hero. */
export function ActionBlock({ bar, hero, children }: { bar: boolean; hero?: boolean; children: ReactNode }) {
  const d = useDesign();
  if (bar) return <View style={styles.plain}>{children}</View>;
  return (
    <ActionRowLine.Provider value={hero ? d.color.highlightLine : d.color.line}>
      <Card hero={hero ? "action" : undefined} style={styles.card}>
        {children}
      </Card>
    </ActionRowLine.Provider>
  );
}

/** A group's outline while the actions load. */
export function ActionGroupSkeleton({ rows = 3, hero }: { rows?: number; hero?: boolean }) {
  const d = useDesign();
  const line = hero ? d.color.highlightLine : d.color.line;
  return (
    <Card hero={hero ? "action" : undefined} style={styles.card}>
      <View accessibilityLabel="Loading actions" accessible>
      <Skeleton width="45%" height={18} style={{ marginBottom: 8 }} />
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.skel, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line }]}>
          <Skeleton width={28} height={28} style={{ borderRadius: 14 }} />
          <Skeleton width={i === 1 ? "55%" : "70%"} height={14} />
        </View>
      ))}
      </View>
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { paddingHorizontal: space.card, paddingTop: space.card, paddingBottom: 6 },
    plain: { gap: 4 },
    // Separate cards: the title and lead line up with the cards' content, as a section header does.
    inset: { paddingHorizontal: space.card },
    list: { gap: 8, marginTop: 8 },
    head: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingBottom: 4 },
    title: { ...type.title, flexShrink: 1 },
    count: { ...type.subhead, ...figures },
    lead: { ...type.subhead, paddingBottom: 6 },
    skel: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 },
  }),
);
