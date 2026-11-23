// The /transactions URL scope and its labels, ported from
// packages/web/src/components/transactions/TransactionFilters.tsx (a React
// module, so it cannot be imported at runtime).
import type { TaxonomyGroup, TxnQueryBody } from "@web/lib/api";
import { CATEGORY_ID_RE } from "@web/lib/spending-filters";
import { formatStoredDay, formatStoredMonth } from "./format";
import { isSortKey, SORT_LABELS, type SortKey } from "./txn-list";

/** in and out leave transfers out (the Spending rule), transfer is only them. */
export type TxnKind = "all" | "in" | "out" | "transfer";
/** A status filter: either way, only those, or none of those. */
export type TriState = "any" | "only" | "hide";
export type TxnSource = "any" | "bank" | "manual";

/** What the API's universal filter takes (packages/api/src/lib/txn-filter.ts), as JSON. */
export type TxnQueryFilters = Omit<NonNullable<TxnQueryBody["filters"]>, "direction" | "merchant"> & {
  merchants?: string[];
  kind?: Exclude<TxnKind, "all">;
  pending?: boolean;
  excluded?: boolean;
  recurring?: boolean;
  source?: "bank" | "manual";
};

export interface TxnFilters {
  search: string;
  /** Exact merchants, as rows show them. */
  merchants: string[];
  categories: string[];
  /** Category ids to drop. */
  excludeCategories: string[];
  accountIds: string[];
  datePreset: "all" | "this-month" | "last-month" | "last-3-months" | "ytd" | "custom";
  customStart: string; // 'YYYY-MM-DD' or ''
  customEnd: string;
  amountOp: "any" | "atLeast" | "atMost" | "between";
  amountMin: string;
  amountMax: string;
  kind: TxnKind;
  pending: TriState;
  excluded: TriState;
  recurring: TriState;
  source: TxnSource;
  /** Only the Transactions list orders by it. */
  sort: SortKey;
}

export const EMPTY_FILTERS: TxnFilters = {
  search: "",
  merchants: [],
  categories: [],
  excludeCategories: [],
  accountIds: [],
  datePreset: "all",
  customStart: "",
  customEnd: "",
  amountOp: "any",
  amountMin: "",
  amountMax: "",
  kind: "all",
  pending: "any",
  excluded: "any",
  recurring: "any",
  source: "any",
  sort: "newest",
};

/** Any status filter narrows the list. */
export function isStatusActive(f: TxnFilters): boolean {
  return f.pending !== "any" || f.excluded !== "any" || f.recurring !== "any" || f.source !== "any";
}

export function amountRangeInverted(f: TxnFilters): boolean {
  return f.amountOp === "between" && f.amountMin !== "" && f.amountMax !== "" && Number(f.amountMin) > Number(f.amountMax);
}

/** From after To. Ignored until fixed, the same way an inverted amount is. */
export function dateRangeInverted(f: TxnFilters): boolean {
  return f.datePreset === "custom" && f.customStart !== "" && f.customEnd !== "" && f.customStart > f.customEnd;
}

/** "Custom range" with no dates yet filters nothing, nor does a backwards one. */
export function isDateActive(f: TxnFilters): boolean {
  if (dateRangeInverted(f)) return false;
  return f.datePreset !== "all" && (f.datePreset !== "custom" || !!f.customStart || !!f.customEnd);
}

/** An amount bound that narrows the list (a backwards range doesn't). */
export function isAmountActive(f: TxnFilters): boolean {
  return (f.amountMin !== "" || f.amountMax !== "") && !amountRangeInverted(f);
}

/** Any filter the Filters sheet holds is narrowing the list (search and money in or out live outside it, and an order narrows nothing). */
export function hasPanelFilters(f: TxnFilters): boolean {
  return (
    f.categories.length > 0 ||
    f.excludeCategories.length > 0 ||
    f.accountIds.length > 0 ||
    f.merchants.length > 0 ||
    isDateActive(f) ||
    isAmountActive(f) ||
    isStatusActive(f)
  );
}

