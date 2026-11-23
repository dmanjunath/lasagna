import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountTypeKey, accountTypeLabel, type AccountTypeOption } from "@web/lib/account-types";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { accountsApi, invalidateAccounts, useItems } from "@/api/accounts";
import { billingApi } from "@/api/auth";
import { ApiError } from "@/api/client";
import { AddressField, ChoicePage, InputRow, ValueSourceSection } from "@/components/accounts/FormFields";
import { InstIcon } from "@/components/accounts/InstIcon";
import { addableItems, displayName, institutionOf, isItemError, type Item } from "@/lib/account-list";
import { ADD_FORMS, asksMinPayment, createBody, EMPTY_ADD_FORM, formForType, friendlyAddError, moneyInput, offersLink, type AddForm, type AddFormKind } from "@/lib/add-account";
import { openPath } from "@/lib/navigation";
import { connectBank, updateConnection, usePlaidPhase } from "@/lib/plaid-link";
import { markWebStale } from "@/lib/web-stale";
import { icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { failed } from "@/ui/feedback";
import { Divider, formStyles, Group, NavRow, SectionHeader, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";
import { showToast } from "@/ui/Toast";

type Page = "choose" | "form" | "type" | "link";
const NEW = "__new";

/** Waits for the sheet to finish closing, so what opens next (Plaid Link, a pushed page) presents over the app. */
const afterClose = (fn: () => void) => setTimeout(fn, 450);

/**
 * Adding an account (the web's add dialog): connect a bank through Plaid, add
 * to a bank already connected, or add one by hand (a balance, a property).
 * "Describe your finances" opens the web's quick import. `add` and `link`
 * open the form on a type, already tied to its counterpart (a property's
 * mortgage).
 */
export default function AddAccountSheet({ add, link }: { add?: string; link?: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const plaid = usePlaidPhase();
  const items = useItems();
  const all = items.data?.items ?? [];
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: billingApi.status });

  const deep = add ? formForType(add) : null;
  const [page, setPage] = useState<Page>(deep ? "form" : "choose");
  const [kind, setKind] = useState<AddFormKind | null>(deep?.kind ?? null);
  const [chosen, setChosen] = useState<AccountTypeOption | null>(deep ? (deep.type ?? (ADD_FORMS[deep.kind].types.length === 1 ? ADD_FORMS[deep.kind].types[0] : null)) : null);
  const [openedOnForm] = useState(!!deep);
  const [form, setForm] = useState<AddForm>({ ...EMPTY_ADD_FORM, linkedId: link ?? "" });
  const [chain, setChain] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<AddForm>) => setForm((f) => ({ ...f, ...patch }));

  const typed = JSON.stringify({ ...form, linkedId: "" }) !== JSON.stringify(EMPTY_ADD_FORM);
  const leave = useDiscardGuard(page !== "choose" && typed && !saving);

  const spec = kind ? ADD_FORMS[kind] : null;
  // Until a type is picked the form's first type shapes it: every type in a form agrees on asset or debt, property or not.
  const shape = chosen ?? spec?.types[0] ?? null;
  const isProperty = shape?.type === "real_estate";
  const linkable = shape ? offersLink(shape) : false;
  const candidates = all.flatMap((i) =>
    i.accounts
      .filter((a) => (isProperty ? a.type === "loan" && !a.propertyAccountId : shape?.subtype === "mortgage" ? a.type === "real_estate" : false))
      .map((a) => ({ a, inst: institutionOf(i) })),
  );
  const linked = candidates.find((c) => c.a.id === form.linkedId);
  const counterpart = isProperty ? "mortgage" : "property";

  const startConnect = () => {
    router.back();
    afterClose(() => void connectBank(qc));
  };
  const startUpdate = (item: Item) => {
    router.back();
    afterClose(() => void updateConnection(qc, item));
  };
  const startDescribe = () => {
    router.back();
    afterClose(() => openPath("/quick-import"));
  };
  const openForm = (k: AddFormKind) => {
    if (k !== kind) {
      setForm({ ...EMPTY_ADD_FORM, linkedId: link ?? "" });
      setChosen(ADD_FORMS[k].types.length === 1 ? ADD_FORMS[k].types[0] : null);
      setChain(false);
    }
    setKind(k);
    setError(null);
    setPage("form");
  };

  const upgrade = async () => {
    try {
      const { url } = await billingApi.checkout();
      if (url) await WebBrowser.openBrowserAsync(url);
      void billing.refetch();
    } catch {
      failed("Couldn't start checkout. Try again.");
    }
  };

  const save = async () => {
    if (!chosen || !form.name.trim()) return;
    setSaving(true);
    setError(null);
    let created: { id: string; name: string };
    try {
      created = (await accountsApi.createManual(createBody(chosen, form))).account;
    } catch (e) {
      setError(e instanceof ApiError && e.status >= 400 && e.status < 500 ? friendlyAddError(e.message) : e instanceof Error ? e.message : friendlyAddError(undefined));
      setSaving(false);
      return;
    }
    invalidateAccounts(qc);
    markWebStale();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const name = form.name.trim();
    setSaving(false);
    if (chain) {
      // "Add a new mortgage/property": its form next, tied to the one just made.
      const next = formForType(chosen.type === "real_estate" ? "loan:mortgage" : "real_estate");
      if (next) {
        setKind(next.kind);
        setChosen(next.type ?? (ADD_FORMS[next.kind].types.length === 1 ? ADD_FORMS[next.kind].types[0] : null));
        setForm({ ...EMPTY_ADD_FORM, linkedId: created.id });
        setChain(false);
        showToast({ tone: "positive", title: `Added ${name}` });
        return;
      }
    }
    leave();
    showToast({ tone: "positive", title: `Added ${name}`, duration: 6000, action: { label: "View account", onPress: () => openPath(`/accounts/${created.id}`) } });
  };

  // ── Pages inside the sheet ────────────────────────────────────────────────
  if (page === "type" && spec) {
    return (
      <ChoicePage
        title={spec.typeLabel}
        value={chosen ? accountTypeKey(chosen.type, chosen.subtype) : ""}
        options={spec.types.map((o) => ({
          value: accountTypeKey(o.type, o.subtype),
          label: o.label,
          section: o.category === "debt" ? "Debt" : o.category === "other" ? "Other" : o.category === "realEstate" ? undefined : "Bank and investments",
        }))}
        onCancel={() => setPage("form")}
        onPick={(v) => {
          const next = spec.types.find((o) => accountTypeKey(o.type, o.subtype) === v)!;
          // A card's APR and a loan's rate are different numbers: one typed for the other is dropped.
          if (chosen && chosen.isDebt && next.isDebt && chosen.type !== next.type) set({ rate: "" });
          if (!offersLink(next)) {
            set({ linkedId: "" });
            setChain(false);
          }
          setChosen(next);
          setPage("form");
        }}
      />
    );
  }
  if (page === "link") {
    return (
      <ChoicePage
        title={isProperty ? "Mortgage" : "Property"}
        value={chain ? NEW : form.linkedId}
        options={[
          { value: "", label: isProperty ? "No mortgage" : "No property" },
          ...candidates.map((c) => ({ value: c.a.id, label: displayName(c.a), detail: `${c.inst}, ${accountTypeLabel(c.a.type, c.a.subtype)}` })),
          { value: NEW, label: `Add a new ${counterpart}`, detail: "Its form opens after this one", section: "New" },
        ]}
        onCancel={() => setPage("form")}
        onPick={(v) => {
          setChain(v === NEW);
          set({ linkedId: v === NEW ? "" : v });
          setPage("form");
        }}
      />
    );
  }

  if (page === "form" && spec && kind) {
    return (
      <>
        <SheetBar
          title={spec.title}
          left={openedOnForm ? { title: "Cancel", onPress: () => router.back(), disabled: saving } : { title: "Back", symbol: "chevron.left", onPress: () => setPage("choose"), disabled: saving }}
          right={{ title: "Add", strong: true, busy: saving, disabled: !chosen || !form.name.trim(), onPress: () => void save() }}
        />
        <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Group>
            {spec.types.length > 1 ? (
              <>
                <NavRow label={spec.typeLabel} value={chosen?.label ?? "Choose a type"} onPress={() => setPage("type")} />
                <Divider />
              </>
            ) : null}
            <InputRow label="Account name" value={form.name} onChange={(name) => set({ name })} autoCapitalize="words" placeholder={isProperty ? "Home" : "Savings"} />
            {isProperty ? null : (
              <>
                <Divider />
                <InputRow label={shape?.isDebt ? "Amount owed" : "Balance"} value={form.balance} onChange={(v) => set({ balance: moneyInput(v) })} money keyboardType="decimal-pad" placeholder="0" />
              </>
            )}
          </Group>

          {isProperty ? (
            <>
              <View style={formStyles.section}>
                <SectionHeader>Address</SectionHeader>
                <AddressField
                  value={form.address}
                  rejected={rejected}
                  onReject={() => setRejected(true)}
                  onText={(address) => {
                    setRejected(false);
                    set({ address, placeId: "", lat: null, lng: null });
                  }}
                  onPick={(p) => {
                    setRejected(false);
                    set({ address: p.address, placeId: p.placeId, lat: p.lat, lng: p.lng });
                  }}
                />
                {rejected ? null : <Text style={[formStyles.footnote, { color: t.contentMuted }]}>Add an address and we'll estimate the value for you.</Text>}
              </View>
              <ValueSourceSection source={form.valueSource} onSource={(valueSource) => set({ valueSource })} ownValue={form.balance} onOwnValue={(balance) => set({ balance })} />
            </>
          ) : null}

          {linkable ? (
            <View style={formStyles.section}>
              <Group>
                <NavRow
                  label={isProperty ? "Mortgage" : "Property"}
                  value={chain ? `New ${counterpart}, set up next` : linked ? displayName(linked.a) : isProperty ? "No mortgage" : "No property"}
                  onPress={() => setPage("link")}
                />
              </Group>
              <Text style={[formStyles.footnote, { color: t.contentMuted }]}>
                {isProperty ? "Tie an existing mortgage to this property so we can show your equity. You can also add one later." : "Tie this loan to the property it's secured by. You can also add one later."}
              </Text>
            </View>
          ) : null}

          {chosen?.subtype === "rental" ? (
            <View style={formStyles.section}>
              <SectionHeader>Rental economics</SectionHeader>
              <Group>
                <InputRow label="Monthly rent" value={form.rent} onChange={(v) => set({ rent: moneyInput(v) })} money keyboardType="decimal-pad" placeholder="0" />
                <Divider />
                <InputRow label="Annual insurance" value={form.insurance} onChange={(v) => set({ insurance: moneyInput(v) })} money keyboardType="decimal-pad" placeholder="0" />
                <Divider />
                <InputRow label="Annual maintenance" value={form.maintenance} onChange={(v) => set({ maintenance: moneyInput(v) })} money keyboardType="decimal-pad" placeholder="0" />
              </Group>
            </View>
          ) : null}

          {chosen?.isDebt ? (
            <Group>
              <InputRow label="Interest rate (%)" value={form.rate} onChange={(v) => set({ rate: moneyInput(v) })} keyboardType="decimal-pad" placeholder={chosen.type === "credit" ? "21.99" : "6.5"} />
              {asksMinPayment(chosen) ? (
                <>
                  <Divider />
                  <InputRow label="Monthly payment" value={form.minPayment} onChange={(v) => set({ minPayment: moneyInput(v) })} money keyboardType="decimal-pad" placeholder="0" />
                </>
              ) : null}
            </Group>
          ) : null}

          {error ? (
            <Text style={[formStyles.error, { color: t.negative }]} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </ScrollView>
      </>
    );
  }

  // ── Step 1: the ways in ───────────────────────────────────────────────────
  const addable = addableItems(all);
  const b = billing.data;
  const atCap = !!b && b.plan === "free" && b.usage.institutions >= b.usage.maxInstitutions;
  return (
    <>
      <SheetBar title="Add an account" left={{ title: "Cancel", onPress: () => router.back() }} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body}>
        {/* At the cap, a new institution connects and then sits frozen: say so before the bank's sign-in. */}
        {atCap ? (
          <Banner
            tone="caution"
            title={`You're at your free plan limit of ${b.usage.maxInstitutions} institutions`}
            body="A new one won't sync until you upgrade."
            action={{ title: "Upgrade", onPress: () => void upgrade() }}
          />
        ) : null}
        <Button
          title={addable.length > 0 ? "Connect a new bank or card" : "Connect your bank or card"}
          icon="bolt.fill"
          iconLeading
          loading={plaid !== "idle"}
          onPress={startConnect}
        />

        {addable.length > 0 ? (
          <View style={formStyles.section}>
            <SectionHeader>Add an account at a bank you already connected</SectionHeader>
            <Group>
              {addable.map((item, i) => (
                <View key={item.id}>
                  {i > 0 ? <Divider inset={60} /> : null}
                  <Choice
                    lead={<InstIcon institution={institutionOf(item)} size={32} />}
                    title={item.institutionName ?? "Your bank"}
                    detail={isItemError(item) ? "Reconnect and add accounts" : `${item.accounts.length} account${item.accounts.length === 1 ? "" : "s"} connected`}
                    onPress={() => startUpdate(item)}
                    disabled={plaid !== "idle"}
                  />
                </View>
              ))}
            </Group>
          </View>
        ) : null}

        <View style={formStyles.section}>
          <SectionHeader>Or add one yourself</SectionHeader>
          <Group>
            <Choice symbol="pencil" title="Add a balance manually" onPress={() => openForm("manual")} />
            <Divider inset={60} />
            <Choice symbol="house" title="Add a property" onPress={() => openForm("property")} />
            <Divider inset={60} />
            <Choice symbol="sparkles" title="Describe your finances" detail="Type them out in plain English" onPress={startDescribe} />
          </Group>
        </View>
      </ScrollView>
    </>
  );
}

/** One way in: a tile or symbol, a title and a line, and a chevron. */
function Choice({ lead, symbol, title, detail, onPress, disabled }: { lead?: React.ReactNode; symbol?: SFSymbol; title: string; detail?: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={[title, detail].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.choice, { opacity: disabled ? 0.5 : 1 }, pressed && { backgroundColor: t.canvasSunken }]}
    >
      {lead ?? (
        <View style={[styles.symbolTile, { backgroundColor: t.canvasSunken }]}>
          <SymbolView name={symbol!} size={icon.md} tintColor={t.contentSecondary} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
      )}
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[styles.choiceTitle, { color: t.content }]}>{title}</Text>
        {detail ? <Text style={[styles.choiceDetail, { color: t.contentMuted }]}>{detail}</Text> : null}
      </View>
      <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    choice: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 10, minHeight: 56 },
    symbolTile: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
    choiceTitle: { ...type.body, ...weight.medium },
    choiceDetail: { ...type.footnote },
  }),
);
