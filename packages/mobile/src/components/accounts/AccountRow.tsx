import type { TintRole } from "@lasagna/design";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { AccountRowData, ValueSource } from "@/lib/account-list";
import { formatMoney } from "@/lib/format";
import { icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { CategoryMedallion } from "@/components/CategoryMedallion";
import { InstIcon } from "./InstIcon";
import { pressFeedback } from "@/ui/press";

/** An account type's tint: what you own is wealth, what you owe is spending, cash is money in. */
export function accountTypeRole(type: string): TintRole {
  if (type === "credit" || type === "loan") return "spend";
  if (type === "depository") return "income";
  if (type === "investment" || type === "real_estate" || type === "alternative") return "wealth";
  return "neutral";
}

/** An account type's symbol, for a tile with no institution logo. */
export function accountTypeSymbol(type: string, subtype?: string | null): SFSymbol {
  if (type === "credit") return "creditcard";
  if (type === "investment") return "chart.line.uptrend.xyaxis";
  if (type === "real_estate") return "house";
  if (type === "loan") return subtype === "mortgage" ? "house" : subtype === "auto" ? "car" : subtype === "student" ? "graduationcap" : "doc.text";
  if (type === "depository") return subtype === "savings" ? "banknote" : "building.columns";
  return "square.stack";
}

type BadgeTone = "positive" | "info" | "neutral";

/** A small tinted tag: where a value came from, Frozen, Not counted. */
export function Tag({ label, tone, symbol }: { label: string; tone: BadgeTone; symbol?: SFSymbol }) {
  const t = useTheme();
  const fill = tone === "positive" ? t.positiveSoft : tone === "info" ? t.infoSoft : t.faintFill;
  const ink = tone === "positive" ? t.positive : tone === "info" ? t.info : t.contentSecondary;
  return (
    <View style={[styles.tag, { backgroundColor: fill }]}>
      {symbol ? <SymbolView name={symbol} size={icon.xs} weight="bold" tintColor={ink} accessibilityElementsHidden importantForAccessibility="no" /> : null}
      <Text style={[styles.tagText, { color: ink }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </View>
  );
}

const SOURCE: Record<ValueSource, { label: string; tone: BadgeTone; symbol: SFSymbol }> = {
  synced: { label: "Synced", tone: "positive", symbol: "arrow.triangle.2.circlepath" },
  estimated: { label: "Estimated", tone: "info", symbol: "sparkles" },
  manual: { label: "You entered", tone: "neutral", symbol: "pencil" },
};

/** Where an account's value came from (the web's ValueSourceBadge). */
export function ValueSourceTag({ source }: { source: ValueSource }) {
  const s = SOURCE[source];
  return <Tag label={s.label} tone={s.tone} symbol={s.symbol} />;
}

/** The figure a row shows: unsigned under Debt (owed), else with a true minus when negative. */
export function rowAmount(r: Pick<AccountRowData, "value" | "negative" | "owed">): string {
  const abs = formatMoney(Math.abs(r.value), true);
  return r.negative && !r.owed && !abs.includes("•") ? `−${abs}` : abs;
}

/**
 * One account, as the web's AcctRow: its institution's tile, the name and a
 * line of what it is, the balance, and where the value came from. The whole
 * row opens the account.
 */
function AccountRowBase({ row, onPress, hideIcon, hidden }: { row: AccountRowData; onPress: (id: string) => void; hideIcon?: boolean; hidden: boolean }) {
  const t = useTheme();
  const stacked = useWindowDimensions().fontScale > 1.3;
  const a = row.account;
  const amount = rowAmount(row);
  const frozen = a.frozen === true;
  const status = frozen ? (
    <Tag label="Frozen" tone="info" symbol="lock.fill" />
  ) : row.estimating ? (
    <Tag label="Estimating" tone="info" symbol="sparkles" />
  ) : a.valueSource ? (
    <ValueSourceTag source={a.valueSource} />
  ) : null;
  const amountEl = (
    <Text style={[styles.amount, { color: row.negative && !hidden ? t.negative : t.content }]} numberOfLines={1}>
      {amount}
    </Text>
  );
  const meta = `${row.meta}${a.mask ? `${row.meta ? " " : ""}••${a.mask}` : ""}`;
  return (
    <Pressable
      onPress={() => onPress(a.id)}
      accessibilityRole="button"
      accessibilityLabel={[row.name, amount, row.owed ? "owed" : null, meta, ...row.badges, frozen ? "Frozen" : null, row.estimating ? "Estimating value" : null]
        .filter(Boolean)
        .join(", ")}
      style={({ pressed }) => [styles.row, { opacity: frozen ? 0.7 : 1 }, pressFeedback(t, pressed)]}
    >
      {hideIcon ? null : row.item.institutionId === "manual" ? (
        // An account entered by hand has no institution logo: its type's symbol, in the tile every list row uses.
        <CategoryMedallion role={accountTypeRole(a.type)} display={{ label: a.type, symbol: accountTypeSymbol(a.type, a.subtype), emoji: null }} />
      ) : (
        <InstIcon institution={row.institution} />
      )}
      <View style={styles.main}>
        <Text style={[styles.name, { color: t.content }]} numberOfLines={stacked ? 2 : 1}>
          {row.name}
        </Text>
        {meta ? (
          <Text style={[styles.meta, { color: t.contentMuted }]} numberOfLines={stacked ? 3 : 2}>
            {meta}
          </Text>
        ) : null}
        {row.badges.length > 0 || (stacked && status) ? (
          <View style={styles.tags}>
            {row.badges.map((b) => (
              <Tag key={b} label={b} tone="neutral" />
            ))}
            {stacked ? status : null}
          </View>
        ) : null}
        {stacked ? amountEl : null}
      </View>
      {stacked ? null : (
        <View style={styles.right}>
          {amountEl}
          {status}
        </View>
      )}
      <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

export const AccountRow = memo(AccountRowBase);

const styles = themedStyles(() =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 12, minHeight: 64 },
    main: { flex: 1, gap: 2 },
    name: { ...type.callout, ...weight.semibold },
    meta: { ...type.footnote },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
    right: { alignItems: "flex-end", gap: 4, maxWidth: "45%" },
    amount: { ...type.amountM },
    tag: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2, alignSelf: "flex-start" },
    tagText: { ...type.caption, ...weight.bold },
  }),
);
