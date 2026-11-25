import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { saveErrorText } from "@/api/client";
import { txnApi, type TxnPatch } from "@/api/transactions";
import { formatCurrencyExact, formatStoredDate } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { useCategoryDisplay } from "@/lib/taxonomy";
import { heldTransaction, updateHeldTransaction } from "@/lib/txn-store";
import { space, themedStyles, type, useTheme } from "@/theme";
import { committed, failed } from "@/ui/feedback";
import { Divider, FieldRow, formStyles, Group, NavRow, SectionHeader, SheetBar, SheetHero } from "@/ui/Form";
import { CategoryMedallion } from "@/components/CategoryMedallion";
import { useDiscardGuard } from "@/ui/sheet";
import { CategoryPickerPage } from "@/components/transactions/CategoryList";
import { EmptyState } from "@/ui/State";

/**
 * A transaction's detail sheet: merchant, category, notes and exclude are
 * editable, the rest is read-only. Save sends only the changed fields, as
 * TransactionDetail does on the web. Reused by the transactions list.
 */
export default function TransactionSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tx = heldTransaction(id);
  if (!tx) return <EmptyState title="This transaction isn't loaded" action={{ title: "Close", onPress: () => router.back() }} />;
  return <Detail key={tx.id} tx={tx} />;
}

