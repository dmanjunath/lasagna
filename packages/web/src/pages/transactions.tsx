import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { Banknote, ChevronDown, DollarSign, Layers, Receipt, Search, Store } from 'lucide-react';
import { api, type TxnQueryRow, type TxnQuerySummary } from '../lib/api';
import { cn } from '../lib/utils';
import { usePageContext } from '../lib/page-context';
import { Alert, Button, EmptyState, SegmentedControl, Skeleton } from '../components/uikit';
import { getCategoryDisplay } from '../lib/categories';
import { taxonomyIcon, useCategoryDisplay, useTaxonomy } from '../lib/taxonomy';
import {
  TxnRow,
  CategoryEditorSelect,
  CreateRuleBar,
} from '../components/transactions/TransactionList';
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

type Mode = 'date' | 'category' | 'group' | 'merchant';
type SortKey = 'newest' | 'oldest' | 'largest' | 'smallest';

const SORTS: Record<SortKey, { field: 'date' | 'amount'; dir: 'asc' | 'desc' }> = {
  newest: { field: 'date', dir: 'desc' },
  oldest: { field: 'date', dir: 'asc' },
  largest: { field: 'amount', dir: 'desc' },
  smallest: { field: 'amount', dir: 'asc' },
};

const PAGE_SIZE = 50;
const GROUP_PAGE_SIZE = 20;

interface Group { key: string; label: string; count: number; total: number }
interface GroupCache { rows: TxnQueryRow[]; nextCursor: string | null; loading: boolean }

// ---------------------------------------------------------------------------
// Transactions page — browse everything: search, filters, Date/Category/
// Merchant grouping, infinite scroll, inline category editing.
// ---------------------------------------------------------------------------

