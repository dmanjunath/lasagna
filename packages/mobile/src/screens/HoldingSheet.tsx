import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Fragment } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useItems } from "@/api/accounts";
import { portfolioApi } from "@/api/portfolio";
import { formatMoney } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { openPath } from "@/lib/navigation";
import { accountIdFor, cleanAccountLabel, fmtPct, formatShares } from "@/lib/portfolio";
import { icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card } from "@/ui/Card";
import { Divider, formStyles, SectionHeader, SheetBar, SheetHero } from "@/ui/Form";
import { Skeleton } from "@/ui/Skeleton";
import { ErrorState } from "@/ui/State";
import { pressFeedback } from "@/ui/press";

/**
 * One holding's breakdown (the web's expanded holdings row): the fund's name
 * under its ticker when the API has one, then the accounts
 * that hold it, with shares, value and each one's share of the total. An
 * account row opens that account's page. The API names accounts only, so a
 * row opens its account when exactly one account has that name.
 */
export default function HoldingSheet({ symbol, label, name }: { symbol: string; label: string; name: string | null }) {
  const t = useTheme();
  const hidden = useAmountsHidden();
  const stacked = useWindowDimensions().fontScale > 1.3;
  const q = useQuery({ queryKey: ["portfolio", "symbol", symbol], queryFn: () => portfolioApi.symbolAccounts(symbol) });
  const items = useItems();
  const accounts = (items.data?.items ?? []).flatMap((i) => i.accounts.map((a) => ({ id: a.id, name: a.name })));
  const cash = symbol.trim().toUpperCase() === "CASH";
  const rows = q.data?.accounts ?? [];

  // openPath closes this sheet itself, then pushes onto the page the sheet came from.
  const open = (id: string) => openPath(`/accounts/${id}`);

  return (
    <>
      <SheetBar title={label} right={{ title: "Done", strong: true, onPress: () => router.back() }} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={[formStyles.body, { gap: 12 }]}>
        <SheetHero
          title={name ?? label}
          figure={q.data ? formatMoney(q.data.totalValue ?? 0, true) : undefined}
        />
        {q.isPending ? (
          <Card style={{ gap: 12 }}>
            <Skeleton width="50%" height={16} />
            <Skeleton width="100%" height={14} />
            <Skeleton width="80%" height={14} />
          </Card>
        ) : q.isError ? (
          <ErrorState compact title="Couldn't load the accounts" error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <SectionHeader>{`Held in ${rows.length} account${rows.length === 1 ? "" : "s"}`}</SectionHeader>
            {rows.length === 0 ? (
              <Text style={[styles.lead, { color: t.contentMuted }]}>No account breakdown for this holding.</Text>
            ) : (
              <Card style={styles.listCard}>
                {rows.map((a, i) => {
                  const id = accountIdFor(a.account, accounts);
                  const name = cleanAccountLabel(a.account);
                  const value = formatMoney(a.value, true);
                  // Cash rows carry dollars as shares, and an assumed split carries none: no count for either.
                  const shares = !cash && !hidden && a.shares > 0 ? `${formatShares(a.shares)} shares, ` : "";
                  const line = `${shares}${fmtPct(a.percentage)} of this holding`;
                  return (
                    <Fragment key={a.account}>
                      {i > 0 ? <Divider /> : null}
                      <Pressable
                        disabled={!id}
                        onPress={() => id && open(id)}
                        accessibilityRole={id ? "button" : "text"}
                        accessibilityLabel={`${name}, ${value}, ${line}`}
                        accessibilityHint={id ? "Opens the account" : undefined}
                        style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[styles.name, { color: t.content }]} numberOfLines={stacked ? 3 : 1}>
                            {name}
                          </Text>
                          <Text style={[styles.meta, { color: t.contentMuted }]}>{line}</Text>
                        </View>
                        <Text style={[styles.amount, { color: t.content }]}>{value}</Text>
                        <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={id ? t.contentFaint : "transparent"} accessibilityElementsHidden importantForAccessibility="no" />
                      </Pressable>
                    </Fragment>
                  );
                })}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    lead: { ...type.subhead, ...weight.semibold },
    listCard: { padding: 0 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 12, minHeight: 60 },
    name: { ...type.callout, ...weight.semibold },
    meta: { ...type.footnote },
    amount: { ...type.amountM },
  }),
);
