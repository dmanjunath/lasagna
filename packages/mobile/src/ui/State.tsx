import { SymbolView, type SFSymbol } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { icon as iconSize, space, themedStyles, type, useTheme } from "@/theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { Mascot } from "./Mascot";
import { Note } from "./Note";
import { errorText } from "@/api/client";

/**
 * Nothing to show yet: an optional icon, a title, a line of body and at most
 * one primary action, at its own width. `compact` sits inside a card.
 * Otherwise it leads the page from the top, under the title, in the theme's
 * `emptyState` skin: `open` on the page (with the sleeping mascot where the
 * theme has one), or `panel`, one card (the web's page empty state).
 * `gutter`: it stands alone, outside a screen's padded body (a sheet, a
 * screen with no scroll view), so it keeps the screen's gutter itself.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  secondary,
  compact,
  art: showArt = true,
  note,
  gutter,
}: {
  icon?: SFSymbol;
  title: string;
  body?: string;
  action?: { title: string; onPress: () => void; loading?: boolean };
  /** The other way forward, as a quieter button under the action (Finish setup, or Connect a bank). */
  secondary?: { title: string; onPress: () => void };
  compact?: boolean;
  /** False for a screen that is empty only because of a filter: no sleeping mascot for that. */
  art?: boolean;
  /** The screen's one handwritten aside, under the action. Shown only where the theme has a note accent. */
  note?: string;
  gutter?: boolean;
}) {
  const t = useTheme();
  const d = useDesign();
  const panel = !compact && d.skin.emptyState === "panel";
  // A full-screen empty state shows the theme's art: its sleeping mascot, or the icon.
  const art = !showArt ? "none" : compact ? (icon ? "icon" : "none") : d.skin.emptyArt === "mascot" && d.mascot ? "mascot" : d.skin.emptyArt === "none" || !icon ? "none" : "icon";
  const content = (
    <>
      {art === "mascot" ? (
        <View style={[styles.mascot, { backgroundColor: d.color.surfaceMuted }]}>
          <Mascot name="sleepy" width={150} />
        </View>
      ) : art === "icon" && icon ? (
        <View style={[styles.icon, { backgroundColor: t.brandSoft, borderRadius: panel ? d.radius.md : 24 }]}>
          <SymbolView name={icon} size={iconSize.lg} tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
      ) : null}
      <Text style={[compact ? styles.titleCompact : panel ? styles.titlePanel : styles.title, { color: t.content }]} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={[compact || panel ? styles.body : styles.bodyOpen, { color: compact || panel ? t.contentMuted : t.contentSecondary }]}>{body}</Text> : null}
      {action ? <Button title={action.title} onPress={action.onPress} loading={action.loading} size={compact ? "compact" : "regular"} style={compact ? styles.actionCompact : panel ? styles.actionPanel : styles.action} /> : null}
      {secondary ? <Button title={secondary.title} variant="secondary" onPress={secondary.onPress} size={compact ? "compact" : "regular"} style={styles.secondary} /> : null}
      {note && d.skin.noteAccent === "handwritten" ? (
        <View style={styles.note}>
          <Note muted>{note}</Note>
        </View>
      ) : null}
    </>
  );
  if (compact) return <View style={styles.compact}>{content}</View>;
  return <View style={[styles.screen, gutter && styles.gutter]}>{panel ? <Card style={styles.panel}>{content}</Card> : <View style={styles.open}>{content}</View>}</View>;
}

/** A load that failed: a title, an optional line of body, and Try again (or `retryLabel` when the way out is something else). */
export function ErrorState({ title, body, error, onRetry, compact, retryLabel = "Try again" }: { title: string; body?: string; error?: unknown; onRetry: () => void; compact?: boolean; retryLabel?: string }) {
  const t = useTheme();
  // The failure itself picks the words: no connection, or our side (errorText).
  if (body === undefined && error !== undefined) body = errorText(error);
  return (
    <View style={compact ? styles.compact : styles.error} accessibilityLiveRegion="polite">
      <View style={[styles.icon, styles.errorIcon, { backgroundColor: t.negativeSoft }]}>
        <SymbolView name="exclamationmark.circle" size={iconSize.lg} tintColor={t.negative} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <Text style={[compact ? styles.titleCompact : styles.title, { color: t.content }]} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={[styles.body, { color: t.contentMuted }]}>{body}</Text> : null}
      <Button title={retryLabel} variant="secondary" size={compact ? "compact" : "regular"} onPress={onRetry} style={compact ? styles.actionCompact : styles.errorAction} />
    </View>
  );
}

/** A card whose own request failed. */
export function CardError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Card>
      <ErrorState compact title={title} onRetry={onRetry} />
    </Card>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // Near the top, under the page's title: not centred in whatever height is left.
  screen: { paddingTop: space.lg, paddingBottom: 32 },
  gutter: { paddingHorizontal: space.screen },
  open: { alignItems: "center", paddingHorizontal: 24, gap: 14 },
  panel: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 40, gap: 8 },
  error: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 48, gap: 8 },
  compact: { alignItems: "center", paddingVertical: 12, gap: 6 },
  icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  errorIcon: { borderRadius: 24 },
  // The approved mockup: a 220 by 170 pill with the mascot asleep at its foot.
  mascot: { width: 220, height: 170, borderRadius: 110, alignItems: "center", justifyContent: "flex-end", paddingBottom: 10 },
  title: { ...type.title1, textAlign: "center" },
  titlePanel: { ...type.title, textAlign: "center" },
  titleCompact: { ...type.headline, textAlign: "center" },
  body: { ...type.subhead, textAlign: "center" },
  bodyOpen: { ...type.callout, textAlign: "center" },
  // At its own width, never stretched across the screen.
  action: { alignSelf: "center", marginTop: 6, paddingHorizontal: 30 },
  actionPanel: { alignSelf: "center", marginTop: 16 },
  actionCompact: { marginTop: 8, alignSelf: "center" },
  note: { marginTop: 6, alignSelf: "center" },
  secondary: { alignSelf: "center", paddingHorizontal: 30 },
  errorAction: { marginTop: 8, alignSelf: "stretch" },
}));
