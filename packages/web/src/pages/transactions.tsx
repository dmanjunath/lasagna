import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { Banknote, ChevronLeft, ChevronRight, DollarSign, Receipt, Search, SlidersHorizontal } from 'lucide-react';
import { api, type TxnQueryRow, type TxnQuerySummary } from '../lib/api';
import { useAccountsIndex } from '../lib/use-accounts-index';
import { cn, formatStoredDay, storedDayKey } from '../lib/utils';
import { HIDDEN_AMOUNT, isAmountsHidden, isMasked } from '../lib/hide-amounts';
import { HiddenAmount } from '../components/uikit';
import { usePageContext } from '../lib/page-context';
import { Alert, Button, EmptyState, Skeleton, useToast } from '../components/uikit';
import { PageTitle } from '../components/ds/PageTitle';
import { useCategoryDisplay } from '../lib/taxonomy';
import {
  TxnRow,
  CreateRuleBar,
  PENCIL_CLASS,
} from '../components/transactions/TransactionList';
import { CategoryPicker } from '../components/common/CategoryPicker';
import { InstIcon } from '../components/common/InstIcon';
import { TransactionDetail } from '../components/transactions/TransactionDetail';
import {
  TransactionFilters,
  EMPTY_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  filtersToSearchParams,
  hasPanelFilters,
  type TxnFilters,
} from '../components/transactions/TransactionFilters';
import { HeaderAction, HeaderTextAction } from '../components/layout/app-header';
import { useMobileHeader } from '../lib/mobile-header';
import { useIsMobile } from '../lib/hooks/use-mobile';
import { RulesPanel } from '../components/rules/RulesPanel';
import { BulkEditBar, type BulkEdit } from '../components/transactions/BulkEditBar';
import { OptionMenu } from '../components/common/OptionMenu';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrencyExact(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// The heading over a day's rows. The day itself comes from the shared helper,
// so the heading and the TxnRow dates under it always name the same day.
// "Today" and "Yesterday" compare against the reader's own calendar, which is
// the calendar they mean by those two words.
function dayLabel(iso: string, now: Date = new Date()): string {
  const day = storedDayKey(iso);
  const localKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (day === localKey(now)) return 'Today';
  if (day === localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
    return 'Yesterday';
  }
  const sameYear = day.slice(0, 4) === String(now.getFullYear());
  return formatStoredDay(iso, sameYear ? undefined : { year: 'numeric' });
}

type SortKey = 'newest' | 'oldest' | 'largest' | 'smallest';

const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  largest: 'Largest amount',
  smallest: 'Smallest amount',
};

const SORTS: Record<SortKey, { field: 'date' | 'amount'; dir: 'asc' | 'desc' }> = {
  newest: { field: 'date', dir: 'desc' },
  oldest: { field: 'date', dir: 'asc' },
  largest: { field: 'amount', dir: 'desc' },
  smallest: { field: 'amount', dir: 'asc' },
};

const PAGE_SIZE = 50;

function formatCompactCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

// "Aug 11, 2026" for a single day, else "Jan 3 to Aug 11, 2026" — the year
// shows once when the span stays inside one calendar year.
//
// Read through the same shared helper as the day headings and the rows. These
// are the earliest and latest of the very transactions listed underneath, so a
// second date rule here printed a span that contradicted the rows inside it
// ("Apr 15 to Jun 21" over rows reading Apr 16 and Jun 22).
function dateRangeLabel(earliest: string | null, latest: string | null): string {
  if (!earliest || !latest) return '';
  const a = formatStoredDay(earliest, { year: 'numeric' });
  const b = formatStoredDay(latest, { year: 'numeric' });
  if (a === b) return a;
  if (storedDayKey(earliest).slice(0, 4) === storedDayKey(latest).slice(0, 4)) {
    return `${formatStoredDay(earliest)} to ${b}`;
  }
  return `${a} to ${b}`;
}

// ---------------------------------------------------------------------------
// KPI strip — money in / out, net, and the count over the CURRENT filter set
// (server-summed across the whole match, not just the loaded page). Mirrors the
// spending page's StatCell idiom so the two pages read as siblings.
// ---------------------------------------------------------------------------

function KpiCell({ label, value, sub, tone }: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: 'pos' | 'neg';
}) {
  // A masked figure sheds its tone AND the sign baked into its string: both
  // would still say which way the number went.
  const masked = isMasked(value);
  return (
    <div className="px-4 py-3 sm:px-5 sm:py-3.5">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-content-muted">{label}</div>
      <div className={cn(
        'mt-1.5 font-editorial text-[19px] sm:text-[22px] font-extrabold leading-none tracking-[-0.02em] ui-tnum',
        !masked && tone === 'pos' && 'text-[rgb(var(--ui-brand-ink))]',
        !masked && tone === 'neg' && 'text-negative',
      )}>{masked ? <HiddenAmount /> : value}</div>
      {sub && <div className="mt-1.5 truncate text-[11.5px] font-semibold text-content-muted">{sub}</div>}
    </div>
  );
}

