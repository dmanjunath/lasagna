import { ReactNode, useState } from 'react';
import { RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { faviconUrl, institutionDomainFor } from './institutions';

export interface AccountRowProps {
  /** Display name of the institution — "Chase", "Vanguard", etc. */
  institution: string;
  /** Optional domain override. If omitted, we infer from a local map. */
  institutionDomain?: string;
  /** Account name — "Suhana R Manjunath 529 College Savings". */
  name: string;
  /** Sub-line metadata: mask, type, account number, last sync, etc. */
  meta?: ReactNode;
  /** Primary balance value. */
  value: number;
  /** Optional delta below value, rendered tabular and muted. */
  delta?: ReactNode;
  /** Optional sync callback — exposes a hover-revealed sync icon on desktop. */
  onSync?: () => void;
  /** Whether the sync action is currently in flight. */
  syncing?: boolean;
  /** Optional rename callback — shown when provided (manual accounts only). */
  onEdit?: () => void;
  /** Optional delete callback — shown when provided (manual accounts only). */
  onDelete?: () => void;
  /** Format the value (caller-controlled so currency formatting stays consistent). */
  formatValue?: (n: number) => string;
  /** Render value as negative (e.g. debt totals shown as positive absolute with leading −). */
  negative?: boolean;
}

const defaultFmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * AccountRow — shared primitive for any account/holding-style list row.
 *
 * Layout contract:
 * - Desktop 52px tall, mobile 56px tall.
 * - Left: 28×28 institution favicon (Google s2) with a monogram fallback.
 *   Monogram bg is neutral grayscale — NOT sauce/teal/cheese — so it never
 *   shouts louder than the value.
 * - Primary line: account name (truncate, full name in title attr).
 * - Eyebrow under name: institution + mask + type (caller-supplied via `meta`).
 * - Right: value (always visible, tabular-nums), delta below in 11px muted.
 * - Mobile rule: $ value never collapses. Truncate names; never wrap to 6 lines.
 */
export function AccountRow({
  institution,
  institutionDomain,
  name,
  meta,
  value,
  delta,
  onSync,
  syncing,
  onEdit,
  onDelete,
  formatValue = defaultFmt,
  negative,
}: AccountRowProps) {
  const resolvedDomain = institutionDomain ?? institutionDomainFor(institution);
  const icon = faviconUrl(resolvedDomain, 64);
  const monogram = (institution || '?').trim().charAt(0).toUpperCase();
  const formatted = formatValue(Math.abs(value));
  const display = negative ? `−${formatted}` : formatted;
  const actionCount = (onEdit ? 1 : 0) + (onSync ? 1 : 0) + (onDelete ? 1 : 0);

  return (
    <div
      className="ds-row ds-row--account"
      data-actions={actionCount > 0 ? actionCount : undefined}
    >
      <Favicon icon={icon} monogram={monogram} alt={institution} />
      <div className="ds-row__main">
        <div className="ds-row__primary" title={name}>{name}</div>
        {meta && <div className="ds-row__meta">{meta}</div>}
      </div>
      <div className="ds-row__right">
        <span className={`ds-row__value ds-num${negative ? ' ds-neg' : ''}`}>{display}</span>
        {delta && <span className="ds-row__delta ds-num">{delta}</span>}
      </div>
      {actionCount > 0 && (
        <div className="ds-row__actions" role="group" aria-label={`Actions for ${name}`}>
          {onEdit && (
            <button
              type="button"
              className="ds-row__action"
              onClick={onEdit}
              title="Rename"
              aria-label={`Rename ${name}`}
            >
              <Pencil size={14} />
            </button>
          )}
          {onSync && (
            <button
              type="button"
              className="ds-row__action"
              onClick={onSync}
              disabled={syncing}
              title={`Sync ${institution}`}
              aria-label={`Sync ${institution}`}
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="ds-row__action ds-row__action--danger"
              onClick={onDelete}
              title="Delete"
              aria-label={`Delete ${name}`}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Favicon — keeps presentation consistent across AccountRow and TransactionRow.
 * Falls back to a neutral grayscale monogram if the s2 fetch 404s (Google
 * returns a generic globe icon at sz=64 even on failures, but a real network
 * error or img.onerror will swap to the monogram).
 */
export function Favicon({
  icon,
  monogram,
  alt,
  size = 28,
}: {
  icon: string | null;
  monogram: string;
  alt: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (icon && !failed) {
    return (
      <img
        src={icon}
        alt={alt}
        width={size}
        height={size}
        className="ds-row__favicon"
        onError={() => setFailed(true)}
        loading="lazy"
      />
    );
  }
  return (
    <div
      className="ds-row__monogram"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.floor(size * 0.42)) }}
      aria-hidden="true"
    >
      {monogram}
    </div>
  );
}
