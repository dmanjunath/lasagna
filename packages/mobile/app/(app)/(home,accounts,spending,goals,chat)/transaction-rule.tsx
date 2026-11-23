import type { RulePreviewTxn } from "@web/lib/api";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useAccountsIndex } from "@/api/accounts";
import { saveErrorText } from "@/api/client";
import { rulesApi } from "@/api/rules";
import { AccountList } from "@/components/transactions/AccountList";
import { formatCurrencyExact, formatStoredDay } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { bodyFromForm, EMPTY_RULE_FORM, formFromSeed, validateRuleForm, type RuleForm } from "@/lib/rules";
import { openPath } from "@/lib/navigation";
import { accountLabel } from "@/lib/txn-filters";
import { useCategoryDisplay } from "@/lib/taxonomy";
import { heldRuleRequest } from "@/lib/txn-sheets";
import { CategoryPickerPage } from "@/components/transactions/CategoryList";
import { useTheme } from "@/theme";
import { CheckRow, Divider, FieldRow, formStyles, Group, NavRow, SectionHeader, Segmented, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";
import { showToast } from "@/ui/Toast";

type View_ =
  | { mode: "form" }
  | { mode: "pick"; field: "accountId" | "matchCategory" | "setCategory" }
  | { mode: "confirm"; ruleId: string; count: number; txns: RulePreviewTxn[] };

/**
 * A new category rule, prefilled from a recategorize, then an "apply to
 * existing?" step listing the matching transactions so any can be left out.
 * Same API and steps as the web's RulesPanel.
 */
export default function TransactionRule() {
  const t = useTheme();
  const req = heldRuleRequest();
  const hidden = useAmountsHidden();
  const displayOf = useCategoryDisplay();
  const { list: accounts } = useAccountsIndex();
  const [form, setForm] = useState<RuleForm>(() => (req?.seed ? formFromSeed(req.seed) : EMPTY_RULE_FORM));
  const [view, setView] = useState<View_>({ mode: "form" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Transactions the user unticked in the apply step.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const set = (patch: Partial<RuleForm>) => setForm((f) => ({ ...f, ...patch }));
  const [initial] = useState(form);
  // Unsaved only until the rule exists: on the apply step, leaving is Skip.
  const leave = useDiscardGuard(view.mode !== "confirm" && !saving && JSON.stringify(form) !== JSON.stringify(initial));

  const finish = () => {
    req?.onChanged();
    leave();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // The rules list lives in Settings' Rules section, which opens in the web fallback.
    showToast({ tone: "positive", title: "Rule created", duration: 6000, action: { label: "View rules", onPress: () => openPath("/profile#rules") } });
  };

  const save = async () => {
    const clientError = validateRuleForm(form);
    if (clientError) return setError(clientError);
    setSaving(true);
    setError(null);
    let ruleId: string;
    try {
      ruleId = (await rulesApi.create(bodyFromForm(form))).rule.id;
    } catch (e) {
      setError(saveErrorText(e, "Couldn't save this rule. Check the conditions and try again."));
      setSaving(false);
      return;
    }
    // The rule exists now. A failed preview isn't fatal, and saving again would duplicate it.
    try {
      const { count, transactions } = await rulesApi.preview(ruleId);
      if (count > 0) setView({ mode: "confirm", ruleId, count, txns: transactions });
      else finish();
    } catch {
      finish();
    } finally {
      setSaving(false);
    }
  };

  const apply = async () => {
    if (view.mode !== "confirm") return;
    setSaving(true);
    setError(null);
    try {
      await rulesApi.apply(view.ruleId, [...excluded]);
      finish();
    } catch (e) {
      setError(saveErrorText(e, "Couldn't apply the rule to these transactions. Try again."));
    } finally {
      setSaving(false);
    }
  };

  if (view.mode === "pick") {
    const back = () => setView({ mode: "form" });
    const pick = (id: string) => {
      Haptics.selectionAsync();
      set({ [view.field]: id });
      back();
    };
    if (view.field !== "accountId") {
      const match = view.field === "matchCategory";
      return (
        <CategoryPickerPage
          title={match ? "Current category" : "Set category"}
          value={form[view.field]}
          anyLabel={match ? "Any category" : undefined}
          onCancel={back}
          onPick={(id) => {
            set({ [view.field]: id });
            back();
          }}
        />
      );
    }
    return (
      <>
        <SheetBar title="Account" left={{ title: "Cancel", onPress: back }} />
        <AccountList accounts={accounts} value={form.accountId} anyLabel="Any account" onPick={pick} />
      </>
    );
  }

  if (view.mode === "confirm") {
    const applyCount = view.count - excluded.size;
    return (
      <>
        <SheetBar
          title="Apply to existing?"
          left={{ title: "Skip", onPress: finish, disabled: saving }}
          right={{ title: `Apply to ${applyCount}`, strong: true, busy: saving, disabled: applyCount === 0, onPress: () => void apply() }}
        />
        <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body}>
          <Text style={[formStyles.lead, { color: t.contentSecondary }]}>
            It also matches {view.count} transaction{view.count === 1 ? "" : "s"} you already have. Untick any to keep their current category.
          </Text>
          <Group>
            {view.txns.map((x, i) => {
              const on = !excluded.has(x.id);
              const amount = parseFloat(x.amount);
              const amountText = `${amount < 0 && !hidden ? "+" : ""}${formatCurrencyExact(Math.abs(amount))}`;
              return (
                <View key={x.id}>
                  {i > 0 ? <Divider /> : null}
                  <CheckRow
                    label={x.merchantName || x.name}
                    value={amountText}
                    // The category an untick keeps.
                    detail={`${formatStoredDay(x.date, { year: "numeric" })}${x.accountName ? `, ${x.accountName}` : ""}, ${displayOf(x.categoryId).label}`}
                    checked={on}
                    onPress={() =>
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (next.has(x.id)) next.delete(x.id);
                        else next.add(x.id);
                        Haptics.selectionAsync();
                        return next;
                      })
                    }
                  />
                </View>
              );
            })}
          </Group>
          {view.count > view.txns.length ? (
            <Text style={[formStyles.footnote, { color: t.contentMuted }]}>Showing the newest {view.txns.length}. The rest are included.</Text>
          ) : null}
          {error ? <Text style={[formStyles.error, { color: t.negative }]}>{error}</Text> : null}
        </ScrollView>
      </>
    );
  }

  const account = accounts.find((a) => a.id === form.accountId);
  return (
    <>
      <SheetBar
        title="New rule"
        left={{ title: "Cancel", onPress: () => router.back(), disabled: saving }}
        right={{ title: "Save", strong: true, busy: saving, onPress: () => void save() }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={formStyles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        <Text style={[formStyles.lead, { color: t.contentSecondary }]}>Transactions matching every condition get the new category.</Text>
        <View style={formStyles.section}>
          <SectionHeader>Conditions</SectionHeader>
          <Group>
            <FieldRow label="Merchant contains">
              <Input value={form.merchantContains} onChangeText={(merchantContains) => set({ merchantContains })} placeholder="e.g. amzn" accessibilityLabel="Merchant contains" />
            </FieldRow>
            <Divider />
            <NavRow label="Account" value={account ? accountLabel(account, accounts) : "Any account"} onPress={() => setView({ mode: "pick", field: "accountId" })} />
            <Divider />
            <NavRow
              label="Current category"
              value={form.matchCategory ? displayOf(form.matchCategory).label : "Any category"}
              onPress={() => setView({ mode: "pick", field: "matchCategory" })}
            />
          </Group>
        </View>

        <View style={formStyles.section}>
          <SectionHeader>Amount</SectionHeader>
          <Segmented
            accessibilityLabel="Amount condition"
            value={form.amountMode}
            onChange={(amountMode) => set({ amountMode })}
            options={[
              { value: "any", label: "Any" },
              { value: "equals", label: "Exactly" },
              { value: "between", label: "Between" },
            ]}
          />
          {form.amountMode === "equals" ? (
            <Group>
              <FieldRow label="Amount">
                <Input value={form.amountEquals} onChangeText={(amountEquals) => set({ amountEquals })} placeholder="0.00" keyboardType="decimal-pad" accessibilityLabel="Amount" />
              </FieldRow>
            </Group>
          ) : form.amountMode === "between" ? (
            <Group>
              <FieldRow label="Min">
                <Input value={form.amountMin} onChangeText={(amountMin) => set({ amountMin })} placeholder="0.00" keyboardType="decimal-pad" accessibilityLabel="Minimum amount" />
              </FieldRow>
              <Divider />
              <FieldRow label="Max">
                <Input value={form.amountMax} onChangeText={(amountMax) => set({ amountMax })} placeholder="0.00" keyboardType="decimal-pad" accessibilityLabel="Maximum amount" />
              </FieldRow>
            </Group>
          ) : null}
        </View>

        <View style={formStyles.section}>
          <SectionHeader>Then</SectionHeader>
          <Group>
            <NavRow
              label="Set category"
              value={form.setCategory ? displayOf(form.setCategory).label : "Choose a category"}
              onPress={() => setView({ mode: "pick", field: "setCategory" })}
            />
          </Group>
        </View>
        {error ? (
          <Text style={[formStyles.error, { color: t.negative }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

function Input(props: { value: string; onChangeText: (v: string) => void; placeholder: string; accessibilityLabel: string; keyboardType?: "decimal-pad" }) {
  const t = useTheme();
  return (
    <TextInput
      {...props}
      placeholderTextColor={t.contentFaint}
      keyboardAppearance={t.keyboard}
      selectionColor={t.brandInk}
      returnKeyType="done"
      autoCorrect={false}
      autoCapitalize="none"
      clearButtonMode="while-editing"
      style={[formStyles.input, { color: t.content }]}
    />
  );
}

