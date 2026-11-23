import { pushInTab } from "./navigation";
import { useSyncExternalStore } from "react";
import type { FilterPage } from "./filter-store";
import type { TxnFilters } from "./txn-filters";

// The transactions screen's sheets are routes of their own, so the screen
// hands them what they work on through here, as txn-store does for the
// detail sheet.

// ── Filters: the screen in view owns them and publishes them, with the
// sections its data supports. One sheet serves every page.
export type FilterSection = "views" | "sort" | "date" | "accounts" | "categories" | "merchants" | "amount" | "status";
export type StatusField = "pending" | "excluded" | "recurring" | "source";
/** An account choice. A page whose accounts are not the account index (Portfolio's holdings) names its own. */
export type AccountOption = { id: string; name: string; detail?: string; group?: string };
/** A sort the page owns that is not the transaction list's (Spending's breakdown order). It replaces the Sort section's choices. */
export type PageSort = { value: string; defaultValue: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void };
export type FilterController = {
  filters: TxnFilters;
  set: (f: TxnFilters) => void;
  page: FilterPage;
  sections: FilterSection[];
  status?: StatusField[];
  accounts?: AccountOption[];
  sort?: PageSort;
};
let controller: FilterController | null = null;
const subs = new Set<() => void>();

export function publishFilters(c: FilterController | null) {
  controller = c;
  subs.forEach((f) => f());
}

export function useFilterController(): FilterController | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => controller,
  );
}

/** A page with one or two sections (Portfolio's accounts) gets a sheet sized to them, not a full-height one. */
export const COMPACT_FILTER_SECTIONS = 2;

export function openFilters() {
  const few = (controller?.sections.filter((s) => s !== "views").length ?? Infinity) <= COMPACT_FILTER_SECTIONS;
  pushInTab(few ? "/transaction-filters?compact=1" : "/transaction-filters");
}

// ── A category to pick, for a row's or the selection's recategorize.
export type CategoryRequest = { title: string; value: string; onPick: (id: string) => void };
let categoryRequest: CategoryRequest | null = null;

export function pickCategory(req: CategoryRequest) {
  categoryRequest = req;
  pushInTab("/pick-category");
}

export function heldCategoryRequest(): CategoryRequest | null {
  return categoryRequest;
}

// ── A new rule, prefilled from a recategorize.
export type RuleSeed = { merchantText: string; category: string };
let ruleRequest: { seed: RuleSeed | null; onChanged: () => void } | null = null;

export function openRuleSheet(seed: RuleSeed | null, onChanged: () => void) {
  ruleRequest = { seed, onChanged };
  pushInTab("/transaction-rule");
}

export function heldRuleRequest() {
  return ruleRequest;
}
