import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { billWhen, fmtUsd, type Bill } from "@/lib/home";
import { figures, icon, themedStyles, type, useTheme } from "@/theme";
import { Card } from "@/ui/Card";

/** A single note when a big bill is due within the week. */
export function BillNote({ bill, account }: { bill: Bill; account: { name: string; balance: number } | null }) {
  const t = useTheme();
  useAmountsHidden();
  const covered = account ? account.balance >= bill.amount : null;
  return (
    <Card style={{ gap: 6 }}>
      <View style={styles.head}>
        <SymbolView name="calendar" size={icon.md} tintColor={t.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
        <Text style={[styles.title, { color: t.content }]}>
          {bill.name} <Text style={styles.num}>{fmtUsd(bill.amount)}</Text>
        </Text>
      </View>
      <Text style={[styles.body, { color: t.contentMuted }]}>
        {billWhen(bill.daysAway)}
        {account ? (
          <>
            {" "}from {account.name}.{" "}
            {covered ? (
              <>You're covered. The balance is {fmtUsd(account.balance)}.</>
            ) : (
              <Text style={{ color: t.negative }}>Balance {fmtUsd(account.balance)} may not cover.</Text>
            )}
          </>
        ) : null}
      </Text>
    </Card>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { ...type.headline, flex: 1 },
  num: { ...figures },
  body: { ...type.subhead },
}));
