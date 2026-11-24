import DateTimePicker from "@react-native-community/datetimepicker";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAccountsIndex } from "@/api/accounts";
import { txnApi } from "@/api/transactions";
import { CategoryList } from "@/components/transactions/CategoryList";
import { PickList, type PickItem } from "@/components/transactions/PickList";
import { addView, deleteView, matchingView, renameView, useSavedViews, type FilterPage } from "@/lib/filter-store";
import { groupAccounts } from "@/lib/accounts";
import { localDayKey } from "@/lib/format";
import { useTaxonomy } from "@/lib/taxonomy";
import {
  amountRangeInverted,
  AMOUNT_OP_LABELS,
  DATE_PRESET_LABELS,
  dateRangeInverted,
  EMPTY_FILTERS,
  filtersToApiQuery,
  hasAnyChoice,
  type TxnFilters,
} from "@/lib/txn-filters";
import { accountsSummary, amountSummary, categoriesSummary, dateSummary, merchantsSummary, sortSummary, statusSummary, STATUS_CHOICES } from "@/lib/filter-summary";
import { SORT_KEYS, SORT_LABELS } from "@/lib/txn-list";
import { useFilterController, type AccountOption, type FilterSection, type PageSort, type StatusField } from "@/lib/txn-sheets";
import { icon, space, themedStyles, type, useTheme } from "@/theme";
import { CheckRow, Divider, FieldRow, formStyles, Group, NavRow, SectionHeader, Segmented, SheetBar } from "@/ui/Form";
import { Chip } from "@/ui/Chip";
import { TextLink } from "@/ui/Card";
import { EmptyState } from "@/ui/State";

type Page = "main" | "sort" | "date" | "categories" | "accounts" | "merchants" | "amount" | "status" | "views";

const DATE_PRESETS = Object.keys(DATE_PRESET_LABELS) as TxnFilters["datePreset"][];
const AMOUNT_OPS = Object.keys(AMOUNT_OP_LABELS) as TxnFilters["amountOp"][];

/**
 * The one filter sheet every filterable page opens (the universal filter): the
 * page names the sections its data supports. The main page is a few grouped
 * summary rows (views, sort, date, the filters), each saying what it holds and
 * opening its own page in the sheet. Each change shows on the page as it is
 * made. Search stays in the nav bar, money in or out on the page.
 */
export default function TransactionFilters() {
  const c = useFilterController();
  if (!c) return <EmptyState gutter title="Nothing to filter" action={{ title: "Close", onPress: () => router.back() }} />;
  return <Panel filters={c.filters} onChange={c.set} page={c.page} sections={c.sections} status={c.status ?? ["pending", "excluded", "recurring", "source"]} accountOptions={c.accounts} pageSort={c.sort} />;
}

