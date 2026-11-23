import type { TxnQueryBody, TxnQueryListResponse, TxnQueryRow } from "@web/lib/api";
import type { BulkEdit } from "@/lib/txn-list";
import type { TxnQueryFilters } from "@/lib/txn-filters";
import { patch, post, request } from "./client";

export type TxnPatch = { category?: string; merchantName?: string | null; notes?: string; excluded?: boolean };

/** The /transactions/query body, with the universal filter's fields. */
export type TxnQuery = Omit<TxnQueryBody, "filters"> & { filters?: TxnQueryFilters };

export const txnApi = {
  query: (body: TxnQuery) => post<TxnQueryListResponse>("/transactions/query", body),
  recent: (limit: number) => request<{ transactions: TxnQueryRow[] }>(`/transactions?limit=${limit}`),
  update: (id: string, body: TxnPatch) => patch<{ success: boolean }>(`/transactions/${id}`, body),
  bulkUpdate: (ids: string[], body: BulkEdit) => patch<{ success: boolean; updated: number }>("/transactions/bulk", { ids, ...body }),
  /** Merchant names with their counts, most used first. `scope` is the filter's other dimensions, as query params. */
  merchants: (q: string, scope: string[] = []) =>
    request<{ counts: Array<{ name: string; count: number }> }>(
      `/transactions/merchants?${[...(q ? [`q=${encodeURIComponent(q)}`] : []), ...scope].join("&")}`,
    ).then((d) => d?.counts ?? []),
};
