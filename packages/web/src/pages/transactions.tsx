import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { Banknote, ChevronDown, ChevronLeft, ChevronRight, DollarSign, Receipt, Search } from 'lucide-react';
import { api, type TxnQueryRow, type TxnQuerySummary } from '../lib/api';
import { useAccountsIndex } from '../lib/use-accounts-index';
import { cn } from '../lib/utils';
import { usePageContext } from '../lib/page-context';
import { Alert, Button, EmptyState, Skeleton, useToast } from '../components/uikit';
import { useCategoryDisplay } from '../lib/taxonomy';
import {
  TxnRow,
  CreateRuleBar,
} from '../components/transactions/TransactionList';
import { CategoryPicker } from '../components/common/CategoryPicker';
import { TransactionDetail } from '../components/transactions/TransactionDetail';
import {
  TransactionFilters,
  EMPTY_FILTERS,
  filtersToQuery,
  type TxnFilters,
} from '../components/transactions/TransactionFilters';
import { RulesPanel } from '../components/rules/RulesPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrencyExact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// "Aug 11, 2026" for a single day, else "Jan 3 to Aug 11, 2026" — the year
// shows once when the span stays inside one calendar year.
function dateRangeLabel(earliest: string | null, latest: string | null): string {
  if (!earliest || !latest) return '';
  const da = new Date(earliest);
  const db = new Date(latest);
  const a = shortDate(earliest);
  const b = shortDate(latest);
  if (a === b) return a;
  if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime()) && da.getFullYear() === db.getFullYear()) {
    const aNoYear = da.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${aNoYear} to ${b}`;
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
  sub?: string;
  tone?: 'pos' | 'neg';
}) {
  return (
    <div className="px-4 py-3 sm:px-5 sm:py-3.5">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-content-muted">{label}</div>
      <div className={cn(
        'mt-1.5 font-editorial text-[19px] sm:text-[22px] font-extrabold leading-none tracking-[-0.02em] ui-tnum',
        tone === 'pos' && 'text-[rgb(var(--ui-brand-ink))]',
        tone === 'neg' && 'text-negative',
      )}>{value}</div>
      {sub && <div className="mt-1.5 truncate text-[11.5px] font-semibold text-content-muted">{sub}</div>}
    </div>
  );
}

// Guarded money formatter — an older API (or a web/API deploy skew) can send a
// summary without the money fields; render a dash rather than "NaN".
function money(n: number): string {
  return Number.isFinite(n) ? formatCurrencyExact(n) : '—';
}

function KpiStrip({ summary }: { summary: TxnQuerySummary }) {
  const { totalCredits: credits, totalDebits: debits } = summary;
  const netKnown = Number.isFinite(credits) && Number.isFinite(debits);
  const net = credits - debits;
  const range = dateRangeLabel(summary.earliest, summary.latest);
  return (
    <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm sm:grid-cols-4 sm:divide-y-0">
      <KpiCell
        label="Transactions"
        value={Number.isFinite(summary.count) ? formatCompactCount(summary.count) : '—'}
        sub={range || undefined}
      />
      <KpiCell label="Money in" value={money(credits)} tone="pos" />
      <KpiCell label="Money out" value={money(debits)} />
      <KpiCell
        label="Net"
        value={netKnown ? `${net < 0 ? '−' : ''}${formatCurrencyExact(Math.abs(net))}` : '—'}
        tone={netKnown ? (net < 0 ? 'neg' : net > 0 ? 'pos' : undefined) : undefined}
      />
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

  // Hydrate the category filter from the URL so a drill from the Spending
  // breakdown (`/transactions?categories=<id>,<id>`) lands pre-filtered.
  const [filters, setFilters] = useState<TxnFilters>(() => {
    const cats = new URLSearchParams(window.location.search).get('categories');
    return cats
      ? { ...EMPTY_FILTERS, categories: cats.split(',').filter(Boolean) }
      : EMPTY_FILTERS;
  });
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

  // One fetch pipeline: page 1 for the current filters/sort. Resets accumulation
  // and refreshes the filter-scoped summary.
  useEffect(() => {
    const seq = ++requestSeqRef.current;
    setLoadingInitial(true);
    setError(null);
    setCreateRulePrompt(null);
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
      toast({
        tone: 'positive',
        title: `Moved to ${displayOf({ categoryId: newCatId }).label}`,
        duration: 6000,
        description: prevCatId ? (
          <button
            type="button"
            onClick={undo}
            className="ui-focus mt-0.5 rounded-ui-sm font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
          >
            Undo
          </button>
        ) : undefined,
      });
    } catch (err) {
      console.error(err);
      patchTx(tx.id, { categoryId: prevCatId });
      setError("Couldn't update the category, so the change was undone. Try again.");
    }
  }

  // One transaction row (+ create-rule bar) — shared everywhere so inline
  // editing behaves identically.
  function renderTxRow(tx: TxnQueryRow) {
    const amount = parseFloat(tx.amount);
    const isIncome = amount < 0;
    const display = displayOf(tx);
    const categoryNode = (
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
        <div
          onClick={() => setDetailTx(tx)}
          className="cursor-pointer border-t border-line transition-colors first:border-t-0 last:rounded-b-ui-xl hover:bg-canvas-sunken/60"
        >
          <TxnRow
            merchant={tx.merchantName || tx.name}
            onOpenDetail={() => setDetailTx(tx)}
            icon={display.icon ?? (isIncome ? <DollarSign size={15} /> : <Banknote size={15} />)}
            isIncome={isIncome}
            categoryNode={categoryNode}
            date={tx.date}
            amount={amount}
            accountName={tx.accountName ?? undefined}
            excluded={tx.excludedAt != null}
          />
        </div>
        {createRulePrompt?.txId === tx.id && (
          <CreateRuleBar
            merchantText={createRulePrompt.merchantText}
            category={createRulePrompt.category}
            onCreate={() => {
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
    filters.categories.length > 0 ||
    filters.accountIds.length > 0 ||
    filters.datePreset !== 'all' ||
    filters.amountMin !== '' ||
    filters.amountMax !== '';

  // Day headers only make sense on date-ordered lists.
  const showDayHeaders = sortKey === 'newest' || sortKey === 'oldest';

  const isEmpty = !loadingInitial && rows.length === 0;

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
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
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
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            Transactions
          </h1>
        </div>
      </header>

      {/* ════════ Toolbar — search + Filters popover; the desktop sort select
           trails the row. Active-filter chips render beneath. ════════ */}
      <div className="mt-5">
        <TransactionFilters
          filters={filters}
          onChange={setFilters}
          accounts={accounts}
          trailing={
            // Desktop sort — inline with search + Filters. Mobile sorts via the
            // tappable list header instead.
            <div className="relative hidden shrink-0 sm:block">
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                aria-label="Sort"
                className="ui-focus touch-target h-11 min-h-touch appearance-none rounded-ui-md border border-line-strong bg-panel pl-3 pr-9 text-[13px] font-medium text-content shadow-ui-sm"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="largest">Largest</option>
                <option value="smallest">Smallest</option>
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" />
            </div>
          }
        />
      </div>

      {/* ════════ Filter-scoped KPI strip — money in/out, net, and count over
           the whole match (not just the loaded page). ════════ */}
      {summary && summary.count > 0 && <KpiStrip summary={summary} />}

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
          <div className="relative flex items-center justify-between border-b border-line px-4 py-2.5 sm:hidden">
            <span className="text-[13px] font-semibold text-content-muted">
              Sorted by
            </span>
            <span className="flex items-center gap-1 text-[13px] font-semibold text-content">
              {SORT_LABELS[sortKey]}
              <ChevronRight size={14} className="rotate-90 text-content-muted" />
            </span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort transactions"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="largest">Largest amount</option>
              <option value="smallest">Smallest amount</option>
            </select>
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
              const d = new Date(tx.date);
              const dayKey = Number.isNaN(d.getTime()) ? tx.date : d.toDateString();
              const needsHeader = showDayHeaders && dayKey !== lastDayKey;
              lastDayKey = dayKey;
              return (
                <React.Fragment key={tx.id}>
                  {needsHeader && (
                    <div className="sticky top-0 z-[1] bg-canvas px-4 py-1.5 text-[13px] font-semibold text-content-muted first:rounded-t-ui-xl">
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
  );
}
