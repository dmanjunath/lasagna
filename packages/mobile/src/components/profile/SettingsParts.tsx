import type { ColorRoles, TintRole } from "@lasagna/design";
import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Children, Fragment, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { hasRoleColor } from "@/design/tint";
import type { DetailRow } from "@/lib/profile";
import { icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card } from "@/ui/Card";
import { Divider, useStackedRows } from "@/ui/Form";
import { Skeleton } from "@/ui/Skeleton";

// Settings' rows (Settings.tsx on the web): a list row that opens a section,
// a card of label and value rows, and a switch row.

/**
 * A tile's colors: the role's own tint where the theme has role colors (money
 * in for income, net worth for the household's shared accounts), else the
 * web's quiet sunken tile.
 */
export function tileColors(c: ColorRoles, role: TintRole): { fill: string; ink: string } {
  // Neutral's own fill is a soft card's fill, so a neutral tile takes the sunken well to stay visible on one.
  return role !== "neutral" && hasRoleColor(c, role) ? { fill: c.tint[role].fill, ink: c.tint[role].ink } : { fill: c.canvasSunken, ink: c.contentMuted };
}

export function RoleTile({ symbol, role, tone }: { symbol: SFSymbol; role: TintRole; tone?: "negative" }) {
  const d = useDesign();
  const { fill, ink } = tone === "negative" ? { fill: d.color.negativeSoft, ink: d.color.negative } : tileColors(d.color, role);
  return (
    <View style={[styles.tile, { backgroundColor: fill }]}>
      <SymbolView name={symbol} size={icon.md} weight="medium" tintColor={ink} accessibilityElementsHidden importantForAccessibility="no" />
    </View>
  );
}

/** A row that opens something: a tile, the name, an optional line under it, and a chevron. */
export function SettingsRow({
  symbol,
  role = "neutral",
  title,
  detail,
  onPress,
  tone,
  chevron = true,
}: {
  symbol?: SFSymbol;
  role?: TintRole;
  title: string;
  detail?: string | null;
  onPress: () => void;
  /** A destructive row (Delete account). */
  tone?: "negative" | "brand";
  chevron?: boolean;
}) {
  const t = useTheme();
  const color = tone === "negative" ? t.negative : tone === "brand" ? t.brandInk : t.content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.canvasSunken }]}
    >
      {symbol ? <RoleTile symbol={symbol} role={role} tone={tone === "negative" ? "negative" : undefined} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.title, { color }]}>{title}</Text>
        {detail ? (
          <Text style={[styles.detail, { color: t.contentMuted }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {chevron ? <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" /> : null}
    </Pressable>
  );
}

/** Rows in one card, divided under their text. */
export function RowCard({ children, tiles = true }: { children: ReactNode; tiles?: boolean }) {
  const items = Children.toArray(children);
  return (
    <Card style={styles.listCard}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 ? <Divider inset={tiles ? space.rowInset + 44 : space.rowInset} /> : null}
          {child}
        </Fragment>
      ))}
    </Card>
  );
}

/** Label and value, one line each (the value under its label at large text). "Not set" is muted. */
export function DetailRows({ rows, loading }: { rows: DetailRow[]; loading?: boolean }) {
  const t = useTheme();
  const stacked = useStackedRows();
  return (
    <Card style={styles.listCard}>
      {rows.map((r, i) => (
        <Fragment key={r.label}>
          {i > 0 ? <Divider /> : null}
          <View style={[styles.detailRow, stacked && styles.detailRowStacked]} accessible accessibilityLabel={`${r.label}, ${r.value}`}>
            <Text style={[styles.label, { color: t.contentMuted }]}>{r.label}</Text>
            {loading ? (
              <Skeleton width={90} height={14} />
            ) : (
              <Text style={[styles.value, !stacked && styles.valueEnd, r.muted ? { color: t.contentFaint } : { color: t.content }]}>{r.value}</Text>
            )}
          </View>
        </Fragment>
      ))}
    </Card>
  );
}

/** A switch with its name and an optional line. The whole row flips it. */
export function SwitchRow({
  symbol,
  role = "neutral",
  title,
  detail,
  value,
  onChange,
  disabled,
}: {
  symbol?: SFSymbol;
  role?: TintRole;
  title: string;
  detail?: string | null;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const flip = (v: boolean) => {
    if (disabled) return;
    Haptics.selectionAsync();
    onChange(v);
  };
  return (
    <Pressable
      onPress={() => flip(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={title}
      accessibilityHint={detail ?? undefined}
      style={({ pressed }) => [styles.row, pressed && !disabled && { backgroundColor: t.canvasSunken }]}
    >
      {symbol ? <RoleTile symbol={symbol} role={role} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.title, { color: disabled ? t.contentMuted : t.content }]}>{title}</Text>
        {detail ? <Text style={[styles.detail, { color: t.contentMuted }]}>{detail}</Text> : null}
      </View>
      <Switch value={value} onValueChange={flip} disabled={disabled} trackColor={{ true: t.brand }} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/** A short line under a screen's title saying what the section is for. */
export function ScreenLead({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={[styles.lead, { color: t.contentMuted }]}>{children}</Text>;
}

/** A small label pill (You, Owner, Canceling). */
export function Badge({ label, tone }: { label: string; tone?: "brand" | "caution" }) {
  const t = useTheme();
  const bg = tone === "brand" ? t.brandSoft : tone === "caution" ? t.cautionSoft : t.canvasSunken;
  const fg = tone === "brand" ? t.brandInk : tone === "caution" ? t.caution : t.contentSecondary;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    tile: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: space.rowInset, paddingVertical: 8 },
    title: { ...type.callout, ...weight.semibold },
    detail: { ...type.footnote },
    listCard: { padding: 0 },
    detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 48, paddingHorizontal: space.rowInset, paddingVertical: 8 },
    detailRowStacked: { flexDirection: "column", alignItems: "flex-start", gap: 2 },
    label: { ...type.callout },
    value: { ...type.callout, ...weight.semibold, fontVariant: ["tabular-nums"], flexShrink: 1 },
    valueEnd: { textAlign: "right" },
    lead: { ...type.footnote, ...weight.medium, paddingHorizontal: space.card, marginTop: -6 },
    badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { ...type.caption, ...weight.semibold },
  }),
);