// Guarded money formatter — an older API (or a web/API deploy skew) can send a
// summary without the money fields; render a dash rather than "NaN".
function money(n: number): string {
  return Number.isFinite(n) ? formatCurrencyExact(n) : '—';
}

function kpiFigures(summary: TxnQuerySummary) {
  const { totalCredits: credits, totalDebits: debits } = summary;
  const netKnown = Number.isFinite(credits) && Number.isFinite(debits);
  const net = credits - debits;
  return {
    count: Number.isFinite(summary.count) ? formatCompactCount(summary.count) : '—',
    moneyIn: money(credits),
    moneyOut: money(debits),
    net: netKnown ? `${net < 0 ? '−' : ''}${formatCurrencyExact(Math.abs(net))}` : '—',
    netTone: (netKnown ? (net < 0 ? 'neg' : net > 0 ? 'pos' : undefined) : undefined) as 'pos' | 'neg' | undefined,
  };
}

// "Largest $3,032.35" under Money in / Money out, opening that transaction.
function LargestLink({ tx, onOpen }: { tx: TxnQueryRow | null | undefined; onOpen: (tx: TxnQueryRow) => void }) {
  if (!tx) return null;
  const amount = Math.abs(parseFloat(tx.amount));
  return (
    <button
      type="button"
      onClick={() => onOpen(tx)}
      title={`${tx.merchantName || tx.name}, ${formatStoredDay(tx.date)}`}
      // Link-styled (brand ink and a chevron, like the chip's View link), so it
      // reads as a way to the transaction rather than a caption.
      className="ui-focus touch-target-inline inline-flex max-w-full items-center gap-0.5 rounded-ui-xs text-left text-[rgb(var(--ui-brand-ink))] [@media(hover:hover)]:hover:underline"
    >
      <span className="truncate">Largest {isAmountsHidden() ? <HiddenAmount /> : formatCurrencyExact(amount)}</span>
      <ChevronRight size={13} className="shrink-0" aria-hidden />
    </button>
  );
}

// Under a Credit or Debit filter the other side is always zero and Net only
// restates the one side left, so both drop out.
function KpiStrip({ summary, direction, onOpenTx }: {
  summary: TxnQuerySummary;
  direction: TxnFilters['direction'];
  onOpenTx: (tx: TxnQueryRow) => void;
}) {
  const k = kpiFigures(summary);
  const range = dateRangeLabel(summary.earliest, summary.latest);
  const both = direction === 'all';
  return (
    <div className={cn(
      // Two by two until xl, where the row columns also switch: in a
      // sidebar-narrowed column, four six-figure amounts ran into each other.
      'mt-4 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm xl:divide-y-0',
      both ? 'xl:grid-cols-4' : 'divide-y-0',
    )}>
      <KpiCell label="Transactions" value={k.count} sub={range || undefined} />
      {direction !== 'debit' && (
        <KpiCell label="Money in" value={k.moneyIn} tone="pos" sub={summary.largestCredit ? <LargestLink tx={summary.largestCredit} onOpen={onOpenTx} /> : undefined} />
      )}
      {direction !== 'credit' && (
        <KpiCell label="Money out" value={k.moneyOut} sub={summary.largestDebit ? <LargestLink tx={summary.largestDebit} onOpen={onOpenTx} /> : undefined} />
      )}
      {both && <KpiCell label="Net" value={k.net} tone={k.netTone} />}
    </div>
  );
}

