import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import { api } from '../lib/api.js';
import { SimpleShell } from '../components/layout/simple-shell';
import { ConfirmDialog } from '../components/ui/confirm-dialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: string, currency: string): string {
  const num = parseFloat(value);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getAccountTypeLabel(type: string, subtype: string | null): string {
  const sub = subtype ?? type;
  return sub.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Account {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  balance: string | null;
  currency: string;
  metadata?: { linkedAccountId?: string; [key: string]: unknown } | null;
}

interface PlaidItem {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  accounts: Account[];
}

// ---------------------------------------------------------------------------
// Manual account types — grouped by category for less-overwhelming picker
// ---------------------------------------------------------------------------

interface AccountTypeDef {
  label: string;
  emoji: string;
  type: string;
  subtype?: string;
  isDebt: boolean;
}

interface AccountTypeGroup {
  title: string;
  items: AccountTypeDef[];
}

const ACCOUNT_TYPE_GROUPS: AccountTypeGroup[] = [
  {
    title: 'Cash',
    items: [{ label: 'Checking / Savings', emoji: '💵', type: 'depository', isDebt: false }],
  },
  {
    title: 'Investments',
    items: [
      { label: '401(k) / 403(b)', emoji: '📈', type: 'investment', subtype: '401k', isDebt: false },
      { label: 'Roth IRA', emoji: '🌱', type: 'investment', subtype: 'roth_ira', isDebt: false },
      { label: 'Traditional IRA', emoji: '📊', type: 'investment', subtype: 'ira', isDebt: false },
      { label: 'Brokerage', emoji: '💼', type: 'investment', subtype: 'brokerage', isDebt: false },
      { label: 'HSA', emoji: '🏥', type: 'investment', subtype: 'hsa', isDebt: false },
    ],
  },
  {
    title: 'Property',
    items: [
      { label: 'Primary Residence', emoji: '🏡', type: 'real_estate', subtype: 'primary', isDebt: false },
      { label: 'Rental Property', emoji: '🏢', type: 'real_estate', subtype: 'rental', isDebt: false },
    ],
  },
  {
    title: 'Debt',
    items: [
      { label: 'Credit Card', emoji: '💳', type: 'credit', isDebt: true },
      { label: 'Student Loan', emoji: '🎓', type: 'loan', subtype: 'student', isDebt: true },
      { label: 'Auto Loan', emoji: '🚗', type: 'loan', subtype: 'auto', isDebt: true },
      { label: 'Mortgage', emoji: '🏠', type: 'loan', subtype: 'mortgage', isDebt: true },
    ],
  },
];

const ALL_ACCOUNT_TYPES: AccountTypeDef[] = ACCOUNT_TYPE_GROUPS.flatMap((g) => g.items);

// ---------------------------------------------------------------------------
// Small UI primitives
// ---------------------------------------------------------------------------

function InstitutionInitial({ name }: { name: string }) {
  const initial = (name || '?')[0].toUpperCase();
  return (
    <div className="w-10 h-10 rounded-xl bg-text text-[color:var(--lf-cheese)] grid place-items-center font-serif text-lg shrink-0">
      {initial}
    </div>
  );
}

function StatusBadge({ status, lastSyncedAt }: { status: string; lastSyncedAt: string | null }) {
  const isError = status === 'error' || status === 'item_login_required';
  const prefix = isError ? '⚠' : '✓';
  const label = isError
    ? 'needs reconnect'
    : lastSyncedAt
      ? `synced · ${formatRelativeTime(lastSyncedAt)}`
      : 'synced';
  return (
    <span className={`text-[11px] tracking-wide ${isError ? 'text-accent' : 'text-text-muted'}`}>
      {prefix} {label}
    </span>
  );
}

function TypePill({ type, subtype }: { type: string; subtype: string | null }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] tracking-wide bg-bg border border-rule text-text-muted whitespace-nowrap shrink-0">
      {getAccountTypeLabel(type, subtype)}
    </span>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="inline-block align-[-2px]"
      style={{ animation: 'lf-spin 0.8s linear infinite' }}
    >
      <style>{`@keyframes lf-spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Overflow menu for per-institution destructive actions
// ---------------------------------------------------------------------------

function OverflowMenu({
  status,
  onReconnect,
  onDisconnect,
}: {
  status: string;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const needsReconnect = status === 'item_login_required' || status === 'error';

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-11 h-11 grid place-items-center rounded-xl border border-rule bg-bg text-text-muted text-lg leading-none hover:bg-bg-elevated"
      >
        …
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-20 w-44 rounded-xl bg-bg-elevated border border-rule shadow-lg overflow-hidden"
        >
          {needsReconnect && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onReconnect();
              }}
              className="w-full text-left px-4 py-3 text-sm hover:bg-bg min-h-[44px]"
            >
              Reconnect
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="w-full text-left px-4 py-3 text-sm text-accent hover:bg-bg min-h-[44px]"
          >
            Disconnect…
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plaid types
// ---------------------------------------------------------------------------

interface PlaidLinkFactory {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: PlaidMetadata) => void;
    onExit: () => void;
  }) => { open: () => void };
}

interface PlaidMetadata {
  institution?: {
    institution_id: string;
    name: string;
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Accounts() {
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [linkStillSyncing, setLinkStillSyncing] = useState(false);
  const [newlyLinkedId, setNewlyLinkedId] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Manual account modal state
  const [showManualModal, setShowManualModal] = useState(false);
  const [activeType, setActiveType] = useState<AccountTypeDef | null>(null);
  const [acctName, setAcctName] = useState('');
  const [acctBalance, setAcctBalance] = useState('');
  const [acctRate, setAcctRate] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  // Banner prompt: after adding a property suggest mortgage, and vice versa
  const [linkedBanner, setLinkedBanner] = useState<
    { message: string; actionLabel: string; onAction: () => void } | null
  >(null);
  // ID of an account to cross-link with the next manual account creation
  const [pendingLinkedId, setPendingLinkedId] = useState<string | null>(null);

  // Destructive-action confirm dialogs
  const [confirmDisconnect, setConfirmDisconnect] = useState<PlaidItem | null>(null);
  const [confirmDeleteAcct, setConfirmDeleteAcct] = useState<Account | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  // Per-item / per-account sync spinners. Each holds the in-flight target id.
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  // Per-item reconnect spinner (waiting for update-mode link-token + Plaid open).
  const [reconnectingItemId, setReconnectingItemId] = useState<string | null>(null);

  const loadItems = useCallback((showLoader = true) => {
    if (showLoader) setLoading(true);
    api
      .getItems()
      .then((d) => setItems(d.items))
      .catch(() => setError('Failed to load accounts'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => loadItems(), [loadItems]);

  // Auto-open Plaid Link if navigated with ?autoLink=true (from onboarding)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autoLink') === 'true') {
      window.history.replaceState({}, '', '/accounts');
      const timer = setTimeout(() => handleLink(), 300);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLink = async () => {
    setLinking(true);
    setError('');
    setLinkStillSyncing(false);
    try {
      const [{ linkToken }] = await Promise.all([
        api.createLinkToken(),
        (await import('../lib/load-plaid.js')).loadPlaidSdk(),
      ]);

      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setError('Could not load the bank connector. Refresh and try again.');
        setLinking(false);
        return;
      }

      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken: string, metadata: PlaidMetadata) => {
          try {
            await api.exchangeToken({
              publicToken,
              institutionId: metadata.institution?.institution_id,
              institutionName: metadata.institution?.name,
            });
            // Sync runs async on the server — poll until accounts appear
            setSyncing(true);
            let attempts = 0;
            const poll = setInterval(async () => {
              attempts++;
              try {
                const data = await api.getItems();
                const newInst = data.items.find(
                  (i) => i.institutionName === metadata.institution?.name,
                );
                if (newInst && newInst.accounts.length > 0) {
                  clearInterval(poll);
                  setItems(data.items);
                  setSyncing(false);
                  setLinking(false);
                  setNewlyLinkedId(newInst.id);
                  setTimeout(() => {
                    itemRefs.current[newInst.id]?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    });
                  }, 100);
                  setTimeout(() => setNewlyLinkedId(null), 3000);
                } else if (attempts >= 10) {
                  // Poll timed out — show inline recoverable message instead
                  // of silently leaving the user wondering whether it worked.
                  clearInterval(poll);
                  setItems(data.items);
                  setSyncing(false);
                  setLinking(false);
                  setLinkStillSyncing(true);
                }
              } catch {
                if (attempts >= 10) {
                  clearInterval(poll);
                  setSyncing(false);
                  setLinking(false);
                  setLinkStillSyncing(true);
                }
              }
            }, 2000);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to link account');
            setLinking(false);
          }
        },
        onExit: () => setLinking(false),
      });

      handler.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start linking');
      setLinking(false);
    }
  };

  const performDisconnect = async (id: string) => {
    setActingId(id);
    try {
      await api.deleteItem(id);
      setConfirmDisconnect(null);
      loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setActingId(null);
    }
  };

  const performDeleteManualAccount = async (id: string) => {
    setActingId(id);
    try {
      await api.deleteManualAccount(id);
      setConfirmDeleteAcct(null);
      loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setActingId(null);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setError('');
    try {
      await api.triggerSync();
      loadItems(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync accounts');
    } finally {
      setSyncing(false);
    }
  };

  /** Reconnect — opens Plaid Link in update mode for the given item so the
   *  user re-authenticates without losing the existing access_token / history.
   *  Falls back to standard Link if the update-mode endpoint fails (e.g. the
   *  item is too old to have a stored access_token). */
  const handleReconnect = async (itemId: string) => {
    setError('');
    setReconnectingItemId(itemId);
    try {
      const [{ linkToken }] = await Promise.all([
        api.createUpdateLinkToken(itemId),
        (await import('../lib/load-plaid.js')).loadPlaidSdk(),
      ]);
      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setError('Could not load the bank connector. Refresh and try again.');
        setReconnectingItemId(null);
        return;
      }
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async () => {
          // After re-auth Plaid keeps the same item_id; we just need to
          // re-sync so status flips back to "good" and balances refresh.
          try {
            await api.syncItem(itemId);
          } catch {
            // sync failures are non-fatal here — user can manually retry
          }
          setReconnectingItemId(null);
          loadItems(false);
        },
        onExit: () => setReconnectingItemId(null),
      });
      handler.open();
    } catch {
      // Update-mode unavailable (likely no access_token on this item).
      // Fall back to a fresh Link so the user at least has a path forward.
      setReconnectingItemId(null);
      handleLink();
    }
  };

  /** Sync a single Plaid item (institution). Optimistic spinner; the server
   *  runs the sync async, so we poll briefly and refresh the list. */
  const handleSyncItem = async (itemId: string) => {
    if (syncingItemId) return;
    setSyncingItemId(itemId);
    setError('');
    try {
      await api.syncItem(itemId);
      // Sync runs async — wait briefly, then refresh.
      setTimeout(() => {
        loadItems(false);
        setSyncingItemId(null);
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh that bank');
      setSyncingItemId(null);
    }
  };

  /** Sync a single account. Server syncs the whole parent item but the spinner
   *  is scoped to this row so the user gets immediate feedback on the row they
   *  tapped. */
  const handleSyncAccount = async (accountId: string) => {
    if (syncingAccountId) return;
    setSyncingAccountId(accountId);
    setError('');
    try {
      await api.syncAccount(accountId);
      setTimeout(() => {
        loadItems(false);
        setSyncingAccountId(null);
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh that account');
      setSyncingAccountId(null);
    }
  };

  const resetManualForm = () => {
    setActiveType(null);
    setAcctName('');
    setAcctBalance('');
    setAcctRate('');
  };

  const closeManualModal = useCallback(() => {
    setShowManualModal(false);
    resetManualForm();
  }, []);

  const handleAddManualAccount = async () => {
    if (!activeType || !acctName.trim()) return;
    setAddingAccount(true);
    try {
      const balance = acctBalance ? parseFloat(acctBalance) : 0;
      const metadata =
        activeType.isDebt && acctRate ? { interestRate: parseFloat(acctRate) } : undefined;
      const result = await api.createManualAccount({
        name: acctName.trim(),
        type: activeType.type,
        subtype: activeType.subtype,
        balance,
        metadata,
        linkedAccountId: pendingLinkedId || undefined,
      });

      const justAdded = activeType;
      const createdId = result.account.id;
      resetManualForm();
      setPendingLinkedId(null);
      setShowManualModal(false);
      loadItems();

      // Show banner suggesting linked account
      if (justAdded.type === 'real_estate') {
        setLinkedBanner({
          message: 'Have a mortgage on this property?',
          actionLabel: 'Add Mortgage',
          onAction: () => {
            setLinkedBanner(null);
            setPendingLinkedId(createdId);
            const mortgage = ALL_ACCOUNT_TYPES.find((at) => at.subtype === 'mortgage')!;
            setActiveType(mortgage);
            setAcctName(mortgage.label);
            setShowManualModal(true);
          },
        });
      } else if (justAdded.subtype === 'mortgage') {
        setLinkedBanner({
          message: 'Want to add the property for this mortgage?',
          actionLabel: 'Add Property',
          onAction: () => {
            setLinkedBanner(null);
            setPendingLinkedId(createdId);
            setShowManualModal(true);
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add account');
    } finally {
      setAddingAccount(false);
    }
  };

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  const allAccounts = items.flatMap((i) => i.accounts);
  const totalAccounts = allAccounts.length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SimpleShell title="Accounts" showBack>
      {/* ── Page summary (title lives in the top bar) ── */}
      <div className="mb-5">
        {!loading && (
          <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium">
            {items.length} institution{items.length !== 1 ? 's' : ''} · {totalAccounts} account
            {totalAccounts !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Action buttons ── */}
      {!isDemoMode && (
        <>
          <div className="flex gap-2 mb-2">
            <button
              onClick={handleLink}
              disabled={linking || syncing}
              className="flex-1 rounded-xl bg-text text-white py-3 text-sm font-medium min-h-[44px] disabled:opacity-50"
            >
              {linking ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size={14} /> Linking…
                </span>
              ) : (
                '+ Connect a bank'
              )}
            </button>
            <button
              onClick={() => setShowManualModal(true)}
              className="flex-1 rounded-xl bg-bg-elevated border border-rule text-text-secondary py-3 text-sm font-medium min-h-[44px]"
            >
              ✎ Add manual
            </button>
          </div>
          <Link
            href="/quick-import"
            className="block w-full text-center mb-5 rounded-xl bg-accent/10 border border-accent/30 text-accent py-3 text-sm font-medium min-h-[44px] hover:bg-accent/15"
          >
            ✨ Quick Import — describe your accounts in plain English
          </Link>
        </>
      )}

      {!isDemoMode && items.length > 0 && (
        // Renamed to "Refresh all" so the global scope is obvious. (Per-item
        // sync was misleading — it ran the same global endpoint.)
        <button
          onClick={handleSyncAll}
          disabled={syncing || linking}
          className="w-full mb-5 rounded-xl bg-bg-elevated border border-rule text-text-secondary py-2.5 text-xs font-medium min-h-[44px] disabled:opacity-50"
        >
          {syncing ? (
            <span className="inline-flex items-center gap-2">
              <Spinner size={13} /> Refreshing all…
            </span>
          ) : (
            '↺ Refresh all'
          )}
        </button>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-2xl bg-accent/10 border border-accent/25 text-accent text-sm flex items-center gap-2" role="alert">
          <span aria-hidden="true">⚠</span>
          {error}
        </div>
      )}

      {/* ── Link-still-syncing banner ── */}
      {linkStillSyncing && (
        <div className="mb-4 px-4 py-3 rounded-2xl bg-bg-elevated border border-rule text-sm flex items-center gap-2">
          <span className="flex-1">
            Still syncing — your bank can take a minute. Pull to refresh or try again.
          </span>
          <button
            onClick={() => {
              setLinkStillSyncing(false);
              loadItems(false);
            }}
            className="rounded-lg bg-text text-white px-3 py-1.5 text-xs font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Linked-account banner ── */}
      {linkedBanner && (
        <div className="mb-4 px-4 py-3 rounded-2xl bg-success/10 border border-success/25 text-text-secondary text-sm flex items-center gap-2">
          <span className="flex-1">{linkedBanner.message}</span>
          <button
            onClick={linkedBanner.onAction}
            className="rounded-lg bg-bg-elevated border border-rule px-3 py-1.5 text-xs font-medium"
          >
            {linkedBanner.actionLabel}
          </button>
          <button
            onClick={() => setLinkedBanner(null)}
            aria-label="Dismiss"
            className="w-8 h-8 grid place-items-center text-text-muted"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm p-10 text-center text-sm text-text-muted">
          <Spinner size={18} />
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && items.length === 0 && (
        <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm p-8 flex flex-col items-center gap-2 text-center">
          <div className="text-3xl" aria-hidden="true">⊞</div>
          <p className="text-lg font-serif font-medium">No accounts linked yet</p>
          <p className="text-sm text-text-muted">
            Connect your bank to see balances, transactions, and synced insights.
          </p>
          {!isDemoMode && (
            <div className="flex gap-2 mt-3 w-full">
              <button
                onClick={handleLink}
                disabled={linking}
                className="flex-1 rounded-xl bg-text text-white py-3 text-sm font-medium min-h-[44px] disabled:opacity-50"
              >
                {linking ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size={13} /> Linking…
                  </span>
                ) : (
                  '+ Connect a bank'
                )}
              </button>
              <button
                onClick={() => setShowManualModal(true)}
                className="flex-1 rounded-xl bg-bg border border-rule text-text-secondary py-3 text-sm font-medium min-h-[44px]"
              >
                ✎ Add manual
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Institution list ── */}
      {!loading && items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const needsReconnect =
              item.status === 'item_login_required' || item.status === 'error';
            return (
              <div
                key={item.id}
                ref={(el) => {
                  itemRefs.current[item.id] = el;
                }}
                className={`rounded-2xl bg-bg-elevated border shadow-sm overflow-hidden transition-colors ${
                  newlyLinkedId === item.id ? 'border-success ring-2 ring-success/20' : 'border-rule'
                }`}
              >
                {/* Institution header — manual items show only name + delete
                    affordance per row; sync/reconnect chrome is for linked
                    banks where those concepts apply. */}
                <div className="flex items-center justify-between gap-3 p-4 border-b border-rule/60">
                  <div className="flex items-center gap-3 min-w-0">
                    <InstitutionInitial name={item.institutionName ?? '?'} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {item.institutionName ?? 'Unknown bank'}
                      </div>
                      {item.institutionId !== 'manual' && (
                        <div className="mt-0.5">
                          <StatusBadge status={item.status} lastSyncedAt={item.lastSyncedAt} />
                        </div>
                      )}
                    </div>
                  </div>

                  {!isDemoMode && item.institutionId !== 'manual' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {needsReconnect ? (
                        <button
                          onClick={() => handleReconnect(item.id)}
                          disabled={reconnectingItemId === item.id}
                          className="rounded-xl bg-text text-white px-3 h-11 text-xs font-medium disabled:opacity-50"
                        >
                          {reconnectingItemId === item.id ? 'Opening…' : 'Reconnect'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSyncItem(item.id)}
                          disabled={syncingItemId === item.id}
                          aria-label={`Refresh ${item.institutionName ?? 'this bank'}`}
                          className="w-11 h-11 grid place-items-center rounded-full hover:bg-bg disabled:opacity-50 text-text-secondary"
                        >
                          {syncingItemId === item.id ? <Spinner size={14} /> : '↻'}
                        </button>
                      )}
                      <OverflowMenu
                        status={item.status}
                        onReconnect={() => handleReconnect(item.id)}
                        onDisconnect={() => setConfirmDisconnect(item)}
                      />
                    </div>
                  )}
                </div>

                {/* Account rows */}
                {item.accounts.length === 0 && syncing && (
                  <div className="p-4 text-sm text-text-muted flex items-center gap-2">
                    <Spinner size={14} /> Syncing accounts…
                  </div>
                )}

                {item.accounts.length === 0 && !syncing && (
                  <div className="p-4 text-sm text-text-muted">
                    {needsReconnect
                      ? 'Sign back in to your bank to keep balances current.'
                      : 'No accounts found for this institution.'}
                  </div>
                )}

                {item.accounts.length > 0 && (
                  <div>
                    {item.accounts.map((account, ai) => (
                      <AccountRow
                        key={account.id}
                        account={account}
                        isLast={ai === item.accounts.length - 1}
                        isManual={item.institutionId === 'manual'}
                        syncing={syncingAccountId === account.id}
                        onSync={
                          item.institutionId === 'manual'
                            ? undefined
                            : () => handleSyncAccount(account.id)
                        }
                        onDelete={() => setConfirmDeleteAcct(account)}
                        linkedAccountName={
                          account.metadata?.linkedAccountId
                            ? (allAccounts.find((a) => a.id === account.metadata?.linkedAccountId)
                                ?.name ?? null)
                            : null
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Trust footnote — quiet, outcome-first copy is in the buttons above */}
      {!isDemoMode && (
        <p className="text-[11px] text-text-muted text-center mt-5">
          Secure bank linking powered by Plaid · we never see your bank password
        </p>
      )}

      {/* Bottom safe-area padding so last institution clears the bottom nav.
          Bottom nav is ~57px tall + 16px breathing room. */}
      <div className="h-20" aria-hidden="true" />

      {/* ── Manual account modal ── */}
      {showManualModal && (
        <ManualAccountModal
          activeType={activeType}
          onPickType={(t) => {
            setActiveType(t);
            setAcctName(t.label);
            setAcctBalance('');
            setAcctRate('');
          }}
          onChangeType={resetManualForm}
          acctName={acctName}
          setAcctName={setAcctName}
          acctBalance={acctBalance}
          setAcctBalance={setAcctBalance}
          acctRate={acctRate}
          setAcctRate={setAcctRate}
          adding={addingAccount}
          onSubmit={handleAddManualAccount}
          onClose={closeManualModal}
          onSwitchToLinkBank={() => {
            closeManualModal();
            handleLink();
          }}
        />
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmDisconnect !== null}
        title="Disconnect this bank?"
        message={`Lasagna will stop syncing balances and transactions from ${
          confirmDisconnect?.institutionName ?? 'this institution'
        }. You can reconnect anytime.`}
        confirmLabel="Disconnect"
        destructive
        busy={actingId === confirmDisconnect?.id}
        onCancel={() => setConfirmDisconnect(null)}
        onConfirm={() => {
          if (confirmDisconnect) void performDisconnect(confirmDisconnect.id);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteAcct !== null}
        title="Delete this account?"
        message={`"${
          confirmDeleteAcct?.name ?? 'This account'
        }" will be removed from your net worth and debt views. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={actingId === confirmDeleteAcct?.id}
        onCancel={() => setConfirmDeleteAcct(null)}
        onConfirm={() => {
          if (confirmDeleteAcct) void performDeleteManualAccount(confirmDeleteAcct.id);
        }}
      />
    </SimpleShell>
  );
}

