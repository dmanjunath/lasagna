import type { TxnQueryRow } from "@web/lib/api";
import { MenuView, type MenuAction, type NativeActionEvent } from "@react-native-menu/menu";
import { memo, useMemo } from "react";
import { View, type AccessibilityActionEvent } from "react-native";
import { TxnRow } from "@/components/TxnRow";
import { useTheme } from "@/theme";
import type { CategoryDisplay } from "@/lib/taxonomy";

/** What a row's menu can do. One stable object for the whole list, so rows stay memoized. */
export type RowActions = {
  open: (row: TxnQueryRow) => void;
  toggleSelected: (row: TxnQueryRow) => void;
  pickCategory: (row: TxnQueryRow) => void;
  renameMerchant: (row: TxnQueryRow) => void;
  filterMerchant: (row: TxnQueryRow) => void;
  filterCategory: (row: TxnQueryRow) => void;
  filterAccount: (row: TxnQueryRow) => void;
  /** Absent where there is no selection (home's recent activity). */
  select?: (row: TxnQueryRow) => void;
};

const MENU_DISMISS_MS = 450;

/**
 * A transactions-list row. Tap opens the detail sheet. Long press opens the
 * native context menu: recategorize, rename, and "Show only" for the row's
 * merchant, category and account (the web's filter pills). Change category
 * opens the grouped picker sheet. VoiceOver gets the
 * same as custom actions. While selecting, a tap ticks the row and the menu is
 * gone, so a stray press can't reload the list out from under the selection.
 */
function TxnListRowBase({
  row,
  display,
  hidden,
  selecting,
  selected,
  showDate,
  hideAccount,
  merchantIsFilter,
  categoryIsFilter,
  accountIsFilter,
  actions,
  surface,
}: {
  row: TxnQueryRow;
  display: CategoryDisplay;
  hidden: boolean;
  selecting: boolean;
  selected: boolean;
  showDate: boolean;
  hideAccount: boolean;
  merchantIsFilter: boolean;
  categoryIsFilter: boolean;
  accountIsFilter: boolean;
  actions: RowActions;
  surface?: "canvas" | "card";
}) {
  const t = useTheme();
  const merchant = row.merchantName || row.name;
  const canFilterCategory = !!row.categoryId && !categoryIsFilter;
  const canFilterAccount = !!row.accountName && !accountIsFilter;

  // One level of nesting only: the library's new-architecture bridge drops deeper submenus.
  const menu = useMemo<MenuAction[]>(
    () => [
      { id: "category", title: "Change category", image: "tag", imageColor: t.content },
      { id: "rename", title: "Rename merchant", image: "pencil", imageColor: t.content },
      {
        id: "show",
        title: "",
        displayInline: true,
        subactions: [
          ...(merchantIsFilter ? [] : [{ id: "f-merchant", title: `Show only ${merchant}`, image: "line.3.horizontal.decrease", imageColor: t.content }]),
          ...(canFilterCategory ? [{ id: "f-category", title: `Show only ${display.label}`, image: "line.3.horizontal.decrease", imageColor: t.content }] : []),
          ...(canFilterAccount ? [{ id: "f-account", title: `Show only ${row.accountName}`, image: "line.3.horizontal.decrease", imageColor: t.content }] : []),
        ],
      },
      ...(actions.select ? [{ id: "select", title: "Select", image: "checkmark.circle", imageColor: t.content }] : []),
    ],
    [t, row.accountName, merchant, merchantIsFilter, canFilterCategory, canFilterAccount, display.label, actions.select],
  );

  const run = (id: string) => {
    if (id === "category") return actions.pickCategory(row);
    if (id === "rename") return actions.renameMerchant(row);
    if (id === "f-merchant") return actions.filterMerchant(row);
    if (id === "f-category") return actions.filterCategory(row);
    if (id === "f-account") return actions.filterAccount(row);
    if (id === "select") return actions.select?.(row);
  };

  // UIKit leaves a view of its own beside a row whose context menu has been
  // open, which throws off React Native's child indices: unmounting a sibling
  // or the row from a shared parent then crashes. Each row gets a wrapper of
  // its own (never flattened) so UIKit's view lands in it, and the wrapper is
  // keyed by mode so React only ever removes the wrapper whole.
  if (selecting) {
    return (
      <View key="select" collapsable={false}>
        <TxnRow row={row} display={display} hidden={hidden} selecting selected={selected} showDate={showDate} hideAccount={hideAccount} onPress={actions.toggleSelected} surface={surface} />
      </View>
    );
  }

  const a11yActions = [
    { name: "category", label: "Change category" },
    { name: "rename", label: "Rename merchant" },
    ...(merchantIsFilter ? [] : [{ name: "f-merchant", label: `Show only ${merchant}` }]),
    ...(canFilterCategory ? [{ name: "f-category", label: `Show only ${display.label}` }] : []),
    ...(canFilterAccount ? [{ name: "f-account", label: `Show only ${row.accountName}` }] : []),
    ...(actions.select ? [{ name: "select", label: "Select" }] : []),
  ];

  return (
    <View key="menu" collapsable={false}>
      <MenuView
        shouldOpenOnLongPress
        title={merchant}
        actions={menu}
        onPressAction={({ nativeEvent }: NativeActionEvent) => {
          const id = nativeEvent.event;
          // These rebuild the list, so they wait for the menu to finish
          // animating back into the row first.
          if (id.startsWith("f-") || id === "select") setTimeout(() => run(id), MENU_DISMISS_MS);
          else run(id);
        }}
      >
        <TxnRow
          row={row}
          display={display}
          hidden={hidden}
          showDate={showDate}
          hideAccount={hideAccount}
          onPress={actions.open}
          surface={surface}
          accessibilityActions={a11yActions}
          onAccessibilityAction={(e: AccessibilityActionEvent) => run(e.nativeEvent.actionName)}
        />
      </MenuView>
    </View>
  );
}

export const TxnListRow = memo(TxnListRowBase);