/** Anything Clear all would reset: every filter, search, money in or out, and the order. */
export function hasAnyChoice(f: TxnFilters): boolean {
  return hasActiveFilters(f) || f.sort !== "newest";
}

/** Anything at all narrows the list, which decides between the two empty states. */
export function hasActiveFilters(f: TxnFilters): boolean {
  return (
    f.search !== "" ||
    f.merchants.length > 0 ||
    f.kind !== "all" ||
    isStatusActive(f) ||
    f.categories.length > 0 ||
    f.excludeCategories.length > 0 ||
    f.accountIds.length > 0 ||
    f.datePreset !== "all" ||
    f.amountMin !== "" ||
    f.amountMax !== ""
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** UI filter state to the /transactions/query body's filters. */
export function filtersToQuery(f: TxnFilters, now: Date = new Date()): TxnQueryFilters {
  const result: TxnQueryFilters = {};
  const search = f.search.trim();
  if (search) result.search = search;
  if (f.merchants.length > 0) result.merchants = f.merchants;
  if (f.categories.length > 0) result.categories = f.categories;
  if (f.excludeCategories.length > 0) result.excludeCategories = f.excludeCategories;
  if (f.accountIds.length > 0) result.accountIds = f.accountIds;

  // Open-ended presets omit endDate so the API uses "now" server-side.
  switch (f.datePreset) {
    case "this-month":
      result.startDate = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
      break;
    case "last-month":
      result.startDate = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      result.endDate = `${ymd(new Date(now.getFullYear(), now.getMonth(), 0))}T23:59:59`;
      break;
    case "last-3-months":
      result.startDate = ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1));
      break;
    case "ytd":
      result.startDate = ymd(new Date(now.getFullYear(), 0, 1));
      break;
    case "custom":
      if (dateRangeInverted(f)) break;
      if (f.customStart) result.startDate = f.customStart;
      if (f.customEnd) result.endDate = `${f.customEnd}T23:59:59`;
      break;
  }

  // A min above its max matches nothing, so it is left out until fixed.
  if (!amountRangeInverted(f)) {
    const min = parseFloat(f.amountMin);
    if (!Number.isNaN(min) && (f.amountOp === "atLeast" || f.amountOp === "between")) result.amountMin = min;
    const max = parseFloat(f.amountMax);
    if (!Number.isNaN(max) && (f.amountOp === "atMost" || f.amountOp === "between")) result.amountMax = max;
  }
  if (f.kind !== "all") result.kind = f.kind;
  for (const key of ["pending", "excluded", "recurring"] as const) {
    if (f[key] !== "any") result[key] = f[key] === "only";
  }
  if (f.source !== "any") result.source = f.source;
  return result;
}

/**
 * The same filter as a query string, for the GET endpoints that read it
 * (/spending-summary, /monthly-trend, /merchants): ids comma-joined, one
 * `merchant` per name, since a name can hold a comma. Dates are left to the
 * caller, which owns the window.
 */
export function filtersToApiQuery(f: TxnFilters): string[] {
  const q = filtersToQuery({ ...f, datePreset: "all", customStart: "", customEnd: "" });
  const out: string[] = [];
  if (q.search) out.push(`search=${encodeURIComponent(q.search)}`);
  for (const key of ["categories", "excludeCategories", "accountIds"] as const) {
    const v = q[key];
    if (v?.length) out.push(`${key}=${v.map(encodeURIComponent).join(",")}`);
  }
  for (const m of q.merchants ?? []) out.push(`merchant=${encodeURIComponent(m)}`);
  if (q.amountMin != null) out.push(`amountMin=${q.amountMin}`);
  if (q.amountMax != null) out.push(`amountMax=${q.amountMax}`);
  if (q.kind) out.push(`kind=${q.kind}`);
  for (const key of ["pending", "excluded", "recurring"] as const) if (q[key] != null) out.push(`${key}=${q[key]}`);
  if (q.source) out.push(`source=${q.source}`);
  return out;
}

