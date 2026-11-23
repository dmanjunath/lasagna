import type { TxnQueryBody, TxnQueryListResponse, TxnQueryRow } from "@web/lib/api";
import { useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { txnApi } from "@/api/transactions";
import { bulkPatch, bulkToastTitle, SORTS, undoGroups, type BulkEdit, type SortKey } from "@/lib/txn-list";
import { committed, failed } from "@/ui/feedback";

type ListData = InfiniteData<TxnQueryListResponse, string | null>;

/** Patches rows in every cached list page, so an edit shows at once. */
function patchRows(qc: QueryClient, ids: Set<string>, patch: (row: TxnQueryRow) => TxnQueryRow) {
  qc.setQueriesData<ListData>({ queryKey: ["transactions", "list"] }, (old) =>
    old
      ? { ...old, pages: old.pages.map((p) => ({ ...p, transactions: p.transactions.map((r) => (ids.has(r.id) ? patch(r) : r)) })) }
      : old,
  );
}

/** Refreshes every transactions query: the list, its summary and home's cards. */
export function refreshAll(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ["transactions"] });
}

// After an inline recategorize the list keeps the row in place (with its rule
// offer under it), as the web does: everything else refreshes now, and the
// list is marked stale so its next load is fresh. Its summary (count, money
// in and out) is read again on its own, so a row that left a category filter
// stops counting at once (M-11).
function refreshAroundList(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["transactions"], predicate: (q) => q.queryKey[1] !== "list" });
  void qc.invalidateQueries({ queryKey: ["transactions", "list"], refetchType: "none" });
  for (const [key, data] of qc.getQueriesData<ListData>({ queryKey: ["transactions", "list"] })) {
    const [, , filters, sort] = key as [string, string, TxnQueryBody["filters"], string];
    if (!data?.pages[0]) continue;
    void txnApi
      .query({ filters, sort: SORTS[sort as SortKey] ?? undefined, limit: 1 })
      .then((fresh) =>
        qc.setQueryData<ListData>(key, (old) => (old?.pages[0] ? { ...old, pages: [{ ...old.pages[0], summary: fresh.summary }, ...old.pages.slice(1)] } : old)),
      )
      .catch(() => {});
  }
}

export type RulePrompt = { txId: string; merchantText: string; category: string };

/** The list's edits: inline recategorize and rename with Undo, and bulk edits with grouped Undo. */
export function useTxnEdits(categoryLabel: (id: string) => string) {
  const qc = useQueryClient();
  const [rulePrompt, setRulePrompt] = useState<RulePrompt | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const labelRef = useRef(categoryLabel);
  labelRef.current = categoryLabel;

  const one = (id: string) => new Set([id]);

  async function changeCategory(tx: TxnQueryRow, newCat: string) {
    if (newCat === tx.categoryId) return;
    const prevCat = tx.categoryId;
    const merchantText = tx.merchantName || tx.name;
    patchRows(qc, one(tx.id), (r) => ({ ...r, categoryId: newCat }));
    try {
      await txnApi.update(tx.id, { category: newCat });
    } catch {
      patchRows(qc, one(tx.id), (r) => ({ ...r, categoryId: prevCat }));
      return failed("Couldn't update the category, so the change was undone. Try again.");
    }
    refreshAroundList(qc);
    setRulePrompt({ txId: tx.id, merchantText, category: newCat });
    const undo = async () => {
      patchRows(qc, one(tx.id), (r) => ({ ...r, categoryId: prevCat }));
      setRulePrompt(null);
      try {
        await txnApi.update(tx.id, { category: prevCat });
        void refreshAll(qc);
        committed("Change undone");
      } catch {
        patchRows(qc, one(tx.id), (r) => ({ ...r, categoryId: newCat }));
        failed("Couldn't undo. Try again.");
      }
    };
    committed(`Moved to ${labelRef.current(newCat)}`, prevCat ? () => void undo() : undefined);
  }

  async function renameMerchant(tx: TxnQueryRow, name: string) {
    const prev = tx.merchantName;
    patchRows(qc, one(tx.id), (r) => ({ ...r, merchantName: name }));
    try {
      await txnApi.update(tx.id, { merchantName: name });
    } catch {
      patchRows(qc, one(tx.id), (r) => ({ ...r, merchantName: prev }));
      return failed("Couldn't rename the merchant, so the change was undone. Try again.");
    }
    void refreshAll(qc);
    const undo = async () => {
      patchRows(qc, one(tx.id), (r) => ({ ...r, merchantName: prev }));
      try {
        await txnApi.update(tx.id, { merchantName: prev });
        void refreshAll(qc);
        committed("Change undone");
      } catch {
        patchRows(qc, one(tx.id), (r) => ({ ...r, merchantName: name }));
        failed("Couldn't undo. Try again.");
      }
    };
    committed(`Renamed to ${name}`, () => void undo());
  }

  /** The native rename prompt, seeded with the name the row shows. */
  function promptRename(tx: TxnQueryRow) {
    const current = tx.merchantName || tx.name;
    Alert.prompt(
      "Rename merchant",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          isPreferred: true,
          onPress: (value?: string) => {
            const name = value?.trim();
            if (name && name !== current) void renameMerchant(tx, name);
          },
        },
      ],
      "plain-text",
      current,
    );
  }

  /** Applies one edit to every target. Resolves true when it landed. */
  async function bulkEdit(targets: TxnQueryRow[], edit: BulkEdit): Promise<boolean> {
    if (targets.length === 0) return false;
    setBulkBusy(true);
    try {
      await txnApi.bulkUpdate(
        targets.map((t) => t.id),
        edit,
      );
    } catch {
      failed("Couldn't update the selected transactions. Try again.");
      return false;
    } finally {
      setBulkBusy(false);
    }
    const ids = new Set(targets.map((t) => t.id));
    const patch = bulkPatch(edit);
    patchRows(qc, ids, (r) => ({ ...r, ...patch }));
    void refreshAll(qc);

    // Undo groups the rows by their old value, one bulk call per group.
    const groups = undoGroups(targets, edit);
    const before = new Map(targets.map((t) => [t.id, t]));
    const undo = async () => {
      try {
        await Promise.all(groups.map((g) => txnApi.bulkUpdate(g.ids, g.edit)));
        patchRows(qc, ids, (r) => {
          const old = before.get(r.id)!;
          return { ...r, categoryId: old.categoryId, merchantName: old.merchantName, notes: old.notes, excludedAt: old.excludedAt };
        });
        void refreshAll(qc);
        committed("Change undone");
      } catch {
        failed("Couldn't undo. Try again.");
      }
    };
    committed(bulkToastTitle(targets.length, edit, labelRef.current), groups.length > 0 ? () => void undo() : undefined);
    return true;
  }

  return { rulePrompt, setRulePrompt, changeCategory, promptRename, bulkEdit, bulkBusy };
}
