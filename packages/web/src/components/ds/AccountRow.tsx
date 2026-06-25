import { ReactNode, useState, useRef, useEffect } from 'react';
import { RefreshCw, Trash2, MoreHorizontal, SlidersHorizontal, Lock } from 'lucide-react';
import { faviconUrl, institutionDomainFor } from './institutions';

export interface AccountRowProps {
  /** Display name of the institution — "Chase", "Vanguard", etc. */
  institution: string;
  /** Optional domain override. If omitted, we infer from a local map. */
  institutionDomain?: string;
  /** Account name — "Suhana R Manjunath 529 College Savings". */
  name: string;
  /** Last-4 mask, rendered as a muted account-number tail bound to the name. */
  mask?: string | null;
  /** Sub-line metadata: institution, type, etc. (NOT the mask — that's `mask`). */
  meta?: ReactNode;
  /** Small state chips appended to the meta line — "Not counted", "Inverted". */
  badges?: string[];
  /** Primary balance value. */
  value: number;
  /** Optional delta below value, rendered tabular and muted. */
  delta?: ReactNode;
  /** Optional sync callback — adds a "Sync now" item to the overflow menu. */
  onSync?: () => void;
  /** Whether the sync action is currently in flight. */
  syncing?: boolean;
  /** Opens the account settings modal — adds "Account settings" to the menu. */
  onSettings?: () => void;
  /** Optional delete callback — adds "Delete account" to the menu (manual only). */
  onDelete?: () => void;
  /** Optional upgrade callback — adds "Upgrade to sync" to the menu (frozen accounts). */
  onUpgrade?: () => void;
  /** Format the value (caller-controlled so currency formatting stays consistent). */
  formatValue?: (n: number) => string;
  /** Render value as negative (e.g. debt totals shown as positive absolute with leading −). */
  negative?: boolean;
  /** De-emphasize the whole row (e.g. a frozen, no-longer-synced account). */
  muted?: boolean;
}

const defaultFmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * AccountRow — shared primitive for any account/holding-style list row.
 *
 * Layout contract:
 * - Desktop 60px tall, mobile 64px tall.
 * - Left: 28×28 institution favicon (Google s2) with a monogram fallback.
 * - Primary line: account name (truncate, full name in title attr).
 * - Eyebrow under name: institution + mask + type (caller-supplied via `meta`),
 *   plus optional state chips.
 * - A `⋯` overflow menu sits just left of the value. Its slot is always
 *   reserved so the value NEVER moves — the balance stays visible at all times
 *   (the old hover-slide hid the balance behind the action buttons). The icon
 *   itself fades in on hover/focus on desktop; it's always shown on touch.
 * - Right: value (always visible, tabular-nums, pinned right), delta below.
 */
