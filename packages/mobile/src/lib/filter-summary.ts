import { categoryChips, dateChipLabel, type TriState, type TxnFilters, type TxnSource } from "./txn-filters";
import { SORT_LABELS } from "./txn-list";
import type { TaxonomyGroup } from "@web/lib/api";

// The filter sheet's summary rows: each says what its sub-page holds, in a few
// words, and whether that differs from the default (shown in the brand ink).

export type RowSummary = { value: string; set: boolean };

export const STATUS_FIELDS = ["pending", "excluded", "recurring", "source"] as const;
export type StatusFieldKey = (typeof STATUS_FIELDS)[number];

/** Each status filter's name and its choices, in the order the sub-page lists them. */
export const STATUS_CHOICES: {
  [K in StatusFieldKey]: { label: string; options: Array<{ value: K extends "source" ? TxnSource : TriState; label: string }> };
} = {
  pending: { label: "Pending", options: [{ value: "any", label: "Any" }, { value: "only", label: "Pending only" }, { value: "hide", label: "Hide pending" }] },
  excluded: { label: "Excluded from totals", options: [{ value: "any", label: "Any" }, { value: "only", label: "Excluded only" }, { value: "hide", label: "Hide excluded" }] },
  recurring: { label: "Recurring", options: [{ value: "any", label: "Any" }, { value: "only", label: "Recurring only" }, { value: "hide", label: "Hide recurring" }] },
  source: { label: "Added by", options: [{ value: "any", label: "Any" }, { value: "bank", label: "Bank only" }, { value: "manual", label: "You only" }] },
};

export function sortSummary(f: TxnFilters): RowSummary {
  return { value: SORT_LABELS[f.sort], set: f.sort !== "newest" };
}

export function dateSummary(f: TxnFilters): RowSummary {
  return { value: dateChipLabel(f), set: f.datePreset !== "all" };
}

export function categoriesSummary(f: TxnFilters, groups: TaxonomyGroup[]): RowSummary {
  const only = categoryChips(f.categories, groups);
  const except = categoryChips(f.excludeCategories, groups);
  if (only.length === 0 && except.length === 0) return { value: "All", set: false };
  if (only.length > 0) return { value: only.length === 1 ? only[0].label : `${only.length} selected`, set: true };
  return { value: except.length === 1 ? `All except ${except[0].label}` : `All except ${except.length}`, set: true };
}

export function accountsSummary(f: TxnFilters, accounts: Array<{ id: string; name: string }>): RowSummary {
  const n = f.accountIds.length;
  if (n === 0) return { value: "All", set: false };
  if (n === 1) return { value: accounts.find((a) => a.id === f.accountIds[0])?.name ?? "1 selected", set: true };
  return { value: `${n} selected`, set: true };
}

export function merchantsSummary(f: TxnFilters): RowSummary {
  const n = f.merchants.length;
  if (n === 0) return { value: "All", set: false };
  return { value: n === 1 ? f.merchants[0] : `${n} selected`, set: true };
}

/** "Any" until a figure is typed: an operator with no amount filters nothing. */
export function amountSummary(f: TxnFilters): RowSummary {
  const min = f.amountOp !== "atMost" ? f.amountMin : "";
  const max = f.amountOp !== "atLeast" ? f.amountMax : "";
  if (f.amountOp === "any" || (!min && !max)) return { value: "Any", set: false };
  if (min && max) return { value: `$${min} to $${max}`, set: true };
  return { value: min ? `At least $${min}` : `At most $${max}`, set: true };
}

export function statusSummary(f: TxnFilters, fields: readonly StatusFieldKey[] = STATUS_FIELDS): RowSummary {
  const on = fields.filter((k) => f[k] !== "any");
  if (on.length === 0) return { value: "Any", set: false };
  if (on.length > 1) return { value: `${on.length} set`, set: true };
  const k = on[0];
  const choice = (STATUS_CHOICES[k].options as Array<{ value: string; label: string }>).find((o) => o.value === f[k]);
  return { value: choice?.label ?? "1 set", set: true };
}