// The same figures on one line, under the stuck toolbar once the strip above
// has scrolled away.
function KpiLine({ summary, direction }: { summary: TxnQuerySummary; direction: TxnFilters['direction'] }) {
  const k = kpiFigures(summary);
  const item = (label: string, value: string, tone?: 'pos' | 'neg', short?: string) => {
    const masked = isMasked(value);
    return (
      <span className="whitespace-nowrap">
        {short ? (
          <>
            <span className="text-content-muted sm:hidden">{short}</span>
            <span className="hidden text-content-muted sm:inline">{label}</span>
          </>
        ) : <span className="text-content-muted">{label}</span>}{' '}
        <span className={cn(
          'font-bold ui-tnum text-content',
          !masked && tone === 'pos' && 'text-[rgb(var(--ui-brand-ink))]',
          !masked && tone === 'neg' && 'text-negative',
        )}>{masked ? <HiddenAmount /> : value}</span>
      </span>
    );
  };
  return (
    // Must never clip: a cut-off figure reads as a different number. Below lg
    // the count drops out and the gaps tighten so the money figures fit.
    <div className="flex h-9 items-center gap-x-3 whitespace-nowrap text-[12.5px] lg:gap-x-5">
      <span className="hidden lg:inline">{item('Transactions', k.count)}</span>
      {direction !== 'debit' && item('Money in', k.moneyIn, 'pos', 'In')}
      {direction !== 'credit' && item('Money out', k.moneyOut, undefined, 'Out')}
      {direction === 'all' && item('Net', k.net, k.netTone)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transactions page — browse everything: search, filters, sort, infinite
// scroll, inline category editing, and a filter-scoped KPI strip.
// ---------------------------------------------------------------------------

export function Transactions() {
  const { setPageContext } = usePageContext();
  const [, setLocation] = useLocation();
  const displayOf = useCategoryDisplay();
  const toast = useToast();

  // Hydrate the filters from the URL so a drill-in lands on the scope it
  // promised: categories, a date range, and a merchant search
  // (`/transactions?categories=<id>&startDate=2026-07-01&endDate=2026-07-31`).
  const [filters, setFilters] = useState<TxnFilters>(() => filtersFromQuery(window.location.search));
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  // Paginated list accumulation
  const [rows, setRows] = useState<TxnQueryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Server-summed money in/out, count, and date span over the full filter match.
  const [summary, setSummary] = useState<TxnQuerySummary | null>(null);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline edit + rules
  const [createRulePrompt, setCreateRulePrompt] = useState<{ txId: string; merchantText: string; category: string } | null>(null);
  const [rulesPanel, setRulesPanel] = useState<{ open: boolean; seed: { merchantText: string; category: string } | null }>({ open: false, seed: null });
  const [detailTx, setDetailTx] = useState<TxnQueryRow | null>(null);
  const dismissMovedToastRef = useRef<(() => void) | null>(null);

  // Multi-select. `selectMode` is the phone's explicit entry (no hover to
  // reveal the checkboxes); on desktop any ticked row puts the list in it.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const selecting = selectMode || selectedIds.size > 0;
  // The phone's Filters panel. Its trigger sits in the top bar.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isMobile = useIsMobile();

  // The sticky toolbar's height, so the day headings stick just below it.
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const [toolbarH, setToolbarH] = useState(0);
  // Where the toolbar sticks: under the phone's fixed top bar, 0 on wider
  // screens. Read from its computed style, so the safe-area inset is counted.
  const [stickyTop, setStickyTop] = useState(0);
  // The one-line KPIs show only once the full strip has gone under the
  // toolbar, so the same figures are never on screen twice.
  const kpiStripRef = useRef<HTMLDivElement | null>(null);
  const [kpiHidden, setKpiHidden] = useState(false);
  useEffect(() => {
    const el = kpiStripRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      // Gone above the toolbar's bottom edge, not merely below the fold.
      ([e]) => setKpiHidden(!e.isIntersecting && e.boundingClientRect.bottom <= (e.rootBounds?.top ?? stickyTop + toolbarH)),
      { rootMargin: `-${stickyTop + toolbarH}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [stickyTop, toolbarH, summary != null && summary.count > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const stuckSentinelRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = stuckSentinelRef.current;
    if (!el) return;
    // Stuck once the line above the toolbar passes under where it sticks.
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: `-${stickyTop}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [stickyTop]);
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const measure = () => {
      setToolbarH(el.offsetHeight);
      setStickyTop(parseFloat(getComputedStyle(el).top) || 0);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // Accounts with institution identity — for the account filter options/chips.
  const { list: accounts } = useAccountsIndex();
  const [refreshKey, setRefreshKey] = useState(0);

  // Latest-wins: every filters/sort change bumps the seq; responses tagged with
  // an older seq are dropped so a slow page-1 can't clobber newer state.
  const requestSeqRef = useRef(0);
  // Prevents two simultaneous loadMore fetches when the IntersectionObserver
  // fires twice before the first response resolves.
  const inFlightRef = useRef(false);

  useEffect(() => {
    setPageContext({
      pageId: 'transactions',
      pageTitle: 'Transactions',
      description: 'All transactions across accounts with search, filters, and sort.',
    });
  }, [setPageContext]);

  // Keep the address bar on the scope that is actually on screen, so a filtered
  // view can be copied out and pasted back, and a reload lands where it left.
  // Always a replace, never a push: filters are not places, so Back (the top
  // bar's, the in-page one, or a swipe) leaves the page for wherever the user
  // came from instead of stepping through filter states.
  const filterQuery = filtersToSearchParams(filters);
  useEffect(() => {
    const next = filterQuery ? `/transactions?${filterQuery}` : '/transactions';
    if (`${window.location.pathname}${window.location.search}` !== next) setLocation(next, { replace: true });
  }, [filterQuery, setLocation]);

  // One fetch pipeline: page 1 for the current filters/sort. Resets accumulation
  // and refreshes the filter-scoped summary.
  useEffect(() => {
    const seq = ++requestSeqRef.current;
    setLoadingInitial(true);
    setError(null);
    setCreateRulePrompt(null);
    setSelectedIds(new Set());
    const qf = filtersToQuery(filters);

    api.queryTransactions({ filters: qf, sort: SORTS[sortKey], limit: PAGE_SIZE })
      .then((res) => {
        if (seq !== requestSeqRef.current || res.mode !== 'list') return;
        setRows(res.transactions);
        setNextCursor(res.nextCursor);
        setSummary(res.summary);
      })
      .catch((err: Error) => {
        if (seq !== requestSeqRef.current) return;
        setError(err.message || 'Failed to load transactions');
      })
      .finally(() => {
        if (seq === requestSeqRef.current) setLoadingInitial(false);
      });
  }, [filters, sortKey, refreshKey]);

  // Infinite scroll. Kept in a ref so the observer always calls the latest closure.
  const loadMoreRef = useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    if (!nextCursor || loadingMore || loadingInitial || inFlightRef.current) return;
    inFlightRef.current = true;
    const seq = requestSeqRef.current;
    setLoadingMore(true);
    api.queryTransactions({ filters: filtersToQuery(filters), sort: SORTS[sortKey], limit: PAGE_SIZE, cursor: nextCursor })
      .then((res) => {
        if (seq !== requestSeqRef.current || res.mode !== 'list') return;
        setRows((prev) => [...prev, ...res.transactions]);
        setNextCursor(res.nextCursor);
      })
      .catch((err: Error) => {
        if (seq !== requestSeqRef.current) return;
        if (/cursor/i.test(err.message || '')) {
          // Stale/garbage cursor — clear it and restart from page 1.
          setNextCursor(null);
          setRefreshKey((k) => k + 1);
        } else {
          setError(err.message || 'Failed to load more transactions');
        }
      })
      .finally(() => {
        inFlightRef.current = false;
        setLoadingMore(false);
      });
  };

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '400px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadingInitial, nextCursor]);

  // Patch a transaction's fields in the list.
  function patchTx(txId: string, patch: Partial<Pick<TxnQueryRow, 'merchantName' | 'categoryId' | 'notes' | 'excludedAt'>>) {
    setRows((prev) => prev.map((t) => (t.id === txId ? { ...t, ...patch } : t)));
  }

  // Page-local optimistic category edit (same shape as TransactionList's
  // categoryEditorFor): capture prev → optimistic → PATCH → prompt on
  // success, revert on failure. `newCatId` is a category id (uuid).
  async function handleCategoryEdit(tx: TxnQueryRow, newCatId: string) {
    if (newCatId === tx.categoryId) {
      return;
    }
    const prevCatId = tx.categoryId;
    const merchantText = tx.merchantName || tx.name;
    patchTx(tx.id, { categoryId: newCatId });
    try {
      await api.updateTransactionCategory(tx.id, newCatId);
      setCreateRulePrompt({ txId: tx.id, merchantText, category: newCatId });
      const undo = async () => {
        patchTx(tx.id, { categoryId: prevCatId });
        setCreateRulePrompt(null);
        try {
          await api.updateTransactionCategory(tx.id, prevCatId as string);
          toast({ tone: 'info', title: 'Change undone' });
        } catch {
          patchTx(tx.id, { categoryId: newCatId });
          setError("Couldn't undo. Try again.");
        }
      };
      dismissMovedToastRef.current = toast({
        tone: 'positive',
        title: `Moved to ${displayOf({ categoryId: newCatId }).label}`,
        duration: 6000,
        action: prevCatId ? { label: 'Undo', onClick: () => void undo() } : undefined,
      });
    } catch (err) {
      console.error(err);
      patchTx(tx.id, { categoryId: prevCatId });
      setError("Couldn't update the category, so the change was undone. Try again.");
    }
  }

  function toggleSelected(txId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectMode(false);
  }

  // Escape leaves selection, as it does in a mail client.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      // An open dialog, menu or listbox takes Escape for itself first.
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selecting]);

  // The row fields one bulk edit changes, as the list holds them.
  function bulkPatch(edit: BulkEdit): Partial<TxnQueryRow> {
    const patch: Partial<TxnQueryRow> = {};
    if (edit.category !== undefined) patch.categoryId = edit.category;
    if (edit.merchantName !== undefined) patch.merchantName = edit.merchantName;
    if (edit.notes !== undefined) patch.notes = edit.notes.trim() === '' ? null : edit.notes;
    if (edit.excluded !== undefined) patch.excludedAt = edit.excluded ? new Date().toISOString() : null;
    return patch;
  }

  // The edit that puts one row back the way it was before `edit`.
  function revertEditFor(tx: TxnQueryRow, edit: BulkEdit): BulkEdit | null {
    if (edit.category !== undefined) return tx.categoryId ? { category: tx.categoryId } : null;
    if (edit.merchantName !== undefined) return { merchantName: tx.merchantName };
    if (edit.notes !== undefined) return { notes: tx.notes ?? '' };
    return { excluded: tx.excludedAt != null };
  }

  async function handleBulkEdit(edit: BulkEdit): Promise<boolean> {
    const targets = rows.filter((t) => selectedIds.has(t.id));
    if (targets.length === 0) return false;
    setBulkBusy(true);
    try {
      await api.bulkUpdateTransactions(targets.map((t) => t.id), edit);
    } catch (err) {
      console.error(err);
      setError("Couldn't update the selected transactions. Try again.");
      return false;
    } finally {
      setBulkBusy(false);
    }
    const ids = new Set(targets.map((t) => t.id));
    const patch = bulkPatch(edit);
    setRows((prev) => prev.map((t) => (ids.has(t.id) ? { ...t, ...patch } : t)));
    clearSelection();

    // Undo groups the rows by their old value, one bulk call per group.
    const groups = new Map<string, { edit: BulkEdit; ids: string[] }>();
    for (const t of targets) {
      const back = revertEditFor(t, edit);
      if (!back) continue;
      const key = JSON.stringify(back);
      if (!groups.has(key)) groups.set(key, { edit: back, ids: [] });
      groups.get(key)!.ids.push(t.id);
    }
    const undo = async () => {
      try {
        await Promise.all([...groups.values()].map((g) => api.bulkUpdateTransactions(g.ids, g.edit)));
        const before = new Map(targets.map((t) => [t.id, t]));
        setRows((prev) => prev.map((t) => {
          const old = before.get(t.id);
          return old ? { ...t, categoryId: old.categoryId, merchantName: old.merchantName, notes: old.notes, excludedAt: old.excludedAt } : t;
        }));
        toast({ tone: 'info', title: 'Change undone' });
      } catch {
        setError("Couldn't undo. Try again.");
      }
    };

    const n = targets.length;
    const noun = n === 1 ? 'transaction' : 'transactions';
    const title =
      edit.category !== undefined ? `Moved ${n} ${noun} to ${displayOf({ categoryId: edit.category }).label}`
      : edit.merchantName !== undefined ? `Renamed ${n} ${noun} to ${edit.merchantName}`
      : edit.notes !== undefined ? (edit.notes.trim() === '' ? `Cleared the note on ${n} ${noun}` : `Added a note to ${n} ${noun}`)
      : edit.excluded ? `Excluded ${n} ${noun}` : `Included ${n} ${noun}`;
    toast({
      tone: 'positive',
      title,
      duration: 6000,
      action: groups.size > 0 ? { label: 'Undo', onClick: () => void undo() } : undefined,
    });
    return true;
  }

  const bulkProps = {
    count: selectedIds.size,
    shownCount: rows.length,
    allShownSelected: rows.length > 0 && rows.every((t) => selectedIds.has(t.id)),
    anyIncluded: rows.some((t) => selectedIds.has(t.id) && t.excludedAt == null),
    anyExcluded: rows.some((t) => selectedIds.has(t.id) && t.excludedAt != null),
    busy: bulkBusy,
    onSelectAll: () => setSelectedIds(new Set(rows.map((t) => t.id))),
    onClear: clearSelection,
    onApply: handleBulkEdit,
  };

  // Inline rename from the row. Same optimistic shape as the category edit.
  async function handleMerchantRename(tx: TxnQueryRow, name: string) {
    const prev = tx.merchantName;
    patchTx(tx.id, { merchantName: name });
    try {
      await api.updateTransaction(tx.id, { merchantName: name });
    } catch (err) {
      console.error(err);
      patchTx(tx.id, { merchantName: prev });
      setError("Couldn't rename the merchant, so the change was undone. Try again.");
      return;
    }
    const undo = async () => {
      patchTx(tx.id, { merchantName: prev });
      try {
        await api.updateTransaction(tx.id, { merchantName: prev });
        toast({ tone: 'info', title: 'Change undone' });
      } catch {
        patchTx(tx.id, { merchantName: name });
        setError("Couldn't undo. Try again.");
      }
    };
    toast({
      tone: 'positive',
      title: `Renamed to ${name}`,
      duration: 6000,
      action: { label: 'Undo', onClick: () => void undo() },
    });
  }

  // One transaction row (+ create-rule bar) — shared everywhere so inline
  // editing behaves identically.
  function renderTxRow(tx: TxnQueryRow) {
    const amount = parseFloat(tx.amount);
    const isIncome = amount < 0;
    const display = displayOf(tx);
    const account = accounts.find((a) => a.id === tx.accountId);
    const categoryNode = selecting ? (
      <span className="min-w-0 truncate text-content-secondary">{display.label}</span>
    ) : (
      <CategoryPicker
        variant="inline"
        value={tx.categoryId ?? ''}
        currentLabel={display.label}
        onOpen={() => setCreateRulePrompt(null)}
        onChange={(newCatId) => handleCategoryEdit(tx, newCatId)}
      />
    );
    return (
      <React.Fragment key={tx.id}>
        {/* Clickable wrapper (row only — the CreateRuleBar sibling stays
             outside). TxnRow is always the wrapper's first child so its own
             border-t is suppressed; the wrapper carries it instead. */}
        {/* Mouse: click anywhere on the row opens details. Keyboard/AT: the
             merchant is the "open details" button (see onOpenDetail), so the row
             div is NOT role=button and doesn't nest the inner category picker. */}
        {/* While selecting, a row click ticks the row, and the merchant and
             account stop being filter links so a stray tap can't reload the
             list out from under the selection. */}
        <div
          onClick={() => (selecting ? toggleSelected(tx.id) : setDetailTx(tx))}
          className={cn(
            'cursor-pointer border-t border-line transition-colors first:border-t-0 last:rounded-b-ui-xl hover:bg-canvas-sunken/60',
            selectedIds.has(tx.id) && 'bg-[var(--ui-brand-softer)] hover:bg-[var(--ui-brand-soft)]',
          )}
        >
          <TxnRow
            merchant={tx.merchantName || tx.name}
            onOpenDetail={selecting ? undefined : () => setDetailTx(tx)}
            onMerchantClick={selecting ? undefined : () => setFilters((f) => ({ ...f, merchant: tx.merchantName || tx.name }))}
            onAccountClick={selecting ? undefined : () => setFilters((f) => (
              f.accountIds.length === 1 && f.accountIds[0] === tx.accountId ? f : { ...f, accountIds: [tx.accountId] }
            ))}
            showDate={!showDayHeaders}
            columns
            accountIcon={account ? <InstIcon institution={account.institution} isManual={account.isManual} size="sm" /> : undefined}
            selected={selectedIds.has(tx.id)}
            selecting={selecting}
            onToggleSelect={() => toggleSelected(tx.id)}
            onRenameMerchant={(name) => handleMerchantRename(tx, name)}
            merchantIsFilter={filters.merchant === (tx.merchantName || tx.name)}
            // Wider screens: the category is a filter pill, and its pencil
            // recategorizes. Phones show the plain label and edit in the drawer.
            categoryPill={selecting ? undefined : {
              label: display.label,
              icon: display.icon,
              // No pill for an uncategorized row (nothing to filter to) or for
              // the category already filtered to.
              onFilter: !tx.categoryId || (filters.categories.length === 1 && filters.categories[0] === tx.categoryId)
                ? undefined
                : () => setFilters((f) => ({ ...f, categories: [tx.categoryId as string], excludeCategories: [] })),
              editor: (
                <CategoryPicker
                  variant="pencil"
                  value={tx.categoryId ?? ''}
                  currentLabel={display.label}
                  onOpen={() => setCreateRulePrompt(null)}
                  onChange={(newCatId) => handleCategoryEdit(tx, newCatId)}
                  className={PENCIL_CLASS}
                />
              ),
            }}
            icon={display.icon ?? (isIncome ? <DollarSign size={15} /> : <Banknote size={15} />)}
            isIncome={isIncome}
            categoryNode={categoryNode}
            date={tx.date}
            amount={amount}
            // Filtered to one account, every row would repeat its name.
            accountName={filters.accountIds.length === 1 ? undefined : (tx.accountName ?? undefined)}
            excluded={tx.excludedAt != null}
          />
        </div>
        {createRulePrompt?.txId === tx.id && (
          <CreateRuleBar
            merchantText={createRulePrompt.merchantText}
            category={createRulePrompt.category}
            onCreate={() => {
              // The rule is the "Moved to" toast's follow-up, so that toast
              // goes rather than sit over the rule sheet on a phone.
              dismissMovedToastRef.current?.();
              setRulesPanel({ open: true, seed: { merchantText: createRulePrompt.merchantText, category: createRulePrompt.category } });
              setCreateRulePrompt(null);
            }}
            onDismiss={() => setCreateRulePrompt(null)}
          />
        )}
      </React.Fragment>
    );
  }

  const hasActiveFilters =
    filters.search !== '' ||
    filters.merchant !== '' ||
    filters.direction !== 'all' ||
    filters.categories.length > 0 ||
    filters.excludeCategories.length > 0 ||
    filters.accountIds.length > 0 ||
    filters.datePreset !== 'all' ||
    filters.amountMin !== '' ||
    filters.amountMax !== '';

  // Day headers only make sense on date-ordered lists.
  const showDayHeaders = sortKey === 'newest' || sortKey === 'oldest';

  const isEmpty = !loadingInitial && rows.length === 0;

  // Phones: the page's actions sit in the top bar, as a native nav bar holds
  // them. Search stays in the page. Phones have no hover to reveal the row
  // checkboxes, so Select is the way into selection there.
  useMobileHeader(isMobile ? {
    actions: (
      <>
        <span data-filters-trigger className="contents">
          <HeaderAction label="Filters" active={hasPanelFilters(filters)} expanded={filtersOpen} controls="txn-filters-panel" onClick={() => setFiltersOpen((o) => !o)}>
            <SlidersHorizontal size={18} />
          </HeaderAction>
        </span>
        {(rows.length > 0 || selecting) && (
          <HeaderTextAction
            label={selecting ? 'Done' : 'Select'}
            onClick={() => (selecting ? clearSelection() : setSelectMode(true))}
          />
        )}
      </>
    ),
  } : null);
  const showKpiLine = stuck && kpiHidden && !!summary && summary.count > 0;

  const skeletonRows = (
    <div>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i} className="flex items-center gap-3.5 border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
          <Skeleton className="h-9 w-9 rounded-ui-md" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-2 h-3 w-44" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );

  // Date-ordered list, chunked into consecutive-day sections when date-sorted.
  let lastDayKey: string | null = null;

  return (
    <div
      className="pt-4 md:pt-7 pb-6 sm:pb-28 text-content"
      // Day headings stick under the toolbar, and under the KPI line while it shows (h-9).
      style={{ '--txn-toolbar-h': `${stickyTop + toolbarH + (showKpiLine ? 36 : 0)}px` } as React.CSSProperties}
    >
      {/* The page's column. The sticky toolbar runs full width, so the page
           is three stacked parts, each centring its own content in it. */}
      <div className="mx-auto max-w-[1180px] px-3 sm:px-11">
      {/* ── Back — desktop only; mobile gets the shell's top-bar back ── */}
      <button
        type="button"
        onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation('/spending'); }}
        className="ui-focus -ml-2 mb-2 hidden min-h-touch items-center gap-1 rounded-ui-sm px-2 text-[13px] font-semibold text-content-muted transition-colors hover:text-content sm:mb-3 sm:ml-0 sm:inline-flex sm:min-h-0 sm:px-0"
      >
        <ChevronLeft size={16} /> Back
      </button>

      {/* ════════ Header ════════ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <PageTitle>Transactions</PageTitle>
        </div>
      </header>

      </div>

      {/* ════════ Toolbar — search, filters, sort, and the active-filter
           chips beneath. Sticky (below the phone's top bar), full width, and
           on wider screens the bulk-edit bar while rows are selected. Once
           stuck it becomes a surface with a rule and a shadow, so it reads as
           a layer above the list. ════════ */}
      <div ref={stuckSentinelRef} aria-hidden className="h-px" />
      <div
        ref={stickyRef}
        className={cn(
          'sticky top-[calc(env(safe-area-inset-top)+48px)] z-20 py-2 transition-shadow sm:top-0 sm:py-3 md:mt-2',
          stuck && 'bg-canvas',
          stuck && !showKpiLine && 'border-b border-line shadow-ui-sm',
        )}
      >
        {/* Overlaid below the toolbar, not in the flow, so the list doesn't
             jump by its height the moment the toolbar sticks. */}
        {showKpiLine && summary && (
          <div className="absolute inset-x-0 top-full border-b border-line bg-canvas shadow-ui-sm">
            <div className="mx-auto max-w-[1180px] px-3 sm:px-11">
              <KpiLine summary={summary} direction={filters.direction} />
            </div>
          </div>
        )}
        <div className="mx-auto max-w-[1180px] px-3 sm:px-11">
        {selecting && (
          <div className="hidden sm:block">
            <BulkEditBar variant="toolbar" {...bulkProps} />
          </div>
        )}
        <div className={cn(selecting && 'sm:hidden')}>
        <TransactionFilters
          filters={filters}
          onChange={setFilters}
          accounts={accounts}
          filtersOpen={filtersOpen}
          onFiltersOpenChange={setFiltersOpen}
          trailing={
            // Desktop sort, inline with search and filters. Mobile sorts via
            // the list header instead. Selecting on desktop starts from a row's
            // hover checkbox.
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <OptionMenu
                ariaLabel="Sort"
                // Labelled, so it's clear why this one control sits apart
                // from the filters on the left.
                prefix="Sorted by"
                toolbar={{ count: 0 }}
                value={sortKey}
                options={(Object.keys(SORT_LABELS) as SortKey[]).map((k) => ({ value: k, label: SORT_LABELS[k] }))}
                onChange={setSortKey}
                panelClassName="left-auto right-0"
              />
            </div>
          }
        />
        </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-3 sm:px-11">
      {/* ════════ Filter-scoped KPI strip — money in/out, net, and count over
           the whole match (not just the loaded page). ════════ */}
      {summary && summary.count > 0 && <div ref={kpiStripRef}><KpiStrip summary={summary} direction={filters.direction} onOpenTx={setDetailTx} /></div>}

      {/* ════════ Error strip (stale rows stay visible below) ════════ */}
      {error && (
        <Alert tone="negative" className="mt-4">
          {error}
        </Alert>
      )}

      {/* ════════ List card ════════ */}
      <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm">
        {/* Mobile sort header — a tappable row on the list itself; the invisible
             native select on top opens the OS picker (field + order in one). */}
        {rows.length > 0 && (
          <div className="flex items-stretch border-b border-line sm:hidden">
          {/* The same sort menu as Spending's on a phone. */}
          <div className="flex flex-1 items-center px-3 py-2">
            <OptionMenu
              ariaLabel="Sort transactions"
              prefix="Sorted by"
              toolbar={{ count: 0 }}
              value={sortKey}
              options={(Object.keys(SORT_LABELS) as SortKey[]).map((k) => ({ value: k, label: SORT_LABELS[k] }))}
              onChange={setSortKey}
            />
          </div>
          </div>
        )}
        {/* Skeleton only before the FIRST rows arrive; later refetches
             (sort/filter changes) keep the stale content mounted, dimmed, so
             the list doesn't flash to skeletons. */}
        {loadingInitial && rows.length === 0 ? (
          skeletonRows
        ) : isEmpty ? (
          <div className="p-3">
            {hasActiveFilters ? (
              <EmptyState
                icon={<Search size={22} />}
                title="No transactions match"
                description="Adjust or clear your filters to see more."
                action={<Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={<Receipt size={22} />}
                title="No transactions yet"
                description="Connect a bank or card account to see all your transactions here."
                action={
                  <Link href="/accounts">
                    <Button variant="primary">Connect an account</Button>
                  </Link>
                }
              />
            )}
          </div>
        ) : (
          <div className={cn('transition-opacity duration-200', loadingInitial && 'opacity-50')}>
            {rows.map((tx) => {
              const dayKey = storedDayKey(tx.date);
              const needsHeader = showDayHeaders && dayKey !== lastDayKey;
              lastDayKey = dayKey;
              return (
                <React.Fragment key={tx.id}>
                  {needsHeader && (
                    <div className="sticky top-[var(--txn-toolbar-h)] z-[2] bg-canvas px-4 py-1.5 text-[13px] font-semibold text-content-muted first:rounded-t-ui-xl">
                      {dayLabel(tx.date)}
                    </div>
                  )}
                  {renderTxRow(tx)}
                </React.Fragment>
              );
            })}
            {loadingMore && (
              <div className="flex items-center gap-3.5 border-t border-line px-4 py-3 sm:px-5">
                <Skeleton className="h-9 w-9 rounded-ui-md" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="mt-2 h-3 w-44" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Infinite-scroll sentinel */}
      <div ref={sentinelRef} className="h-1" aria-hidden />

      {selecting && (
        <div className="sm:hidden">
          {/* Room under the last row so the floating bar never covers it. */}
          <div className="h-36" aria-hidden />
          <BulkEditBar variant="floating" {...bulkProps} />
        </div>
      )}

      <RulesPanel
        open={rulesPanel.open}
        seed={rulesPanel.seed}
        onClose={() => setRulesPanel({ open: false, seed: null })}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />

      <TransactionDetail
        open={detailTx !== null}
        tx={detailTx}
        onClose={() => setDetailTx(null)}
        onSaved={(patch) => {
          if (!detailTx) return;
          patchTx(detailTx.id, {
            ...(patch.merchantName !== undefined ? { merchantName: patch.merchantName } : {}),
            ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes.trim() === '' ? null : patch.notes } : {}),
            ...(patch.excluded !== undefined ? { excludedAt: patch.excluded ? new Date().toISOString() : null } : {}),
          });
        }}
      />
      </div>
    </div>
  );
}