// ---------------------------------------------------------------------------
// URL <-> filters
// ---------------------------------------------------------------------------

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoDay(raw: string | undefined): string {
  if (!raw) return "";
  const day = raw.slice(0, 10);
  return ISO_DAY.test(day) ? day : "";
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** A query string ("?a=1&b=2" or "a=1&b=2") as a map. The first value of a repeated key wins. */
export function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const key = decode(i === -1 ? part : part.slice(0, i));
    if (key in out) continue;
    out[key] = i === -1 ? "" : decode(part.slice(i + 1));
  }
  return out;
}

/** A query string with every value of a repeated key, for `merchant`. */
export function parseQueryAll(query: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const part of query.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const key = decode(i === -1 ? part : part.slice(0, i));
    const value = i === -1 ? "" : decode(part.slice(i + 1));
    const cur = out[key];
    out[key] = cur === undefined ? value : Array.isArray(cur) ? [...cur, value] : [cur, value];
  }
  return out;
}

const list = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : []);
const tri = (v: string | undefined): TriState => (v === "true" ? "only" : v === "false" ? "hide" : "any");

/** Rebuilds filters from route params (decoded values). A date range arrives as a custom range. */
export function filtersFromParams(params: Record<string, string | string[] | undefined>): TxnFilters {
  const get = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters: TxnFilters = { ...EMPTY_FILTERS };
  const search = get("search")?.trim();
  if (search) filters.search = search;
  const merchants = params.merchant;
  filters.merchants = [...new Set((Array.isArray(merchants) ? merchants : merchants ? [merchants] : []).map((m) => m.trim()).filter(Boolean))];
  filters.categories = list(get("categories"));
  filters.excludeCategories = list(get("excludeCategories"));
  filters.accountIds = list(get("accountIds"));
  const kind = get("kind");
  // `direction` is the old two-value name a link may still carry.
  const direction = get("direction");
  if (kind === "in" || kind === "out" || kind === "transfer") filters.kind = kind;
  else if (direction === "credit") filters.kind = "in";
  else if (direction === "debit") filters.kind = "out";
  filters.pending = tri(get("pending"));
  filters.excluded = tri(get("excluded"));
  filters.recurring = tri(get("recurring"));
  const source = get("source");
  if (source === "bank" || source === "manual") filters.source = source;
  const sort = get("sort");
  if (isSortKey(sort)) filters.sort = sort;
  const amountOp = get("amountOp");
  if (amountOp === "atLeast" || amountOp === "atMost" || amountOp === "between") {
    filters.amountOp = amountOp;
    filters.amountMin = get("amountMin") ?? "";
    filters.amountMax = get("amountMax") ?? "";
  }
  const start = isoDay(get("startDate"));
  const end = isoDay(get("endDate"));
  const preset = get("datePreset");
  if (start || end) {
    filters.datePreset = "custom";
    filters.customStart = start;
    filters.customEnd = end;
  } else if (preset && preset !== "all" && preset in DATE_PRESET_LABELS) {
    // Only the app writes this one: a relative preset ("Last month") that the
    // web keeps in page state rather than in the URL.
    filters.datePreset = preset as TxnFilters["datePreset"];
  }
  return filters;
}

/** The reading half of filtersToSearchParams, from a raw query string. */
export function filtersFromQuery(query: string): TxnFilters {
  return filtersFromParams(parseQueryAll(query));
}