export function AccountRow({
  institution,
  institutionDomain,
  name,
  mask,
  meta,
  badges,
  value,
  delta,
  onSync,
  syncing,
  onSettings,
  onDelete,
  onUpgrade,
  formatValue = defaultFmt,
  negative,
  muted,
}: AccountRowProps) {
  const resolvedDomain = institutionDomain ?? institutionDomainFor(institution);
  const icon = faviconUrl(resolvedDomain, 64);
  const monogram = (institution || '?').trim().charAt(0).toUpperCase();
  const formatted = formatValue(Math.abs(value));
  // Debt sections force a leading − (negative). Elsewhere, show a sign only
  // when the value is actually negative (e.g. an inverted asset balance).
  const showNeg = negative || value < 0;
  const display = showNeg ? `−${formatted}` : formatted;
  const hasMenu = Boolean(onSettings || onSync || onDelete || onUpgrade);

  const hasBadges = Boolean(badges && badges.length > 0);
  // The whole row opens settings (the ⋯ menu's clicks stop propagation so they
  // don't double-fire). Gives a big, discoverable tap target for editing.
  const clickable = Boolean(onSettings);

  return (
    <div
      className={`ds-row ds-row--account${clickable ? ' ds-row--clickable' : ''}${muted ? ' ds-row--muted' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Edit ${name}` : undefined}
      onClick={clickable ? onSettings : undefined}
      onKeyDown={
        clickable
          ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSettings!(); } }
          : undefined
      }
    >
      <Favicon icon={icon} monogram={monogram} alt={institution} />
      <div className="ds-row__main">
        <div className="ds-row__primary-line">
          <span className="ds-row__primary" title={name}>{name}</span>
          {mask && (
            <span className="ds-row__acct-no" aria-label={`account ending ${mask}`}>
              <span className="ds-row__acct-dots" aria-hidden="true">••••</span>{mask}
            </span>
          )}
        </div>
        {(meta || hasBadges) && (
          <div className="ds-row__meta-line">
            {meta && <span className="ds-row__meta">{meta}</span>}
            {badges?.map((b) => (
              <span key={b} className="ds-row__badge">{b}</span>
            ))}
          </div>
        )}
      </div>
      <div className="ds-row__right">
        <span className={`ds-row__value ds-num${showNeg ? ' ds-neg' : ''}`}>{display}</span>
        {delta && <span className="ds-row__delta ds-num">{delta}</span>}
      </div>
      {hasMenu && (
        <RowMenu
          name={name}
          onSettings={onSettings}
          onSync={onSync}
          syncing={syncing}
          onDelete={onDelete}
          onUpgrade={onUpgrade}
        />
      )}
    </div>
  );
}

/**
 * RowMenu — the `⋯` overflow trigger and its popover, pinned to the row's right
 * edge so it sits in one predictable place (hugging the value) rather than
 * floating in the gap. The trigger stays faintly visible at rest so the actions
 * are discoverable without hover-hunting, and shows a spinner while syncing so
 * "Sync now" gives feedback even after the menu closes.
 */
export function RowMenu({
  name,
  onSettings,
  onSync,
  syncing,
  onDelete,
  onUpgrade,
}: {
  name: string;
  onSettings?: () => void;
  onSync?: () => void;
  syncing?: boolean;
  onDelete?: () => void;
  onUpgrade?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Flip the popover above the trigger when there isn't room below (last rows).
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setDropUp(window.innerHeight - rect.bottom < 200);
    setOpen(true);
  };

  const closeMenu = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // On open, move focus into the menu; on outside-click / Escape, close it.
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLButtonElement>('.ds-row__menu-item')?.focus();
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(true); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      className={`ds-row__menu${open ? ' ds-row__menu--open' : ''}${syncing ? ' ds-row__menu--busy' : ''}`}
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        ref={triggerRef}
        className="ds-row__menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={syncing ? `Syncing ${name}` : `Actions for ${name}`}
        onClick={() => (open ? closeMenu() : openMenu())}
      >
        {syncing ? <RefreshCw size={15} className="animate-spin" /> : <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div
          ref={popRef}
          className={`ds-row__menu-pop${dropUp ? ' ds-row__menu-pop--up' : ''}`}
          role="menu"
          aria-label={`Actions for ${name}`}
        >
          {onSettings && (
            <button
              type="button"
              role="menuitem"
              className="ds-row__menu-item"
              onClick={() => { closeMenu(); onSettings(); }}
            >
              <SlidersHorizontal size={14} />
              Account settings
            </button>
          )}
          {onSync && (
            <button
              type="button"
              role="menuitem"
              className="ds-row__menu-item"
              disabled={syncing}
              onClick={() => { closeMenu(); onSync(); }}
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          {onUpgrade && (
            <button
              type="button"
              role="menuitem"
              className="ds-row__menu-item"
              onClick={() => { closeMenu(); onUpgrade(); }}
            >
              <Lock size={14} />
              Upgrade to sync
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              className="ds-row__menu-item ds-row__menu-item--danger"
              onClick={() => { closeMenu(); onDelete(); }}
            >
              <Trash2 size={14} />
              Delete account
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
