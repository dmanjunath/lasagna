import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: string, currency: string): string {
  const num = parseFloat(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(num);
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
// API (preserved from original)
// ---------------------------------------------------------------------------

import { api } from "../lib/api.js";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InstitutionInitial({ name }: { name: string }) {
  const initial = (name || "?")[0].toUpperCase();
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 8,
      background: "var(--lf-ink)", color: "var(--lf-cheese)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Instrument Serif', Georgia, serif",
      fontSize: 16, fontWeight: 400, flexShrink: 0,
    }}>
      {initial}
    </div>
  );
}

function StatusBadge({ status, lastSyncedAt }: { status: string; lastSyncedAt: string | null }) {
  const isError = status === "error" || status === "item_login_required";
  const color = isError ? "var(--lf-sauce)" : "var(--lf-muted)";
  const prefix = isError ? "⚠" : "✓";
  const label = isError
    ? "needs re-auth"
    : lastSyncedAt
    ? `synced · ${formatRelativeTime(lastSyncedAt)}`
    : "synced";

  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13, color,
      letterSpacing: "0.02em",
    }}>
      {prefix} {label}
    </span>
  );
}

function TypePill({ type, subtype }: { type: string; subtype: string | null }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 20,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: "0.04em",
      background: "var(--lf-cream-deep)",
      color: "var(--lf-muted)",
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      {getAccountTypeLabel(type, subtype)}
    </span>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 14px", borderRadius: 8,
        border: "1px solid var(--lf-rule)",
        background: hovered && !disabled ? "var(--lf-cream)" : "transparent",
        color: disabled ? "var(--lf-muted)" : "var(--lf-ink)",
        fontSize: 13, fontFamily: "'Geist', system-ui, sans-serif",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s",
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 16px", borderRadius: 8,
        border: "1px solid var(--lf-ink)",
        background: hovered && !disabled ? "var(--lf-sauce-deep)" : "var(--lf-ink)",
        color: "var(--lf-paper)",
        fontSize: 13, fontFamily: "'Geist', system-ui, sans-serif",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s",
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function SmallIconButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 30, height: 30, borderRadius: 7,
        border: "1px solid var(--lf-rule)",
        background: hovered ? (danger ? "rgba(201,84,58,0.08)" : "var(--lf-cream-deep)") : "transparent",
        color: danger && hovered ? "var(--lf-sauce)" : "var(--lf-muted)",
        fontSize: 13, cursor: "pointer",
        transition: "background 0.1s, color 0.1s",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Spinner (inline — no lucide dependency in this file)
// ---------------------------------------------------------------------------

function Spinner({ size = 16 }: { size?: number }) {
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
  { label: "Checking / Savings", emoji: "\uD83D\uDCB5", type: "depository", isDebt: false },
  { label: "401(k) / 403(b)", emoji: "\uD83D\uDCC8", type: "investment", subtype: "401k", isDebt: false },
  { label: "Roth IRA", emoji: "\uD83C\uDF31", type: "investment", subtype: "roth_ira", isDebt: false },
  { label: "Traditional IRA", emoji: "\uD83D\uDCCA", type: "investment", subtype: "ira", isDebt: false },
  { label: "Brokerage", emoji: "\uD83D\uDCBC", type: "investment", subtype: "brokerage", isDebt: false },
  { label: "HSA", emoji: "\uD83C\uDFE5", type: "investment", subtype: "hsa", isDebt: false },
  { label: "Primary Residence", emoji: "\uD83C\uDFE1", type: "real_estate", subtype: "primary", isDebt: false },
  { label: "Rental Property", emoji: "\uD83C\uDFE2", type: "real_estate", subtype: "rental", isDebt: false },
  { label: "Credit Card", emoji: "\uD83D\uDCB3", type: "credit", isDebt: true },
  { label: "Student Loan", emoji: "\uD83C\uDF93", type: "loan", subtype: "student", isDebt: true },
  { label: "Auto Loan", emoji: "\uD83D\uDE97", type: "loan", subtype: "auto", isDebt: true },
  { label: "Mortgage", emoji: "\uD83C\uDFE0", type: "loan", subtype: "mortgage", isDebt: true },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Accounts() {
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newlyLinkedId, setNewlyLinkedId] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Manual account modal state
  const [showManualModal, setShowManualModal] = useState(false);
  const [activeType, setActiveType] = useState<AccountTypeDef | null>(null);
  const [acctName, setAcctName] = useState("");
  const [acctBalance, setAcctBalance] = useState("");
  const [acctRate, setAcctRate] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  // Banner prompt: after adding a property suggest mortgage, and vice versa
  const [linkedBanner, setLinkedBanner] = useState<{ message: string; actionLabel: string; onAction: () => void } | null>(null);
  // ID of an account to cross-link with the next manual account creation
  const [pendingLinkedId, setPendingLinkedId] = useState<string | null>(null);

  const loadItems = (showLoader = true) => {
    if (showLoader) setLoading(true);
    api.getItems()
      .then((d) => setItems(d.items))
      .catch(() => setError("Failed to load accounts"))
      .finally(() => setLoading(false));
  };

  useEffect(() => loadItems(), []);

  // Auto-open Plaid Link if navigated with ?autoLink=true (from onboarding)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoLink") === "true") {
      window.history.replaceState({}, "", "/accounts");
      const timer = setTimeout(() => handleLink(), 300);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleLink = async () => {
    setLinking(true);
    setError("");
    try {
      const { linkToken } = await api.createLinkToken();

      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setError("Plaid Link script not loaded. Add it to index.html.");
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

                    api.generateInsights().catch(() => {});
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

  const handleDelete = async (id: string) => {
    await api.deleteItem(id);
    loadItems();
  };

  const handleDeleteAccount = async (id: string) => {
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

      // Show banner suggesting linked account
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
            setShowManualModal(true); // opens to type picker so they can choose primary/rental
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{
      flex: 1, overflowY: "auto",
      padding: "clamp(16px, 4vw, 40px)",
      paddingBottom: "clamp(80px, 12vw, 40px)",
      background: "var(--lf-paper)",
      minHeight: "100vh",
    }}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        style={{ maxWidth: 1100, margin: "0 auto" }}
      >

        {/* ── Page Header ── */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
            <div>
              <h1 style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 36,
                fontWeight: 400, lineHeight: 1.1,
                color: "var(--lf-ink)", margin: 0,
              }}>
                Accounts
              </h1>
              {!loading && (
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: "var(--lf-muted)",
                  marginTop: 6,
                }}>
                  {items.length} institution{items.length !== 1 ? "s" : ""} · {totalAccounts} account{totalAccounts !== 1 ? "s" : ""}
                </div>
              )}
            </div>

            {!isDemoMode && (
              <div style={{ display: "flex", gap: 8, paddingBottom: 6 }}>
                {items.length > 0 && (
                  <GhostButton onClick={handleSyncAll} disabled={syncing || linking}>
                    {syncing ? <><Spinner size={13} /> Syncing…</> : "↺ Sync all"}
                  </GhostButton>
                )}
                <GhostButton onClick={() => setShowManualModal(true)}>
                  ✎ Add Manual
                </GhostButton>
                <PrimaryButton onClick={handleLink} disabled={linking || syncing}>
                  {linking ? <><Spinner size={13} /> Linking…</> : "+ Link via Plaid"}
                </PrimaryButton>
              </div>
            )}
          </div>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              marginBottom: 24,
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(201,84,58,0.08)",
              border: "1px solid rgba(201,84,58,0.25)",
              color: "var(--lf-sauce)",
              fontSize: 13,
              fontFamily: "'Geist', system-ui, sans-serif",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{ fontSize: 15 }}>⚠</span>
            {error}
          </motion.div>
        )}

        {/* ── Linked account banner ── */}
        {linkedBanner && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              marginBottom: 24,
              padding: "14px 20px",
              borderRadius: 10,
              background: "rgba(90,107,63,0.08)",
              border: "1px solid rgba(90,107,63,0.25)",
              fontSize: 13,
              fontFamily: "'Geist', system-ui, sans-serif",
              display: "flex", alignItems: "center", gap: 12,
              color: "var(--lf-ink)",
            }}
          >
            <span style={{ flex: 1 }}>{linkedBanner.message}</span>
            <GhostButton onClick={linkedBanner.onAction}>
              {linkedBanner.actionLabel}
            </GhostButton>
            <SmallIconButton
              label="✕"
              onClick={() => setLinkedBanner(null)}
            />
          </motion.div>
        )}

        {/* ── Loading state ── */}
        {loading && (
          <div style={{
            background: "var(--lf-paper)",
            border: "1px solid var(--lf-rule)",
            borderRadius: 14, overflow: "hidden",
            padding: "48px 32px",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 12, color: "var(--lf-muted)",
            fontFamily: "'Geist', system-ui, sans-serif", fontSize: 14,
          }}>
            <Spinner size={22} />
            Loading accounts…
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && items.length === 0 && (
          <div style={{
            background: "var(--lf-paper)",
            border: "1px solid var(--lf-rule)",
            borderRadius: 14, overflow: "hidden",
            padding: "56px 32px",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 12, textAlign: "center",
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 28, color: "var(--lf-cream-deep)",
            }}>⊞</div>
            <p style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 20, color: "var(--lf-ink)", margin: 0,
            }}>
              No accounts linked yet.
            </p>
            <p style={{ color: "var(--lf-muted)", fontSize: 13, margin: 0, fontFamily: "'Geist', system-ui, sans-serif" }}>
              Connect your bank to see balances, transactions, and synced insights.
            </p>
            {!isDemoMode && (
              <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "center" }}>
                <PrimaryButton onClick={handleLink} disabled={linking}>
                  {linking ? <><Spinner size={13} /> Linking…</> : "+ Link via Plaid"}
                </PrimaryButton>
                <GhostButton onClick={() => setShowManualModal(true)}>
                  ✎ Add Manual
                </GhostButton>
              </div>
            )}
          </div>
        )}

        {/* ── Institution list ── */}
        {!loading && items.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                ref={(el) => { itemRefs.current[item.id] = el; }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.35 }}
                style={{
                  background: "var(--lf-paper)",
                  border: newlyLinkedId === item.id
                    ? "1px solid var(--lf-basil)"
                    : "1px solid var(--lf-rule)",
                  borderRadius: 14, overflow: "hidden",
                  boxShadow: newlyLinkedId === item.id
                    ? "0 0 0 3px rgba(90,107,63,0.15)"
                    : "none",
                  transition: "border-color 0.4s, box-shadow 0.4s",
                }}
              >
                {/* Institution header */}
                <div style={{
                  background: "var(--lf-cream)",
                  padding: "18px 24px",
                  borderBottom: "1px solid var(--lf-rule)",
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: 12,
                }}>
                  {/* Left: logo chip + name + status */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <InstitutionInitial name={item.institutionName ?? "?"} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontFamily: "'Geist', system-ui, sans-serif",
                        fontSize: 15, fontWeight: 600,
                        color: "var(--lf-ink)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {item.institutionName ?? "Unknown Bank"}
                      </div>
                      <div style={{ marginTop: 2 }}>
                        <StatusBadge status={item.status} lastSyncedAt={item.lastSyncedAt} />
                      </div>
                    </div>
                  </div>

                  {/* Right: actions */}
                  {!isDemoMode && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <SmallIconButton
                        label={syncingItemId === item.id ? "…" : "↺"}
                        onClick={() => handleSyncItem(item.id)}
                      />
                      <SmallIconButton
                        label="✕"
                        danger
                        onClick={() => handleDelete(item.id)}
                      />
                    </div>
                  )}
                </div>

                {/* Account rows */}
                {item.accounts.length === 0 && syncing && (
                  <div style={{
                    padding: "18px 24px",
                    display: "flex", alignItems: "center", gap: 8,
                    color: "var(--lf-muted)", fontSize: 13,
                    fontFamily: "'Geist', system-ui, sans-serif",
                  }}>
                    <Spinner size={14} /> Syncing accounts…
                  </div>
                )}

                {item.accounts.length === 0 && !syncing && (
                  <div style={{
                    padding: "18px 24px",
                    color: "var(--lf-muted)", fontSize: 13,
                    fontFamily: "'Geist', system-ui, sans-serif",
                  }}>
                    No accounts found for this institution.
                  </div>
                )}

                {item.accounts.length > 0 && (
                  <div>
                    {item.accounts.map((account, ai) => (
                      <AccountRow
                        key={account.id}
                        account={account}
                        isLast={ai === item.accounts.length - 1}
                        isManual={item.institutionId === "manual"}
                        onDelete={() => handleDeleteAccount(account.id)}
                        linkedAccountName={account.metadata?.linkedAccountId
                          ? allAccounts.find((a) => a.id === account.metadata?.linkedAccountId)?.name ?? null
                          : null}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

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
                width: "100%", maxWidth: 440,
                background: "var(--lf-paper)",
                border: "1px solid var(--lf-rule)",
                borderRadius: 16, overflow: "hidden",
                boxShadow: "0 24px 48px rgba(0,0,0,0.15)",
              }}
            >
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "18px 24px",
                borderBottom: "1px solid var(--lf-rule)",
                background: "var(--lf-cream)",
              }}>
                <span style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontSize: 20, fontWeight: 400, color: "var(--lf-ink)",
                }}>
                  Add Manual Account
                </span>
                <SmallIconButton
                  label="✕"
                  onClick={() => { setShowManualModal(false); resetManualForm(); }}
                />
              </div>

              {/* Body */}
              <div style={{ padding: 24, maxHeight: "70vh", overflowY: "auto" }}>
                {activeType ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{ display: "flex", flexDirection: "column", gap: 16 }}
                  >
                    {/* Selected type header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{activeType.emoji}</span>
                      <span style={{
                        fontFamily: "'Geist', system-ui, sans-serif",
                        fontSize: 15, fontWeight: 600, color: "var(--lf-ink)",
                      }}>
                        {activeType.label}
                      </span>
                      <button
                        onClick={resetManualForm}
                        style={{
                          marginLeft: "auto", fontSize: 12,
                          fontFamily: "'JetBrains Mono', monospace",
                          color: "var(--lf-muted)", background: "none",
                          border: "none", cursor: "pointer",
                          letterSpacing: "0.04em",
                        }}
                      >
                        change type
                      </button>
                    </div>

                    {/* Account name */}
                    <div>
                      <label style={{
                        display: "block", fontSize: 12, color: "var(--lf-muted)",
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.06em", textTransform: "uppercase",
                        marginBottom: 6,
                      }}>
                        Account name
                      </label>
                      <input
                        type="text"
                        value={acctName}
                        onChange={(e) => setAcctName(e.target.value)}
                        autoFocus
                        style={{
                          width: "100%", padding: "10px 14px",
                          background: "var(--lf-paper)",
                          border: "1px solid var(--lf-rule)",
                          borderRadius: 8, fontSize: 14,
                          fontFamily: "'Geist', system-ui, sans-serif",
                          color: "var(--lf-ink)", outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    {/* Balance / Property Value */}
                    <div>
                      <label style={{
                        display: "block", fontSize: 12, color: "var(--lf-muted)",
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.06em", textTransform: "uppercase",
                        marginBottom: 6,
                      }}>
                        {activeType.type === "real_estate" ? "Estimated value" : "Balance"}
                      </label>
                      <div style={{ position: "relative" }}>
                        <span style={{
                          position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                          color: "var(--lf-muted)", fontSize: 14,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          $
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={acctBalance}
                          onChange={(e) => setAcctBalance(e.target.value.replace(/[^0-9.]/g, ""))}
                          placeholder="0"
                          style={{
                            width: "100%", padding: "10px 14px 10px 28px",
                            background: "var(--lf-paper)",
                            border: "1px solid var(--lf-rule)",
                            borderRadius: 8, fontSize: 14,
                            fontFamily: "'JetBrains Mono', monospace",
                            color: "var(--lf-ink)", outline: "none",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    </div>

                    {/* Interest rate (debt only) */}
                    {activeType.isDebt && (
                      <div>
                        <label style={{
                          display: "block", fontSize: 12, color: "var(--lf-muted)",
                          fontFamily: "'JetBrains Mono', monospace",
                          letterSpacing: "0.06em", textTransform: "uppercase",
                          marginBottom: 6,
                        }}>
                          Interest rate
                        </label>
                        <div style={{ position: "relative" }}>
                          <input
                            type="number"
                            min={0}
                            max={40}
                            step={0.1}
                            value={acctRate}
                            onChange={(e) => setAcctRate(e.target.value)}
                            placeholder="5.5"
                            style={{
                              width: "100%", padding: "10px 36px 10px 14px",
                              background: "var(--lf-paper)",
                              border: "1px solid var(--lf-rule)",
                              borderRadius: 8, fontSize: 14,
                              fontFamily: "'JetBrains Mono', monospace",
                              color: "var(--lf-ink)", outline: "none",
                              boxSizing: "border-box",
                            }}
                          />
                          <span style={{
                            position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                            color: "var(--lf-muted)", fontSize: 14,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}>
                            %
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Submit */}
                    <div style={{ paddingTop: 4 }}>
                      <PrimaryButton
                        onClick={handleAddManualAccount}
                        disabled={!acctName.trim() || addingAccount}
                      >
                        {addingAccount
                          ? <><Spinner size={13} /> Adding…</>
                          : "+ Add Account"}
                      </PrimaryButton>
                    </div>
                  </motion.div>
                ) : (
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                  }}>
                    {ACCOUNT_TYPES.map((at) => (
                      <button
                        key={at.label}
                        onClick={() => { setActiveType(at); setAcctName(at.label); setAcctBalance(""); setAcctRate(""); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "12px 14px", borderRadius: 10,
                          border: "1px solid var(--lf-rule)",
                          background: "var(--lf-paper)",
                          textAlign: "left", cursor: "pointer",
                          fontFamily: "'Geist', system-ui, sans-serif",
                          fontSize: 13, color: "var(--lf-muted)",
                          fontWeight: 500,
                          transition: "background 0.12s, border-color 0.12s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--lf-cream)";
                          e.currentTarget.style.borderColor = "var(--lf-cream-deep)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "var(--lf-paper)";
                          e.currentTarget.style.borderColor = "var(--lf-rule)";
                        }}
                      >
                        <span style={{ fontSize: 18 }}>{at.emoji}</span>
                        {at.label}
                      </button>
                    ))}
                  </div>
                )}

                <p style={{
                  textAlign: "center", fontSize: 12, color: "var(--lf-muted)",
                  fontFamily: "'Geist', system-ui, sans-serif",
                  marginTop: 16, marginBottom: 0,
                }}>
                  Manual balances are a snapshot — link accounts for automatic updates.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account row sub-component
// ---------------------------------------------------------------------------

function AccountRow({ account, isLast, isManual, onDelete, linkedAccountName }: {
  account: Account; isLast: boolean; isManual: boolean; onDelete: () => void;
  linkedAccountName: string | null;
}) {
  const [hovered, setHovered] = useState(false);
  const balance = account.balance !== null ? parseFloat(account.balance) : null;
  const isNegative = balance !== null && balance < 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center",
        padding: "14px 24px", gap: 12,
        borderBottom: isLast ? "none" : "1px solid var(--lf-rule-soft)",
        background: hovered ? "var(--lf-cream)" : "transparent",
        transition: "background 0.1s",
        cursor: "default",
      }}
    >
      {/* Name + mask + linked hint */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          fontFamily: "'Geist', system-ui, sans-serif",
          fontSize: 14, fontWeight: 500,
          color: "var(--lf-ink)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          display: "block",
        }}>
          {account.name}
          {account.mask && (
            <span style={{ color: "var(--lf-muted)", fontWeight: 400, marginLeft: 6 }}>
              ••{account.mask}
            </span>
          )}
        </span>
        {linkedAccountName && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, color: "var(--lf-muted)",
            letterSpacing: "0.02em",
          }}>
            linked to {linkedAccountName}
          </span>
        )}
      </div>

      {/* Type pill */}
      <TypePill type={account.type} subtype={account.subtype} />

      {/* Balance */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 14, fontWeight: 500,
        color: isNegative ? "var(--lf-sauce)" : "var(--lf-ink)",
        minWidth: 90, textAlign: "right",
        flexShrink: 0,
      }}>
        {balance !== null
          ? formatCurrency(account.balance!, account.currency)
          : "—"}
      </span>

      {/* Delete button (visible on hover) */}
      {isManual && (
        <SmallIconButton
          label="✕"
          danger
          onClick={onDelete}
        />
      )}
    </div>
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
