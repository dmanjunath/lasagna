import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Search, X, DollarSign, Banknote } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Badge, EmptyState, Skeleton } from '../uikit';
import { CATEGORY_CONFIG, getCategoryDisplay } from '../../lib/categories';

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
  category: string;
  accountId: string;
}

// ---------------------------------------------------------------------------
// Transaction row — category medallion · merchant · category·date · amount.
// Income (amount < 0) renders positive teal with a leading '+'. The category
// label stays a click target so it can open the inline recategorize editor.
// ---------------------------------------------------------------------------

function TxnRow({
  merchant, icon, isIncome, categoryNode, date, amount,
}: {
  merchant: string;
  icon: React.ReactNode;
  isIncome: boolean;
  categoryNode: React.ReactNode;
  date: string;
  amount: number;
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
        <div className="mt-0.5 flex items-center text-[12.5px] text-content-muted">
          {categoryNode}
          <span className="mx-1 text-content-faint">·</span>
          <span className="ui-tnum">{shortDate(date)}</span>
        </div>
      </div>
      <span className={cn('shrink-0 font-editorial text-[14.5px] font-extrabold tracking-[-0.01em] ui-tnum', isIncome && 'text-positive')}>
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
}) {
  // When `category` prop is provided (even as null) the component is controlled.
  const isControlled = category !== undefined;

  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [internalCategory, setInternalCategory] = useState<string | null>(null);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [createRulePrompt, setCreateRulePrompt] = useState<{ txId: string; merchantText: string; category: string } | null>(null);

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
      <select
        autoFocus
        value={tx.category}
        onBlur={() => setEditingTxId(null)}
        onChange={async (e) => {
          const newCat = e.target.value;
          const prevCat = tx.category;
          const merchantText = tx.merchantName || tx.name;
          setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, category: newCat } : t));
          setEditingTxId(null);
          try {
            await api.updateTransactionCategory(tx.id, newCat);
            if (onCreateRule) {
              setCreateRulePrompt({ txId: tx.id, merchantText, category: newCat });
            }
            onDataChanged?.();
          } catch (err) {
            console.error(err);
            setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, category: prevCat } : t));
          }
        }}
        className="h-7 rounded-ui-sm border border-line-strong bg-panel px-1.5 text-[12px] font-medium text-content"
        onClick={(e) => e.stopPropagation()}
      >
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
          <option key={key} value={key}>{cfg.label}</option>
        ))}
      </select>
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
                {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
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
              {getCategoryDisplay(effectiveCategory).label}
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
        {loading ? (
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
        ) : transactions.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={<Search size={22} />}
              title="No transactions found"
              description="Try adjusting your filters or the month in view."
            />
          </div>
        ) : (
          <div>
            {transactions.map((tx) => {
              const amount = parseFloat(tx.amount);
              const isIncome = amount < 0;
              const display = getCategoryDisplay(tx.category);
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
                  <TxnRow
                    merchant={tx.merchantName || tx.name}
                    icon={isIncome ? <DollarSign size={15} /> : (display.icon ?? <Banknote size={15} />)}
                    isIncome={isIncome}
                    categoryNode={categoryNode}
                    date={tx.date}
                    amount={amount}
                  />
                  {createRulePrompt?.txId === tx.id && (
                    <div className="flex items-center gap-3 bg-[rgb(var(--ui-brand-softer))] px-4 py-2.5 text-[12.5px] sm:px-5">
                      <span className="flex-1 text-content-muted">
                        Always categorize &ldquo;{createRulePrompt.merchantText}&rdquo; as{' '}
                        <b className="font-semibold text-content">{getCategoryDisplay(createRulePrompt.category).label}</b>?
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onCreateRule?.({ merchantText: createRulePrompt.merchantText, category: createRulePrompt.category });
                          setCreateRulePrompt(null);
                        }}
                        className="shrink-0 font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
                      >
                        Create rule
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreateRulePrompt(null)}
                        aria-label="Dismiss"
                        className="grid shrink-0 place-items-center text-content-muted hover:text-content"
                      >
                        <X size={13} />
                      </button>
                    </div>
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
    </div>
  );
}