function Detail({ tx }: { tx: NonNullable<ReturnType<typeof heldTransaction>> }) {
  const t = useTheme();
  const qc = useQueryClient();
  const hidden = useAmountsHidden();
  const displayOf = useCategoryDisplay();
  // Seeded with the cleaned merchant only. Cleared, it goes back to the bank's description (shown above the field).
  const [merchant, setMerchant] = useState(tx.merchantName ?? "");
  const [category, setCategory] = useState(tx.categoryId ?? "");
  const [notes, setNotes] = useState(tx.notes ?? "");
  const [excluded, setExcluded] = useState(tx.excludedAt != null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = parseFloat(tx.amount);
  const income = amount < 0;

  // Only the fields that changed, as TransactionDetail does on the web.
  const body: TxnPatch = {};
  const trimmed = merchant.trim();
  // A cleared field resets the name to the bank's (M-12).
  if (!trimmed && tx.merchantName) body.merchantName = null;
  else if (trimmed && trimmed !== (tx.merchantName ?? "")) body.merchantName = trimmed;
  if (category !== (tx.categoryId ?? "")) body.category = category;
  if (notes !== (tx.notes ?? "")) body.notes = notes;
  if (excluded !== (tx.excludedAt != null)) body.excluded = excluded;
  const dirty = Object.keys(body).length > 0;
  const leave = useDiscardGuard(dirty && !saving);

  const save = async () => {
    if (!dirty) return router.back();
    setSaving(true);
    setError(null);
    try {
      await txnApi.update(tx.id, body);
    } catch (e) {
      setError(saveErrorText(e, "Couldn't save these changes. Check them and try again."));
      setSaving(false);
      return;
    }
    updateHeldTransaction(tx.id, rowPatch(body));
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    leave();
    // Undo puts back exactly the fields this save changed.
    const before: TxnPatch = {
      ...(body.merchantName !== undefined ? { merchantName: tx.merchantName } : {}),
      ...(body.category !== undefined ? { category: tx.categoryId ?? "" } : {}),
      ...(body.notes !== undefined ? { notes: tx.notes ?? "" } : {}),
      ...(body.excluded !== undefined ? { excluded: tx.excludedAt != null } : {}),
    };
    committed("Transaction updated", () => {
      txnApi
        .update(tx.id, before)
        .then(() => {
          updateHeldTransaction(tx.id, rowPatch(before));
          void qc.invalidateQueries({ queryKey: ["transactions"] });
          committed("Change undone");
        })
        .catch(() => failed("Couldn't undo. Try again."));
    });
  };

  if (picking) {
    return (
      <CategoryPickerPage
        title="Category"
        value={category}
        onCancel={() => setPicking(false)}
        onPick={(c) => {
          setCategory(c);
          setPicking(false);
        }}
      />
    );
  }

  // A formSheet lays out a header and a ScrollView natively, so the sheet is exactly those two views.
  return (
    <>
      <SheetBar
        title="Transaction"
        left={{ title: "Cancel", onPress: () => router.back(), disabled: saving }}
        right={{ title: "Save", onPress: () => void save(), busy: saving, strong: true }}
      />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
        <SheetHero
          leading={<CategoryMedallion display={displayOf(category)} income={income} />}
          title={trimmed || tx.merchantName || tx.name}
          figure={`${income && !hidden ? "+" : ""}${formatCurrencyExact(Math.abs(amount))}`}
          figureColor={income && !hidden ? t.positive : undefined}
          meta={[formatStoredDate(tx.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }), tx.accountName ?? ""]}
          badge={tx.pending === 1 ? "Pending" : undefined}
        />

        <View style={formStyles.section}>
          <SectionHeader>Details</SectionHeader>
          <Group>
            <FieldRow label="Merchant">
              <TextInput
                value={merchant}
                onChangeText={setMerchant}
                keyboardAppearance={t.keyboard}
                selectionColor={t.brandInk}
                accessibilityLabel="Merchant"
                returnKeyType="done"
                clearButtonMode="while-editing"
                style={[formStyles.input, { color: t.content }]}
              />
            </FieldRow>
            <Divider />
            <NavRow label="Category" value={displayOf(category).label} onPress={() => setPicking(true)} />
            {/* The bank's own wording, only when it says something the name above doesn't. */}
            {tx.name.trim().toLowerCase() !== (trimmed || tx.merchantName || "").trim().toLowerCase() ? (
              <>
                <Divider />
                <FieldRow label="Bank description">
                  <Text style={[styles.readonly, { color: t.contentSecondary }]} numberOfLines={2}>
                    {tx.name}
                  </Text>
                </FieldRow>
              </>
            ) : null}
          </Group>
        </View>

        <View style={formStyles.section}>
          <SectionHeader>Note</SectionHeader>
          <Group>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note"
              placeholderTextColor={t.contentFaint}
              keyboardAppearance={t.keyboard}
              selectionColor={t.brandInk}
              multiline
              maxLength={2000}
              accessibilityLabel="Notes"
              style={[styles.notes, { color: t.content }]}
            />
          </Group>
        </View>

        <View style={formStyles.section}>
          <SectionHeader>Totals</SectionHeader>
          <Group>
            <FieldRow label="Exclude from spending">
              <Switch
                value={excluded}
                onValueChange={setExcluded}
                trackColor={{ true: t.brand }}
                accessibilityLabel="Exclude from spending"
              />
            </FieldRow>
          </Group>
          <Text style={[formStyles.footnote, { color: t.contentMuted }]}>Excluded transactions don't count toward spending, income, or charts.</Text>
        </View>

        {error ? <Text style={[formStyles.error, { color: t.negative }]}>{error}</Text> : null}
      </ScrollView>
    </>
  );
}

/** The held row's fields after a patch, so the list shows the change before it refetches. */
function rowPatch(body: TxnPatch) {
  return {
    ...(body.merchantName !== undefined ? { merchantName: body.merchantName } : {}),
    ...(body.category !== undefined ? { categoryId: body.category } : {}),
    ...(body.notes !== undefined ? { notes: body.notes.trim() === "" ? null : body.notes } : {}),
    ...(body.excluded !== undefined ? { excludedAt: body.excluded ? new Date().toISOString() : null } : {}),
  };
}

const styles = themedStyles(() => StyleSheet.create({
  readonly: { ...type.body, flexShrink: 1, textAlign: "right" },
  notes: { ...type.body, minHeight: 96, paddingHorizontal: space.rowInset, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" },
}));
