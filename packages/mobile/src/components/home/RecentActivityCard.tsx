import type { TxnQueryRow } from "@web/lib/api";
import { useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import { TxnListRow, type RowActions } from "@/components/transactions/TxnListRow";
import { useTxnEdits } from "@/components/transactions/useTxnEdits";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { openPath } from "@/lib/navigation";
import { useCategoryDisplay } from "@/lib/taxonomy";
import { EMPTY_FILTERS, filtersToSearchParams, type TxnFilters } from "@/lib/txn-filters";
import { pickCategory } from "@/lib/txn-sheets";
import { openTransaction } from "@/lib/txn-store";
import { Card, CardHeader } from "@/ui/Card";
import { space } from "@/theme";
import { EmptyState } from "@/ui/State";

const showOnly = (patch: Partial<TxnFilters>) => openPath(`/transactions?${filtersToSearchParams({ ...EMPTY_FILTERS, ...patch })}`);

/**
 * The latest four transactions, as the transactions list draws them: a tap
 * opens the detail sheet, a long press the same menu (recategorize, rename,
 * and "Show only", which opens the list scoped to that).
 */
export function RecentActivityCard({
  txns,
  onAll,
  title = "Recent activity",
  allTitle = "See all",
  allLabel = "See all transactions",
}: {
  txns: TxnQueryRow[];
  onAll: () => void;
  /** Spending names its own card and counts the full list ("See all 25"). */
  title?: string;
  allTitle?: string;
  allLabel?: string;
}) {
  const hidden = useAmountsHidden();
  const display = useCategoryDisplay();
  const label = useCallback((id: string) => display(id).label, [display]);
  const edits = useTxnEdits(label);
  const editsRef = useRef(edits);
  editsRef.current = edits;

  const actions = useMemo<RowActions>(
    () => ({
      open: openTransaction,
      toggleSelected: () => {},
      pickCategory: (row) => pickCategory({ title: "Category", value: row.categoryId ?? "", onPick: (id) => void editsRef.current.changeCategory(row, id) }),
      renameMerchant: (row) => editsRef.current.promptRename(row),
      filterMerchant: (row) => showOnly({ merchants: [row.merchantName || row.name] }),
      filterCategory: (row) => showOnly({ categories: [row.categoryId] }),
      filterAccount: (row) => showOnly({ accountIds: [row.accountId] }),
    }),
    [],
  );

  return (
    <Card style={{ gap: 6 }}>
      <CardHeader title={title} link={{ title: allTitle, label: allLabel, onPress: onAll }} />
      {txns.length === 0 ? (
        <EmptyState compact title="No transactions yet" />
      ) : (
        // The rows run to the card's edges, as list rows do.
        <View style={{ marginHorizontal: -space.card, marginBottom: -10 }}>
          {txns.map((x) => (
            <TxnListRow
              key={x.id}
              row={x}
              display={display(x.categoryId)}
              hidden={hidden}
              selecting={false}
              selected={false}
              showDate
              hideAccount
              merchantIsFilter={false}
              categoryIsFilter={false}
              accountIsFilter={false}
              actions={actions}
              surface="card"
            />
          ))}
        </View>
      )}
    </Card>
  );
}
