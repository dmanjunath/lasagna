import type { TxnQueryRow } from "@web/lib/api";
import { FlashList, type FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Stack, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";
import { useAccountsIndex } from "@/api/accounts";
import { ApiError } from "@/api/client";
import { txnApi } from "@/api/transactions";
import { BULK_BAR_HEIGHT, BulkBar } from "@/components/transactions/BulkBar";
import { CreateRuleBar } from "@/components/transactions/CreateRuleBar";
import { FilterChips } from "@/components/transactions/FilterChips";
import { FiltersButton, ScopeRow } from "@/components/transactions/ScopeRow";
import { SUMMARY_LINE_HEIGHT, SummaryLine, SummaryStrip } from "@/components/transactions/SummaryStrip";
import { TxnListRow, type RowActions } from "@/components/transactions/TxnListRow";
import { refreshAll, useTxnEdits } from "@/components/transactions/useTxnEdits";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { openPath } from "@/lib/navigation";
import { useCategoryDisplay, useTaxonomy } from "@/lib/taxonomy";
import { loadFilters, saveFilters } from "@/lib/filter-store";
import {
  filterChips,
  filtersFromParams,
  EMPTY_FILTERS,
  filtersToParams,
  filtersToQuery,
  hasActiveFilters,
  hasAnyChoice,
  hasPanelFilters,
  resolveCategoryRefs,
  type TxnFilters,
} from "@/lib/txn-filters";
import { SORTS, sortShowsDays, type BulkEdit } from "@/lib/txn-list";
import { headerIndices, toSections, type TxnListItem } from "@/lib/txn-sections";
import { openFilters, openRuleSheet, pickCategory, publishFilters, type FilterSection } from "@/lib/txn-sheets";
import { openTransaction } from "@/lib/txn-store";
import { useTheme as useDesign } from "@/design";
import { radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { SectionHeader } from "@/ui/Form";
import { ScreenTitle, useCollapsingHeader } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { EmptyState, ErrorState } from "@/ui/State";
import { setTabBarHidden } from "@/shell/tab-bar";
import { useTextScaleKey } from "@/ui/text-scale";

const PAGE = 50;
const SECTIONS: FilterSection[] = ["views", "sort", "date", "accounts", "categories", "merchants", "amount", "status"];

export default function Transactions() {
  const t = useTheme();
  const qc = useQueryClient();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const hidden = useAmountsHidden();
  const displayOf = useCategoryDisplay();
  const taxonomy = useTaxonomy();
  const { list: accounts } = useAccountsIndex();

  // ── Filters live in the route's search params, so a link like
  // /transactions?categories=<id>&startDate=… lands on that scope.
  const params = useLocalSearchParams();
  const parsed = filtersFromParams(params);
  const filterQuery = JSON.stringify(filtersToParams(parsed));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => parsed, [filterQuery]);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const setFilters = useCallback((f: TxnFilters) => nav.setParams(filtersToParams(f) as never), [nav]);
  const publish = useCallback(() => publishFilters({ filters: filtersRef.current, set: setFilters, page: "transactions", sections: SECTIONS }), [setFilters]);
  useEffect(publish, [filters, publish]);
  useFocusEffect(publish);

  // The filters stay until cleared: a bare /transactions (the drawer) picks up
  // the last ones. A link with a scope replaces them, and ?fresh=1 (a See all)
  // starts unfiltered. The list waits for this, so it never loads twice.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const fresh = params.fresh === "1";
    if (fresh) nav.setParams({ fresh: undefined } as never);
    if (fresh || hasAnyChoice(filters)) return setRestored(true);
    let live = true;
    void loadFilters("transactions").then((saved) => {
      if (!live) return;
      if (saved && hasAnyChoice(saved)) setFilters({ ...saved, search: "" });
      setRestored(true);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (restored) saveFilters("transactions", filters);
  }, [filters, restored]);

  // A link may name categories by key (categories=groceries): swap in the ids
  // the server takes and drop any it doesn't know, once the taxonomy is in (M-6).
  useEffect(() => {
    const groups = taxonomy.data?.groups;
    if (!groups) return;
    const categories = resolveCategoryRefs(filters.categories, groups);
    const excludeCategories = resolveCategoryRefs(filters.excludeCategories, groups);
    if (categories || excludeCategories) {
      setFilters({ ...filters, categories: categories ?? filters.categories, excludeCategories: excludeCategories ?? filters.excludeCategories });
    }
  }, [filters, taxonomy.data, setFilters]);
  const unresolved = !taxonomy.data && [...filters.categories, ...filters.excludeCategories].some((r) => !/^[0-9a-f-]{36}$/i.test(r));

  const sortKey = filters.sort;
  const barBottomRef = useRef(0);
  const byDate = sortShowsDays(sortKey);

  // ── Data: page 1 carries the summary over the whole match.
  const queryFilters = useMemo(() => filtersToQuery(filters), [filters]);
  const q = useInfiniteQuery({
    queryKey: ["transactions", "list", queryFilters, sortKey],
    queryFn: ({ pageParam }) => txnApi.query({ filters: queryFilters, sort: SORTS[sortKey], limit: PAGE, cursor: pageParam ?? undefined }),
    // A link's category keys become ids first, so the server never sees a key.
    enabled: !unresolved && restored,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // A new scope keeps the old rows on screen, dimmed, until its own arrive.
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.transactions) ?? [], [q.data]);
  const summary = q.data?.pages[0]?.summary ?? null;
  const switching = q.isPlaceholderData;
  // The spinner shows only for a pull. A refetch the app starts itself stays quiet.
  const [pulling, setPulling] = useState(false);
  const pullToRefresh = async () => {
    setPulling(true);
    try {
      await q.refetch();
    } finally {
      setPulling(false);
    }
  };

  // ── Edits
  const categoryLabel = useCallback((id: string) => displayOf(id).label, [displayOf]);
  const edits = useTxnEdits(categoryLabel);
  const { rulePrompt, setRulePrompt } = edits;

  // ── Selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, []);

  // A new scope or order starts over: no stale selection or rule offer, and
  // back at the top of the list (just under the collapsed bar) if scrolled down.
  const scopeKey = `${filterQuery}|${sortKey}`;
  const lastScope = useRef(scopeKey);
  useEffect(() => {
    if (lastScope.current === scopeKey) return;
    lastScope.current = scopeKey;
    setRulePrompt(null);
    setSelectedIds(new Set());
    // Only when scrolled into the rows: at the top the scope row that made the change stays put.
    if (offsetRef.current != null && offsetRef.current > -barBottomRef.current + 40) {
      listRef.current?.scrollToOffset({ offset: -barBottomRef.current, animated: false });
    }
  }, [scopeKey, setRulePrompt]);

  // ── Search: the native bar, debounced into the filters.
  const searchRef = useRef<SearchBarCommands>(null);
  // Focusing the field brings it out from under the bar: the search button, and an arrival to search.
  // searchOpen: opened that way and not yet put away, so a scroll with nothing typed closes it.
  const [searchOpen, setSearchOpen] = useState(params.focus === "search");
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // The field mounts with searchOpen, so focus once the bar has it.
    setTimeout(() => searchRef.current?.focus(), 250);
  }, []);
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => {
    // An outside change (a chip's remove, Clear all, a link) replaces the text.
    if (filters.search !== searchInput.trim()) {
      setSearchInput(filters.search);
      searchRef.current?.setText(filters.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === filtersRef.current.search) return;
    const timer = setTimeout(() => setFilters({ ...filtersRef.current, search: trimmed }), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilters]);
  useEffect(() => {
    // A link that arrives with a search shows it in the bar.
    if (filters.search) setTimeout(() => searchRef.current?.setText(filters.search), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spending's Search transactions lands here with the field focused (?focus=search), once the push has settled.
  useEffect(() => {
    if (params.focus !== "search") return;
    return nav.addListener("transitionEnd" as never, (e: { data?: { closing?: boolean } }) => {
      if (!e.data?.closing) searchRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Row actions: one stable object so memoized rows don't re-render.
  const actionsRef = useRef<RowActions>(null as never);
  actionsRef.current = {
    toggleSelected: (row) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        Haptics.selectionAsync();
        return next;
      }),
    open: (row) => openTransaction(row),
    pickCategory: (row) => {
      setRulePrompt(null);
      pickCategory({ title: "Category", value: row.categoryId ?? "", onPick: (id) => void edits.changeCategory(row, id) });
    },
    renameMerchant: (row) => edits.promptRename(row),
    filterMerchant: (row) => setFilters({ ...filtersRef.current, merchants: [row.merchantName || row.name] }),
    filterCategory: (row) => setFilters({ ...filtersRef.current, categories: [row.categoryId], excludeCategories: [] }),
    filterAccount: (row) => setFilters({ ...filtersRef.current, accountIds: [row.accountId] }),
    select: (row) => {
      setSelectMode(true);
      setSelectedIds(new Set([row.id]));
    },
  };
  const actions = useMemo<RowActions>(
    () => ({
      open: (r) => actionsRef.current.open(r),
      toggleSelected: (r) => actionsRef.current.toggleSelected(r),
      pickCategory: (r) => actionsRef.current.pickCategory(r),
      renameMerchant: (r) => actionsRef.current.renameMerchant(r),
      filterMerchant: (r) => actionsRef.current.filterMerchant(r),
      filterCategory: (r) => actionsRef.current.filterCategory(r),
      filterAccount: (r) => actionsRef.current.filterAccount(r),
      select: (r) => actionsRef.current.select?.(r),
    }),
    [],
  );

  const selecting = selectMode || selectedIds.size > 0;

  useEffect(() => {
    // Leaving select mode remounts the field empty: put the search back.
    if (!selecting && filters.search) setTimeout(() => searchRef.current?.setText(filters.search), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting]);
  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);
  const allShownSelected = rows.length > 0 && selectedRows.length === rows.length;
  const anyIncluded = selectedRows.some((r) => r.excludedAt == null);
  const anyExcluded = selectedRows.some((r) => r.excludedAt != null);

  const applyBulk = useCallback(
    async (edit: BulkEdit) => {
      if (await edits.bulkEdit(selectedRows, edit)) clearSelection();
    },
    [edits, selectedRows, clearSelection],
  );
  const plural = selectedIds.size === 1 ? "transaction" : "transactions";
  const bulkRename = () =>
    Alert.prompt(`Rename ${selectedIds.size} ${plural}`, "Merchant name", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Apply",
        isPreferred: true,
        onPress: (v?: string) => {
          if (v?.trim()) void applyBulk({ merchantName: v.trim() });
        },
      },
    ]);
  const bulkNote = () =>
    Alert.prompt(`Note on ${selectedIds.size} ${plural}`, "Replaces any note already on these transactions.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear notes", style: "destructive", onPress: () => void applyBulk({ notes: "" }) },
      {
        text: "Apply",
        isPreferred: true,
        onPress: (v?: string) => {
          if (v?.trim()) void applyBulk({ notes: v });
        },
      },
    ]);

  // The bottom toolbar takes the tab bar's place (the tab layout lifts the toasts above it).
  useFocusEffect(
    useCallback(() => {
      setTabBarHidden(selecting);
      return () => setTabBarHidden(false);
    }, [selecting]),
  );

  // ── List items, sticky day headers, and the compact summary.
  const items = useMemo(() => toSections(rows, byDate, new Date(), rulePrompt?.txId), [rows, byDate, rulePrompt?.txId]);
  const stickyIndices = useMemo(() => (byDate ? headerIndices(items) : undefined), [items, byDate]);
  // Where the bar ends (with its search field when that shows), in the list's
  // own frame. The bar is clear and the list runs under it from the top of the
  // screen, so the edge is the bar's height.
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const [containerTop, setContainerTop] = useState(0);
  const barBottom = Math.max(0, useHeaderHeight() - containerTop);
  barBottomRef.current = barBottom;
  const [stripBottom, setStripBottom] = useState<number | null>(null);
  const [lineShown, setLineShown] = useState(false);
  // Selecting, the title counts the selection and the tiles stay at the top: no second copy of the totals.
  const hasStrip = !!summary && summary.count > 0 && !selecting;
  const showLine = lineShown && hasStrip;
  // Day headers pin under the nav bar, and under the one-line summary when the strip has gone.
  const stickyOffset = barBottom + (hasStrip ? SUMMARY_LINE_HEIGHT : 0);
  const listRef = useRef<FlashListRef<TxnListItem>>(null);
  const scaleKey = useTextScaleKey();
  const offsetRef = useRef<number | null>(null);
  // The pinned day header is pushed up by the next day's header as it arrives, as iOS lists do.
  const stickyRef = useRef(-1);
  const pinnedHeight = useRef(0);
  const [push, setPush] = useState(0);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current = e.nativeEvent.contentOffset.y;
      const next = stickyRef.current >= 0 ? stickyIndices?.find((i) => i > stickyRef.current) : undefined;
      const layout = next != null ? listRef.current?.getLayout(next) : undefined;
      if (layout && pinnedHeight.current > 0) {
        const nextTop = (listRef.current?.getFirstItemOffset() ?? 0) + layout.y - e.nativeEvent.contentOffset.y;
        const p = Math.min(0, nextTop - (stickyOffset + pinnedHeight.current));
        setPush((v) => (v === p ? v : p));
      } else setPush((v) => (v === 0 ? v : 0));
      if (stripBottom == null) return;
      // The strip is gone once its bottom edge passes under where the line sits.
      const gone = stripBottom - e.nativeEvent.contentOffset.y <= barBottom + SUMMARY_LINE_HEIGHT;
      setLineShown((v) => (v === gone ? v : gone));
    },
    [stripBottom, barBottom, stickyIndices, stickyOffset],
  );

  // A recategorize shows its toast and, under the row, the offer to make it a
  // rule. A row near the foot would have its offer under the toast, so the list
  // scrolls just enough to keep the offer above it.
  const { height: screenHeight } = useWindowDimensions();
  const promptIndex = rulePrompt ? items.findIndex((it) => it.type === "prompt") : -1;
  useEffect(() => {
    if (promptIndex < 0) return;
    const id = setTimeout(() => {
      const layout = listRef.current?.getLayout(promptIndex);
      if (!layout || offsetRef.current == null) return;
      const bottom = containerTop + (listRef.current?.getFirstItemOffset() ?? 0) + layout.y + layout.height - offsetRef.current;
      // The tab bar, the toast (about 52pt) and the gaps around it.
      const clear = screenHeight - (insets.bottom + 49 + 52 + 24);
      if (bottom > clear) listRef.current?.scrollToOffset({ offset: offsetRef.current + bottom - clear, animated: true });
    }, 50);
    return () => clearTimeout(id);
  }, [promptIndex, screenHeight, insets.bottom, containerTop]);

  const [stickyIndex, setStickyIndexState] = useState(-1);
  const setStickyIndex = useCallback((i: number) => {
    stickyRef.current = i;
    setStickyIndexState(i);
    setPush(0);
  }, []);
  const pinnedItem = byDate && stickyIndex >= 0 ? items[stickyIndex] : undefined;
  const pinnedDay = pinnedItem?.type === "header" ? pinnedItem.label : null;
  // The search field already shows its text, so no chip repeats it while it does.
  // Select mode drops the search field, so a search then shows as a chip.
  const searchShown = !selecting && searchInput.trim() === filters.search;
  const chips = useMemo(
    () => filterChips(filters, taxonomy.data?.groups ?? [], accounts).filter((c) => !(searchShown && c.key === "search")),
    [filters, taxonomy.data, accounts, searchShown],
  );
  const hideAccount = filters.accountIds.length === 1;

  const renderItem = useCallback(
    ({ item, target }: ListRenderItemInfo<TxnListItem>) => {
      if (item.type === "header") {
        // FlashList's own pinned copy fades while the next day pushes it,
        // showing rows through it. The screen pins an opaque one instead.
        if (target === "StickyHeader") return null;
        return <DayHeader label={item.label} />;
      }
      const row = item.row;
      if (item.type === "prompt") {
        return rulePrompt ? (
          <CreateRuleBar
            merchantText={rulePrompt.merchantText}
            categoryLabel={displayOf(rulePrompt.category).label}
            onCreate={() => {
              const seed = { merchantText: rulePrompt.merchantText, category: rulePrompt.category };
              setRulePrompt(null);
              openRuleSheet(seed, () => void refreshAll(qc));
            }}
            onDismiss={() => setRulePrompt(null)}
          />
        ) : null;
      }
      const f = filtersRef.current;
      return (
        <TxnListRow
          row={row}
          display={displayOf(row.categoryId)}
          hidden={hidden}
          selecting={selecting}
          selected={selectedIds.has(row.id)}
          showDate={!byDate}
          hideAccount={hideAccount}
          merchantIsFilter={f.merchants.length === 1 && f.merchants[0] === (row.merchantName || row.name)}
          categoryIsFilter={f.categories.length === 1 && f.categories[0] === row.categoryId}
          accountIsFilter={f.accountIds.length === 1 && f.accountIds[0] === row.accountId}
          actions={actions}
        />
      );
    },
    [t, rulePrompt, displayOf, hidden, selecting, selectedIds, byDate, hideAccount, actions, qc, setRulePrompt],
  );

  // With nothing to narrow or order, Filter and Sort have no job.
  const noData = !q.isPending && rows.length === 0 && !hasActiveFilters(filters);
  const matchTotal = summary?.count ?? 0;
  const selectedTitle = matchTotal > rows.length ? `${selectedIds.size} of ${matchTotal} selected` : `${selectedIds.size} selected`;
  // Selecting, the page's title counts the selection, in the content and in the bar alike.
  const title = selecting ? (selectedIds.size === 0 ? "Select transactions" : selectedTitle) : "Transactions";
  const chrome = useCollapsingHeader({ title, refreshing: pulling, onRefresh: () => void pullToRefresh(), searchBar: !(noData || selecting) && (searchOpen || !!filters.search) });
  const setKind = useCallback((kind: TxnFilters["kind"]) => setFilters({ ...filtersRef.current, kind }), [setFilters]);
  const listHeader = (
    <View style={styles.top}>
      <ScreenTitle title={title} root={false} onLayout={chrome.onTitleLayout} />
      {noData || selecting ? null : (
        <ScopeRow
          kind={filters.kind}
          onKind={setKind}
          // Filters (the order among them) at the row's end, as on Spending.
          trailing={<FiltersButton on={hasPanelFilters(filters) || filters.sort !== "newest"} onPress={openFilters} />}
        />
      )}
      <FilterChips chips={chips} onChange={setFilters} />
      {summary && summary.count > 0 ? (
        <View onLayout={(e) => setStripBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height + styles.top.paddingTop)}>
          <SummaryStrip summary={summary} kind={filters.kind} onOpenTx={openTransaction} hidden={hidden} />
        </View>
      ) : null}
      {q.isError && rows.length > 0 ? (
        <Text style={[styles.error, { color: t.negative }]} accessibilityLiveRegion="polite">
          Some transactions didn't load. Pull down to try again.
        </Text>
      ) : null}
    </View>
  );

  const empty = q.isPending ? (
    <RowSkeletons count={8} />
  ) : q.isError ? (
    // Only a network or server failure is worth retrying as is. A request the
    // server refuses (a filter it can't apply) needs the filters cleared (M-6).
    q.error instanceof ApiError && q.error.status >= 400 && q.error.status < 500 ? (
      <ErrorState
        title="These filters can't be applied"
        body="Clear them to see your transactions."
        retryLabel="Clear all"
        onRetry={() => setFilters(EMPTY_FILTERS)}
      />
    ) : (
      <ErrorState title="Transactions didn't load" error={q.error} onRetry={() => void q.refetch()} />
    )
  ) : hasActiveFilters(filters) ? (
    // The chip row above already offers Clear all once there are two chips: say it once.
    <EmptyState
      art={false}
      title="No transactions match"
      body={chips.length >= 2 ? "Remove a filter above to see more." : "Adjust or clear your filters to see more."}
      action={chips.length >= 2 ? undefined : { title: "Clear all", onPress: () => setFilters(EMPTY_FILTERS) }}
    />
  ) : (
    <EmptyState
      icon="creditcard"
      title="No transactions yet"
      body="Connect a bank or card account to see all your transactions here."
      // The one-tap link, the same as Home's (M-5).
      action={{ title: "Connect a bank", onPress: () => openPath("/accounts?autoLink=true") }}
    />
  );

  return (
    <>
      {chrome.bar}
      <Stack.Screen
        options={{
          headerBackVisible: !selecting,
          // With nothing to search, the field has no job either. Select mode drops it too. It shows only once
          // asked for (the search button, an arrival to search) or while a search is on, so a pull to refresh
          // never reveals it above the page title: the title comes first.
          headerSearchBarOptions: noData || selecting || !(searchOpen || filters.search) ? undefined : {
            ref: searchRef,
            placeholder: "Search transactions",
            // An active search stays on screen: a filtered list must say it is filtered.
            // Otherwise it hides on scroll, after the search button or an arrival to search too.
            hideWhenScrolling: !filters.search,
            onChangeText: (e) => setSearchInput(e.nativeEvent.text),
            onCancelButtonPress: () => {
              setSearchInput("");
              setSearchOpen(false);
            },
            obscureBackground: false,
            hideNavigationBar: false,
            autoCapitalize: "none",
            tintColor: t.brandInk,
            textColor: t.content,
            hintTextColor: t.contentFaint,
            headerIconColor: t.contentMuted,
          },
        }}
      />
      {/* The page chrome contract: leading is Back (Cancel while selecting). Trailing: search and Select, or Select All while selecting. No overflow menu: the order is in Filters. */}
      {selecting ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button onPress={clearSelection}>Cancel</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            {/* Selects the loaded rows, as the web does. The title says when that is not the whole match. */}
            <Stack.Toolbar.Button onPress={() => setSelectedIds(allShownSelected ? new Set() : new Set(rows.map((r) => r.id)))}>
              {allShownSelected ? "Deselect All" : "Select All"}
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      ) : noData ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Search transactions" onPress={openSearch} />
          {rows.length > 0 ? <Stack.Toolbar.Button onPress={() => setSelectMode(true)}>Select</Stack.Toolbar.Button> : null}
        </Stack.Toolbar>
      )}

      <View
        ref={containerRef}
        style={{ flex: 1 }}
        onLayout={() => containerRef.current?.measureInWindow((_x: number, y: number) => setContainerTop((v) => (Math.abs(v - y) < 0.5 ? v : y)))}
      >
        <FlashList<TxnListItem>
          // Rows are measured again when the text size changes (see text-scale.ts).
          key={scaleKey}
          ref={(r) => {
            listRef.current = r;
            chrome.scrollRef(r);
          }}
          data={items}
          // Rows only ever append below, and anchoring them made a shrinking
          // header (a chip removed) scroll the list down by its height.
          maintainVisibleContentPosition={{ disabled: true }}
          contentInsetAdjustmentBehavior="automatic"
          keyExtractor={(it) => it.key}
          getItemType={(it) => it.type}
          renderItem={renderItem}
          extraData={renderItem}
          stickyHeaderIndices={stickyIndices}
          stickyHeaderConfig={{ offset: stickyOffset, useNativeDriver: true }}
          onChangeStickyIndex={setStickyIndex}
          // FlashList spaces the first item down by the sticky offset, meant for
          // a list under an overlaid header. This list's inset already clears
          // the nav bar, so the header gives that space back.
          ListHeaderComponentStyle={{ marginBottom: -stickyOffset }}
          onScroll={onScroll}
          // A scroll with nothing typed puts an opened search field away again, as it does on a normal entry.
          onScrollEndDrag={chrome.dragHandlers.onScrollEndDrag}
          onScrollBeginDrag={() => {
            chrome.dragHandlers.onScrollBeginDrag();
            if (!searchOpen || searchInput.trim()) return;
            // An active (focused) search field stays out whatever the setting, so it is closed first.
            searchRef.current?.cancelSearch();
            setSearchOpen(false);
          }}
          scrollEventThrottle={16}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={empty}
          // The scroll view already insets for the home indicator.
          contentContainerStyle={{ paddingHorizontal: space.screen, paddingBottom: selecting ? BULK_BAR_HEIGHT + 16 : 16 }}
          style={{ opacity: switching ? 0.5 : 1 }}
          keyboardDismissMode="on-drag"
          onEndReachedThreshold={1.5}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage && !q.isFetchNextPageError) void q.fetchNextPage();
          }}
          refreshControl={chrome.refreshControl}
          ListFooterComponent={q.isFetchingNextPage ? <RowSkeletons count={2} /> : null}
        />
        {chrome.refreshOverlay}
        {selecting ? (
          <BulkBar
            disabled={selectedIds.size === 0 || edits.bulkBusy}
            actions={[
              { key: "category", label: "Category", onPress: () => pickCategory({ title: "Category", value: "", onPick: (id) => void applyBulk({ category: id }) }) },
              // Shown (disabled) with nothing selected, so the bar keeps its shape.
              { key: "exclude", label: "Exclude", hidden: selectedRows.length > 0 && !anyIncluded, onPress: () => void applyBulk({ excluded: true }) },
              { key: "include", label: "Include", hidden: !anyExcluded, onPress: () => void applyBulk({ excluded: false }) },
              { key: "rename", label: "Rename", onPress: bulkRename },
              { key: "note", label: "Note", onPress: bulkNote },
            ]}
          />
        ) : null}
        {pinnedDay ? (
          <View
            onLayout={(e) => (pinnedHeight.current = e.nativeEvent.layout.height)}
            style={[styles.pinned, { top: stickyOffset, backgroundColor: t.canvas, transform: [{ translateY: push }] }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          >
            <DayHeader label={pinnedDay} />
          </View>
        ) : null}
        {showLine && summary ? (
          <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(120)}
            style={[styles.line, { top: barBottom, backgroundColor: t.canvas, borderBottomColor: t.line }]}
          >
            <SummaryLine summary={summary} kind={filters.kind} hidden={hidden} />
          </Animated.View>
        ) : null}
      </View>
    </>
  );
}

/** A day's heading over its rows. */
function DayHeader({ label }: { label: string }) {
  const t = useTheme();
  return <SectionHeader style={[styles.header, { backgroundColor: t.canvas }]}>{label}</SectionHeader>;
}

/** Rows' outline while they load. */
function RowSkeletons({ count }: { count: number }) {
  const d = useDesign();
  const tileRadius = d.skin.categoryTile === "neutral" ? d.radius.pill : radius.sm;
  return (
    <View accessibilityLabel="Loading" accessible>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          {/* The category tile's shape. */}
          <Skeleton width={42} height={42} style={{ borderRadius: tileRadius }} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="45%" height={14} />
            <Skeleton width="65%" height={12} />
          </View>
          <Skeleton width={64} height={14} />
        </View>
      ))}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  top: { paddingTop: 2, paddingBottom: 8, gap: 12 },
  header: { paddingTop: 14, paddingBottom: 6 },
  error: { ...type.subhead, ...weight.medium },
  skelRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 12 },
  pinned: { position: "absolute", left: 0, right: 0, zIndex: 2, paddingHorizontal: space.screen },
  line: { position: "absolute", left: 0, right: 0, zIndex: 3, borderBottomWidth: StyleSheet.hairlineWidth },
}));
