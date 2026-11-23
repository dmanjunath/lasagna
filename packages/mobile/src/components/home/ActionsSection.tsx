import type { ApiActionRow } from "@web/lib/action-rows";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { homeActions } from "@/lib/home-actions";
import { openPath } from "@/lib/navigation";
import { space, themedStyles } from "@/theme";
import { CardHeader } from "@/ui/Card";
import { Skeleton } from "@/ui/Skeleton";
import { EmptyState, ErrorState } from "@/ui/State";
import { ActionBlock } from "@/components/actions/ActionGroup";
import { ActionItem, DoneItem } from "./ActionItem";

/**
 * Home's shortlist of open actions, on the theme's highlight (the sticky-note
 * tint, kept for action rows only). Rows done here stay, ticked, with a
 * sparkle, until the screen reloads.
 */
export function ActionsSection({
  actions,
  done,
  loading,
  failed,
  generating,
  onRetry,
  onGenerate,
  onComplete,
  onSnooze,
  onDismiss,
}: {
  actions: ApiActionRow[];
  /** Titles of actions marked done on this visit. */
  done: string[];
  loading: boolean;
  failed: boolean;
  generating: boolean;
  onRetry: () => void;
  onGenerate: () => void;
  onComplete: (row: ApiActionRow) => Promise<void>;
  onSnooze: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const d = useDesign();
  const shown = useMemo(() => homeActions(actions), [actions]);
  const byId = useMemo(() => new Map(actions.map((a) => [a.id, a])), [actions]);
  // Only offered when there is more behind it than home shows.
  const more = !loading && !failed && actions.length > shown.length;
  // Skins: `highlight` sets the rows in one plain card (the greeting is Home's
  // hero, so this card is not tinted). `accentBar` lists them as separate
  // cards with no block of its own (the greeting card holds it on that theme).
  const bar = d.skin.actionCard === "accentBar";

  return (
    <ActionBlock bar={bar}>
      <View style={styles.head}>
        <CardHeader
          title="Actions"
          link={more ? { title: `See all ${actions.length}`, label: `See all ${actions.length} actions`, onPress: () => openPath("/insights") } : undefined}
        />
      </View>

      {loading ? (
        <View accessibilityLabel="Loading actions" accessible>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.skel, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: d.color.line }]}>
              <Skeleton width={28} height={28} style={{ borderRadius: 14 }} />
              <Skeleton width={i === 1 ? "55%" : "70%"} height={14} />
            </View>
          ))}
        </View>
      ) : failed ? (
        <ErrorState compact title="Couldn't load your actions" onRetry={onRetry} />
      ) : shown.length > 0 || done.length > 0 ? (
        <View style={bar && styles.list}>
          {shown.map((a, i) => (
            <ActionItem
              key={a.id}
              row={a}
              first={i === 0}
              onComplete={() => onComplete(byId.get(a.id)!)}
              onSnooze={() => onSnooze(a.id)}
              onDismiss={() => onDismiss(a.id)}
            />
          ))}
          {done.map((title, i) => (
            <DoneItem key={`${title}-${i}`} title={title} first={shown.length === 0 && i === 0} />
          ))}
        </View>
      ) : (
        <EmptyState
          compact
          title="No actions yet"
          body="Get personalized actions based on your finances."
          action={{ title: "Generate actions", onPress: onGenerate, loading: generating }}
        />
      )}
    </ActionBlock>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    list: { gap: 8, marginTop: 8 },
    head: { paddingBottom: 4 },
    skel: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 },
  }),
);
