import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { accountsApi, invalidateAccounts, useItems } from "@/api/accounts";
import { debtApi } from "@/api/debt";
import { saveErrorText } from "@/api/client";
import { AddressField, ChoicePage, DateRow, InputRow, ToggleRow, ValueSourceSection } from "@/components/accounts/FormFields";
import { editFormFrom, loanFields, type DebtFallback, loanTypeOf, savePlan, typeKey, typeOptionsFor, type EditForm } from "@/lib/account-edit";
import { displayName, effectiveBalance, findAccount, isDebtType, isManualItem, type Item, type ItemAccount } from "@/lib/account-list";
import { markAccountDeleted } from "@/lib/account-sheets";
import { moneyInput } from "@/lib/add-account";
import { formatMoney } from "@/lib/format";
import { space, themedStyles, type, useTheme, weight } from "@/theme";
import { committed, failed } from "@/ui/feedback";
import { Divider, formStyles, Group, NavRow, SectionHeader, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";
import { EmptyState } from "@/ui/State";
import { pressFeedback } from "@/ui/press";

/**
 * An account's settings (the web's /accounts/:id/edit), as a sheet: address
 * and value for a property, name and (by hand) value, type, the three display
 * overrides, loan details, the linked property, rental economics, and Delete
 * for an account entered by hand.
 */
export default function AccountEditSheet({ id }: { id: string }) {
  const items = useItems();
  const found = items.data ? findAccount(items.data.items, id) : null;
  // The payoff plan's rate and minimum, so the form starts from the figures Loan details shows.
  const debts = useQuery({ queryKey: ["debts"], queryFn: debtApi.list, enabled: !!found && isDebtType(found.account.type) });
  if (items.isPending || (debts.fetchStatus === "fetching" && !debts.data)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!found) return <EmptyState gutter title="This account isn't available" action={{ title: "Close", onPress: () => router.back() }} />;
  return <Editor key={id} account={found.account} item={found.item} items={items.data!.items} debt={debts.data?.debts.find((x) => x.id === id) ?? null} />;
}

type Page = "form" | "type" | "property";

function Editor({ account: a, item, items, debt }: { account: ItemAccount; item: Item; items: Item[]; debt: DebtFallback }) {
  const t = useTheme();
  const qc = useQueryClient();
  const manual = isManualItem(item);
  const liability = isDebtType(a.type);
  const property = a.type === "real_estate";
  const [initial] = useState(() => editFormFrom(a, debt));
  const [form, setForm] = useState<EditForm>(initial);
  const set = (patch: Partial<EditForm>) => setForm((f) => ({ ...f, ...patch }));
  const [page, setPage] = useState<Page>("form");
  const [rejected, setRejected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const leave = useDiscardGuard(dirty && !saving && !deleting);

  const options = useMemo(() => typeOptionsFor(a), [a]);
  const chosen = options.find((o) => typeKey(o.type, o.subtype) === form.typeKey) ?? options[0];
  const crosses = liability !== isDebtType(chosen.type);
  const loanType = loanTypeOf(a);
  const fields = loanFields(loanType);
  const properties = items.flatMap((i) => i.accounts).filter((x) => x.type === "real_estate");
  const linkedName = properties.find((p) => p.id === form.linkedPropertyId);
  const balance = parseFloat(a.balance ?? "0");
  const counted = form.invertBalance ? -balance : balance;

  const confirm = (title: string, body: string, ok: string) =>
    new Promise<boolean>((resolve) =>
      Alert.alert(title, body, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: ok, onPress: () => resolve(true) },
      ]),
    );

  const save = async () => {
    if (!dirty) return router.back();
    const plan = savePlan(a, manual, form, initial);
    if (plan.crossesBucket && !(await confirm("Change net worth?", `Reclassifying this account moves it ${isDebtType(chosen.type) ? "into debt" : "into assets"} and will change your net worth.`, "Save change"))) return;
    if (plan.reEstimates && !(await confirm("Re-estimate this home?", "Changing the address will re-estimate this home's value and replace the current one.", "Change address"))) return;
    setSaving(true);
    setError(null);
    try {
      if (plan.manualBalance !== undefined) await accountsApi.updateManual(a.id, { balance: plan.manualBalance });
      await accountsApi.update(a.id, plan.update);
      if (plan.loan) await accountsApi.loanDetails(a.id, plan.loan);
      if (plan.property) await accountsApi.propertyDetails(a.id, plan.property);
    } catch (e) {
      setError(saveErrorText(e, "Couldn't save these changes. Check them and try again."));
      setSaving(false);
      // Part of it may have landed.
      invalidateAccounts(qc);
      return;
    }
    invalidateAccounts(qc);
    leave();
    committed("Changes saved");
  };

  const remove = () => {
    Alert.alert(`Delete "${displayName(a)}"?`, "The account and its full balance history will be permanently removed. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await accountsApi.deleteManual(a.id);
          } catch {
            setDeleting(false);
            failed("Couldn't delete this account. Try again.");
            return;
          }
          markAccountDeleted(a.id);
          invalidateAccounts(qc);
          leave();
          committed(`Deleted ${displayName(a)}`);
        },
      },
    ]);
  };

  if (page === "type") {
    return (
      <ChoicePage
        title="Account type"
        value={form.typeKey}
        options={options.map((o) => ({ value: typeKey(o.type, o.subtype), label: o.label }))}
        onCancel={() => setPage("form")}
        onPick={(v) => {
          set({ typeKey: v });
          setPage("form");
        }}
      />
    );
  }
  if (page === "property") {
    return (
      <ChoicePage
        title="Secured by"
        value={form.linkedPropertyId}
        options={[{ value: "", label: "No property" }, ...properties.map((p) => ({ value: p.id, label: displayName(p), detail: formatMoney(effectiveBalance(p), true) }))]}
        onCancel={() => setPage("form")}
        onPick={(v) => {
          set({ linkedPropertyId: v });
          setPage("form");
        }}
      />
    );
  }

  const money = (k: keyof EditForm) => (v: string) => set({ [k]: moneyInput(v) } as Partial<EditForm>);

  return (
    <>
      <SheetBar
        title="Edit account"
        left={{ title: "Cancel", onPress: () => router.back(), disabled: saving || deleting }}
        right={{ title: "Save", strong: true, busy: saving, disabled: deleting, onPress: () => void save() }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={formStyles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {property ? (
          <>
            <View style={formStyles.section}>
              <SectionHeader>Address</SectionHeader>
              <AddressField
                value={form.address}
                rejected={rejected}
                onReject={() => setRejected(true)}
                onText={(address) => {
                  setRejected(false);
                  set({ address, placeId: "", lat: "", lng: "" });
                }}
                onPick={(p) => {
                  setRejected(false);
                  set({ address: p.address, placeId: p.placeId, lat: p.lat != null ? String(p.lat) : "", lng: p.lng != null ? String(p.lng) : "" });
                }}
              />
            </View>
            <ValueSourceSection source={form.valueSource} onSource={(valueSource) => set({ valueSource })} ownValue={form.ownValue} onOwnValue={(ownValue) => set({ ownValue })} />
          </>
        ) : null}

        <View style={formStyles.section}>
          <SectionHeader>Details</SectionHeader>
          <Group>
            <InputRow label="Name" value={form.name} onChange={(name) => set({ name })} autoCapitalize="words" />
            {manual && !property ? (
              <>
                <Divider />
                <InputRow label={liability ? "Amount owed" : "Value"} value={form.value} onChange={money("value")} money keyboardType="decimal-pad" placeholder="0" />
              </>
            ) : null}
          </Group>
          {manual ? null : (
            <Text style={[formStyles.footnote, { color: t.contentMuted }]}>The balance syncs from your bank and can't be edited. Renaming only changes how the account appears here.</Text>
          )}
        </View>

        <View style={formStyles.section}>
          <SectionHeader>Classification</SectionHeader>
          <Group>
            <NavRow label="Account type" value={chosen.label} onPress={() => setPage("type")} />
          </Group>
          {crosses ? (
            <Text style={[formStyles.footnote, { color: t.negative }]}>
              {`This moves the account ${isDebtType(chosen.type) ? "into debt" : "into assets"}. It will change your net worth.`}
            </Text>
          ) : null}
        </View>

        <View style={formStyles.section}>
          <SectionHeader>Display</SectionHeader>
          <Group>
            <ToggleRow
              label="Exclude from net worth"
              detail={`Keep the account visible but leave its ${formatMoney(Math.abs(counted), true)} out of net worth totals and the chart.`}
              value={form.excludeFromNetWorth}
              onChange={(excludeFromNetWorth) => set({ excludeFromNetWorth })}
            />
            <Divider />
            <ToggleRow
              label="Exclude transactions"
              detail="Hide this account's transactions from spending and activity views."
              value={form.excludeTransactions}
              onChange={(excludeTransactions) => set({ excludeTransactions })}
            />
            <Divider />
            <ToggleRow
              label="Invert balance"
              detail={`Flip the sign of the balance. Currently counts as ${formatMoney(counted, true)}${form.invertBalance ? ` (was ${formatMoney(balance, true)})` : ""}.`}
              value={form.invertBalance}
              onChange={(invertBalance) => set({ invertBalance })}
            />
          </Group>
        </View>

        {liability ? (
          <View style={formStyles.section}>
            <SectionHeader>Loan details</SectionHeader>
            <Group>
              {[
                fields.interestRate && <InputRow key="ir" label="Interest rate (%)" value={form.interestRate} onChange={(interestRate) => set({ interestRate: moneyInput(interestRate) })} keyboardType="decimal-pad" placeholder="0" />,
                fields.purchaseApr && <InputRow key="pa" label="Purchase APR (%)" value={form.purchaseApr} onChange={(purchaseApr) => set({ purchaseApr: moneyInput(purchaseApr) })} keyboardType="decimal-pad" placeholder="0" />,
                fields.originationDate && <DateRow key="od" label="Origination date" value={form.originationDate} onChange={(originationDate) => set({ originationDate })} />,
                fields.loanTermYears && <InputRow key="lt" label="Loan term (years)" value={form.loanTermYears} onChange={(v) => set({ loanTermYears: v.replace(/[^0-9]/g, "") })} keyboardType="number-pad" placeholder="30" />,
                fields.minPayment && <InputRow key="mp" label="Minimum payment" value={form.minPayment} onChange={money("minPayment")} money keyboardType="decimal-pad" placeholder="0" />,
                fields.repaymentPlanType && <InputRow key="rp" label="Repayment plan" value={form.repaymentPlanType} onChange={(repaymentPlanType) => set({ repaymentPlanType })} autoCapitalize="words" />,
              ]
                .filter(Boolean)
                .map((el, i) => (
                  <View key={i}>
                    {i > 0 ? <Divider /> : null}
                    {el}
                  </View>
                ))}
            </Group>
          </View>
        ) : null}

        {liability ? (
          <View style={formStyles.section}>
            <SectionHeader>Linked property</SectionHeader>
            <Group>
              <NavRow label="Secured by" value={linkedName ? displayName(linkedName) : "No property"} onPress={() => setPage("property")} />
            </Group>
            <Text style={[formStyles.footnote, { color: t.contentMuted }]}>Tie this loan to the property it's secured by. Its page will show your equity.</Text>
          </View>
        ) : null}

        {property && a.subtype === "rental" ? (
          <View style={formStyles.section}>
            <SectionHeader>Rental economics</SectionHeader>
            <Group>
              <InputRow label="Monthly rent" value={form.monthlyRent} onChange={money("monthlyRent")} money keyboardType="decimal-pad" placeholder="0" />
              <Divider />
              <InputRow label="Annual insurance" value={form.annualInsurance} onChange={money("annualInsurance")} money keyboardType="decimal-pad" placeholder="0" />
              <Divider />
              <InputRow label="Annual maintenance" value={form.annualMaintenance} onChange={money("annualMaintenance")} money keyboardType="decimal-pad" placeholder="0" />
            </Group>
          </View>
        ) : null}

        {error ? (
          <Text style={[formStyles.error, { color: t.negative }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {/* The account's one Delete, at the foot of its settings. Only an account entered by hand can be deleted here. */}
        {manual ? (
          <Group>
            <Pressable
              onPress={remove}
              disabled={deleting || saving}
              accessibilityRole="button"
              accessibilityLabel="Delete account"
              style={({ pressed }) => [styles.delete, pressFeedback(t, pressed)]}
            >
              {deleting ? <ActivityIndicator /> : <Text style={[styles.deleteText, { color: t.negative }]}>Delete account</Text>}
            </Pressable>
          </Group>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    delete: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: space.rowInset },
    deleteText: { ...type.body, ...weight.semibold },
  }),
);