function Panel({
  filters: published,
  onChange: publish,
  page: owner,
  sections,
  status,
  accountOptions,
  pageSort,
}: {
  filters: TxnFilters;
  onChange: (f: TxnFilters) => void;
  page: FilterPage;
  sections: FilterSection[];
  status: StatusField[];
  accountOptions?: AccountOption[];
  pageSort?: PageSort;
}) {
  // A sheet with one section (Portfolio: accounts) is that section's list, with no summary page in front of it.
  const content = sections.filter((s) => s !== "views");
  const only = content.length === 1 ? (content[0] as Page) : null;
  const [page, setPage] = useState<Page>(only ?? "main");
  // The sheet's own copy, so two quick changes build on each other instead of
  // the second one starting from filters the page hasn't republished yet.
  const [filters, setLocal] = useState(published);
  const latest = useRef(published);
  // What the page showed when the sheet opened, for Cancel.
  const [opened] = useState(published);
  const onChange = (f: TxnFilters) => {
    latest.current = f;
    setLocal(f);
    publish(f);
  };
  const { list: index } = useAccountsIndex();
  const accounts: AccountOption[] = useMemo(
    () =>
      accountOptions ??
      groupAccounts(index).flatMap((g) => g.accounts.map((a) => ({ id: a.id, name: a.name, detail: `${a.institution}${a.mask ? ` ••${a.mask}` : ""}`, group: g.title }))),
    [accountOptions, index],
  );
  const groups = useTaxonomy().data?.groups ?? [];
  const views = useSavedViews(owner);
  const set = (patch: Partial<TxnFilters>) => onChange({ ...latest.current, ...patch });
  const has = (s: FilterSection) => sections.includes(s);
  const back = { title: "Filters", onPress: () => setPage("main"), symbol: "chevron.left" as const };
  // Each change shows on the page as it is made. Apply keeps them, Cancel puts back what the page showed before.
  const cancel = {
    title: "Cancel",
    onPress: () => {
      publish(opened);
      router.back();
    },
  };
  const apply = { title: "Apply", strong: true, onPress: () => router.back() };
  /** A sub-page's bar: back to the summary, or Cancel and Apply when the sheet is only this page. */
  const bar = page === only ? { left: cancel, right: apply } : { left: back };
  const pick = (patch: Partial<TxnFilters>) => {
    Haptics.selectionAsync();
    set(patch);
  };

  if (page === "sort") {
    const choices = pageSort ? pageSort.options : SORT_KEYS.map((k) => ({ value: k, label: SORT_LABELS[k] }));
    const chosen = pageSort ? pageSort.value : filters.sort;
    return (
      <SubPage title="Sort" bar={bar}>
        <Group>
          {choices.map((o, i) => (
            <View key={o.value}>
              {i > 0 ? <Divider /> : null}
              <CheckRow
                label={o.label}
                checked={chosen === o.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (pageSort) pageSort.onChange(o.value);
                  else set({ sort: o.value as TxnFilters["sort"] });
                }}
              />
            </View>
          ))}
        </Group>
      </SubPage>
    );
  }
  if (page === "date") {
    return (
      <SubPage title="Date" bar={bar}>
        <Group>
          {DATE_PRESETS.map((p, i) => (
            <View key={p}>
              {i > 0 ? <Divider /> : null}
              <CheckRow label={DATE_PRESET_LABELS[p]} checked={filters.datePreset === p} onPress={() => pick({ datePreset: p, customStart: "", customEnd: "" })} />
            </View>
          ))}
        </Group>
        {filters.datePreset === "custom" ? (
          <View style={formStyles.section}>
            <Group>
              <DateRow label="From" value={filters.customStart} onChange={(customStart) => set({ customStart })} />
              <Divider />
              <DateRow label="To" value={filters.customEnd} onChange={(customEnd) => set({ customEnd })} />
            </Group>
            {dateRangeInverted(filters) ? <ErrorText>From is after To.</ErrorText> : null}
          </View>
        ) : null}
      </SubPage>
    );
  }
  if (page === "categories") {
    // One list, in one of two modes: only these, or everything but these.
    const except = filters.categories.length === 0 && filters.excludeCategories.length > 0;
    const selected = except ? filters.excludeCategories : filters.categories;
    return (
      <>
        <SheetBar title="Categories" {...bar} />
        <CategoryList
          multiple
          allLabel={except ? undefined : "All categories"}
          selected={selected}
          onChange={(ids) => (except ? set({ excludeCategories: ids, categories: [] }) : set({ categories: ids, excludeCategories: [] }))}
          header={
            <Segmented
              accessibilityLabel="Show only these categories, or all except these"
              value={except ? "except" : "only"}
              // Switching keeps what is ticked: "only these three" becomes "all except these three".
              onChange={(mode) => (mode === "except" ? set({ excludeCategories: selected, categories: [] }) : set({ categories: selected, excludeCategories: [] }))}
              options={[
                { value: "only", label: "Only these" },
                { value: "except", label: "All except these" },
              ]}
            />
          }
        />
      </>
    );
  }
  if (page === "accounts") {
    return (
      <>
        <SheetBar title="Accounts" {...bar} />
        <PickList
          items={accounts.map((a) => ({ id: a.id, label: a.name, detail: a.detail, group: a.group }))}
          selected={filters.accountIds}
          onChange={(accountIds) => set({ accountIds })}
          allLabel="All accounts"
          searchPlaceholder="Search accounts"
        />
      </>
    );
  }
  if (page === "merchants") {
    return (
      <>
        <SheetBar title="Merchants" {...bar} />
        <MerchantPage filters={filters} onChange={(merchants) => set({ merchants })} />
      </>
    );
  }
  if (page === "amount") {
    return (
      <SubPage title="Amount" bar={bar}>
        <Group>
          {AMOUNT_OPS.map((o, i) => (
            <View key={o}>
              {i > 0 ? <Divider /> : null}
              <CheckRow label={AMOUNT_OP_LABELS[o]} checked={filters.amountOp === o} onPress={() => pick({ amountOp: o, amountMin: "", amountMax: "" })} />
            </View>
          ))}
        </Group>
        {filters.amountOp !== "any" ? (
          <View style={formStyles.section}>
            <Group>
              {filters.amountOp !== "atMost" ? (
                <DraftInput
                  key={`min-${filters.amountOp}`}
                  label={filters.amountOp === "between" ? "Min" : "Amount"}
                  accessibilityLabel="Minimum amount"
                  value={filters.amountMin}
                  onCommit={(amountMin) => set({ amountMin })}
                  placeholder="$0.00"
                  keyboardType="decimal-pad"
                />
              ) : null}
              {filters.amountOp === "between" ? <Divider /> : null}
              {filters.amountOp !== "atLeast" ? (
                <DraftInput
                  key={`max-${filters.amountOp}`}
                  label={filters.amountOp === "between" ? "Max" : "Amount"}
                  accessibilityLabel="Maximum amount"
                  value={filters.amountMax}
                  onCommit={(amountMax) => set({ amountMax })}
                  placeholder="$0.00"
                  keyboardType="decimal-pad"
                />
              ) : null}
            </Group>
            {amountRangeInverted(filters) ? <ErrorText>Min is more than max.</ErrorText> : null}
          </View>
        ) : null}
      </SubPage>
    );
  }
  if (page === "status") {
    return (
      <SubPage title="Status" bar={bar}>
        {status.map((field) => {
          const options = STATUS_CHOICES[field].options as Array<{ value: string; label: string }>;
          return (
            <View key={field} style={formStyles.section}>
              <SectionHeader>{STATUS_CHOICES[field].label}</SectionHeader>
              <Group>
                {options.map((o, i) => (
                  <View key={o.value}>
                    {i > 0 ? <Divider /> : null}
                    <CheckRow label={o.label} checked={filters[field] === o.value} onPress={() => pick({ [field]: o.value } as Partial<TxnFilters>)} />
                  </View>
                ))}
              </Group>
            </View>
          );
        })}
      </SubPage>
    );
  }
  if (page === "views") {
    return (
      <>
        <SheetBar title="Saved views" {...bar} />
        <ManageViews page={owner} />
      </>
    );
  }

  const current = matchingView(views, filters);
  const anything = hasAnyChoice(filters) || (!!pageSort && pageSort.value !== pageSort.defaultValue);
  const saveView = () =>
    Alert.prompt("Save view", "Name these filters to pick them again later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        isPreferred: true,
        onPress: (name?: string) => {
          if (name?.trim()) addView(owner, name, latest.current);
        },
      },
    ]);

  const sort = pageSort
    ? { value: pageSort.options.find((o) => o.value === pageSort.value)?.label ?? "", set: pageSort.value !== pageSort.defaultValue }
    : sortSummary(filters);
  const date = dateSummary(filters);
  const filterRows: Array<{ key: Page; label: string; summary: { value: string; set: boolean } }> = [];
  if (has("categories")) filterRows.push({ key: "categories", label: "Categories", summary: categoriesSummary(filters, groups) });
  if (has("accounts") && accounts.length > 0) filterRows.push({ key: "accounts", label: "Accounts", summary: accountsSummary(filters, accounts) });
  if (has("merchants")) filterRows.push({ key: "merchants", label: "Merchants", summary: merchantsSummary(filters) });
  if (has("amount")) filterRows.push({ key: "amount", label: "Amount", summary: amountSummary(filters) });
  if (has("status")) filterRows.push({ key: "status", label: "Status", summary: statusSummary(filters, status) });

  return (
    <>
      <SheetBar title="Filters" left={cancel} right={apply} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body}>
        {/* Saved views as pills, the one these filters match chosen. Nothing saved: only the way to save, once there is something to save. */}
        {has("views") && views.length > 0 ? (
          <View style={formStyles.section}>
            {/* Manage sits in the header's line. Saving a new view is with Clear all, at the end. */}
            <View style={styles.viewsHead}>
              <SectionHeader style={{ flex: 1 }}>Views</SectionHeader>
              <TextLink title="Manage" label="Manage saved views" onPress={() => setPage("views")} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills} accessibilityLabel="Saved views">
              {views.map((v) => (
                <Chip
                  key={v.id}
                  label={v.name}
                  selected={current?.id === v.id}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onChange(v.filters);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {has("sort") || has("date") ? (
          <Group>
            {has("sort") ? <NavRow label="Sort" value={sort.value} highlight={sort.set} onPress={() => setPage("sort")} /> : null}
            {has("sort") && has("date") ? <Divider /> : null}
            {has("date") ? <NavRow label="Date" value={date.value} highlight={date.set} onPress={() => setPage("date")} /> : null}
          </Group>
        ) : null}

        {filterRows.length > 0 ? (
          <View style={formStyles.section}>
            <Group>
              {filterRows.map((r, i) => (
                <View key={r.key}>
                  {i > 0 ? <Divider /> : null}
                  <NavRow label={r.label} value={r.summary.value} highlight={r.summary.set} onPress={() => setPage(r.key)} />
                </View>
              ))}
            </Group>
          </View>
        ) : null}

        {/* Save view and Clear all, together at the end: the two things to do with filters already set. Clear all is the chip row's reset, search included. */}
        {anything ? (
          <View style={styles.clear}>
            {has("views") && !current ? <TextLink title="Save view" label="Save these filters as a view" onPress={saveView} /> : null}
            <TextLink
              title="Clear all"
              onPress={() => {
                Haptics.selectionAsync();
                onChange(EMPTY_FILTERS);
                pageSort?.onChange(pageSort.defaultValue);
              }}
            />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

/** A sub-page of the sheet: its bar with the way back, over a scrolling body. */
function SubPage({ title, bar, children }: { title: string; bar: Pick<React.ComponentProps<typeof SheetBar>, "left" | "right">; children: React.ReactNode }) {
  return (
    <>
      <SheetBar title={title} {...bar} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={formStyles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {children}
      </ScrollView>
    </>
  );
}

/** Merchants from the server, most used first with their counts, searched there as you type. */
function MerchantPage({ filters, onChange }: { filters: TxnFilters; onChange: (m: string[]) => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  // The counts follow the rest of the filter, so they say how many rows each would add.
  const scope = filtersToApiQuery({ ...filters, merchants: [], search: "" });
  const list = useQuery({ queryKey: ["transactions", "merchants", debounced, scope], queryFn: () => txnApi.merchants(debounced, scope) });
  const items: PickItem[] = useMemo(() => {
    const rows = (list.data ?? []).map((m) => ({ id: m.name, label: m.name, value: String(m.count) }));
    // A picked merchant stays listed while a search hides it, so it can be unticked.
    const missing = debounced ? [] : filters.merchants.filter((m) => !rows.some((r) => r.id === m)).map((m) => ({ id: m, label: m }));
    return [...missing, ...rows];
  }, [list.data, filters.merchants, debounced]);
  return (
    <PickList
      items={items}
      selected={filters.merchants}
      onChange={onChange}
      allLabel="All merchants"
      searchPlaceholder="Search merchants"
      onQuery={setQ}
      footer={list.isPending ? null : items.length === 0 ? <EmptyState compact art={false} title="No merchants match" /> : null}
    />
  );
}

/** Rename and delete saved views, each with its own visible buttons. */
function ManageViews({ page }: { page: FilterPage }) {
  const views = useSavedViews(page);
  if (views.length === 0) return <EmptyState gutter art={false} title="No saved views" />;
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body}>
      <Group>
        {views.map((v, i) => (
          <View key={v.id}>
            {i > 0 ? <Divider /> : null}
            <ViewRow
              name={v.name}
              onRename={() =>
                Alert.prompt("Rename view", undefined, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Save", isPreferred: true, onPress: (name?: string) => name?.trim() && renameView(page, v.id, name) },
                ], "plain-text", v.name)
              }
              onDelete={() =>
                Alert.alert(`Delete "${v.name}"?`, "The filters on the page stay as they are.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => deleteView(page, v.id) },
                ])
              }
            />
          </View>
        ))}
      </Group>
    </ScrollView>
  );
}

function ViewRow({ name, onRename, onDelete }: { name: string; onRename: () => void; onDelete: () => void }) {
  const t = useTheme();
  return (
    <View style={styles.viewRow}>
      <Text style={[styles.viewName, { color: t.content }]} numberOfLines={1}>
        {name}
      </Text>
      <TextLink title="Rename" label={`Rename ${name}`} onPress={onRename} />
      <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete ${name}`} hitSlop={10} style={({ pressed }) => [styles.del, { opacity: pressed ? 0.5 : 1 }]}>
        <SymbolView name="trash" size={icon.sm} tintColor={t.negative} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
    </View>
  );
}

function ErrorText({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text style={[formStyles.error, { color: t.negative }]} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

/** A labelled text field whose value applies after a pause in typing, so each keystroke doesn't refetch. */
function DraftInput({
  label,
  value,
  onCommit,
  accessibilityLabel,
  ...input
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  accessibilityLabel?: string;
  placeholder: string;
  keyboardType?: "decimal-pad";
  autoCapitalize?: "words";
}) {
  const t = useTheme();
  const [draft, setDraft] = useState(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const clean = (v: string) => (input.keyboardType ? v.replace(/[^0-9.]/g, "") : v.trim());
  const pending = useRef<string | null>(null);
  const flush = () => {
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    commitRef.current(next);
  };
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const next = clean(draft);
    if (next === value) {
      pending.current = null;
      return;
    }
    pending.current = next;
    const timer = setTimeout(flush, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  // Done can close the sheet mid-pause: what was typed still applies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => flush, []);
  return (
    <FieldRow label={label}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholderTextColor={t.contentFaint}
        keyboardAppearance={t.keyboard}
        selectionColor={t.brandInk}
        accessibilityLabel={accessibilityLabel ?? label}
        returnKeyType="done"
        clearButtonMode="while-editing"
        autoCorrect={false}
        onEndEditing={flush}
        style={[formStyles.input, { color: t.content }]}
        {...input}
      />
    </FieldRow>
  );
}

const fromKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** One end of a custom range: the native compact date picker, or Add while unset. */
function DateRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <FieldRow label={label}>
      {value ? (
        <>
          <DateTimePicker
            value={fromKey(value)}
            mode="date"
            display="compact"
            accentColor={t.brandInk}
            onChange={(_, d) => d && onChange(localDayKey(d))}
            accessibilityLabel={label}
          />
          <Pressable onPress={() => onChange("")} accessibilityRole="button" accessibilityLabel={`Clear ${label}`} hitSlop={10}>
            <SymbolView name="xmark.circle.fill" size={icon.md} tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={() => {
            const now = new Date();
            onChange(localDayKey(label === "From" ? new Date(now.getFullYear(), now.getMonth(), 1) : now));
          }}
          accessibilityRole="button"
          accessibilityLabel={`Set ${label} date`}
          hitSlop={8}
          style={({ pressed }) => [styles.add, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.addText, { color: t.brandInk }]}>Add date</Text>
        </Pressable>
      )}
    </FieldRow>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  add: { minHeight: 44, justifyContent: "center" },
  addText: { ...type.body },
  // Pills start where the rows' text starts, and run to the sheet's edge when they scroll.
  // Vertical room so a raised (selected) view pill's edge shadow is not clipped by the scroll view.
  pills: { gap: 8, paddingHorizontal: space.card, paddingVertical: 4 },
  viewsHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 16, paddingRight: space.card },
  clear: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", columnGap: 28, rowGap: 8, paddingTop: 4 },
  viewRow: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48, paddingHorizontal: 16 },
  viewName: { ...type.body, flex: 1 },
  del: { width: 32, height: 44, alignItems: "center", justifyContent: "center" },
}));
