import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";
import {
  RefreshCw,
  X,
  Plus,
  Pencil,
  AlertTriangle,
  Sparkles,
  Building2,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import {
  Page,
  Section,
  Button,
  Pill,
  Eyebrow,
  EmptyState,
  useConfirm,
  RowMenu,
} from "../components/ds";
import { api } from "../lib/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: string, currency: string): string {
  const num = parseFloat(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatTotal(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getAccountTypeLabel(type: string, subtype: string | null): string {
  const sub = subtype ?? type;
  return sub.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  excludeFromNetWorth?: boolean;
  excludeTransactions?: boolean;
  invertBalance?: boolean;
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
// Spinner
// ---------------------------------------------------------------------------

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2}
      strokeLinecap="round"
      style={{ animation: "lf-spin 0.8s linear infinite" }}
    >
      <style>{`@keyframes lf-spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Manual account types
// ---------------------------------------------------------------------------

interface AccountTypeDef {
  label: string;
  emoji: string;
  type: string;
  subtype?: string;
  isDebt: boolean;
}

const ACCOUNT_TYPES: AccountTypeDef[] = [
  { label: "Checking / Savings", emoji: "💵", type: "depository", isDebt: false },
  { label: "401(k) / 403(b)", emoji: "📈", type: "investment", subtype: "401k", isDebt: false },
  { label: "Roth IRA", emoji: "🌱", type: "investment", subtype: "roth_ira", isDebt: false },
  { label: "Traditional IRA", emoji: "📊", type: "investment", subtype: "ira", isDebt: false },
  { label: "Brokerage", emoji: "💼", type: "investment", subtype: "brokerage", isDebt: false },
  { label: "HSA", emoji: "🏥", type: "investment", subtype: "hsa", isDebt: false },
  { label: "Primary Residence", emoji: "🏡", type: "real_estate", subtype: "primary", isDebt: false },
  { label: "Rental Property", emoji: "🏢", type: "real_estate", subtype: "rental", isDebt: false },
  { label: "Credit Card", emoji: "💳", type: "credit", isDebt: true },
  { label: "Student Loan", emoji: "🎓", type: "loan", subtype: "student", isDebt: true },
  { label: "Auto Loan", emoji: "🚗", type: "loan", subtype: "auto", isDebt: true },
  { label: "Mortgage", emoji: "🏠", type: "loan", subtype: "mortgage", isDebt: true },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Accounts() {
  const confirm = useConfirm();
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newlyLinkedId, setNewlyLinkedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  // Manual account modal state
  const [showManualModal, setShowManualModal] = useState(false);
  const [activeType, setActiveType] = useState<AccountTypeDef | null>(null);
  const [acctName, setAcctName] = useState("");
  const [acctBalance, setAcctBalance] = useState("");
  const [acctRate, setAcctRate] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [linkedBanner, setLinkedBanner] = useState<{ message: string; actionLabel: string; onAction: () => void } | null>(null);
  const [pendingLinkedId, setPendingLinkedId] = useState<string | null>(null);
  // Iter 8 P1: mobile overflow menu state for the page-bar actions.
  // <520px collapses Sync all + Add manual into a "···" sheet so Connect a
  // bank (primary) stays inline. Sheet closes on click-outside / Escape.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    const onClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  const loadItems = (showLoader = true) => {
    if (showLoader) setLoading(true);
    api.getItems()
      .then((d) => setItems(d.items))
      .catch(() => setError("Failed to load accounts"))
      .finally(() => setLoading(false));
  };

  useEffect(() => loadItems(), []);

  // Auto-open Plaid Link if navigated with ?autoLink=true
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoLink") === "true") {
      window.history.replaceState({}, "", "/accounts");
      const timer = setTimeout(() => handleLink(), 300);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand on highlight (newly linked)
  useEffect(() => {
    if (newlyLinkedId) {
      setExpandedIds((prev) => new Set(prev).add(newlyLinkedId));
    }
  }, [newlyLinkedId]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLink = async () => {
    setLinking(true);
    setError("");
    try {
      const [{ linkToken }] = await Promise.all([
        api.createLinkToken(),
        (await import("../lib/load-plaid.js")).loadPlaidSdk(),
      ]);

      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setError("Failed to load Plaid. Please refresh and try again.");
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
            setSyncing(true);
            let attempts = 0;
            const poll = setInterval(async () => {
              attempts++;
              try {
                const data = await api.getItems();
                const newInst = data.items.find(
                  (i) => i.institutionName === metadata.institution?.name
                );
                if ((newInst && newInst.accounts.length > 0) || attempts >= 10) {
                  clearInterval(poll);
                  setItems(data.items);
                  setSyncing(false);
                  setLinking(false);

                  if (newInst) {
                    setNewlyLinkedId(newInst.id);
                    setTimeout(() => {
                      itemRefs.current[newInst.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 100);
                    setTimeout(() => setNewlyLinkedId(null), 3000);
                  }
                }
              } catch {
                clearInterval(poll);
                setSyncing(false);
                setLinking(false);
              }
            }, 2000);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to link account");
            setLinking(false);
          }
        },
        onExit: () => setLinking(false),
      });

      handler.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start linking");
      setLinking(false);
    }
  };

  const handleDelete = async (id: string, institutionName: string) => {
    const ok = await confirm({
      title: `Disconnect ${institutionName}?`,
      body: 'All linked accounts and their transaction history will be removed. You can reconnect later, but transactions before today will need to be re-synced.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    await api.deleteItem(id);
    loadItems();
  };

  const handleDeleteAccount = async (id: string, accountName: string) => {
    const ok = await confirm({
      title: `Remove ${accountName}?`,
      body: 'This account and its current balance will be deleted. Historical snapshots are kept.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteManualAccount(id);
      loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setError("");
    try {
      await api.triggerSync();
      loadItems(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync accounts");
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncItem = async (id: string) => {
    setSyncingItemId(id);
    try {
      // DATA-NEEDED: per-item sync endpoint; falling back to full sync
      await api.triggerSync();
      loadItems(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncingItemId(null);
    }
  };

  const resetManualForm = () => {
    setActiveType(null);
    setAcctName("");
    setAcctBalance("");
    setAcctRate("");
  };

  const handleAddManualAccount = async () => {
    if (!activeType || !acctName.trim()) return;
    setAddingAccount(true);
    try {
      const balance = acctBalance ? parseFloat(acctBalance) : 0;
      const metadata = activeType.isDebt && acctRate
        ? { interestRate: parseFloat(acctRate) }
        : undefined;
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

      if (justAdded.type === "real_estate") {
        setLinkedBanner({
          message: "Have a mortgage on this property?",
          actionLabel: "Add Mortgage",
          onAction: () => {
            setLinkedBanner(null);
            setPendingLinkedId(createdId);
            const mortgage = ACCOUNT_TYPES.find((at) => at.subtype === "mortgage")!;
            setActiveType(mortgage);
            setAcctName(mortgage.label);
            setShowManualModal(true);
          },
        });
      } else if (justAdded.subtype === "mortgage") {
        setLinkedBanner({
          message: "Want to add the property for this mortgage?",
          actionLabel: "Add Property",
          onAction: () => {
            setLinkedBanner(null);
            setPendingLinkedId(createdId);
            setShowManualModal(true);
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add account");
    } finally {
      setAddingAccount(false);
    }
  };

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

  const allAccounts = items.flatMap((i) => i.accounts);
  const totalAccounts = allAccounts.length;

  // Total tracked = sum of absolute balances across all accounts (a soft "scope" figure)
  const totalTracked = allAccounts.reduce((sum, a) => {
    const v = a.balance !== null ? parseFloat(a.balance) : 0;
    return sum + (Number.isNaN(v) ? 0 : Math.abs(v));
  }, 0);

  const linkedItems = items.filter((i) => i.institutionId !== "manual");
  const manualItems = items.filter((i) => i.institutionId === "manual");
  const manualAccounts = manualItems.flatMap((i) => i.accounts);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Iter 7 A: compact ds-page-bar replaces the serif PageHeader + editorial
  // Lede. Caption inline carries the "N institutions · M accounts · total"
  // line that the Lede block used to own.
  const lastSync = items
    .map((i) => i.lastSyncedAt)
    .filter((v): v is string => !!v)
    .sort()
    .pop();
  const captionParts: string[] = [];
  if (items.length > 0) captionParts.push(`${items.length} institution${items.length !== 1 ? "s" : ""}`);
  if (totalAccounts > 0) captionParts.push(`${totalAccounts} account${totalAccounts !== 1 ? "s" : ""}`);
  if (totalTracked > 0) captionParts.push(formatTotal(totalTracked));
  if (lastSync) captionParts.push(`last sync ${formatRelativeTime(lastSync)}`);

  return (
    <Page>
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Accounts</h1>
          {!loading && captionParts.length > 0 && (
            <span className="ds-page-bar__caption">{captionParts.join(' · ')}</span>
          )}
        </div>
        {!isDemoMode && (
          <span className="ds-page-bar__actions ds-accounts-header-actions">
            {/* Primary action stays inline on every breakpoint. */}
            <Button variant="ink" size="sm" onClick={handleLink} disabled={linking || syncing} icon={linking ? <Spinner size={13} /> : <Plus size={14} />} className="ds-accounts-cta-primary">
              {linking ? "Connecting…" : "Connect a bank"}
            </Button>
            {/* Secondaries collapse into the "···" sheet at <=520px via the
                .ds-page-bar__action--overflow utility. */}
            {items.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSyncAll}
                disabled={syncing || linking}
                icon={syncing ? <Spinner size={13} /> : <RefreshCw size={14} />}
                className="ds-accounts-cta-secondary ds-page-bar__action--overflow"
              >
                {syncing ? "Syncing…" : "Sync all"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManualModal(true)}
              icon={<Pencil size={14} />}
              className="ds-accounts-cta-secondary ds-page-bar__action--overflow"
            >
              Add manual
            </Button>
            {/* Overflow trigger — only shown at <=520px via CSS. */}
            <span className="ds-page-bar__overflow" ref={overflowRef}>
              <button
                type="button"
                className="ds-page-bar__overflow-btn"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={overflowOpen}
                onClick={() => setOverflowOpen((v) => !v)}
              >
                <MoreHorizontal size={16} />
              </button>
              {overflowOpen && (
                <div className="ds-page-bar__overflow-menu" role="menu">
                  {items.length > 0 && (
                    <button
                      type="button"
                      className="ds-page-bar__overflow-item"
                      role="menuitem"
                      disabled={syncing || linking}
                      onClick={() => { setOverflowOpen(false); handleSyncAll(); }}
                    >
                      {syncing ? <Spinner size={13} /> : <RefreshCw size={14} />}
                      {syncing ? "Syncing…" : "Sync all"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ds-page-bar__overflow-item"
                    role="menuitem"
                    onClick={() => { setOverflowOpen(false); setShowManualModal(true); }}
                  >
                    <Pencil size={14} />
                    Add manual
                  </button>
                </div>
              )}
            </span>
          </span>
        )}
      </header>

      {/* Quick Import CTA — kept as a soft inline marginalia line */}
      <Link href="/quick-import" className="ds-accounts-quickimport">
        <div className="ds-accounts-quickimport__icon">
          <Sparkles size={14} />
        </div>
        <div className="ds-accounts-quickimport__body">
          <span className="ds-accounts-quickimport__eyebrow">Quick import</span>
          <span className="ds-accounts-quickimport__title">Describe your accounts in plain English</span>
        </div>
        <span className="ds-accounts-quickimport__arrow" aria-hidden="true">→</span>
      </Link>

      {/* Error banner */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="ds-accounts-banner ds-accounts-banner--error"
        >
          <AlertTriangle size={14} />
          <span style={{ flex: 1 }}>{error}</span>
        </motion.div>
      )}

      {/* Linked-suggestion banner */}
      {linkedBanner && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="ds-accounts-banner ds-accounts-banner--basil"
        >
          <span style={{ flex: 1 }}>{linkedBanner.message}</span>
          <Button variant="ghost" size="sm" onClick={linkedBanner.onAction}>
            {linkedBanner.actionLabel}
          </Button>
          <Button variant="icon" size="sm" onClick={() => setLinkedBanner(null)} aria-label="Dismiss">
            <X size={14} />
          </Button>
        </motion.div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ height: 120, background: 'var(--lf-cream)', borderRadius: 8 }} className="animate-pulse" />
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={<Building2 size={28} />}
          title="No accounts linked yet"
          body="Connect your bank to see balances, transactions, and synced insights."
          cta={!isDemoMode ? (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Button variant="primary" onClick={handleLink} disabled={linking} icon={linking ? <Spinner size={13} /> : <Plus size={14} />}>
                {linking ? "Connecting…" : "Connect a bank"}
              </Button>
              <Button variant="ghost" onClick={() => setShowManualModal(true)} icon={<Pencil size={14} />}>
                Add manual
              </Button>
            </div>
          ) : undefined}
        />
      )}

      {/* Linked institutions — editorial articles */}
      {!loading && linkedItems.length > 0 && (
        <Section
          title="Connected institutions"
          eyebrow={`${linkedItems.length} linked`}
        >
          <div className="ds-accounts-feed">
            {linkedItems.map((item) => (
              <InstitutionArticle
                key={item.id}
                refCallback={(el) => { itemRefs.current[item.id] = el; }}
                item={item}
                isManual={false}
                isHighlighted={newlyLinkedId === item.id}
                syncing={syncingItemId === item.id}
                isDemoMode={isDemoMode}
                showSyncSpinner={item.accounts.length === 0 && syncing}
                expanded={expandedIds.has(item.id)}
                onToggle={() => toggleExpand(item.id)}
                onSync={() => handleSyncItem(item.id)}
                onDisconnect={() => handleDelete(item.id, item.institutionName ?? "Unknown Bank")}
                onDeleteAccount={handleDeleteAccount}
                onRefresh={() => loadItems(false)}
                allAccounts={allAccounts}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Manual accounts — drop H2 when only one entry (single divider + caption) */}
      {!loading && manualAccounts.length > 0 && (
        manualAccounts.length === 1 ? (
          <section className="ds-section">
            <p className="ds-eyebrow ds-accounts-manual-caption">Manual · {manualAccounts.length} tracked</p>
            <div className="ds-accounts-feed">
              {manualItems.map((item) => (
                <InstitutionArticle
                  key={item.id}
                  refCallback={(el) => { itemRefs.current[item.id] = el; }}
                  item={item}
                  isManual
                  isHighlighted={false}
                  syncing={false}
                  isDemoMode={isDemoMode}
                  showSyncSpinner={false}
                  expanded={expandedIds.has(item.id)}
                  onToggle={() => toggleExpand(item.id)}
                  onSync={() => {}}
                  onDisconnect={() => handleDelete(item.id, item.institutionName ?? "Manual")}
                  onDeleteAccount={handleDeleteAccount}
                  onRefresh={() => loadItems(false)}
                  allAccounts={allAccounts}
                />
              ))}
            </div>
          </section>
        ) : (
          <Section
            title="Manual accounts"
            eyebrow={`${manualAccounts.length} tracked`}
          >
            <div className="ds-accounts-feed">
              {manualItems.map((item) => (
                <InstitutionArticle
                  key={item.id}
                  refCallback={(el) => { itemRefs.current[item.id] = el; }}
                  item={item}
                  isManual
                  isHighlighted={false}
                  syncing={false}
                  isDemoMode={isDemoMode}
                  showSyncSpinner={false}
                  expanded={expandedIds.has(item.id)}
                  onToggle={() => toggleExpand(item.id)}
                  onSync={() => {}}
                  onDisconnect={() => handleDelete(item.id, item.institutionName ?? "Manual")}
                  onDeleteAccount={handleDeleteAccount}
                  onRefresh={() => loadItems(false)}
                  allAccounts={allAccounts}
                />
              ))}
            </div>
          </Section>
        )
      )}

      {/* ── Manual Account Modal ── */}
      <AnimatePresence>
        {showManualModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) { setShowManualModal(false); resetManualForm(); } }}
            style={{
              position: "fixed", inset: 0, zIndex: 100,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 16,
              background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              style={{
                width: "100%", maxWidth: 480,
                background: "var(--lf-paper)",
                border: "1px solid var(--lf-rule)",
                borderRadius: 14, overflow: "hidden",
              }}
            >
              {/* Editorial modal header — eyebrow + serif h2 */}
              <div className="ds-accounts-modal__head">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Eyebrow>Manual account</Eyebrow>
                  <h2 className="ds-h2" style={{ marginTop: 6, fontSize: 26 }}>
                    {activeType ? activeType.label : "Add an account"}
                  </h2>
                </div>
                <Button
                  variant="icon"
                  size="sm"
                  aria-label="Close"
                  onClick={() => { setShowManualModal(false); resetManualForm(); }}
                >
                  <X size={14} />
                </Button>
              </div>

              {/* Body */}
              <div className="ds-accounts-modal__body">
                {activeType ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{ display: "flex", flexDirection: "column", gap: 18 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Pill tone="cream">{activeType.label}</Pill>
                      <button
                        type="button"
                        onClick={resetManualForm}
                        className="ds-btn ds-btn--link"
                        style={{ marginLeft: "auto" }}
                      >
                        change type
                      </button>
                    </div>

                    <div>
                      <Eyebrow>Account name</Eyebrow>
                      <input
                        type="text"
                        value={acctName}
                        onChange={(e) => setAcctName(e.target.value)}
                        autoFocus
                        className="ds-input"
                        style={{ marginTop: 8 }}
                      />
                    </div>

                    <div>
                      <Eyebrow>{activeType.type === "real_estate" ? "Estimated value" : "Balance"}</Eyebrow>
                      <div style={{ position: "relative", marginTop: 8 }}>
                        <span style={{
                          position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                          color: "var(--lf-muted)", fontSize: 14,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={acctBalance}
                          onChange={(e) => setAcctBalance(e.target.value.replace(/[^0-9.]/g, ""))}
                          placeholder="0"
                          className="ds-input ds-num"
                          style={{ paddingLeft: 28 }}
                        />
                      </div>
                    </div>

                    {activeType.isDebt && (
                      <div>
                        <Eyebrow>Interest rate</Eyebrow>
                        <div style={{ position: "relative", marginTop: 8 }}>
                          <input
                            type="number"
                            min={0}
                            max={40}
                            step={0.1}
                            value={acctRate}
                            onChange={(e) => setAcctRate(e.target.value)}
                            placeholder="5.5"
                            className="ds-input ds-num"
                            style={{ paddingRight: 32 }}
                          />
                          <span style={{
                            position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                            color: "var(--lf-muted)", fontSize: 14,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}>%</span>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                  }}>
                    {ACCOUNT_TYPES.map((at) => (
                      <button
                        key={at.label}
                        type="button"
                        onClick={() => { setActiveType(at); setAcctName(at.label); setAcctBalance(""); setAcctRate(""); }}
                        className="ds-accounts-type-tile"
                      >
                        <span className="ds-accounts-type-tile__emoji">{at.emoji}</span>
                        <span className="ds-accounts-type-tile__label">{at.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                <p className="ds-caption" style={{
                  textAlign: "center",
                  marginTop: 18, marginBottom: 0,
                }}>
                  Manual balances are a snapshot — link accounts for automatic updates.
                </p>
              </div>

              {/* Editorial modal footer — sauce primary + ghost secondary */}
              {activeType && (
                <div className="ds-accounts-modal__foot">
                  <Button variant="ghost" onClick={() => { setShowManualModal(false); resetManualForm(); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleAddManualAccount}
                    disabled={!acctName.trim() || addingAccount}
                    icon={addingAccount ? <Spinner size={13} /> : <Plus size={14} />}
                  >
                    {addingAccount ? "Adding…" : "Add account"}
                  </Button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Page-local styles */}
      <style>{`
        .ds-accounts-manual-caption {
          margin: 0 0 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--lf-rule-soft);
        }
        .ds-accounts-header-actions {
          display: inline-flex; gap: 8px; flex-wrap: nowrap;
          align-items: center;
        }
        /* Iter 8: on small screens the secondaries collapse into the
           .ds-page-bar__overflow menu (handled by the design-system primitive),
           so the page-scoped grid is no longer needed here. The primary
           "Connect a bank" stays inline next to the overflow "···" button. */
        .ds-accounts-quickimport {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 6px 0;
          margin-bottom: 24px;
          text-decoration: none; color: var(--lf-muted);
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px;
          transition: color 0.15s;
        }
        .ds-accounts-quickimport:hover { color: var(--lf-sauce); }
        .ds-accounts-quickimport__icon {
          width: 16px; height: 16px;
          display: grid; place-items: center;
          color: var(--lf-cheese);
          flex-shrink: 0;
        }
        .ds-accounts-quickimport__body {
          display: inline-flex; align-items: baseline; gap: 8px;
          min-width: 0;
        }
        .ds-accounts-quickimport__eyebrow {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 10px; letter-spacing: 0.14em;
          text-transform: uppercase; color: var(--lf-muted);
        }
        .ds-accounts-quickimport__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px; color: var(--lf-ink-soft);
        }
        .ds-accounts-quickimport__arrow {
          font-family: 'Geist', system-ui, sans-serif;
          color: var(--lf-muted);
          flex-shrink: 0;
          transition: transform 0.15s, color 0.15s;
        }
        .ds-accounts-quickimport:hover .ds-accounts-quickimport__arrow {
          color: var(--lf-sauce);
          transform: translateX(3px);
        }
        .ds-accounts-banner {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; margin-bottom: 20px;
          border-radius: 10px;
          font-family: 'Geist', system-ui, sans-serif; font-size: 13px;
        }
        .ds-accounts-banner--error {
          background: rgba(201,84,58,0.08);
          border: 1px solid rgba(201,84,58,0.25);
          color: var(--lf-sauce);
        }
        .ds-accounts-banner--basil {
          background: rgba(90,107,63,0.08);
          border: 1px solid rgba(90,107,63,0.25);
          color: var(--lf-ink);
        }
        .ds-accounts-feed { display: flex; flex-direction: column; }
        .ds-accounts-type-tile {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px; border-radius: 10px;
          border: 1px solid var(--lf-rule);
          background: var(--lf-paper);
          text-align: left; cursor: pointer;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px; color: var(--lf-ink-soft);
          font-weight: 500;
          /* uniform height for grid visual rhythm regardless of label length */
          min-height: 56px;
          transition: background 0.12s, border-color 0.12s;
        }
        .ds-accounts-type-tile:hover {
          background: var(--lf-cream);
          border-color: var(--lf-cream-deep);
        }
        .ds-accounts-type-tile__emoji { font-size: 14px; flex-shrink: 0; line-height: 1; }
        .ds-accounts-type-tile__label { text-align: left; line-height: 1.25; }
        .ds-input {
          width: 100%; padding: 10px 14px;
          background: var(--lf-paper);
          border: 1px solid var(--lf-rule);
          border-radius: 8px;
          /* 16px prevents iOS Safari auto-zoom on focus */
          font-size: 16px;
          font-family: 'Geist', system-ui, sans-serif;
          color: var(--lf-ink); outline: none;
          box-sizing: border-box;
        }
        .ds-input:focus { border-color: var(--lf-ink); }
        .ds-accounts-modal__head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 16px;
          padding: 22px 26px 20px;
          border-bottom: 1px solid var(--lf-rule);
        }
        .ds-accounts-modal__body {
          padding: 24px 26px;
          max-height: 60vh; overflow-y: auto;
        }
        .ds-accounts-modal__foot {
          display: flex; justify-content: flex-end; gap: 8px;
          padding: 16px 26px;
          border-top: 1px solid var(--lf-rule);
          background: var(--lf-paper);
        }
      `}</style>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Editorial institution article — hairline-separated, expands inline
// ---------------------------------------------------------------------------

function InstitutionArticle({
  refCallback,
  item,
  isManual,
  isHighlighted,
  syncing,
  isDemoMode,
  showSyncSpinner,
  expanded,
  onToggle,
  onSync,
  onDisconnect,
  onDeleteAccount,
  onRefresh,
  allAccounts,
}: {
  refCallback: (el: HTMLElement | null) => void;
  item: PlaidItem;
  isManual: boolean;
  isHighlighted: boolean;
  syncing: boolean;
  isDemoMode: boolean;
  showSyncSpinner: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onDeleteAccount: (id: string, name: string) => void;
  onRefresh: () => void;
  allAccounts: Account[];
}) {
  const isError = item.status === "error" || item.status === "item_login_required";
  const statusLabel = isError
    ? "needs re-auth"
    : item.lastSyncedAt
    ? `synced ${formatRelativeTime(item.lastSyncedAt)}`
    : isManual
    ? "manual"
    : "synced";

  const institutionName = item.institutionName ?? (isManual ? "Manual" : "Unknown Bank");
  // Net total across the institution (debts reduce; depository/investment increase)
  const total = item.accounts.reduce((sum, a) => {
    if (a.balance === null) return sum;
    const v = parseFloat(a.balance);
    if (Number.isNaN(v)) return sum;
    if (a.type === "credit" || a.type === "loan") return sum - v;
    return sum + v;
  }, 0);

  return (
    <motion.article
      ref={(el) => refCallback(el as HTMLElement | null)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="ds-inst"
      style={{
        background: isHighlighted ? 'rgba(90,107,63,0.06)' : undefined,
      }}
    >
      {/* Header row — clickable to expand. Rendered as a div with role=button
          (instead of <button>) so the sync icon-button inside can remain a
          proper <button> element without nesting. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
        }}
        className="ds-inst__head"
        aria-expanded={expanded}
      >
        <span className="ds-inst__head-chev">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="ds-inst__head-body">
          <div className="ds-inst__head-name">{institutionName}</div>
          <div className="ds-inst__head-meta">
            <Pill tone={isError ? "sauce" : "ghost"}>{statusLabel}</Pill>
            <span className="ds-inst__head-count">
              {item.accounts.length} account{item.accounts.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <span className="ds-inst__head-total ds-num">{formatTotal(total)}</span>
        {!isDemoMode && !isManual && (
          <span className="ds-inst__head-actions">
            <Button
              variant="icon"
              size="sm"
              aria-label={`Sync ${institutionName}`}
              onClick={(e) => { e.stopPropagation(); onSync(); }}
              disabled={syncing}
            >
              {syncing ? <Spinner size={13} /> : <RefreshCw size={14} />}
            </Button>
          </span>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="ds-inst__body">
          {item.accounts.length === 0 && showSyncSpinner && (
            <div className="ds-inst__empty">
              <Spinner size={14} /> Syncing accounts…
            </div>
          )}
          {item.accounts.length === 0 && !showSyncSpinner && !isManual && (
            <div className="ds-inst__empty">No accounts found for this institution.</div>
          )}
          {item.accounts.length > 0 && (
            <div>
              {item.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  isManual={isManual}
                  onDelete={() => onDeleteAccount(account.id, account.name)}
                  onRefresh={onRefresh}
                  linkedAccountName={account.metadata?.linkedAccountId
                    ? allAccounts.find((a) => a.id === account.metadata?.linkedAccountId)?.name ?? null
                    : null}
                />
              ))}
            </div>
          )}

          {!isDemoMode && !isManual && (
            <div className="ds-inst__danger-zone">
              <Button
                variant="ghost"
                size="sm"
                onClick={onDisconnect}
                icon={<X size={13} />}
                className="ds-inst__disconnect-btn"
              >
                Disconnect this institution
              </Button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .ds-inst {
          border-top: 1px solid var(--lf-ink);
        }
        .ds-inst:last-child { border-bottom: 1px solid var(--lf-ink); }
        .ds-inst__head {
          display: flex; align-items: center;
          gap: 12px;
          width: 100%;
          padding: 18px 0;
          background: none;
          border: 0;
          font-family: 'Geist', system-ui, sans-serif;
          color: inherit;
          cursor: pointer;
          text-align: left;
        }
        .ds-inst__head-chev {
          color: var(--lf-muted);
          flex-shrink: 0;
          display: flex;
        }
        .ds-inst__head-body { flex: 1; min-width: 0; }
        .ds-inst__head-name {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 22px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.2;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ds-inst__head-meta {
          display: flex; align-items: center; gap: 10px;
          margin-top: 4px;
          flex-wrap: wrap;
        }
        .ds-inst__head-count {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px;
          color: var(--lf-muted);
        }
        .ds-inst__head-total {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 15px; font-weight: 500;
          color: var(--lf-ink);
          flex-shrink: 0;
          min-width: 90px;
          text-align: right;
        }
        .ds-inst__head-actions {
          display: flex; gap: 4px;
          flex-shrink: 0;
        }
        .ds-inst__body {
          padding: 0 0 14px 26px;
        }
        .ds-inst__empty {
          padding: 12px 0;
          display: flex; align-items: center; gap: 8px;
          color: var(--lf-muted); font-size: 13px;
          font-family: 'Geist', system-ui, sans-serif;
        }
        .ds-inst__icon-danger:hover { color: var(--lf-sauce); border-color: rgba(201,84,58,0.4); }
        .ds-inst__danger-zone {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--lf-rule-soft);
        }
        .ds-inst__disconnect-btn {
          color: var(--lf-sauce);
          border-color: rgba(201,84,58,0.35);
        }
        .ds-inst__disconnect-btn:hover {
          color: var(--lf-sauce-deep);
          border-color: rgba(201,84,58,0.6);
        }
      `}</style>
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Account row
// ---------------------------------------------------------------------------

