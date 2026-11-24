import type { TxnQueryRow } from "@web/lib/api";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from "react-native";
import { formatCurrencyExact, formatStoredDay } from "@/lib/format";
import type { CategoryDisplay } from "@/lib/taxonomy";
import { txnRowTone } from "@/lib/txn-row";
import { icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { CategoryMedallion } from "./CategoryMedallion";
import { pressScale } from "@/ui/press";

// Income (amount < 0) reads positive with a leading "+", as on the web.
function TxnRowBase({
  row,
  display,
  onPress,
  hidden,
  selecting,
  selected,
  showDate,
  hideAccount,
  accessibilityActions,
  onAccessibilityAction,
  surface = "canvas",
}: {
  row: TxnQueryRow;
  display: CategoryDisplay;
  onPress?: (row: TxnQueryRow) => void;
  /** Part of the props so the memoized row re-renders when amounts hide. */
  hidden: boolean;
  /** Selection: a check circle before the medallion. */
  selecting?: boolean;
  selected?: boolean;
  /** The date in the meta line, for lists without day headers. */
  showDate?: boolean;
  /** Filtered to one account, every row would repeat its name. */
  hideAccount?: boolean;
  /** VoiceOver's version of a long-press menu. */
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
  /** What the row sits on: the screen's canvas, or a card (the row is then clear, the card's own fill shows). */
  surface?: "canvas" | "card";
}) {
  const t = useTheme();
  // At the larger text sizes the amount leaves the merchant too little room beside it.
  const stacked = useWindowDimensions().fontScale > 1.3;
  const amount = parseFloat(row.amount);
  const income = amount < 0;
  const excluded = !!row.excludedAt;
  // Meaningful color (owner, 2026-11-23): see txnRowTone.
  const tone = txnRowTone(row, hidden);
  const ink = tone.text === "secondary" ? t.contentSecondary : t.content;
  const amountText = `${income && !hidden ? "+" : ""}${formatCurrencyExact(Math.abs(amount))}`;
  const merchant = row.merchantName || row.name;
  const meta = [row.pending ? "Pending" : null, display.label, showDate ? formatStoredDay(row.date) : null, excluded ? "excluded" : null]
    .filter(Boolean)
    .join(", ");
  const amountEl = (
    <Text style={[styles.amount, { color: tone.amount === "positive" ? t.positive : ink }]}>{amountText}</Text>
  );
  const metaText = (
    <Text style={[styles.meta, styles.metaLeft, { color: t.contentMuted }]} numberOfLines={1}>
      {meta}
    </Text>
  );
  const accountEl =
    row.accountName && !hideAccount ? (
      <Text style={[styles.meta, !stacked && styles.account, { color: t.contentMuted }]} numberOfLines={1}>
        {row.accountName}
      </Text>
    ) : null;
  return (
    <Pressable
      onPress={onPress ? () => onPress(row) : undefined}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: selected ? t.brandSofter : pressed ? t.canvasSunken : surface === "card" ? "transparent" : t.canvas },
        tone.faded && !selecting && styles.dim,
        !selected && pressScale(pressed),
      ]}
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: !!selected } : undefined}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      accessibilityLabel={`${merchant}, ${amountText}, ${meta}${row.accountName && !hideAccount ? `, ${row.accountName}` : ""}`}
    >
      {selecting ? (
        <SymbolView
          name={selected ? "checkmark.circle.fill" : "circle"}
          size={icon.lg}
          tintColor={selected ? t.brandInk : t.contentFaint}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : null}
      <CategoryMedallion display={display} income={income} />
      {/* Each line has its own right edge, so the account label never takes the merchant's room. */}
      <View style={styles.main}>
        {stacked ? (
          // Large text: the merchant gets the full width, the amount moves down beside the category.
          <>
            <Text style={[styles.merchant, { color: ink }]} numberOfLines={2}>
              {merchant}
            </Text>
            <View style={styles.line}>
              {metaText}
              {amountEl}
            </View>
            {accountEl}
          </>
        ) : (
          <>
            <View style={styles.line}>
              <Text style={[styles.merchant, styles.merchantInline, { color: ink }]} numberOfLines={1}>
                {merchant}
              </Text>
              {amountEl}
            </View>
            <View style={styles.line}>
              {metaText}
              {accountEl}
            </View>
          </>
        )}
      </View>
      {/* No chevron: a tap opens a sheet over the list, not a pushed screen. */}
    </Pressable>
  );
}

export const TxnRow = memo(TxnRowBase);

const styles = themedStyles(() => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 10, minHeight: 64 },
  main: { flex: 1, gap: 2 },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  // The merchant takes what the amount leaves. On the second line the account gives way first.
  metaLeft: { flexShrink: 1 },
  account: { flexShrink: 4, maxWidth: "50%", textAlign: "right" },
  merchant: { ...type.callout, ...weight.semibold },
  merchantInline: { flex: 1 },
  meta: { ...type.footnote },
  amount: { ...type.amountM },
  dim: { opacity: 0.5 },
}));
