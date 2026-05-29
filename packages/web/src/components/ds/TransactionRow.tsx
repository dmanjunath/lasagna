import { ReactNode } from 'react';
import { Banknote } from 'lucide-react';
import { Favicon } from './AccountRow';
import { faviconUrl, merchantDomainFor } from './institutions';

export interface TransactionRowProps {
  merchant: string;
  /** Optional domain override; falls back to a local merchant map. */
  merchantDomain?: string;
  /** Category label (already-humanized — primitive does NOT translate keys). */
  category?: ReactNode;
  /** ISO date string. We render relative ("Today"/"Yesterday") or short. */
  date: string;
  /** Signed amount: negative = income/credit, positive = expense/debit. */
  amount: number;
  /** Marks the row as transfer — value renders muted. */
  isTransfer?: boolean;
  /** Render category icon when no favicon resolves (e.g. Plaid name has no host). */
  fallbackIcon?: ReactNode;
  /** Currency formatter — caller-provided to keep dollar / cent rules consistent. */
  formatAmount?: (n: number) => string;
  /** Optional cell to inject between category and date on desktop (e.g. category edit chip). */
  extra?: ReactNode;
  /** Click handler — wraps the row in a button. */
  onClick?: () => void;
}

const defaultFmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * TransactionRow — shared primitive for any transaction-style list row.
 *
 * Layout contract:
 * - Desktop 44px flat — favicon · merchant · category · date · amount.
 * - Mobile 56px stacked — favicon + (row1: merchant + amount, row2: category · date).
 * - Income is rendered green (--lf-pos) with a leading '+'.
 * - Expense is ink, transfer is muted, both with no sign.
 * - NO decorative vertical accent bar on the row — categorical color is
 *   carried by the favicon (real brand) or category icon, not a stripe.
 * - Mobile rule: $ amount NEVER hidden. Category and date collapse onto the
 *   sub-row but never disappear (the brutal iter 2 critic was right).
 */
export function TransactionRow({
  merchant,
  merchantDomain,
  category,
  date,
  amount,
  isTransfer,
  fallbackIcon,
  formatAmount = defaultFmt,
  extra,
  onClick,
}: TransactionRowProps) {
  const isIncome = amount < 0;
  const resolvedDomain = merchantDomain ?? merchantDomainFor(merchant);
  const icon = faviconUrl(resolvedDomain, 64);
  const monogram = (merchant || '?').trim().charAt(0).toUpperCase();
  const display = formatAmount(Math.abs(amount));
  const sign = isIncome ? '+' : '';
  const amountClass = isTransfer ? 'ds-row__amount ds-num ds-row__amount--muted'
    : isIncome ? 'ds-row__amount ds-num ds-pos'
    : 'ds-row__amount ds-num';

  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`ds-row ds-row--tx${onClick ? ' ds-row--clickable' : ''}`}
    >
      {/* Favicon column: real brand icon when we can resolve, otherwise the
          caller-provided category icon (e.g. groceries → cart), otherwise a
          neutral monogram. No vertical accent stripe. */}
      {icon ? (
        <Favicon icon={icon} monogram={monogram} alt={merchant} size={24} />
      ) : fallbackIcon ? (
        <span className="ds-row__catglyph" aria-hidden="true">{fallbackIcon}</span>
      ) : (
        <Favicon icon={null} monogram={monogram || '$'} alt={merchant} size={24} />
      )}

      <div className="ds-row__main">
        <div className="ds-row__primary" title={merchant}>{merchant}</div>
        <div className="ds-row__meta ds-row__meta--tx">
          {category && <span className="ds-row__cat">{category}</span>}
          {category && <span className="ds-row__sep" aria-hidden="true">·</span>}
          <span className="ds-num">{shortDate(date)}</span>
          {extra && <span className="ds-row__extra">{extra}</span>}
        </div>
      </div>

      <span className={amountClass}>{sign}{display}</span>
    </Tag>
  );
}

/** Re-export so callers can use the bank icon as a generic fallback. */
export const TransactionFallbackIcon = Banknote;
