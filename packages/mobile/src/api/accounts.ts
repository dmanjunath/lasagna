import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { indexFromItems, type AccountIndexEntry, type PlaidItems } from "@/lib/accounts";
import type { Item } from "@/lib/account-list";
import type { createBody } from "@/lib/add-account";
import { patch, post, request } from "./client";

const EMPTY: AccountIndexEntry[] = [];

/** Every account with its institution, from /plaid/items, as the web's useAccountsIndex builds it. */
export function useAccountsIndex(): { list: AccountIndexEntry[]; byId: Map<string, AccountIndexEntry> } {
  const { data } = useQuery({
    queryKey: ["accounts-index"],
    queryFn: async () => indexFromItems(await request<PlaidItems>("/plaid/items")),
    staleTime: 5 * 60_000,
  });
  const list = data ?? EMPTY;
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);
  return { list, byId };
}

// ── The Accounts area's calls, mirroring packages/web/src/lib/api.ts ─────────

export type Snapshot = { balance: string | null; snapshotAt: string };

const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

export const accountsApi = {
  items: () => request<{ items: Item[] }>("/plaid/items"),
  history: (id: string) => request<{ snapshots: Snapshot[] }>(`/accounts/${id}/history`),
  // Plaid
  linkToken: () => post<{ linkToken: string }>("/plaid/link-token"),
  updateLinkToken: (itemId: string) => post<{ linkToken: string }>("/plaid/link-token/update", { itemId }),
  exchangeToken: (body: { publicToken: string; institutionId?: string; institutionName?: string }) => post<{ itemId: string }>("/plaid/exchange-token", body),
  syncPlaidItem: (itemId: string) => post<{ ok: boolean }>(`/plaid/items/${itemId}/sync`),
  deleteItem: (itemId: string) => del<unknown>(`/plaid/items/${itemId}`),
  syncItem: (itemId: string) => post<{ ok: boolean }>(`/sync/${itemId}`),
  syncAccount: (id: string) => post<{ ok: boolean }>(`/sync/account/${id}`),
  // Manual accounts and settings
  createManual: (body: ReturnType<typeof createBody>) => post<{ account: { id: string; name: string; type: string } }>("/manual-accounts", body),
  updateManual: (id: string, body: { balance?: number }) => patch<{ ok: boolean }>(`/manual-accounts/${id}`, body),
  deleteManual: (id: string) => del<{ ok: boolean }>(`/manual-accounts/${id}`),
  update: (id: string, body: Record<string, unknown>) => patch<{ ok: boolean }>(`/accounts/${id}`, body),
  loanDetails: (id: string, body: Record<string, unknown>) => patch<unknown>(`/accounts/${id}/loan-details`, body),
  propertyDetails: (id: string, body: Record<string, unknown>) => patch<unknown>(`/accounts/${id}/property-details`, body),
  valueEstimate: (id: string) => request<{ status: "none" | "pending" | "ready" | "failed"; value?: number; reason?: "no_home_value" }>(`/accounts/${id}/value-estimate`),
  // Google Places, through the API
  placesAutocomplete: (q: string) => request<{ predictions: Array<{ description: string; placeId: string }> }>(`/places/autocomplete?q=${encodeURIComponent(q)}`),
  placeDetails: (placeId: string) =>
    request<{ address: string | null; placeId: string; lat: number | null; lng: number | null; isBusiness: boolean }>(`/places/details?placeId=${encodeURIComponent(placeId)}`),
};

/** Every connection and its accounts. The detail page and the sheets read the same query. */
export function useItems() {
  return useQuery({ queryKey: ["plaid-items"], queryFn: accountsApi.items });
}

/** After a connection or an account changed: everything that counts accounts reads again. */
export function invalidateAccounts(qc: QueryClient) {
  for (const key of [["plaid-items"], ["accounts-index"], ["facts"], ["net-worth-history"], ["accounts"], ["account-history"], ["transactions"], ["billing-status"], ["debts"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}
