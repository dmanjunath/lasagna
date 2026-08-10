// Pure logic for POST /api/transactions/query: cursor codec, body validation,
// and the keyset-pagination predicate. Row-wise comparison — DESC pages with
// (field, id) < (v, id), ASC with > — so duplicate field values (common for
// amounts) can't produce gaps or repeats across pages.

import { sql, transactions, type SQL } from "@lasagna/core";
import { UUID_RE } from "./taxonomy.js";

export interface Cursor { v: string; id: string }
export interface QuerySort { field: "date" | "amount"; dir: "asc" | "desc" }
export interface QueryFilters {
  search?: string;
  categoryIds?: string[];
  accountIds?: string[];
  startDate?: Date;
  endDate?: Date;
  amountMin?: number;
  amountMax?: number;
  merchant?: string;
}
export interface NormalizedQuery {
  filters: QueryFilters;
  groupBy: "category" | "group" | "merchant" | null;
  sort: QuerySort;
  limit: number;
  cursor: Cursor | null;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.v === "string" && typeof parsed?.id === "string") {
      return { v: parsed.v, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildKeysetPredicate(sort: QuerySort, cursor: Cursor): SQL {
  const col = sort.field === "date" ? transactions.date : transactions.amount;
  const cast = sort.field === "date" ? sql`${cursor.v}::timestamptz` : sql`${cursor.v}::numeric`;
  return sort.dir === "desc"
    ? sql`(${col}, ${transactions.id}) < (${cast}, ${cursor.id}::uuid)`
    : sql`(${col}, ${transactions.id}) > (${cast}, ${cursor.id}::uuid)`;
}

export function validateQueryBody(body: any): { ok: NormalizedQuery } | { error: string } {
  const f = body?.filters ?? {};
  const filters: QueryFilters = {};

  if (f.search != null && String(f.search).trim() !== "") filters.search = String(f.search).trim();
  if (f.merchant != null && String(f.merchant).trim() !== "") filters.merchant = String(f.merchant).trim();

  for (const key of ["categories", "accountIds"] as const) {
    const v = f[key];
    if (v == null) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return { error: `${key} must be an array of strings` };
    if (key === "accountIds") {
      if (v.length > 0) filters.accountIds = v;
      continue;
    }
    if (v.length > 0) {
      if (!v.every((x: string) => UUID_RE.test(x))) return { error: "categories must be category ids" };
      filters.categoryIds = v;
    }
  }

  for (const key of ["startDate", "endDate"] as const) {
    const v = f[key];
    if (v == null) continue;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return { error: `${key} is not a valid date` };
    filters[key] = d;
  }

  for (const key of ["amountMin", "amountMax"] as const) {
    const v = f[key];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { error: `${key} must be a non-negative finite number` };
    filters[key] = n;
  }
  if (filters.amountMin != null && filters.amountMax != null && filters.amountMin > filters.amountMax) {
    return { error: "amountMin must be <= amountMax" };
  }

  let groupBy: NormalizedQuery["groupBy"] = null;
  if (body?.groupBy != null && body.groupBy !== "date") {
    if (body.groupBy !== "category" && body.groupBy !== "group" && body.groupBy !== "merchant") {
      return { error: "groupBy must be date, category, group, or merchant" };
    }
    groupBy = body.groupBy;
  }

  let sort: QuerySort = { field: "date", dir: "desc" };
  if (body?.sort != null) {
    const { field, dir } = body.sort;
    if (field !== "date" && field !== "amount") return { error: "sort.field must be date or amount" };
    if (dir !== "asc" && dir !== "desc") return { error: "sort.dir must be asc or desc" };
    sort = { field, dir };
  }

  const rawLimit = Number(body?.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 50;

  let cursor: Cursor | null = null;
  if (body?.cursor != null) {
    cursor = decodeCursor(String(body.cursor));
    if (!cursor) return { error: "Invalid cursor" };
    if (!UUID_RE.test(cursor.id)) return { error: "Invalid cursor" };
    if (sort.field === "date") {
      if (Number.isNaN(new Date(cursor.v).getTime())) return { error: "Invalid cursor" };
    } else {
      if (!/^-?\d+(\.\d+)?$/.test(cursor.v)) return { error: "Invalid cursor" };
    }
  }

  return { ok: { filters, groupBy, sort, limit, cursor } };
}

export function cursorForRow(
  sort: QuerySort,
  row: { date: Date | string; amount: string; id: string },
): Cursor {
  return {
    v: sort.field === "date" ? new Date(row.date).toISOString() : String(row.amount),
    id: row.id,
  };
}