/** The query string filtersFromQuery reads back to these same filters. Commas stay literal. */
export function filtersToSearchParams(f: TxnFilters): string {
  const parts: string[] = [];
  const search = f.search.trim();
  if (search) parts.push(`search=${encodeURIComponent(search)}`);
  for (const m of f.merchants) parts.push(`merchant=${encodeURIComponent(m)}`);
  if (f.categories.length > 0) parts.push(`categories=${f.categories.map(encodeURIComponent).join(",")}`);
  if (f.excludeCategories.length > 0) {
    parts.push(`excludeCategories=${f.excludeCategories.map(encodeURIComponent).join(",")}`);
  }
  if (f.accountIds.length > 0) parts.push(`accountIds=${f.accountIds.map(encodeURIComponent).join(",")}`);
  if (f.kind !== "all") parts.push(`kind=${f.kind}`);
  if (f.amountOp !== "any") {
    parts.push(`amountOp=${f.amountOp}`);
    if (f.amountMin && f.amountOp !== "atMost") parts.push(`amountMin=${encodeURIComponent(f.amountMin)}`);
    if (f.amountMax && f.amountOp !== "atLeast") parts.push(`amountMax=${encodeURIComponent(f.amountMax)}`);
  }
  if (f.datePreset === "custom") {
    if (f.customStart) parts.push(`startDate=${f.customStart}`);
    if (f.customEnd) parts.push(`endDate=${f.customEnd}`);
  }
  for (const key of ["pending", "excluded", "recurring"] as const) {
    if (f[key] !== "any") parts.push(`${key}=${f[key] === "only"}`);
  }
  if (f.source !== "any") parts.push(`source=${f.source}`);
  if (f.sort !== "newest") parts.push(`sort=${f.sort}`);
  return parts.join("&");
}

/**
 * The filters as route params, for router.setParams. Every key is present, so
 * a filter that was cleared is removed from the route too.
 */
export function filtersToParams(f: TxnFilters): Record<string, string | string[] | undefined> {
  const q = parseQueryAll(filtersToSearchParams(f));
  const keys = ["search", "categories", "excludeCategories", "accountIds", "kind", "amountOp", "amountMin", "amountMax", "startDate", "endDate", "pending", "excluded", "recurring", "source", "sort"];
  return {
    ...Object.fromEntries(keys.map((k) => [k, q[k] as string | undefined])),
    // Every name its own value: one merchant is a string, several an array.
    merchant: f.merchants.length === 0 ? undefined : f.merchants.length === 1 ? f.merchants[0] : f.merchants,
    // The old name, so a route that still has it drops it.
    direction: undefined,
    datePreset: f.datePreset === "all" ? undefined : f.datePreset,
  };
}

/**
 * The /transactions URL another screen hands a scope over in: the window a
 * figure was counted over, plus the category scope it was counted under.
 */
