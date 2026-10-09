import React, { useState, useEffect } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Pencil, Search, X, DollarSign, Banknote } from 'lucide-react';
import { Link } from 'wouter';
import { api } from '../../lib/api';
import { cn, formatStoredDay } from '../../lib/utils';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../lib/hide-amounts';
import { HiddenAmount, Badge, EmptyState, Skeleton, useToast } from '../uikit';
import { categoryOptionLabel, useCategoryDisplay, usePickerGroups } from '../../lib/taxonomy';
import { CategoryPicker } from '../common/CategoryPicker';
import { TransactionDetail } from './TransactionDetail';
import { MerchantNameInput } from './MerchantNameInput';

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
    <div className="flex items-center gap-3 bg-[var(--ui-brand-softer)] px-4 py-2.5 text-[12.5px] sm:px-5">
      {/* The action sits right after the question it answers, not across the bar. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-content-muted">
          Always categorize &ldquo;{merchantText}&rdquo; as{' '}
          <b className="font-semibold text-content">{displayOf({ categoryId: category }).label}</b>?
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="touch-target-inline inline-flex shrink-0 items-center gap-1 font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
        >
          Create rule <ArrowRight size={13} aria-hidden />
        </button>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="touch-target-inline grid shrink-0 place-items-center text-content-muted hover:text-content"
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
  merchant, icon, isIncome, categoryNode, date, amount, accountName, excluded, onOpenDetail,
  showDate = true, onMerchantClick, onAccountClick, selected, selecting, onToggleSelect,
  columns, accountIcon, onRenameMerchant,
}: {
  merchant: string;
  icon: React.ReactNode;
  isIncome: boolean;
  categoryNode: React.ReactNode;
  date: string;
  amount: number;
  accountName?: string;
  excluded?: boolean;
  // When set, the merchant becomes the keyboard-accessible "open details"
  // control, so the row wrapper doesn't need role=button (which would nest an
  // ARIA button around the inner category picker). With onMerchantClick the
  // merchant filters instead, and the amount carries "open details".
  onOpenDetail?: () => void;
  /** false under a day heading, which already names the date. */
  showDate?: boolean;
  onMerchantClick?: () => void;
  onAccountClick?: () => void;
  /**
   * Selection: a checkbox column left of the medallion. Its space is kept on
   * wider screens and the box fades in on hover, focus, or while selecting.
   * Phones have no hover, so there it only appears while selecting.
   */
  selected?: boolean;
  selecting?: boolean;
  onToggleSelect?: () => void;
  /** Wide screens (xl+) lay merchant, category, account, and amount out as columns. */
  columns?: boolean;
  /** Institution logo shown beside the account in the column layout. */
  accountIcon?: React.ReactNode;
  /** Inline rename: a pencil beside the merchant on row hover opens an editor with suggestions. */
  onRenameMerchant?: (name: string) => void;
}) {
  const showCheckbox = selecting || selected;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const doneRef = React.useRef(false);
  const startEdit = () => { setDraft(merchant); doneRef.current = false; setEditing(true); };
  const finishEdit = (value: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
    const name = value?.trim();
    if (name && name !== merchant) onRenameMerchant?.(name);
  };
  const amountText = isAmountsHidden() ? <HiddenAmount /> : `${isIncome ? '+' : ''}${formatCurrencyExact(Math.abs(amount))}`;
  const amountClass = cn('shrink-0 text-[14.5px] font-bold tracking-[-0.01em] ui-tnum', isIncome && !isAmountsHidden() && 'text-positive', excluded && 'opacity-50');
  return (
    <div className="group/txn flex items-center gap-3.5 border-t border-line px-4 py-3 first:border-t-0 last:rounded-b-ui-xl sm:px-5">
      {onToggleSelect && (
        <label
          onClick={(e) => e.stopPropagation()}
          className={cn(
            '-mx-1.5 grid h-9 w-8 shrink-0 cursor-pointer place-items-center rounded-ui-md',
            !showCheckbox && 'max-sm:hidden opacity-0 [@media(hover:hover)]:group-hover/txn:opacity-100 group-focus-within/txn:opacity-100',
          )}
        >
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelect}
            // Repeat merchants are common, so the date and amount tell rows apart.
            aria-label={`Select ${merchant}, ${formatStoredDay(date)}${isAmountsHidden() ? '' : `, ${formatCurrencyExact(Math.abs(amount))}`}`}
            className="ui-focus h-4 w-4 cursor-pointer rounded border-line accent-[rgb(var(--ui-brand))]"
          />
        </label>
      )}
      <span className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-ui-md',
        isIncome ? 'bg-positive-soft text-positive' : 'bg-canvas-sunken text-content-secondary',
      )}>
        {icon}
      </span>
      <div className={cn('min-w-0 flex-1', columns && 'xl:flex-[1.4]')}>
        {editing ? (
          <div onClick={(e) => e.stopPropagation()} className="relative max-w-[320px]">
            <MerchantNameInput
              autoFocus
              floating
              exclude={merchant}
              ariaLabel="Merchant name"
              value={draft}
              onChange={setDraft}
              onCommit={(v) => finishEdit(v)}
              onCancel={() => finishEdit(null)}
              inputClassName="h-8 min-h-0 py-0 text-[14px] font-bold"
            />
          </div>
        ) : onMerchantClick ? (
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMerchantClick(); }}
              // Above the category trigger, whose touch-target-inline margin
              // reaches up over a short merchant name on phones.
              className="ui-focus relative z-[1] min-w-0 truncate rounded-ui-xs text-left text-[14px] font-bold leading-tight [@media(hover:hover)]:hover:underline"
              title={`Show only ${merchant}`}
            >
              {merchant}
            </button>
            {onRenameMerchant && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startEdit(); }}
                aria-label={`Rename ${merchant}`}
                title="Rename"
                className="ui-focus relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-ui-xs text-content-muted opacity-0 transition-colors hover:bg-canvas-sunken hover:text-content focus:opacity-100 [@media(hover:hover)]:group-hover/txn:opacity-100 [@media(hover:none)]:hidden"
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        ) : onOpenDetail ? (
          <button
            type="button"
            onClick={onOpenDetail}
            className="ui-focus block max-w-full truncate rounded-ui-xs text-left text-[14px] font-bold leading-tight"
            title={merchant}
          >
            {merchant}
          </button>
        ) : (
          <div className="truncate text-[14px] font-bold leading-tight" title={merchant}>{merchant}</div>
        )}
        <div className={cn('mt-0.5 flex min-w-0 items-center gap-2.5 text-[12.5px] text-content-muted sm:gap-3', excluded && 'opacity-50', columns && 'xl:hidden')}>
          {categoryNode}
          {excluded && <Badge tone="neutral" className="shrink-0">Excluded</Badge>}
          {showDate && <span className="ui-tnum shrink-0 whitespace-nowrap">{formatStoredDay(date)}</span>}
          {accountName && (onAccountClick ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAccountClick(); }}
              className="ui-focus hidden min-w-0 truncate rounded-ui-xs text-left transition-colors [@media(hover:hover)]:hover:text-content [@media(hover:hover)]:hover:underline sm:inline"
              title={`Show only ${accountName}`}
            >
              {accountName}
            </button>
          ) : (
            <span className="hidden truncate sm:inline">{accountName}</span>
          ))}
        </div>
      </div>
      {columns && (
        <>
          {/* Column cells, wide screens only. The stacked meta line above
               carries the same fields below xl. */}
          <div className={cn('hidden min-w-0 flex-1 items-center gap-2 text-[13px] text-content-secondary xl:flex', excluded && 'opacity-50')}>
            {categoryNode}
            {excluded && <Badge tone="neutral" className="shrink-0">Excluded</Badge>}
          </div>
          <div className={cn('hidden min-w-0 flex-1 items-center gap-2 text-[13px] text-content-secondary xl:flex', excluded && 'opacity-50')}>
            {accountName && accountIcon && <span className="shrink-0">{accountIcon}</span>}
            {accountName && (onAccountClick ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAccountClick(); }}
                className="ui-focus min-w-0 truncate rounded-ui-xs text-left transition-colors [@media(hover:hover)]:hover:text-content [@media(hover:hover)]:hover:underline"
                title={`Show only ${accountName}`}
              >
                {accountName}
              </button>
            ) : (
              <span className="truncate">{accountName}</span>
            ))}
          </div>
          {showDate && (
            <span className="ui-tnum hidden w-[72px] shrink-0 text-[13px] text-content-muted xl:block">{formatStoredDay(date)}</span>
          )}
        </>
      )}
      {onMerchantClick && onOpenDetail ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          aria-label={`Open details for ${merchant}`}
          className={cn('ui-focus flex items-center gap-1.5 rounded-ui-xs', columns && 'xl:min-w-[120px] xl:justify-end', amountClass)}
        >
          {amountText}
          {columns && <ChevronRight size={16} className="hidden text-content-faint xl:block" aria-hidden />}
        </button>
      ) : (
        <span className={cn(amountClass, columns && 'xl:min-w-[120px] xl:pr-[22px] xl:text-right')}>{amountText}</span>
      )}
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
  categoryIds,
  excludeCategoryIds,
  onClearCategory,
  refreshKey = 0,
  onDataChanged,
  onCreateRule,
  title = 'Recent transactions',
  showCategoryFilter = true,
  onCategoryChange,
  viewAllHref,
  pageSize = 20,
  showPagination = true,
  showSearch = true,
}: {
  accountId?: string;
  startDate?: string;
  endDate?: string;
  category?: string | null;
  /** Category scope applied on top of `category`: keep only these ids. */
  categoryIds?: string[];
  /** Category scope applied on top of `category`: drop these ids. */
  excludeCategoryIds?: string[];
  onClearCategory?: () => void;
  refreshKey?: number;
  onDataChanged?: () => void;
  onCreateRule?: (seed: { merchantText: string; category: string }) => void;
  title?: string;
  showCategoryFilter?: boolean;
  onCategoryChange?: (cat: string | null) => void;
  viewAllHref?: string;
  pageSize?: number;
  /** false = single fixed page; viewAllHref renders as a card footer link instead. */
  showPagination?: boolean;
  showSearch?: boolean;
}) {
  // When `category` prop is provided (even as null) the component is controlled.
  const isControlled = category !== undefined;

  const pickerGroups = usePickerGroups();
  const displayOf = useCategoryDisplay();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [internalCategory, setInternalCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [createRulePrompt, setCreateRulePrompt] = useState<{ txId: string; merchantText: string; category: string } | null>(null);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const effectiveCategory = isControlled ? category : internalCategory;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Stable keys for the two id lists, so a fresh array identity on every parent
  // render can't restart the fetch effect on a scope that did not change.
  const categoryIdsKey = (categoryIds ?? []).join(',');
  const excludeCategoryIdsKey = (excludeCategoryIds ?? []).join(',');

  // Reset page to 1 when any filter changes externally or via debounced search.
  useEffect(() => {
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, accountId, effectiveCategory, categoryIdsKey, excludeCategoryIdsKey, debouncedSearch]);

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
      limit: pageSize,
      category: effectiveCategory || undefined,
      categories: categoryIdsKey ? categoryIdsKey.split(',') : undefined,
      excludeCategories: excludeCategoryIdsKey ? excludeCategoryIdsKey.split(',') : undefined,
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
  }, [page, pageSize, effectiveCategory, categoryIdsKey, excludeCategoryIdsKey, startDate, endDate, accountId, debouncedSearch, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function categoryEditorFor(tx: Transaction) {
    return (
      <CategoryPicker
        variant="inline"
        value={tx.categoryId ?? ''}
        currentLabel={displayOf(tx).label}
        onOpen={() => setCreateRulePrompt(null)}
        onChange={async (newCatId) => {
          const prevCatId = tx.categoryId;
          const merchantText = tx.merchantName || tx.name;
          setEditError(null);
          setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, categoryId: newCatId } : t));
          try {
            await api.updateTransactionCategory(tx.id, newCatId);
            if (onCreateRule) {
              setCreateRulePrompt({ txId: tx.id, merchantText, category: newCatId });
            }
            onDataChanged?.();
            // Confirm the move, with a one-click undo (only when there was a
            // previous category to restore).
            const undo = async () => {
              setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, categoryId: prevCatId } : t));
              setCreateRulePrompt(null);
              try {
                await api.updateTransactionCategory(tx.id, prevCatId as string);
                onDataChanged?.();
                toast({ tone: 'info', title: 'Change undone' });
              } catch {
                setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, categoryId: newCatId } : t));
                setEditError("Couldn't undo. Try again.");
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
            setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, categoryId: prevCatId } : t));
            setEditError("Couldn't update the category, so the change was undone. Try again.");
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
          {/* In teaser mode the footer link already prints the count — showing
               it here too states the same number twice in one card. */}
          {total > 0 && (showPagination || !viewAllHref) && (
            <span className="text-[12.5px] font-semibold text-content-muted ui-tnum">{total} total</span>
          )}
          {viewAllHref && showPagination && (
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
                aria-label="Filter by category"
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
          {showSearch && (
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
              <input
                type="text"
                placeholder="Search merchants…"
                aria-label="Search merchants"
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
          )}
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

      {editError && (
        <p role="alert" className="mb-3 px-1 text-[12.5px] font-medium text-negative">{editError}</p>
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
              const categoryNode = categoryEditorFor(tx);
              return (
                <React.Fragment key={tx.id}>
                  {/* Clickable wrapper (row only — the CreateRuleBar sibling stays
                       outside). TxnRow is always the wrapper's first child so its
                       own border-t is suppressed; the wrapper carries it instead. */}
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
                      excluded={tx.excludedAt != null}
                      // Redundant when the list is already scoped to one account.
                      accountName={accountId ? undefined : (tx.accountName ?? undefined)}
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

        {showPagination && total > pageSize && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3.5 sm:px-5">
            <span className="ui-tnum text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">
              {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
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

        {!showPagination && viewAllHref && total > 0 && (
          <Link
            href={viewAllHref}
            className="ui-focus flex items-center justify-center rounded-b-ui-xl border-t border-line px-4 py-3 text-[13px] font-bold text-content-muted transition-colors hover:text-brand sm:px-5"
          >
            View all {total} {total === 1 ? 'transaction' : 'transactions'} →
          </Link>
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
