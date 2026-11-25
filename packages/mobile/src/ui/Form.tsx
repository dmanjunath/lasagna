import { SymbolView } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme as useDesign } from "@/design";
import { CARD_TITLE_MAX_SCALE } from "./Card";
import { figures, icon, inputType, space, themedStyles, type, useTheme, weight } from "@/theme";
import { pressFeedback } from "./press";

/**
 * Every sheet's bar: Cancel (or a back chevron to the sheet's previous page)
 * on the left, the commit (Save, Done, Apply) on the right in bold, the title
 * centred. Same positions in every sheet. The two buttons keep their whole
 * words and the title gives way (one line, truncated). Like the system's bars,
 * its text stops growing at a modest size.
 */
/** Bar chrome stops growing at this text scale, as the system's navigation bars do. */
const BAR_MAX_SCALE = 1.3;

export function SheetBar({
  title,
  left,
  right,
}: {
  title: string;
  left?: { title: string; onPress: () => void; disabled?: boolean; symbol?: "chevron.left" };
  right?: { title: string; onPress: () => void; busy?: boolean; strong?: boolean; disabled?: boolean };
}) {
  const t = useTheme();
  return (
    <View collapsable={false} style={[styles.bar, { borderBottomColor: t.line, backgroundColor: t.canvas }]}>
      <View style={styles.barSide}>
        {left ? (
          <Pressable
            onPress={left.onPress}
            disabled={left.disabled}
            accessibilityRole="button"
            accessibilityLabel={left.title}
            hitSlop={8}
            style={[styles.barButton, { opacity: left.disabled ? 0.4 : 1 }]}
          >
            {left.symbol ? <SymbolView name={left.symbol} size={icon.md} weight="semibold" tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" /> : null}
            <Text style={[styles.barBtn, { color: t.brandInk }]} numberOfLines={1} maxFontSizeMultiplier={BAR_MAX_SCALE}>
              {left.title}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.barTitle, { color: t.content }]} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={BAR_MAX_SCALE}>
        {title}
      </Text>
      <View style={[styles.barSide, { justifyContent: "flex-end" }]}>
        {right ? (
          right.busy ? (
            <ActivityIndicator />
          ) : (
            <Pressable
              onPress={right.onPress}
              disabled={right.disabled}
              accessibilityRole="button"
              accessibilityLabel={right.title}
              accessibilityState={{ disabled: !!right.disabled }}
              hitSlop={8}
              style={{ opacity: right.disabled ? 0.4 : 1 }}
            >
              <Text style={[styles.barBtn, right.strong && weight.semibold, { color: t.brandInk }]} numberOfLines={1} maxFontSizeMultiplier={BAR_MAX_SCALE}>
                {right.title}
              </Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}

/**
 * A group of rows. Skins: `inset` (one rounded panel), `carded` (one quiet
 * filled card), `plain` (rows straight on the page, between dividers).
 */
export function Group({ children }: { children: React.ReactNode }) {
  const d = useDesign();
  const skin = d.skin.row;
  const fill = skin === "inset" ? d.color.surface : skin === "carded" ? d.color.surfaceMuted : "transparent";
  // A carded group is a card like every other: the same fill, warm edge and soft lift.
  const edge = skin === "carded" ? { borderWidth: 1, borderColor: d.color.hairline, boxShadow: d.shadow.sm } : null;
  return <View style={[styles.group, { backgroundColor: fill, borderRadius: skin === "carded" ? d.radius.lg : skin === "inset" ? d.radius.md : 0 }, edge]}>{children}</View>;
}

/**
 * The top of a detail sheet: what it's about, read at a glance. An optional
 * icon tile, the subject as a title, its key figure large in the numeric face
 * (in a meaning color when it has one, money in green), a muted line of
 * context, and an optional status badge. Centered, as Wallet's card details.
 */
export function SheetHero({
  leading,
  title,
  figure,
  figureColor,
  meta,
  badge,
}: {
  leading?: React.ReactNode;
  title: string;
  figure?: string;
  figureColor?: string;
  meta?: string[];
  badge?: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.hero}>
      {leading ? <View style={styles.heroLeading}>{leading}</View> : null}
      <Text style={[styles.heroTitle, { color: t.content }]} accessibilityRole="header" numberOfLines={2}>
        {title}
      </Text>
      {figure ? (
        <Text style={[styles.heroFigure, { color: figureColor ?? t.content }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {figure}
        </Text>
      ) : null}
      {meta?.filter(Boolean).map((line) => (
        <Text key={line} style={[styles.heroMeta, { color: t.contentMuted }]}>
          {line}
        </Text>
      ))}
      {badge ? (
        <View style={[styles.heroBadge, { backgroundColor: t.canvasSunken }]}>
          <Text style={[styles.heroBadgeText, { color: t.contentSecondary }]}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function Divider({ inset = space.rowInset }: { inset?: number }) {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginLeft: inset }} />;
}

/** Large text leaves no room for a label and its value on one line, so the value moves under the label, aligned with it (as in Settings). */
export function useStackedRows(): boolean {
  return useWindowDimensions().fontScale > 1.3;
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme();
  const stacked = useStackedRows();
  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      <Text style={[styles.label, { color: t.contentSecondary }]}>{label}</Text>
      <View style={[styles.rowValue, stacked && styles.rowValueStacked]}>{children}</View>
    </View>
  );
}

/** A row that opens something: label, the current value, and a chevron. `highlight`: the value differs from its default, in the brand ink. */
export function NavRow({ label, value, onPress, accessibilityLabel, highlight }: { label: string; value: string; onPress: () => void; accessibilityLabel?: string; highlight?: boolean }) {
  const t = useTheme();
  const stacked = useStackedRows();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}, ${value}`}
      style={({ pressed }) => [pressFeedback(t, pressed)]}
    >
      <FieldRow label={label}>
        <Text style={[styles.value, stacked && styles.valueStacked, highlight ? weight.semibold : weight.medium, { color: highlight ? t.brandInk : t.content }]} numberOfLines={1}>
          {value}
        </Text>
        <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
      </FieldRow>
    </Pressable>
  );
}

/** A tappable row with a check mark when chosen. */
export function CheckRow({
  label,
  detail,
  checked,
  mixed,
  onPress,
  strong,
  value,
}: {
  label: string;
  detail?: string;
  /** A figure at the trailing end of the label's line, as a list row shows its amount. */
  value?: string;
  checked: boolean;
  /** Part of a group is chosen. */
  mixed?: boolean;
  onPress: () => void;
  strong?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: mixed ? "mixed" : checked }}
      accessibilityLabel={[label, value, detail].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
    >
      <View style={{ flex: 1, paddingVertical: detail ? 8 : 0 }}>
        <View style={styles.checkLine}>
          <Text style={[styles.label, styles.checkLabel, strong && weight.semibold, { color: t.content }]} numberOfLines={1}>
            {label}
          </Text>
          {value ? <Text style={[styles.label, styles.figure, { color: t.content }]}>{value}</Text> : null}
        </View>
        {detail ? (
          <Text style={[styles.detail, { color: t.contentMuted }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {checked || mixed ? (
        <SymbolView name={mixed ? "minus" : "checkmark"} size={icon.md} weight="semibold" tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" />
      ) : null}
    </Pressable>
  );
}

/** The one section header: over a grouped section, a day of transactions, a drawer section. */
export function SectionHeader({
  children,
  style,
  maxScale,
  trailing,
}: {
  children: string;
  style?: StyleProp<ViewStyle>;
  maxScale?: number;
  /** A figure for the whole section at the trailing edge (a group's total). */
  trailing?: { text: string; color?: string };
}) {
  const t = useTheme();
  const title = (
    <Text style={[styles.sectionTitle, trailing && styles.sectionTitleGrow, { color: t.contentMuted }]} accessibilityRole="header" maxFontSizeMultiplier={maxScale ?? CARD_TITLE_MAX_SCALE}>
      {children}
    </Text>
  );
  if (!trailing) return <View style={style}>{title}</View>;
  return (
    <View style={[styles.sectionRow, style]}>
      {title}
      <Text style={[styles.sectionTrailing, { color: trailing.color ?? t.content }]} maxFontSizeMultiplier={maxScale ?? CARD_TITLE_MAX_SCALE}>
        {trailing.text}
      </Text>
    </View>
  );
}

/** A segmented choice styled with the theme, for two to four short options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  const d = useDesign();
  // A row of filled chips makes a capsule control, outlined chips a rounded one.
  const r = d.skin.chip === "filled" ? d.radius.pill : d.radius.sm;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.seg, { backgroundColor: t.canvasSunken, borderRadius: r }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={[styles.segItem, { borderRadius: r === d.radius.pill ? r : r - 2 }, on && [styles.segOn, { backgroundColor: d.color.thumb, borderColor: t.line, boxShadow: t.shadowSm }]]}
          >
            {/* Every segment at one size: the text stops growing early, like the system control, and a label that still runs long wraps at a word. */}
            <Text
              style={[styles.segText, on ? weight.semibold : weight.medium, { color: on ? d.color.onThumb : t.contentSecondary }]}
              numberOfLines={2}
              maxFontSizeMultiplier={1.2}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const formStyles = themedStyles(() => StyleSheet.create({
  // A form sheet's scroll view runs under the home indicator at the large detent.
  body: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: 22, paddingBottom: 96 },
  section: { gap: 6 },
  footnote: { ...type.footnote, paddingHorizontal: space.card },
  /** A form's own error, inline under the fields. */
  error: { ...type.subhead, ...weight.medium, paddingHorizontal: 4 },
  lead: { ...type.subhead, paddingHorizontal: 4 },
  // A value reads stronger than its muted label, as in every detail sheet.
  input: { ...inputType, ...weight.medium, flex: 1, textAlign: "right", minHeight: 44 },
  /** An input under its label at large text sizes: starts where the label starts. */
  inputStacked: { textAlign: "left" },
}));

const styles = themedStyles(() => StyleSheet.create({
  bar: { zIndex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, paddingHorizontal: space.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  // The sides grow to their words and never shrink. Each takes at least the
  // other's usual width, so the title stays centred in the common case.
  barSide: { flexGrow: 1, flexShrink: 0, minWidth: 72, flexDirection: "row", alignItems: "center", gap: 2 },
  barButton: { flexDirection: "row", alignItems: "center", gap: 2 },
  barTitle: { ...type.headline, flexShrink: 1, textAlign: "center" },
  barBtn: { ...type.body },
  group: { overflow: "hidden" },
  hero: { alignItems: "center", gap: 4, paddingTop: space.sm, paddingBottom: space.xs },
  // A row-sized icon tile, drawn larger as the sheet's emblem.
  heroLeading: { transform: [{ scale: 1.5 }], marginVertical: space.md },
  heroTitle: { ...type.title2, textAlign: "center" },
  heroFigure: { ...type.amountXL, ...figures, textAlign: "center", marginTop: 2 },
  heroMeta: { ...type.subhead, textAlign: "center" },
  heroBadge: { marginTop: space.xs, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  heroBadgeText: { ...type.footnote, ...weight.semibold },
  row: { flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: space.rowInset, gap: 12 },
  rowValue: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  rowStacked: { flexDirection: "column", alignItems: "stretch", gap: 2, paddingVertical: 8 },
  rowValueStacked: { flex: 0, justifyContent: "flex-start" },
  label: { ...type.body },
  value: { ...type.body, flexShrink: 1, textAlign: "right" },
  valueStacked: { flex: 1, textAlign: "left" },
  detail: { ...type.footnote, marginTop: 1 },
  checkLine: { flexDirection: "row", alignItems: "baseline", gap: 12 },
  checkLabel: { flex: 1 },
  // A copy: the shared `figures` object is refilled on a design switch, and a style passed as is gets frozen in development.
  figure: { ...figures },
  sectionTitle: { ...type.footnote, ...weight.semibold, paddingHorizontal: space.card },
  sectionTitleGrow: { flex: 1, paddingRight: 0 },
  sectionRow: { flexDirection: "row", alignItems: "baseline", gap: 12 },
  sectionTrailing: { ...type.subhead, ...figures, paddingRight: space.card },
  seg: { flexDirection: "row", padding: 2 },
  segItem: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  segOn: { borderWidth: StyleSheet.hairlineWidth },
  segText: { ...type.subhead, textAlign: "center" },
}));