// ---------------------------------------------------------------------------
// Manual account modal — extracted for focus trap + cleaner JSX
// ---------------------------------------------------------------------------

function ManualAccountModal({
  activeType,
  onPickType,
  onChangeType,
  acctName,
  setAcctName,
  acctBalance,
  setAcctBalance,
  acctRate,
  setAcctRate,
  adding,
  onSubmit,
  onClose,
  onSwitchToLinkBank,
}: {
  activeType: AccountTypeDef | null;
  onPickType: (t: AccountTypeDef) => void;
  onChangeType: () => void;
  acctName: string;
  setAcctName: (v: string) => void;
  acctBalance: string;
  setAcctBalance: (v: string) => void;
  acctRate: string;
  setAcctRate: (v: string) => void;
  adding: boolean;
  onSubmit: () => void;
  onClose: () => void;
  onSwitchToLinkBank: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const nameId = useId();
  const balanceId = useId();
  const rateId = useId();

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement;
    return () => previouslyFocused.current?.focus?.();
  }, []);

  // Escape to close + Tab focus trap
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!adding) onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [adding, onClose]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !adding) onClose();
      }}
      role="presentation"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/45 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md bg-bg-elevated border border-rule rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-rule/60">
          <span id={titleId} className="text-lg font-serif font-medium">
            Add manual account
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center text-text-muted text-lg"
          >
            ✕
          </button>
        </div>

        <div className="p-4 max-h-[70vh] overflow-y-auto">
          {/* Tip lives ABOVE the picker so it isn't hidden behind the form. */}
          {!activeType && (
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-bg border border-rule text-xs text-text-secondary flex items-start gap-2">
              <span className="flex-1">
                Manual balances are a snapshot. Have a real bank for this account?
              </span>
              <button
                onClick={onSwitchToLinkBank}
                className="text-accent font-medium whitespace-nowrap"
              >
                Connect bank →
              </button>
            </div>
          )}

          {activeType ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xl" aria-hidden="true">{activeType.emoji}</span>
                <span className="text-sm font-medium">{activeType.label}</span>
                <button
                  onClick={onChangeType}
                  className="ml-auto text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium"
                >
                  Change type
                </button>
              </div>

              <label
                htmlFor={nameId}
                className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium"
              >
                Account name
              </label>
              <input
                id={nameId}
                type="text"
                value={acctName}
                onChange={(e) => setAcctName(e.target.value)}
                autoFocus
                className="w-full rounded-lg bg-bg border border-rule px-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 min-h-[44px]"
              />

              <label
                htmlFor={balanceId}
                className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium"
              >
                {activeType.type === 'real_estate' ? 'Estimated value' : 'Balance'}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                  $
                </span>
                <input
                  id={balanceId}
                  type="text"
                  inputMode="decimal"
                  value={acctBalance}
                  onChange={(e) => setAcctBalance(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  className="w-full rounded-lg bg-bg border border-rule pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 min-h-[44px]"
                />
              </div>

              {activeType.isDebt && (
                <>
                  <label
                    htmlFor={rateId}
                    className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium"
                  >
                    Interest rate
                  </label>
                  <div className="relative">
                    <input
                      id={rateId}
                      type="number"
                      min={0}
                      max={40}
                      step={0.1}
                      value={acctRate}
                      onChange={(e) => setAcctRate(e.target.value)}
                      placeholder="5.5"
                      className="w-full rounded-lg bg-bg border border-rule pl-3 pr-7 py-2.5 text-sm focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 min-h-[44px]"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                      %
                    </span>
                  </div>
                </>
              )}

              <button
                onClick={onSubmit}
                disabled={!acctName.trim() || adding}
                className="w-full rounded-xl bg-text text-white py-3 text-sm font-medium min-h-[44px] disabled:opacity-50 mt-2"
              >
                {adding ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size={13} /> Adding…
                  </span>
                ) : (
                  '+ Add account'
                )}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {ACCOUNT_TYPE_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mb-2">
                    {group.title}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.items.map((at) => (
                      <button
                        key={at.label}
                        onClick={() => onPickType(at)}
                        className="flex items-center gap-2 p-3 rounded-xl border border-rule bg-bg text-left text-sm font-medium text-text-secondary hover:bg-bg-elevated transition min-h-[44px]"
                      >
                        <span className="text-lg" aria-hidden="true">{at.emoji}</span>
                        {at.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account row sub-component
// ---------------------------------------------------------------------------

function AccountRow({
  account,
  isLast,
  isManual,
  syncing,
  onSync,
  onDelete,
  linkedAccountName,
}: {
  account: Account;
  isLast: boolean;
  isManual: boolean;
  syncing: boolean;
  onSync?: () => void;
  onDelete: () => void;
  linkedAccountName: string | null;
}) {
  const balance = account.balance !== null ? parseFloat(account.balance) : null;
  const isNegative = balance !== null && balance < 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`flex items-center gap-3 p-4 ${
        isLast ? '' : 'border-b border-rule/60'
      }`}
    >
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`text-sm font-medium text-left w-full ${
            expanded ? 'whitespace-normal break-words' : 'truncate'
          }`}
          title={expanded ? 'Tap to collapse' : account.name}
        >
          {account.name}
          {account.mask && (
            <span className="text-text-muted font-normal ml-1.5">••{account.mask}</span>
          )}
        </button>
        {linkedAccountName && (
          <div className="text-[11px] text-text-muted mt-0.5">
            linked to {linkedAccountName}
          </div>
        )}
        <div className="mt-1">
          <TypePill type={account.type} subtype={account.subtype} />
        </div>
      </div>

      <span
        className={`text-sm font-medium tabular-nums min-w-[90px] text-right shrink-0 ${
          isNegative ? 'text-accent' : 'text-text'
        }`}
      >
        {balance !== null ? formatCurrency(account.balance!, account.currency) : '—'}
      </span>

      {isManual ? (
        <button
          onClick={onDelete}
          aria-label={`Delete ${account.name}`}
          className="w-9 h-9 grid place-items-center text-text-muted hover:text-accent shrink-0"
        >
          ✕
        </button>
      ) : (
        onSync && (
          <button
            onClick={onSync}
            disabled={syncing}
            aria-label={`Refresh ${account.name}`}
            className="w-9 h-9 grid place-items-center text-text-muted hover:text-text-secondary shrink-0 disabled:opacity-50"
          >
            {syncing ? <Spinner size={12} /> : '↻'}
          </button>
        )
      )}
    </div>
  );
}
