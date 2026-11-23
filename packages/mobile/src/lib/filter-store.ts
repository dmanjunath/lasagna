import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { EMPTY_FILTERS, type TxnFilters } from "./txn-filters";

// A page's filters stay until cleared, and a set of them can be saved under a
// name and picked again. Both live on this device only.

export type FilterPage = "transactions" | "spending" | "portfolio";
export type SavedView = { id: string; name: string; filters: TxnFilters };

const currentKey = (page: FilterPage) => `lasagna-filters-${page}`;
const viewsKey = (page: FilterPage) => `lasagna-views-${page}`;

/** Stored filters from an older build gain the fields they lack. */
export function withDefaults(v: unknown): TxnFilters | null {
  if (!v || typeof v !== "object") return null;
  return { ...EMPTY_FILTERS, ...(v as Partial<TxnFilters>) };
}

export async function loadFilters(page: FilterPage): Promise<TxnFilters | null> {
  try {
    const raw = await AsyncStorage.getItem(currentKey(page));
    return raw ? withDefaults(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveFilters(page: FilterPage, f: TxnFilters): void {
  AsyncStorage.setItem(currentKey(page), JSON.stringify(f)).catch(() => {});
}

// ── Saved views: read once per page, then kept in memory for the hook.
const views = new Map<FilterPage, SavedView[]>();
const subs = new Set<() => void>();
const loading = new Set<FilterPage>();
const EMPTY: SavedView[] = [];

function emit() {
  subs.forEach((f) => f());
}

async function loadViews(page: FilterPage) {
  if (views.has(page) || loading.has(page)) return;
  loading.add(page);
  try {
    const raw = await AsyncStorage.getItem(viewsKey(page));
    const list = raw ? (JSON.parse(raw) as SavedView[]) : [];
    views.set(page, Array.isArray(list) ? list.map((v) => ({ ...v, filters: withDefaults(v.filters) ?? EMPTY_FILTERS })) : []);
  } catch {
    views.set(page, []);
  } finally {
    loading.delete(page);
    emit();
  }
}

function write(page: FilterPage, next: SavedView[]) {
  views.set(page, next);
  emit();
  AsyncStorage.setItem(viewsKey(page), JSON.stringify(next)).catch(() => {});
}

/** The saved views once read: what the hook shows. */
export async function savedViews(page: FilterPage): Promise<SavedView[]> {
  await loadViews(page);
  return views.get(page) ?? EMPTY;
}

export function useSavedViews(page: FilterPage): SavedView[] {
  void loadViews(page);
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => views.get(page) ?? EMPTY,
  );
}

export function addView(page: FilterPage, name: string, filters: TxnFilters, id: string = String(Date.now())): SavedView {
  const view = { id, name: name.trim(), filters };
  write(page, [...(views.get(page) ?? []), view]);
  return view;
}

export function renameView(page: FilterPage, id: string, name: string) {
  write(page, (views.get(page) ?? []).map((v) => (v.id === id ? { ...v, name: name.trim() } : v)));
}

export function deleteView(page: FilterPage, id: string) {
  write(page, (views.get(page) ?? []).filter((v) => v.id !== id));
}

/** The view the filters match exactly, to tick it in the list. */
export function matchingView(list: SavedView[], f: TxnFilters): SavedView | null {
  const key = JSON.stringify(f);
  return list.find((v) => JSON.stringify(v.filters) === key) ?? null;
}

/** For tests: forget what was read. */
export function resetViewsForTest() {
  views.clear();
  loading.clear();
}
