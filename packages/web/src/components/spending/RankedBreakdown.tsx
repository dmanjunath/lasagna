import React, { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Receipt } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTaxonomy, taxonomyIcon } from '../../lib/taxonomy';
import { paceVerdict } from '../../lib/spending-pace';
import { rankWithMoneyBackLast } from '../../lib/money-back';
import { SegmentedControl } from '../uikit';
import type { RollupRow } from '../../pages/spending';

// The app's Spending breakdown on the web (owner decision 2026-11-23, Noodle
// only, through the `breakdown: "ranked"` skin): one row per group or category
// with its category tile, the name and amount over a share track sized against
// the largest row, and the Money out / Money in switch at the top of the card.
// A row with several categories opens in place to them (each opening its own
// transactions) and a link to all of them; any other row opens its
// transactions. Running ahead of the usual month says so, in sauce, with an
// arrow, so it never reads as the same signal as a red category track.

export type Side = 'expenses' | 'income';

/** The app's category tone (categoryToneIndex): the same label lands on the same of the theme's eight. */
export function categoryTone(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return (h % 8) + 1;
}


const SIDE_KEY = 'lf-spending-side';
export function RankedBreakdown({
  expenseRows,
  incomeRows,
  rollup,
  sort,
  periodKey,
  formatAmount,
  onDrill,
  onSideChange,
}: {
  expenseRows: RollupRow[];
  incomeRows: RollupRow[];
  rollup: 'category' | 'group';
  sort: { key: 'label' | 'amount'; dir: 'asc' | 'desc' };
  /** "YYYY-MM" for a month (the pace marker's window), absent for a year. */
  periodKey?: string;
  formatAmount: (n: number) => string;
  onDrill: (categoryIds: string[]) => void;
  /** The side on show, so the page's Recent transactions can follow it, as native does. */
  onSideChange?: (side: Side) => void;
}) {
  const { byId } = useTaxonomy();
  const sides: Side[] = [...(expenseRows.length > 0 ? ['expenses' as const] : []), ...(incomeRows.length > 0 ? ['income' as const] : [])];
  // The side survives a drill and Back: returning from Money in's transactions lands on Money in.
  const [picked, setPicked] = useState<Side>(() => {
    try {
      return window.sessionStorage.getItem(SIDE_KEY) === 'income' ? 'income' : 'expenses';
    } catch {
      return 'expenses';
    }
  });
  const pick = (v: Side) => {
    setPicked(v);
    try {
      window.sessionStorage.setItem(SIDE_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };
  const side: Side = sides.includes(picked) ? picked : sides[0] ?? 'expenses';
  useEffect(() => {
    onSideChange?.(side);
  }, [side, onSideChange]);
  const income = side === 'income';
  const [open, setOpen] = useState<Set<string | null>>(() => new Set());

  // Money back (a refund-heavy category, negative) always lists last, as native does.
  const rows = rankWithMoneyBackLast(income ? incomeRows : expenseRows, sort);
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;

  // The tile a row shows: its own category's, or a group's largest category's.
  const catOf = (row: RollupRow) => (rollup === 'category' ? row.key : row.children[0]?.key ?? null);
  const idsOf = (row: RollupRow) =>
    rollup === 'group' ? row.children.map((c) => c.key).filter((k): k is string => k !== null) : row.key !== null ? [row.key] : [];
  // A row's usual: its own (category mode), else the sum over its categories that have one, against what they spent.
  const verdictOf = (row: RollupRow) => {
    if (income || !periodKey) return null;
    if (row.total < 0) return null;
    if (rollup === 'category') return paceVerdict(row.total, row.usual, periodKey);
    const known = row.children.filter((c) => c.usual && c.usual > 0);
    if (known.length === 0) return null;
    return paceVerdict(known.reduce((s, c) => s + c.total, 0), known.reduce((s, c) => s + (c.usual ?? 0), 0), periodKey);
  };

  const pace = (v: 'good' | 'bad' | null) =>
    v === 'bad' ? (
      <span className="flex items-center gap-1 text-[12px] font-semibold text-[rgb(var(--ui-negative))]">
        <ArrowUpRight size={13} strokeWidth={2.6} aria-hidden />
        Above your usual pace
      </span>
    ) : null;

  const tile = (catId: string | null, label: string) => {
    const entry = catId ? byId.get(catId) : undefined;
    const n = categoryTone(label);
    const style = income
      ? { background: 'var(--ui-tint-income)', color: 'var(--ui-tint-income-ink)' }
      : { background: `var(--ui-category-${n})`, color: `var(--ui-category-${n}-ink)` };
    return (
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-md [&>svg]:h-[17px] [&>svg]:w-[17px]" style={style}>
        {entry ? taxonomyIcon(entry) : <Receipt size={17} />}
      </span>
    );
  };

  const track = (pct: number, label: string, thin = false) =>
    rows.length > 1 ? (
      <span aria-hidden className={cn('block w-full overflow-hidden rounded-full bg-canvas-sunken', thin ? 'h-1.5' : 'h-2')}>
        <span
          className="block h-full rounded-full transition-[width] duration-500 ease-ui"
          style={{ width: `${Math.max(pct, 2)}%`, background: income ? 'var(--ui-tint-income-accent)' : `var(--ui-category-${categoryTone(label)}-ink)` }}
        />
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      {sides.length > 1 && (
        // The selected side wears its own role color (Money out sauce, Money in basil), as native does.
        <div data-money-switch>
        <SegmentedControl
          aria-label="Money out or money in"
          value={side}
          onChange={(v) => pick(v as Side)}
          stretch={false}
          options={[
            { value: 'expenses', label: 'Money out' },
            { value: 'income', label: 'Money in' },
          ]}
        />
        </div>
      )}
      <div className="flex flex-col">
        {rows.map((row) => {
          const ids = idsOf(row);
          const several = rollup === 'group' && row.children.length > 1;
          const isOpen = several && open.has(row.key);
          const display = byId.get(catOf(row) ?? '')?.name ?? row.label;
          // Money back reads as money back, in basil, with no share track.
          const back = row.total < 0;
          const amount = back ? `${formatAmount(-row.total)} back` : formatAmount(row.total);
          const verdict = verdictOf(row);
          const act = () => {
            if (several) {
              setOpen((cur) => {
                const next = new Set(cur);
                if (next.has(row.key)) next.delete(row.key);
                else next.add(row.key);
                return next;
              });
            } else if (ids.length > 0) onDrill(ids);
          };
          const actionable = several || ids.length > 0;
          return (
            <React.Fragment key={row.key ?? 'other'}>
              <div
                role={actionable ? 'button' : undefined}
                tabIndex={actionable ? 0 : undefined}
                aria-expanded={several ? isOpen : undefined}
                aria-label={actionable ? `${row.label}, ${amount}${verdict === 'bad' ? ', above your usual pace' : ''}` : undefined}
                onClick={actionable ? act : undefined}
                onKeyDown={actionable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } } : undefined}
                className={cn(
                  'ui-focus group flex min-h-[56px] items-center gap-3 rounded-ui-md px-2 py-2 transition-colors',
                  actionable && 'cursor-pointer hover:bg-canvas-sunken',
                )}
              >
                {tile(catOf(row), display)}
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-content" title={row.label}>{row.label}</span>
                    <span className={cn('ui-tnum shrink-0 whitespace-nowrap text-[14.5px] font-bold tabular-nums', back ? 'text-[rgb(var(--ui-positive))]' : 'text-content')}>{amount}</span>
                  </span>
                  {!back && track((row.total / max) * 100, display)}
                  {pace(verdict)}
                </span>
                {several ? (
                  <ChevronDown size={16} className={cn('shrink-0 text-content-faint transition-transform', isOpen && 'rotate-180')} aria-hidden />
                ) : ids.length > 0 ? (
                  <ChevronRight size={16} className="shrink-0 text-content-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                ) : (
                  <span className="w-4 shrink-0" aria-hidden />
                )}
              </div>
              {isOpen && (
                <div className="flex flex-col pb-2 pl-12">
                  {row.children.map((c) => {
                    const label = c.label === row.label ? `${c.label} (general)` : c.label;
                    const cv = income || !periodKey || c.total < 0 ? null : paceVerdict(c.total, c.usual, periodKey);
                    const cBack = c.total < 0;
                    const go = () => c.key && onDrill([c.key]);
                    return (
                      <div
                        key={c.key ?? 'other'}
                        role={c.key ? 'link' : undefined}
                        tabIndex={c.key ? 0 : undefined}
                        aria-label={c.key ? `${label} transactions, ${cBack ? `${formatAmount(-c.total)} back` : formatAmount(c.total)}` : undefined}
                        onClick={c.key ? go : undefined}
                        onKeyDown={c.key ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } } : undefined}
                        className={cn('ui-focus group flex items-center gap-3 rounded-ui-md px-2 py-2', c.key && 'cursor-pointer hover:bg-canvas-sunken')}
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <span className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-content-secondary" title={label}>{label}</span>
                            <span className={cn('ui-tnum shrink-0 whitespace-nowrap text-[13.5px] font-semibold tabular-nums', cBack ? 'text-[rgb(var(--ui-positive))]' : 'text-content')}>
                              {cBack ? `${formatAmount(-c.total)} back` : formatAmount(c.total)}
                            </span>
                          </span>
                          {!cBack && track((c.total / max) * 100, display, true)}
                          {pace(cv)}
                        </span>
                        <ChevronRight size={15} className={cn('shrink-0', c.key ? 'text-content-faint' : 'text-transparent')} aria-hidden />
                      </div>
                    );
                  })}
                  {ids.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onDrill(ids)}
                      className="ui-focus self-start rounded-ui-xs px-2 py-2 text-[13.5px] font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
                    >
                      {`All ${row.label} transactions`}
                    </button>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
