import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import {
  RefreshCw,
  Plus,
  Pencil,
  AlertTriangle,
  Sparkles,
  Building2,
  ChevronDown,
  MoreHorizontal,
  SlidersHorizontal,
  Trash2,
  Lock,
  X,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth";
import { useBilling, startUpgrade } from "../lib/billing";
import { cn, stripAccountMask } from "../lib/utils";
import { Button, EmptyState, Field, Input, Modal, Skeleton } from "../components/uikit";
import { useConfirm } from "../components/ds";
import { faviconUrl, institutionDomainFor } from "../components/ds/institutions";

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
  frozen?: boolean;
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
  const { tenant } = useAuth();
  const { status: billing } = useBilling();
  const isFree = tenant?.plan === "free";
  // Free + over the account cap: surface which accounts are still active
  // (the rest render as frozen).
  const overLimit = isFree && !!billing && billing.usage.accounts > billing.usage.maxAccounts;
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

  const handleUpgrade = async () => {
    setError("");
    try {
      await startUpgrade();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start upgrade");
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
    <div className="mx-auto max-w-[1040px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-24 sm:pb-28 text-content">
      {/* ── Page header ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em]">
            Accounts
          </h1>
          {!loading && captionParts.length > 0 && (
            <p className="mt-1.5 text-[14px] font-medium text-content-muted">{captionParts.join(" · ")}</p>
          )}
        </div>
        {!isDemoMode && (
          <div className="flex flex-wrap items-center gap-2.5">
            {!isFree && items.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSyncAll}
                disabled={syncing || linking}
                leadingIcon={<RefreshCw size={15} className={syncing ? "animate-spin" : ""} />}
              >
                {syncing ? "Syncing…" : "Sync all"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowManualModal(true)}
              leadingIcon={<Pencil size={15} />}
            >
              Add manual
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleLink}
              disabled={linking || syncing}
              loading={linking}
              leadingIcon={<Plus size={15} />}
            >
              {linking ? "Connecting…" : "Connect a bank"}
            </Button>
          </div>
        )}
      </header>

      {/* Plan usage — over the cap, surface "M of N syncing" (the rest are
          frozen) instead of the confusing "22 of 3 used"; otherwise the plain
          "N of M accounts used" with an upgrade nudge as the cap approaches. */}
      {billing && (
        <p className="mt-3 text-[12.5px] font-medium text-content-muted">
          {overLimit ? (
            <>
              <span className="font-bold text-negative ui-tnum">
                {billing.usage.maxAccounts} of {billing.usage.accounts}
              </span>{" "}
              accounts syncing on Free
            </>
          ) : (
            <>
              <span className="font-bold text-content ui-tnum">
                {billing.usage.accounts} of {billing.usage.maxAccounts}
              </span>{" "}
              accounts used
            </>
          )}
          {isFree && billing.usage.accounts >= billing.usage.maxAccounts && (
            <>
              {" · "}
              <button
                type="button"
                className="ui-focus rounded-ui-sm font-semibold text-[rgb(var(--ui-brand-ink))] underline underline-offset-2 hover:opacity-80"
                onClick={handleUpgrade}
              >
                {overLimit ? "Upgrade to sync all" : "Upgrade for more"}
              </button>
            </>
          )}
        </p>
      )}

      {/* Quick Import CTA */}
      <Link
        href="/quick-import"
        className="group mt-5 flex items-center gap-3 rounded-ui-lg border border-line bg-panel shadow-ui-sm px-4 py-3 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md hover:border-line-strong min-h-touch"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-brand">
          <Sparkles size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">Quick import</span>
          <span className="block truncate text-[13.5px] font-bold text-content">Describe your accounts in plain English</span>
        </span>
        <span className="text-content-muted transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true">→</span>
      </Link>

      {/* Error banner */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 flex items-center gap-2.5 rounded-ui-md border border-negative/30 bg-negative-soft px-4 py-3 text-[14px] font-medium text-negative"
        >
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">{error}</span>
        </motion.div>
      )}

      {/* Linked-suggestion banner */}
      {linkedBanner && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 flex items-center gap-2.5 rounded-ui-md border border-line bg-brand-soft px-4 py-3 text-[14px] font-medium text-content"
        >
          <span className="flex-1">{linkedBanner.message}</span>
          <Button variant="ghost" size="sm" onClick={linkedBanner.onAction}>
            {linkedBanner.actionLabel}
          </Button>
          <button
            type="button"
            onClick={() => setLinkedBanner(null)}
            aria-label="Dismiss"
            className="ui-focus grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm text-content-muted hover:bg-canvas-sunken hover:text-content"
          >
            <X size={15} />
          </button>
        </motion.div>
      )}

      {/* Loading skeleton — mirror the institution card outline. */}
      {loading && (
        <div className="mt-6 space-y-[18px]" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-ui-xl border border-line bg-panel shadow-ui-sm">
              <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
                <Skeleton className="h-4 w-4 rounded-[4px]" />
                <Skeleton className="h-10 w-10 rounded-ui-md" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="mt-7">
          <EmptyState
            icon={<Building2 size={24} />}
            title="No accounts linked yet"
            description="Connect your bank to see balances, transactions, and synced insights."
            action={!isDemoMode ? (
              <div className="flex flex-wrap justify-center gap-2.5">
                <Button variant="primary" onClick={handleLink} disabled={linking} loading={linking} leadingIcon={<Plus size={15} />}>
                  {linking ? "Connecting…" : "Connect a bank"}
                </Button>
                <Button variant="secondary" onClick={() => setShowManualModal(true)} leadingIcon={<Pencil size={15} />}>
                  Add manual
                </Button>
              </div>
            ) : undefined}
          />
        </div>
      )}

      {/* Linked institutions */}
      {!loading && linkedItems.length > 0 && (
        <section className="mt-9">
          <SectionHeader title="Connected institutions" meta={`${linkedItems.length} linked`} />
          <div className="mt-4 space-y-[18px]">
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
                isFree={isFree}
                overLimit={overLimit}
                onUpgrade={handleUpgrade}
              />
            ))}
          </div>
        </section>
      )}

      {/* Manual accounts */}
      {!loading && manualAccounts.length > 0 && (
        <section className="mt-9">
          <SectionHeader title="Manual accounts" meta={`${manualAccounts.length} tracked`} />
          <div className="mt-4 space-y-[18px]">
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
                isFree={isFree}
                overLimit={overLimit}
                onUpgrade={handleUpgrade}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Manual Account Modal ── */}
      <Modal
        open={showManualModal}
        onClose={() => { setShowManualModal(false); resetManualForm(); }}
        title={activeType ? activeType.label : "Add an account"}
        description="Manual balances are a snapshot — link accounts for automatic updates."
        footer={activeType ? (
          <>
            <Button variant="ghost" onClick={() => { setShowManualModal(false); resetManualForm(); }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAddManualAccount}
              disabled={!acctName.trim() || addingAccount}
              loading={addingAccount}
              leadingIcon={<Plus size={15} />}
            >
              {addingAccount ? "Adding…" : "Add account"}
            </Button>
          </>
        ) : undefined}
      >
        {activeType ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-sunken px-2.5 py-1 text-[12px] font-semibold text-content-secondary">
                <span>{activeType.emoji}</span> {activeType.label}
              </span>
              <button
                type="button"
                onClick={resetManualForm}
                className="ui-focus ml-auto rounded-ui-sm text-[13px] font-semibold text-[rgb(var(--ui-brand-ink))] hover:opacity-80"
              >
                change type
              </button>
            </div>

            <Field label="Account name">
              <Input
                type="text"
                value={acctName}
                onChange={(e) => setAcctName(e.target.value)}
                autoFocus
              />
            </Field>

            <Field label={activeType.type === "real_estate" ? "Estimated value" : "Balance"}>
              <Input
                type="text"
                inputMode="decimal"
                value={acctBalance}
                onChange={(e) => setAcctBalance(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                className="ui-tnum"
                leadingIcon={<span className="text-[13px]">$</span>}
              />
            </Field>

            {activeType.isDebt && (
              <Field label="Interest rate">
                <Input
                  type="number"
                  min={0}
                  max={40}
                  step={0.1}
                  value={acctRate}
                  onChange={(e) => setAcctRate(e.target.value)}
                  placeholder="5.5"
                  className="ui-tnum"
                />
              </Field>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {ACCOUNT_TYPES.map((at) => (
              <button
                key={at.label}
                type="button"
                onClick={() => { setActiveType(at); setAcctName(at.label); setAcctBalance(""); setAcctRate(""); }}
                className="ui-focus group flex min-h-touch items-center gap-3 rounded-ui-md border border-line bg-panel px-3.5 py-3 text-left text-[13.5px] font-semibold text-content-secondary transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-ui-sm"
              >
                <span className="text-[16px] leading-none">{at.emoji}</span>
                <span className="leading-tight text-content">{at.label}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header — brand dot + tracked label + right-aligned count
// ---------------------------------------------------------------------------

function SectionHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span
          className="h-[7px] w-[7px] shrink-0 rounded-full bg-brand"
          style={{ boxShadow: "0 0 0 4px var(--ui-brand-soft)" }}
          aria-hidden
        />
        <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">{title}</span>
      </div>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">{meta}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Institution icon — favicon with monogram fallback
// ---------------------------------------------------------------------------

function InstIcon({ institution, isManual, size = 40 }: { institution: string; isManual: boolean; size?: number }) {
  const url = isManual ? null : faviconUrl(institutionDomainFor(institution), 64);
  const mono = (institution || "?").trim().charAt(0).toUpperCase();
  const [err, setErr] = useState(false);
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-ui-md border border-line bg-canvas-sunken text-[13px] font-bold text-content-secondary"
      style={{ width: size, height: size }}
    >
      {url && !err ? (
        <img src={url} alt="" style={{ width: size * 0.6, height: size * 0.6 }} className="rounded-[5px]" onError={() => setErr(true)} />
      ) : (
        mono
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Institution card — collapsible header over nested account rows
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
  isFree,
  overLimit,
  onUpgrade,
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
  isFree: boolean;
  overLimit: boolean;
  onUpgrade: () => void;
}) {
  const isError = item.status === "error" || item.status === "item_login_required";
  const statusLabel = isManual
    ? "Manual"
    : isError
    ? "Needs re-auth"
    : item.lastSyncedAt
    ? `Synced ${formatRelativeTime(item.lastSyncedAt)}`
    : "Synced";

  const institutionName = item.institutionName ?? (isManual ? "Manual" : "Unknown Bank");
  // Net total across the institution (debts reduce; depository/investment increase)
  const total = item.accounts.reduce((sum, a) => {
    if (a.balance === null) return sum;
    const v = parseFloat(a.balance);
    if (Number.isNaN(v)) return sum;
    if (a.type === "credit" || a.type === "loan") return sum - v;
    return sum + v;
  }, 0);
  const totalNeg = total < 0;

  return (
    <motion.article
      ref={(el) => refCallback(el as HTMLElement | null)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "overflow-hidden rounded-ui-xl border bg-panel shadow-ui-sm transition-colors",
        isHighlighted ? "border-brand" : "border-line",
      )}
      style={isHighlighted ? { background: "var(--ui-brand-softer)" } : undefined}
    >
      {/* Header row — clickable to expand. div role=button so the sync
          icon-button inside stays a proper <button> without nesting. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
        }}
        aria-expanded={expanded}
        className={cn(
          "ui-focus flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-brand-softer sm:px-5",
          expanded && "border-b border-line",
        )}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center text-content-faint">
          <ChevronDown size={18} className={cn("transition-transform duration-200 ease-ui", !expanded && "-rotate-90")} />
        </span>
        <InstIcon institution={institutionName} isManual={isManual} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-editorial text-[17px] font-bold leading-tight tracking-[-0.01em]" title={institutionName}>
            {institutionName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-content-muted">
            <span className={cn("font-semibold", isError && "text-caution")}>{statusLabel}</span>
            <span className="text-content-faint">·</span>
            <span>{item.accounts.length} account{item.accounts.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <span className={cn("shrink-0 font-editorial text-[16px] font-extrabold tracking-[-0.015em] ui-tnum", totalNeg && "text-negative")}>
          {totalNeg ? "−" : ""}{formatTotal(Math.abs(total))}
        </span>
        {!isDemoMode && !isManual && !isFree && (
          <button
            type="button"
            aria-label={`Sync ${institutionName}`}
            onClick={(e) => { e.stopPropagation(); onSync(); }}
            disabled={syncing}
            className="ui-focus grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content disabled:opacity-50"
          >
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div>
          {item.accounts.length === 0 && showSyncSpinner && (
            <div className="flex items-center gap-2 px-4 py-4 text-[13.5px] text-content-muted sm:px-5">
              <RefreshCw size={14} className="animate-spin" /> Syncing accounts…
            </div>
          )}
          {item.accounts.length === 0 && !showSyncSpinner && !isManual && (
            <div className="px-4 py-4 text-[13.5px] text-content-muted sm:px-5">No accounts found for this institution.</div>
          )}
          {item.accounts.length > 0 && (
            <div>
              {item.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  isManual={isManual}
                  isFree={isFree}
                  overLimit={overLimit}
                  onUpgrade={onUpgrade}
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
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={onDisconnect}
                className="ui-focus inline-flex min-h-touch items-center gap-1.5 rounded-ui-sm px-2.5 text-[13px] font-semibold text-negative transition-colors hover:bg-negative-soft"
              >
                <X size={14} />
                Disconnect this institution
              </button>
            </div>
          )}
        </div>
      )}
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Account row
// ---------------------------------------------------------------------------

function AccountRow({ account, isManual, isFree, overLimit, onUpgrade, onDelete, onRefresh, linkedAccountName }: {
  account: Account; isManual: boolean; isFree: boolean; overLimit: boolean; onUpgrade: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  linkedAccountName: string | null;
}) {
  const balance = account.balance !== null ? parseFloat(account.balance) : null;
  const isNegative = balance !== null && balance < 0;
  const isFrozen = account.frozen === true;
  const [, setLocation] = useLocation();
  const [syncing, setSyncing] = useState(false);
  const openSettings = () => setLocation("/accounts/" + account.id);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Edit ${account.name}`}
      onClick={openSettings}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSettings(); } }}
      className={cn(
        "ui-focus group flex cursor-pointer items-center gap-3.5 border-t border-line px-4 py-3 transition-colors first:border-t-0 hover:bg-brand-softer sm:px-5",
        isFrozen && "opacity-70",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isFrozen && <Lock size={12} className="shrink-0 text-content-muted" />}
          <span className="truncate text-[14.5px] font-bold leading-tight" title={stripAccountMask(account.name, account.mask)}>
            {stripAccountMask(account.name, account.mask)}
          </span>
          {account.mask && (
            <span className="shrink-0 text-[12px] text-content-muted ui-tnum" aria-label={`account ending ${account.mask}`}>
              ····{account.mask}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-content-muted">
          <span>{getAccountTypeLabel(account.type, account.subtype)}</span>
          {linkedAccountName && (
            <>
              <span className="text-content-faint">·</span>
              <span>linked to {linkedAccountName}</span>
            </>
          )}
          {isFrozen ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info">
                <Lock size={10} strokeWidth={2.2} aria-hidden="true" /> Frozen
              </span>
              <button
                type="button"
                className="ui-focus rounded-ui-sm font-semibold text-[rgb(var(--ui-brand-ink))] underline underline-offset-2 hover:opacity-80"
                onClick={(e) => { e.stopPropagation(); onUpgrade(); }}
              >
                Upgrade to sync
              </button>
            </>
          ) : overLimit ? (
            <span className="inline-flex items-center rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-bold text-positive">
              Active
            </span>
          ) : null}
        </div>
      </div>

      <span className={cn("shrink-0 text-right font-editorial text-[15px] font-extrabold tracking-[-0.015em] ui-tnum", isNegative && "text-negative")}>
        {balance !== null
          ? (isNegative ? "−" : "") + formatCurrency(String(Math.abs(balance)), account.currency)
          : "—"}
      </span>

      <RowMenu
        onSettings={openSettings}
        onSync={isManual || isFree ? undefined : async () => {
          setSyncing(true);
          try { await api.syncAccount(account.id); await onRefresh(); }
          finally { setSyncing(false); }
        }}
        syncing={syncing}
        onDelete={isManual ? onDelete : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-row overflow menu — settings / sync / remove. Destructive is red text.
// ---------------------------------------------------------------------------

function RowMenu({
  onSettings, onSync, onDelete, syncing,
}: {
  onSettings: () => void;
  onSync?: () => void;
  onDelete?: () => void;
  syncing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const run = (fn?: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); setOpen(false); fn?.(); };

  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Account actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="ui-focus grid h-9 w-9 place-items-center rounded-ui-sm text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className="animate-scale-in absolute right-0 top-[calc(100%+6px)] z-30 w-52 origin-top-right rounded-ui-md border border-line-strong bg-panel-raised p-1.5 shadow-ui-lg"
        >
          <MenuItem icon={<SlidersHorizontal size={16} />} onClick={run(onSettings)}>Account settings</MenuItem>
          {onSync && (
            <MenuItem icon={<RefreshCw size={16} className={syncing ? "animate-spin" : ""} />} onClick={run(onSync)}>
              {syncing ? "Syncing…" : "Sync now"}
            </MenuItem>
          )}
          {onDelete && (
            <>
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<Trash2 size={16} />} danger onClick={run(onDelete)}>Remove account</MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon, children, onClick, danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "ui-focus flex w-full items-center gap-2.5 rounded-ui-sm px-2.5 py-2 text-left text-[13.5px] font-medium transition-colors",
        danger
          ? "text-negative hover:bg-negative-soft"
          : "text-content-secondary hover:bg-canvas-sunken hover:text-content",
      )}
    >
      <span className="shrink-0">{icon}</span>
      {children}
    </button>
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