function AccountRow({ account, isManual, onDelete, onRefresh, linkedAccountName }: {
  account: Account; isManual: boolean; onDelete: () => void;
  onRefresh: () => void;
  linkedAccountName: string | null;
}) {
  const balance = account.balance !== null ? parseFloat(account.balance) : null;
  const isNegative = balance !== null && balance < 0;
  const [, setLocation] = useLocation();
  const [syncing, setSyncing] = useState(false);
  const openSettings = () => setLocation('/accounts/' + account.id);

  return (
    <>
    <div
      className="ds-acctrow"
      role="button"
      tabIndex={0}
      aria-label={`Edit ${account.name}`}
      onClick={openSettings}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSettings(); } }}
    >
      <div className="ds-acctrow__name">
        <span className="ds-acctrow__name-main">
          {account.name}
          {account.mask && (
            <span style={{ color: "var(--lf-muted)", fontWeight: 400, marginLeft: 6 }}>
              ••{account.mask}
            </span>
          )}
        </span>
        {linkedAccountName && (
          <span className="ds-caption" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
            linked to {linkedAccountName}
          </span>
        )}
      </div>

      <Pill tone="cream">{getAccountTypeLabel(account.type, account.subtype)}</Pill>

      <span className="ds-num" style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13, fontWeight: 500,
        color: isNegative ? "var(--lf-sauce)" : "var(--lf-ink)",
        minWidth: 90, textAlign: "right",
        flexShrink: 0,
      }}>
        {balance !== null
          ? formatCurrency(account.balance!, account.currency)
          : "—"}
      </span>

      <RowMenu
        name={account.name}
        onSettings={openSettings}
        onSync={isManual ? undefined : async () => {
          setSyncing(true);
          try { await api.syncAccount(account.id); await onRefresh(); }
          finally { setSyncing(false); }
        }}
        syncing={syncing}
        onDelete={isManual ? onDelete : undefined}
      />

      <style>{`
        .ds-acctrow {
          display: flex; align-items: center;
          padding: 8px 0;
          gap: 12px;
          border-top: 1px solid var(--lf-rule-soft);
          cursor: pointer;
          transition: background 0.12s;
        }
        .ds-acctrow:hover { background: rgba(31, 26, 22, 0.025); }
        .ds-acctrow:first-child { border-top: 0; }
        .ds-acctrow__name {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column; gap: 2px;
        }
        .ds-acctrow__name-main {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px; font-weight: 500;
          color: var(--lf-ink);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
      `}</style>
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Plaid Link types (preserved from original)
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