export function transactionsHref(scope: Partial<TxnFilters> & { startDate?: string; endDate?: string }): string {
  const { startDate, endDate, ...rest } = scope;
  const query = filtersToSearchParams({
    ...EMPTY_FILTERS,
    ...rest,
    ...(startDate || endDate ? { datePreset: "custom" as const, customStart: startDate?.slice(0, 10) ?? "", customEnd: endDate?.slice(0, 10) ?? "" } : {}),
  });
  // A link with no scope still says so, so the list starts unfiltered rather than from what it last kept.
  return query ? `/transactions?${query}` : "/transactions?fresh=1";
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** "July 2026" when a custom range covers exactly one calendar month. */
export function wholeMonthLabel(start: string, end: string): string | null {
  const a = ISO_DAY.exec(start);
  const b = ISO_DAY.exec(end);
  if (!a || !b) return null;
  if (a[1] !== b[1] || a[2] !== b[2] || a[3] !== "01") return null;
  const year = Number(a[1]);
  const month = Number(a[2]);
  if (month < 1 || month > 12) return null;
  if (Number(b[3]) !== new Date(year, month, 0).getDate()) return null;
  return formatStoredMonth(start, { month: "long" });
}

/** "2026" when a custom range covers exactly one calendar year. */
export function wholeYearLabel(start: string, end: string): string | null {
  const a = ISO_DAY.exec(start);
  const b = ISO_DAY.exec(end);
  if (!a || !b) return null;
  if (a[1] !== b[1] || a[2] !== "01" || a[3] !== "01" || b[2] !== "12" || b[3] !== "31") return null;
  return a[1];
}

/** "Jan 1 to Aug 31, 2026": the range a custom scope covers. */
export function dateRangeLabel(start: string, end: string): string | null {
  const a = ISO_DAY.test(start) ? start : null;
  const b = ISO_DAY.test(end) ? end : null;
  const full = { month: "short", day: "numeric", year: "numeric" } as const;
  if (a && b) {
    if (a === b) return formatStoredDay(a, full);
    const from = a.slice(0, 4) === b.slice(0, 4) ? formatStoredDay(a) : formatStoredDay(a, full);
    return `${from} to ${formatStoredDay(b, full)}`;
  }
  if (a) return `From ${formatStoredDay(a, full)}`;
  if (b) return `Through ${formatStoredDay(b, full)}`;
  return null;
}

export const DATE_PRESET_LABELS: Record<TxnFilters["datePreset"], string> = {
  all: "All time",
  "this-month": "This month",
  "last-month": "Last month",
  "last-3-months": "Last 3 months",
  ytd: "Year to date",
  custom: "Custom range",
};

export const AMOUNT_OP_LABELS: Record<TxnFilters["amountOp"], string> = {
  any: "Any amount",
  atLeast: "At least",
  atMost: "At most",
  between: "Between",
};

/** The date chip: the month or year it landed on, else the span, else the preset. */
export function dateChipLabel(f: TxnFilters): string {
  if (f.datePreset === "custom") {
    return (
      wholeMonthLabel(f.customStart, f.customEnd) ??
      wholeYearLabel(f.customStart, f.customEnd) ??
      dateRangeLabel(f.customStart, f.customEnd) ??
      "Custom dates"
    );
  }
  return DATE_PRESET_LABELS[f.datePreset];
}

export function amountChipLabel(f: TxnFilters): string {
  if (f.amountMin && f.amountMax) return `$${f.amountMin} to $${f.amountMax}`;
  return f.amountMin ? `≥$${f.amountMin}` : `≤$${f.amountMax}`;
}

// ---------------------------------------------------------------------------
// Category chips: a fully selected group is one chip named after the group.
// ---------------------------------------------------------------------------

export type CategoryChip = { key: string; label: string; ids: string[] };

/**
 * Category references from a link, as ids the server takes. A link may name a
 * system category by its key (categories=groceries): that becomes its id.
 * Anything that is neither an id nor a known key is dropped, so a stale link
 * shows the rest of its scope rather than an error (M-6). Null when nothing
 * changes.
 */
export function resolveCategoryRefs(refs: string[], groups: TaxonomyGroup[]): string[] | null {
  if (refs.every((r) => CATEGORY_ID_RE.test(r))) return null;
  const byKey = new Map<string, string>();
  for (const g of groups) for (const c of g.categories) if (c.systemKey) byKey.set(c.systemKey, c.id);
  const out: string[] = [];
  for (const r of refs) {
    const id = CATEGORY_ID_RE.test(r) ? r : byKey.get(r.toLowerCase());
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Enabled categories per group, the picker's rows. */
export function pickerGroups(groups: TaxonomyGroup[]): Array<{ id: string; name: string; categories: Array<{ id: string; name: string }> }> {
  return groups
    .map((g) => ({ id: g.id, name: g.name, categories: g.categories.filter((c) => !c.disabled).map((c) => ({ id: c.id, name: c.name })) }))
    .filter((g) => g.categories.length > 0);
}

export function categoryChips(selected: string[], groups: TaxonomyGroup[]): CategoryChip[] {
  const byId = new Map<string, string>();
  for (const g of groups) for (const c of g.categories) byId.set(c.id, c.name);
  const consumed = new Set<string>();
  const chips: CategoryChip[] = [];
  for (const g of pickerGroups(groups)) {
    const ids = g.categories.map((c) => c.id);
    if (ids.length > 0 && ids.every((id) => selected.includes(id))) {
      ids.forEach((id) => consumed.add(id));
      chips.push({ key: `grp-${g.id}`, label: g.name, ids });
    }
  }
  for (const id of selected) {
    if (consumed.has(id)) continue;
    chips.push({ key: `cat-${id}`, label: byId.get(id) ?? (CATEGORY_ID_RE.test(id) ? "Unavailable category" : id), ids: [id] });
  }
  return chips;
}

// ---------------------------------------------------------------------------
// Active filter chips, each with the filters its removal leaves.
// ---------------------------------------------------------------------------

export type FilterChip = { key: string; label: string; tone: "brand" | "neutral"; removeLabel: string; next: TxnFilters; /** A chip for something outside the filters (a page's own sort) removes itself. */ onRemove?: () => void };

export type ChipAccount = { id: string; name: string; mask: string | null };

/** "Checking ••2492" when another account shares the name, else the name. */
export function accountLabel(acc: ChipAccount, accounts: ChipAccount[]): string {
  const shared = accounts.filter((a) => a.name === acc.name).length > 1;
  return shared && acc.mask ? `${acc.name} ••${acc.mask}` : acc.name;
}

export function filterChips(f: TxnFilters, groups: TaxonomyGroup[], accounts: ChipAccount[]): FilterChip[] {
  const chips: FilterChip[] = [];
  const plain = (key: string, label: string, next: TxnFilters): FilterChip => ({ key, label, tone: "neutral", removeLabel: `Remove ${label} filter`, next });
  if (f.search) chips.push(plain("search", `"${f.search}"`, { ...f, search: "" }));
  for (const m of f.merchants) chips.push(plain(`m-${m}`, m, { ...f, merchants: f.merchants.filter((x) => x !== m) }));
  for (const c of categoryChips(f.categories, groups)) {
    chips.push({
      key: c.key,
      label: `Only ${c.label}`,
      tone: "brand",
      removeLabel: `Remove ${c.label} filter`,
      next: { ...f, categories: f.categories.filter((id) => !c.ids.includes(id)) },
    });
  }
  for (const c of categoryChips(f.excludeCategories, groups)) {
    chips.push({
      key: `ex-${c.key}`,
      label: `Except ${c.label}`,
      tone: "neutral",
      removeLabel: `Stop excluding ${c.label}`,
      next: { ...f, excludeCategories: f.excludeCategories.filter((id) => !c.ids.includes(id)) },
    });
  }
  for (const id of f.accountIds) {
    const acc = accounts.find((a) => a.id === id);
    chips.push(plain(`acc-${id}`, acc ? accountLabel(acc, accounts) : id, { ...f, accountIds: f.accountIds.filter((x) => x !== id) }));
  }
  if (isDateActive(f)) chips.push(plain("date", dateChipLabel(f), { ...f, datePreset: "all", customStart: "", customEnd: "" }));
  if (isAmountActive(f)) chips.push(plain("amount", amountChipLabel(f), { ...f, amountOp: "any", amountMin: "", amountMax: "" }));
  for (const [key, only, hide] of STATUS_CHIPS) {
    if (f[key] !== "any") chips.push(plain(key, f[key] === "only" ? only : hide, { ...f, [key]: "any" }));
  }
  if (f.source !== "any") chips.push(plain("source", SOURCE_LABELS[f.source], { ...f, source: "any" }));
  if (f.sort !== "newest") chips.push(plain("sort", SORT_LABELS[f.sort], { ...f, sort: "newest" }));
  // Money in or out has no chip: the pills on the page show it.
  return chips;
}

const STATUS_CHIPS = [
  ["pending", "Pending only", "No pending"],
  ["excluded", "Excluded only", "No excluded"],
  ["recurring", "Recurring only", "Not recurring"],
] as const;

export const SOURCE_LABELS: Record<TxnSource, string> = { any: "Any", bank: "From your bank", manual: "Entered by you" };

export const KIND_LABELS: Record<TxnKind, string> = { all: "All", in: "Money in", out: "Money out", transfer: "Transfers" };
