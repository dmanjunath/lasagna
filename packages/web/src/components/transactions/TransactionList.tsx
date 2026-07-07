import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Search, X, DollarSign, Banknote } from 'lucide-react';
import { Link } from 'wouter';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Badge, EmptyState, Skeleton } from '../uikit';
import { categoryOptionLabel, useCategoryDisplay, usePickerGroups, useTaxonomy } from '../../lib/taxonomy';
import { TransactionDetail } from './TransactionDetail';

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

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Transaction {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
  categoryId: string;
  accountId: string;
  accountName: string | null;
  pending: number;
  notes: string | null;
  excludedAt: string | null;
}

// ---------------------------------------------------------------------------
// CategoryEditorSelect — exported so the /transactions page can reuse the
// select UI. The optimistic-update/revert logic stays in the caller.
// ---------------------------------------------------------------------------

export function CategoryEditorSelect({
  value,
  onChange,
  onBlur,
  currentLabel,
}: {
  /** Category id (uuid) of the row's current category, '' when unknown. */
  value: string;
  onChange: (categoryId: string) => void;
  onBlur: () => void;
  /** Display label for a current value the picker can't offer (disabled/legacy). */
  currentLabel?: string;
}) {
  const pickerGroups = usePickerGroups();
  const { byId } = useTaxonomy();
  const current = value ? byId.get(value) : undefined;
  const selectable = !!current && !current.disabled;
  return (
    <select
      autoFocus
      value={value}
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-ui-sm border border-line-strong bg-panel px-1.5 text-[12px] font-medium text-content"
      onClick={(e) => e.stopPropagation()}
    >
      {!selectable && (
        <option value={value} disabled>{currentLabel ?? current?.name ?? 'Uncategorized'}</option>
      )}
      {pickerGroups.map(({ group, categories }) => (
        <optgroup key={group.id} label={group.name}>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{categoryOptionLabel(cat)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// CreateRuleBar — exported so the /transactions page can reuse the prompt UI.
// ---------------------------------------------------------------------------

export function CreateRuleBar({
  merchantText,
  category,
  onCreate,
  onDismiss,
}: {
  merchantText: string;
  /** Category id (uuid) the rule would set. */
  category: string;
  onCreate: () => void;
  onDismiss: () => void;
}) {
  const displayOf = useCategoryDisplay();
  return (
    <div className="flex items-center gap-3 bg-[rgb(var(--ui-brand-softer))] px-4 py-2.5 text-[12.5px] sm:px-5">
      <span className="flex-1 text-content-muted">
        Always categorize &ldquo;{merchantText}&rdquo; as{' '}
        <b className="font-semibold text-content">{displayOf({ categoryId: category }).label}</b>?
      </span>
      <button
        type="button"
        onClick={onCreate}
        className="shrink-0 font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
      >
        Create rule
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid shrink-0 place-items-center text-content-muted hover:text-content"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction row — category medallion · merchant · category·date · amount.
// Income (amount < 0) renders positive teal with a leading '+'. The category
// label stays a click target so it can open the inline recategorize editor.
// ---------------------------------------------------------------------------

export function TxnRow({
  merchant, icon, isIncome, categoryNode, date, amount, accountName, excluded,
}: {
  merchant: string;
  icon: React.ReactNode;
  isIncome: boolean;
  categoryNode: React.ReactNode;
  date: string;
  amount: number;
  accountName?: string;
  excluded?: boolean;
}) {
  return (
    <div className="flex items-center gap-3.5 border-t border-line px-4 py-3 first:border-t-0 last:rounded-b-ui-xl sm:px-5">
      <span className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-ui-md',
        isIncome ? 'bg-positive-soft text-positive' : 'bg-canvas-sunken text-content-secondary',
      )}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold leading-tight" title={merchant}>{merchant}</div>
        <div className={cn('mt-0.5 flex items-center text-[12.5px] text-content-muted', excluded && 'opacity-50')}>
          {categoryNode}
          {excluded && <Badge tone="neutral" className="ml-1.5 shrink-0">Excluded</Badge>}
          <span className="mx-1 text-content-faint">·</span>
          <span className="ui-tnum whitespace-nowrap">{shortDate(date)}</span>
          {accountName && (
            <>
              <span className="mx-1 text-content-faint">·</span>
              <span className="truncate">{accountName}</span>
            </>
          )}
        </div>
      </div>
      <span className={cn('shrink-0 font-editorial text-[14.5px] font-extrabold tracking-[-0.01em] ui-tnum', isIncome && 'text-positive', excluded && 'opacity-50')}>
        {isIncome ? '+' : ''}{formatCurrencyExact(Math.abs(amount))}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TransactionList — self-contained fetching component for the Recent
// transactions experience. Supports controlled (parent-driven) or uncontrolled
// category filter, optional "create rule" affordance, and external refresh.
// ---------------------------------------------------------------------------

export function TransactionList({
  accountId,
  startDate, endDate,
  category,
  onClearCategory,
  refreshKey = 0,
  onDataChanged,
  onCreateRule,
  title = 'Recent transactions',
  showCategoryFilter = true,
  onCategoryChange,
  viewAllHref,
}: {
  accountId?: string;
  startDate?: string;
  endDate?: string;
  category?: string | null;
  onClearCategory?: () => void;
  refreshKey?: number;
  onDataChanged?: () => void;
  onCreateRule?: (seed: { merchantText: string; category: string }) => void;
  title?: string;
  showCategoryFilter?: boolean;
  onCategoryChange?: (cat: string | null) => void;
  viewAllHref?: string;
}) {
  // When `category` prop is provided (even as null) the component is controlled.
  const isControlled = category !== undefined;

  const pickerGroups = usePickerGroups();
  const displayOf = useCategoryDisplay();

  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [internalCategory, setInternalCategory] = useState<string | null>(null);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [createRulePrompt, setCreateRulePrompt] = useState<{ txId: string; merchantText: string; category: string } | null>(null);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);

  const effectiveCategory = isControlled ? category : internalCategory;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset page to 1 when any filter changes externally or via debounced search.
  useEffect(() => {
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, accountId, effectiveCategory, debouncedSearch]);

  // Clear create-rule prompt on page change.
  useEffect(() => {
    setCreateRulePrompt(null);
  }, [page]);

  // Fetch transactions
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getTransactions({
      page,
      limit: PAGE_SIZE,
      category: effectiveCategory || undefined,
      startDate,
      endDate,
      accountId,
      search: debouncedSearch || undefined,
    })
      .then((data) => {
        if (!active) return;
        setTransactions(data.transactions);
        setTotal(data.total);
      })
      .catch(() => {
        if (!active) return;
        setTransactions([]);
        setTotal(0);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, effectiveCategory, startDate, endDate, accountId, debouncedSearch, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function categoryEditorFor(tx: Transaction) {
    return (
      <CategoryEditorSelect
        value={tx.categoryId ?? ''}
        currentLabel={displayOf(tx).label}
        onBlur={() => setEditingTxId(null)}
        onChange={async (newCatId) => {
          const prevCatId = tx.categoryId;
          const merchantText = tx.merchantName || tx.name;
          setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, categoryId: newCatId } : t));
          setEditingTxId(null);
          try {
            await api.updateTransactionCategory(tx.id, newCatId);
            if (onCreateRule) {
              setCreateRulePrompt({ txId: tx.id, merchantText, category: newCatId });
            }
            onDataChanged?.();
          } catch (err) {
            console.error(err);
            setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, categoryId: prevCatId } : t));
          }
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-3 px-1 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.018em]">{title}</h2>
          {total > 0 && (
            <span className="text-[12.5px] font-semibold text-content-muted ui-tnum">{total} total</span>
          )}
          {viewAllHref && (
            <Link href={viewAllHref} className="ui-focus touch-target-inline rounded-ui-sm text-[13px] font-bold text-content-muted hover:text-brand transition-colors">View all →</Link>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {showCategoryFilter && (
            <div className="relative">
              <select
                value={effectiveCategory || ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  if (isControlled) {
                    onCategoryChange?.(val);
                  } else {
                    setInternalCategory(val);
                  }
                  setPage(1);
                }}
                className="ui-focus touch-target h-10 w-full appearance-none rounded-ui-md border border-line bg-panel pl-3 pr-9 text-[13px] font-medium text-content shadow-ui-sm sm:w-auto"
              >
                <option value="">All categories</option>
                {pickerGroups.map(({ group, categories }) => (
                  <optgroup key={group.id} label={group.name}>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{categoryOptionLabel(cat)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronRight size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-content-muted" />
            </div>
          )}
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              type="text"
              placeholder="Search merchants…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); }}
              className="ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel pl-9 pr-8 text-[13px] text-content shadow-ui-sm sm:w-[220px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 grid -translate-y-1/2 place-items-center text-content-muted hover:text-content"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {(effectiveCategory || debouncedSearch) && (
        <div className="mb-3 flex flex-wrap gap-2 px-1">
          {effectiveCategory && (
            <Badge tone="brand" className="pr-1.5">
              {displayOf({ categoryId: effectiveCategory }).label}
              <button
                type="button"
                onClick={() => {
                  if (isControlled) {
                    onClearCategory?.();
                  } else {
                    setInternalCategory(null);
                  }
                }}
                aria-label="Clear category filter"
                className="grid place-items-center"
              >
                <X size={12} />
              </button>
            </Badge>
          )}
          {debouncedSearch && (
            <Badge tone="neutral" className="pr-1.5">
              &ldquo;{debouncedSearch}&rdquo;
              <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search filter" className="grid place-items-center">
                <X size={12} />
              </button>
            </Badge>
          )}
        </div>
      )}

      <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm">
        {/* Skeleton only before the FIRST rows arrive; later refetches keep the
             stale rows mounted (dimmed) so period/filter changes don't flash. */}
        {loading && transactions.length === 0 ? (
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
        ) : !loading && transactions.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={<Search size={22} />}
              title="No transactions found"
              description="Try adjusting your filters or the month in view."
            />
          </div>
        ) : (
          <div className={cn('transition-opacity duration-200', loading && 'opacity-50')}>
            {transactions.map((tx) => {
              const amount = parseFloat(tx.amount);
              const isIncome = amount < 0;
              const display = displayOf(tx);
              const categoryNode = editingTxId === tx.id ? (
                categoryEditorFor(tx)
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
                       outside). TxnRow is always the wrapper's first child so its
                       own border-t is suppressed; the wrapper carries it instead. */}
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
                      excluded={tx.excludedAt != null}
                    />
                  </div>
                  {createRulePrompt?.txId === tx.id && (
                    <CreateRuleBar
                      merchantText={createRulePrompt.merchantText}
                      category={createRulePrompt.category}
                      onCreate={() => {
                        onCreateRule?.({ merchantText: createRulePrompt.merchantText, category: createRulePrompt.category });
                        setCreateRulePrompt(null);
                      }}
                      onDismiss={() => setCreateRulePrompt(null)}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3.5 sm:px-5">
            <span className="ui-tnum text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">
              {(page - 1) * PAGE_SIZE + 1}&ndash;{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="ui-focus grid h-11 w-11 place-items-center rounded-ui-md border border-line text-content transition-colors hover:bg-canvas-sunken disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="ui-tnum min-w-[56px] text-center text-[12px] font-semibold text-content-muted">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
                className="ui-focus grid h-11 w-11 place-items-center rounded-ui-md border border-line text-content transition-colors hover:bg-canvas-sunken disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      <TransactionDetail
        open={detailTx !== null}
        tx={detailTx}
        onClose={() => setDetailTx(null)}
        onSaved={(patch) => {
          if (!detailTx) return;
          const id = detailTx.id;
          setTransactions((prev) => prev.map((t) => t.id === id ? {
            ...t,
            ...(patch.merchantName !== undefined ? { merchantName: patch.merchantName } : {}),
            ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes.trim() === '' ? null : patch.notes } : {}),
            ...(patch.excluded !== undefined ? { excludedAt: patch.excluded ? new Date().toISOString() : null } : {}),
          } : t));
          if (patch.categoryId !== undefined || patch.merchantName !== undefined || patch.excluded !== undefined) onDataChanged?.();
        }}
      />
    </div>
  );
}