export function Transactions() {
  const { setPageContext } = usePageContext();
  const { groups: taxonomyGroups, loading: taxonomyLoading, byId, bySystemKey } = useTaxonomy();
  const displayOf = useCategoryDisplay();

  const [filters, setFilters] = useState<TxnFilters>(EMPTY_FILTERS);
  const [mode, setMode] = useState<Mode>('date');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  // Date-mode accumulation
  const [rows, setRows] = useState<TxnQueryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Grouped modes
  const [groups, setGroups] = useState<Group[]>([]);
  const [expanded, setExpanded] = useState<Map<string, GroupCache>>(new Map());
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  const [summary, setSummary] = useState<TxnQuerySummary | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline edit + rules
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [createRulePrompt, setCreateRulePrompt] = useState<{ txId: string; merchantText: string; category: string } | null>(null);
  const [rulesPanel, setRulesPanel] = useState<{ open: boolean; seed: { merchantText: string; category: string } | null }>({ open: false, seed: null });
  const [detailTx, setDetailTx] = useState<TxnQueryRow | null>(null);

  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Latest-wins: every filters/sort/mode change bumps the seq; responses tagged
  // with an older seq are dropped so a slow page-1 can't clobber newer state.
  const requestSeqRef = useRef(0);
  // Prevents two simultaneous loadMore fetches when the IntersectionObserver
  // fires twice before the first response resolves.
  const inFlightRef = useRef(false);

  useEffect(() => {
    setPageContext({
      pageId: 'transactions',
      pageTitle: 'Transactions',
      description: 'All transactions across accounts with search, filters, and grouping.',
    });
  }, [setPageContext]);

  // Accounts — for the account filter and the id→name fallback.
  useEffect(() => {
    api.getBalances()
      .then((data) => setAccounts(data.balances.map((b) => ({ id: b.accountId, name: b.name }))))
      .catch(() => {});
  }, []);

  // One fetch pipeline: page 1 of the current mode. Resets accumulation.
  useEffect(() => {
    const seq = ++requestSeqRef.current;
    setLoadingInitial(true);
    setError(null);
    setEditingTxId(null);
    setCreateRulePrompt(null);
    setExpanded(new Map());
    setOpenKeys(new Set());
    const qf = filtersToQuery(filters);

    if (mode === 'date') {
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
    } else {
      api.queryTransactions({ filters: qf, groupBy: mode })
        .then((res) => {
          if (seq !== requestSeqRef.current || res.mode !== 'groups') return;
          setGroups(res.groups);
          setSummary(res.summary);
        })
        .catch((err: Error) => {
          if (seq !== requestSeqRef.current) return;
          setError(err.message || 'Failed to load transactions');
        })
        .finally(() => {
          if (seq === requestSeqRef.current) setLoadingInitial(false);
        });
    }
  }, [filters, sortKey, mode, refreshKey]);

  // Infinite scroll (date mode). Kept in a ref so the observer always calls
  // the latest closure.
  const loadMoreRef = useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    if (mode !== 'date' || !nextCursor || loadingMore || loadingInitial || inFlightRef.current) return;
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
  }, [mode, loadingInitial, nextCursor]);

  // Patch a transaction's fields wherever it's rendered (date list + any
  // expanded group caches — ids are unique so patching both is safe).
  function patchTx(txId: string, patch: Partial<Pick<TxnQueryRow, 'merchantName' | 'categoryId' | 'notes' | 'excludedAt'>>) {
    setRows((prev) => prev.map((t) => (t.id === txId ? { ...t, ...patch } : t)));
    setExpanded((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [key, entry] of next) {
        if (entry.rows.some((r) => r.id === txId)) {
          next.set(key, { ...entry, rows: entry.rows.map((r) => (r.id === txId ? { ...r, ...patch } : r)) });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  // Refetch just the summary line (category edits shift spent/received splits).
  function refetchSummary() {
    const seq = requestSeqRef.current;
    api.queryTransactions({ filters: filtersToQuery(filters), limit: 1 })
      .then((res) => {
        if (seq === requestSeqRef.current) setSummary(res.summary);
      })
      .catch(() => {});
  }

  // Page-local optimistic category edit (same shape as TransactionList's
  // categoryEditorFor): capture prev → optimistic → PATCH → prompt + summary
  // refetch on success, revert on failure. `newCatId` is a category id (uuid).
  async function handleCategoryEdit(tx: TxnQueryRow, newCatId: string) {
    if (newCatId === tx.categoryId) {
      setEditingTxId(null);
      return;
    }
    const prevCatId = tx.categoryId;
    const merchantText = tx.merchantName || tx.name;
    patchTx(tx.id, { categoryId: newCatId });
    setEditingTxId(null);
    try {
      await api.updateTransactionCategory(tx.id, newCatId);
      setCreateRulePrompt({ txId: tx.id, merchantText, category: newCatId });
      refetchSummary();
    } catch (err) {
      console.error(err);
      patchTx(tx.id, { categoryId: prevCatId });
    }
  }

  // Grouped-mode expansion: fetch (or append to) one group's transaction list.
  function loadGroupRows(key: string, cursor: string | null) {
    // Category/group keys are systemKeys for system rows; the API accepts only
    // category ids, so the taxonomy must be loaded to resolve them.
    if ((mode === 'group' || mode === 'category') && taxonomyGroups.length === 0) {
      setError(
        taxonomyLoading
          ? 'Categories are still loading — try again.'
          : 'Categories failed to load — try again.',
      );
      return;
    }
    const seq = requestSeqRef.current;
    setExpanded((prev) => {
      const next = new Map(prev);
      const entry = next.get(key) ?? { rows: [], nextCursor: null, loading: false };
      next.set(key, { ...entry, loading: true });
      return next;
    });
    // Group mode has no server-side group filter: expand a group by sending its
    // child category ids (all children, incl. disabled — history lives there).
    const groupChildIds = (groupKey: string): string[] => {
      const group = taxonomyGroups.find((g) => (g.systemKey ?? g.id) === groupKey);
      const ids = group?.categories.map((c) => c.id) ?? [];
      return ids.length > 0 ? ids : [groupKey];
    };
    // Category keys are systemKey ?? id (decision 4); the API filters on ids only.
    const categoryIdForKey = (catKey: string): string =>
      (bySystemKey.get(catKey) ?? byId.get(catKey))?.id ?? catKey;
    const merged = {
      ...filtersToQuery(filters),
      ...(mode === 'category'
        ? { categories: [categoryIdForKey(key)] }
        : mode === 'group'
          ? { categories: groupChildIds(key) }
          : { merchant: key }),
    };
    api.queryTransactions({ filters: merged, limit: GROUP_PAGE_SIZE, ...(cursor ? { cursor } : {}) })
      .then((res) => {
        if (seq !== requestSeqRef.current || res.mode !== 'list') return;
        setExpanded((prev) => {
          const next = new Map(prev);
          const entry = next.get(key) ?? { rows: [], nextCursor: null, loading: false };
          next.set(key, {
            rows: cursor ? [...entry.rows, ...res.transactions] : res.transactions,
            nextCursor: res.nextCursor,
            loading: false,
          });
          return next;
        });
      })
      .catch(() => {
        if (seq !== requestSeqRef.current) return;
        setExpanded((prev) => {
          const next = new Map(prev);
          const entry = next.get(key);
          // Remove the loading entry; preserve any previously-cached rows.
          if (entry) next.set(key, { ...entry, loading: false });
          else next.delete(key);
          return next;
        });
        setError("Couldn't load transactions for this group — try again.");
      });
  }

  function toggleGroup(key: string) {
    const isOpen = openKeys.has(key);
    const next = new Set(openKeys);
    if (isOpen) next.delete(key);
    else next.add(key);
    setOpenKeys(next);
    if (!isOpen && !expanded.has(key)) loadGroupRows(key, null);
  }

  // One transaction row (+ create-rule bar) — shared by the date list and
  // expanded groups so inline editing behaves identically everywhere.
  function renderTxRow(tx: TxnQueryRow) {
    const amount = parseFloat(tx.amount);
    const isIncome = amount < 0;
    const display = displayOf(tx);
    const categoryNode = editingTxId === tx.id ? (
      <CategoryEditorSelect
        value={tx.categoryId ?? ''}
        currentLabel={display.label}
        onBlur={() => setEditingTxId(null)}
        onChange={(newCatId) => handleCategoryEdit(tx, newCatId)}
      />
    ) : (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditingTxId(tx.id); setCreateRulePrompt(null); }}
        title="Click to recategorize"
        className="touch-target-inline rounded-ui-xs text-content-muted transition-colors hover:text-content hover:underline"
      >
        {display.label}
      </button>
    );
    return (
      <React.Fragment key={tx.id}>
        {/* Clickable wrapper (row only — the CreateRuleBar sibling stays
             outside). TxnRow is always the wrapper's first child so its own
             border-t is suppressed; the wrapper carries it instead. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setDetailTx(tx)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setDetailTx(tx);
            }
          }}
          className="ui-focus cursor-pointer border-t border-line transition-colors first:border-t-0 last:rounded-b-ui-xl hover:bg-canvas-sunken/60"
        >
          <TxnRow
            merchant={tx.merchantName || tx.name}
            icon={isIncome ? <DollarSign size={15} /> : (display.icon ?? <Banknote size={15} />)}
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

  const isEmpty = !loadingInitial && (mode === 'date' ? rows.length === 0 : groups.length === 0);

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

  // Date-mode list, chunked into consecutive-day sections when date-sorted.
  let lastDayKey: string | null = null;

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-12 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            Transactions
          </h1>
          {summary ? (
            <p className="ui-tnum mt-1.5 text-[14px] font-medium text-content-muted">
              {summary.count} transaction{summary.count === 1 ? '' : 's'} · {formatCurrencyExact(summary.totalSpent)} spent · {formatCurrencyExact(summary.totalIncome)} received
            </p>
          ) : (
            <Skeleton className="mt-2.5 h-4 w-72" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedControl
            aria-label="Group by"
            value={mode}
            onChange={(m: Mode) => setMode(m)}
            stretch={false}
            options={[
              { value: 'date', label: 'Date' },
              { value: 'category', label: 'Category' },
              { value: 'group', label: 'Group' },
              { value: 'merchant', label: 'Merchant' },
            ]}
          />
          {mode === 'date' && (
            <div className="relative">
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                aria-label="Sort"
                className="ui-focus touch-target h-10 appearance-none rounded-ui-md border border-line bg-panel pl-3 pr-9 text-[13px] font-medium text-content shadow-ui-sm"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="largest">Largest</option>
                <option value="smallest">Smallest</option>
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" />
            </div>
          )}
        </div>
      </header>

      {/* ════════ Filters ════════ */}
      <div className="mt-5">
        <TransactionFilters filters={filters} onChange={setFilters} accounts={accounts} />
      </div>

      {/* ════════ Error strip (stale rows stay visible below) ════════ */}
      {error && (
        <Alert tone="negative" className="mt-4" title="Something went wrong">
          {error}
        </Alert>
      )}

      {/* ════════ List card ════════ */}
      <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm">
        {loadingInitial ? (
          skeletonRows
        ) : isEmpty ? (
          <div className="p-3">
            {hasActiveFilters ? (
              <EmptyState
                icon={<Search size={22} />}
                title="No transactions match"
                description="Adjust or clear your filters to see more."
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
        ) : mode === 'date' ? (
          <div>
            {rows.map((tx) => {
              const d = new Date(tx.date);
              const dayKey = Number.isNaN(d.getTime()) ? tx.date : d.toDateString();
              const needsHeader = showDayHeaders && dayKey !== lastDayKey;
              lastDayKey = dayKey;
              return (
                <React.Fragment key={tx.id}>
                  {needsHeader && (
                    <div className="sticky top-0 z-[1] bg-canvas px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted first:rounded-t-ui-xl">
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
        ) : (
          <div>
            {groups.map((g) => {
              const isOpen = openKeys.has(g.key);
              const entry = expanded.get(g.key);
              const isRefund = g.total < 0;
              // Category mode: resolve the tenant category (key = systemKey ?? id)
              // for glyph/emoji; label falls back to the server-provided name.
              const catEntry = mode === 'category' ? (bySystemKey.get(g.key) ?? byId.get(g.key)) : undefined;
              const icon = mode === 'category'
                ? (catEntry ? taxonomyIcon(catEntry) : getCategoryDisplay(g.key).icon)
                : mode === 'group'
                  ? <Layers size={15} />
                  : <Store size={15} />;
              const label = mode === 'category' ? (catEntry?.name ?? g.label) : g.label;
              return (
                <React.Fragment key={g.key}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.key)}
                    aria-expanded={isOpen}
                    className="ui-focus flex w-full items-center gap-3.5 border-t border-line px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-canvas-sunken/50 sm:px-5"
                  >
                    <span className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-ui-md',
                      isRefund ? 'bg-positive-soft text-positive' : 'bg-canvas-sunken text-content-secondary',
                    )}>
                      {icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-bold leading-tight" title={label}>{label}</div>
                      <div className="ui-tnum mt-0.5 text-[12.5px] text-content-muted">
                        {g.count} transaction{g.count === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span className={cn('shrink-0 font-editorial text-[14.5px] font-extrabold tracking-[-0.01em] ui-tnum', isRefund && 'text-positive')}>
                      {isRefund ? '+' : ''}{formatCurrencyExact(Math.abs(g.total))}
                    </span>
                    <ChevronDown
                      size={16}
                      className={cn('shrink-0 text-content-muted transition-transform', isOpen && 'rotate-180')}
                      aria-hidden
                    />
                  </button>
                  {isOpen && (
                    <div className="bg-canvas-sunken/40 pl-4 sm:pl-6">
                      {entry && entry.rows.length > 0 && entry.rows.map((tx) => renderTxRow(tx))}
                      {entry?.loading && (
                        <div className="flex items-center gap-3.5 border-t border-line px-4 py-3 sm:px-5">
                          <Skeleton className="h-9 w-9 rounded-ui-md" />
                          <div className="flex-1">
                            <Skeleton className="h-3.5 w-32" />
                            <Skeleton className="mt-2 h-3 w-44" />
                          </div>
                          <Skeleton className="h-4 w-20" />
                        </div>
                      )}
                      {entry && !entry.loading && entry.nextCursor && (
                        <button
                          type="button"
                          onClick={() => loadGroupRows(g.key, entry.nextCursor)}
                          className="ui-focus w-full border-t border-line px-4 py-2.5 text-left text-[12.5px] font-semibold text-content-muted transition-colors hover:text-content sm:px-5"
                        >
                          Load more
                        </button>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Infinite-scroll sentinel */}
      {mode === 'date' && <div ref={sentinelRef} className="h-1" aria-hidden />}

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
          if (patch.categoryId !== undefined || patch.excluded !== undefined) refetchSummary();
          if (patch.merchantName !== undefined && mode === 'merchant') setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
