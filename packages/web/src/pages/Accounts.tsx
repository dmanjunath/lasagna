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
  ChevronRight,
  Trash2,
  Lock,
  X,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth";
import { isNativeApp } from "../lib/native";
import { useBilling, startUpgrade } from "../lib/billing";
import { cn, stripAccountMask } from "../lib/utils";
import { Button, Field, Input, Modal, Skeleton } from "../components/uikit";
import { useConfirm } from "../components/ds";
import { faviconUrl, institutionDomainFor } from "../components/ds/institutions";
import { AccountLinkPicker, type AccountPickerOption } from "../components/common/AccountLinkPicker";
import { AddressAutocomplete } from "../components/common/AddressAutocomplete";
import { ValueSourceBadge } from "../components/common/ValueSourceBadge";
import { ValueSourceControl, type ValueSourceChoice } from "../components/common/ValueSourceControl";

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
  metadata?: { [key: string]: unknown } | null;
  propertyAccountId?: string | null;
  excludeFromNetWorth?: boolean;
  excludeTransactions?: boolean;
  invertBalance?: boolean;
  frozen?: boolean;
  valueSource?: "synced" | "estimated" | "manual";
}

interface PlaidItem {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  accounts: Account[];
}

function isItemError(item: PlaidItem): boolean {
  return item.status === "error" || item.status === "item_login_required";
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
  // Plaid can connect this type automatically. Manual-only types (property,
  // cash, other) skip the connect/manual choice and go straight to the form.
  plaidEligible: boolean;
}

interface AccountTypeGroup {
  title: string;
  types: AccountTypeDef[];
}

// Grouped so the type picker gives the eye an entry point instead of a flat
// equal-weight grid. Cash & bank leads (the most common), property/cash/other
// are manual-only.
const ACCOUNT_TYPE_GROUPS: AccountTypeGroup[] = [
  {
    title: "Cash & bank",
    types: [
      { label: "Checking / Savings", emoji: "💵", type: "depository", isDebt: false, plaidEligible: true },
      { label: "Cash", emoji: "🪙", type: "depository", subtype: "cash", isDebt: false, plaidEligible: false },
    ],
  },
  {
    title: "Credit",
    types: [
      { label: "Credit Card", emoji: "💳", type: "credit", isDebt: true, plaidEligible: true },
    ],
  },
  {
    title: "Investments",
    types: [
      { label: "Brokerage", emoji: "💼", type: "investment", subtype: "brokerage", isDebt: false, plaidEligible: true },
      { label: "401(k) / 403(b)", emoji: "📈", type: "investment", subtype: "401k", isDebt: false, plaidEligible: true },
      { label: "Roth IRA", emoji: "🌱", type: "investment", subtype: "roth_ira", isDebt: false, plaidEligible: true },
      { label: "Traditional IRA", emoji: "📊", type: "investment", subtype: "ira", isDebt: false, plaidEligible: true },
      { label: "HSA", emoji: "🏥", type: "investment", subtype: "hsa", isDebt: false, plaidEligible: true },
    ],
  },
  {
    title: "Loans",
    types: [
      { label: "Mortgage", emoji: "🏠", type: "loan", subtype: "mortgage", isDebt: true, plaidEligible: true },
      { label: "Student Loan", emoji: "🎓", type: "loan", subtype: "student", isDebt: true, plaidEligible: true },
      { label: "Auto Loan", emoji: "🚗", type: "loan", subtype: "auto", isDebt: true, plaidEligible: true },
    ],
  },
  {
    title: "Property",
    types: [
      { label: "Primary Residence", emoji: "🏡", type: "real_estate", subtype: "primary", isDebt: false, plaidEligible: false },
      { label: "Rental Property", emoji: "🏢", type: "real_estate", subtype: "rental", isDebt: false, plaidEligible: false },
    ],
  },
  {
    title: "Other",
    types: [
      { label: "Other Asset", emoji: "📦", type: "alternative", isDebt: false, plaidEligible: false },
      { label: "Other Debt", emoji: "🧾", type: "loan", subtype: "other", isDebt: true, plaidEligible: false },
    ],
  },
];

// Flat list — still needed for the mortgage/property linked-banner lookups.
const ACCOUNT_TYPES: AccountTypeDef[] = ACCOUNT_TYPE_GROUPS.flatMap((g) => g.types);

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
  // Cards render expanded by default (scannable, matches /money). We track the
  // set of *collapsed* ids so an empty set means "everything open".
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  // Add-account modal state. The modal is a small wizard:
  //   no type + no choice  → grouped type picker (step 1)
  //   Plaid-eligible type  → connect/manual choice (step 2a)
  //   manual-only / "manual" chosen → the manual form (step 2b)
  const [showManualModal, setShowManualModal] = useState(false);
  // A Plaid-eligible type awaiting the connect-vs-manual choice.
  const [methodChoiceType, setMethodChoiceType] = useState<AccountTypeDef | null>(null);
  const [activeType, setActiveType] = useState<AccountTypeDef | null>(null);
  const [acctName, setAcctName] = useState("");
  const [acctBalance, setAcctBalance] = useState("");
  const [acctRate, setAcctRate] = useState("");
  const [rentMonthly, setRentMonthly] = useState("");
  const [insAnnual, setInsAnnual] = useState("");
  const [maintAnnual, setMaintAnnual] = useState("");
  // Property address + resolved geocode (real_estate accounts). Editing the
  // text by hand clears the geocode so a stale placeId is never persisted.
  const [acctAddress, setAcctAddress] = useState("");
  const [acctPlaceId, setAcctPlaceId] = useState("");
  const [acctLat, setAcctLat] = useState<number | null>(null);
  const [acctLng, setAcctLng] = useState<number | null>(null);
  // Set when the address picker rejects a commercial place; cleared on next edit.
  const [acctAddressRejected, setAcctAddressRejected] = useState(false);
  // Value source for a real_estate account: "market" runs the auto-estimate on
  // submit (no value input); "own" pins the user's own value as a persisted
  // override the estimate never overwrites. Mirrors the detail/edit page.
  const [acctValueSource, setAcctValueSource] = useState<ValueSourceChoice>("market");
  const [addingAccount, setAddingAccount] = useState(false);
  // Async value-estimate spinner state, shown after creating a property with an
  // address but no manual value (we poll GET /accounts/:id/value-estimate).
  const [estimating, setEstimating] = useState<
    | { status: "pending" }
    | { status: "ready"; value: number }
    // "failed" = no estimate for this address; "timeout" = still pending at the
    // client poll cap (the server keeps the job, so a refresh may show it).
    | { status: "failed" }
    | { status: "timeout" }
    | null
  >(null);
  const [linkedBanner, setLinkedBanner] = useState<{ message: string; actionLabel: string; onAction: () => void } | null>(null);
  const [pendingLinkedId, setPendingLinkedId] = useState<string | null>(null);
  // "+ Add a new …" in the create-modal link picker sets this: after the current
  // account is created, open the counterpart's add form pre-linked to it (instead
  // of only linking an existing account). Cleared once consumed.
  const [addCounterpartAfter, setAddCounterpartAfter] = useState(false);

  const loadItems = (showLoader = true) => {
    if (showLoader) setLoading(true);
    api.getItems()
      .then((d) => setItems(d.items))
      .catch(() => setError("Failed to load accounts"))
      .finally(() => setLoading(false));
  };

  useEffect(() => loadItems(), []);

  // Auto-open Plaid Link if navigated with ?autoLink=true.
  // Guard with a ref (instead of effect cleanup) so React StrictMode's dev
  // double-invoke doesn't strip the query on the first pass, clear the timer on
  // cleanup, and then skip on the remount — which left Plaid never opening.
  const autoLinkFired = useRef(false);
  useEffect(() => {
    if (autoLinkFired.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoLink") === "true") {
      autoLinkFired.current = true;
      window.history.replaceState({}, "", "/accounts");
      setTimeout(() => handleLink(), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link into the add-account form pre-typed + pre-linked. The account
  // detail page's "+ Add a mortgage/property" action navigates here with
  // ?add=<type>[:<subtype>]&link=<counterpartId> so the new account is created
  // already tied to its counterpart via the existing pendingLinkedId flow.
  const addLinkFired = useRef(false);
  useEffect(() => {
    if (addLinkFired.current) return;
    const params = new URLSearchParams(window.location.search);
    const add = params.get("add");
    if (!add) return;
    addLinkFired.current = true;
    const link = params.get("link");
    window.history.replaceState({}, "", "/accounts");
    const [type, subtype] = add.split(":");
    const target =
      ACCOUNT_TYPES.find((at) => at.type === type && (subtype ? at.subtype === subtype : true)) ??
      ACCOUNT_TYPES.find((at) => at.type === type);
    if (!target) return;
    if (link) setPendingLinkedId(link);
    enterManualForm(target);
    setShowManualModal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Newly linked institutions are force-expanded (drop them from collapsed).
  useEffect(() => {
    if (newlyLinkedId) {
      setCollapsedIds((prev) => {
        if (!prev.has(newlyLinkedId)) return prev;
        const next = new Set(prev);
        next.delete(newlyLinkedId);
        return next;
      });
    }
  }, [newlyLinkedId]);

  const toggleExpand = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Expand + scroll a specific institution into view (used by the
  // needs-attention banner). Honest recovery — surfaces the card, no fake API.
  const focusItem = (id: string) => {
    setCollapsedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setTimeout(() => {
      itemRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

  const handleLink = async () => {
    // Plaid's web SDK doesn't support embedded WebViews (bank OAuth breaks) —
    // the native shell needs the native Plaid Link SDK before this can work.
    if (isNativeApp()) {
      setError("Bank connections aren't available in the app yet — connect from the web and your accounts will sync here.");
      return;
    }
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
            // Guard against relinking an already-connected institution: the
            // exchange would mint a second Plaid item whose account_ids are
            // all new, duplicating every account at the institution. Offer
            // update mode on the existing item instead (fetch fresh items —
            // the `items` state may be stale inside this closure).
            const instId = metadata.institution?.institution_id;
            if (instId) {
              const { items: current } = await api.getItems();
              const existing = current.find((i) => i.institutionId === instId);
              if (existing) {
                setLinking(false);
                const addInstead = await confirm({
                  title: `${existing.institutionName ?? "This institution"} is already connected`,
                  body: "Connecting it again would duplicate all of its accounts. To track a newly opened account, add it to your existing connection instead.",
                  confirmLabel: "Add to existing connection",
                  cancelLabel: "Cancel",
                });
                if (addInstead) handleAddAccounts(existing);
                return;
              }
            }
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

  // Add newly opened accounts at an already-linked institution via Plaid Link
  // update mode (account selection enabled). The item keeps its access token
  // and account_ids, so sync picks up only the genuinely new accounts —
  // relinking from scratch would create a second item duplicating every account.
  const handleAddAccounts = async (item: PlaidItem) => {
    if (isNativeApp()) {
      setError("Bank connections aren't available in the app yet — connect from the web and your accounts will sync here.");
      return;
    }
    setLinking(true);
    setError("");
    try {
      const [{ linkToken }] = await Promise.all([
        api.createUpdateLinkToken(item.id),
        (await import("../lib/load-plaid.js")).loadPlaidSdk(),
      ]);

      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setError("Failed to load Plaid. Please refresh and try again.");
        setLinking(false);
        return;
      }

      const prevCount = item.accounts.length;
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async () => {
          try {
            await api.syncPlaidItem(item.id);
            setSyncing(true);
            let attempts = 0;
            const poll = setInterval(async () => {
              attempts++;
              try {
                const data = await api.getItems();
                const updated = data.items.find((i) => i.id === item.id);
                if ((updated && updated.accounts.length > prevCount) || attempts >= 10) {
                  clearInterval(poll);
                  setItems(data.items);
                  setSyncing(false);
                  setLinking(false);
                  setNewlyLinkedId(item.id);
                  setTimeout(() => {
                    itemRefs.current[item.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 100);
                  setTimeout(() => setNewlyLinkedId(null), 3000);
                }
              } catch {
                clearInterval(poll);
                setSyncing(false);
                setLinking(false);
              }
            }, 2000);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add accounts");
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
    setMethodChoiceType(null);
    setAcctName("");
    setAcctBalance("");
    setAcctRate("");
    setRentMonthly("");
    setInsAnnual("");
    setMaintAnnual("");
    setAcctAddress("");
    setAcctPlaceId("");
    setAcctLat(null);
    setAcctLng(null);
    setAcctAddressRejected(false);
    setAcctValueSource("market");
    setEstimating(null);
    setPendingLinkedId(null);
    setAddCounterpartAfter(false);
  };

  // Open the manual form for a given type (prefills name, clears the rest).
  const enterManualForm = (at: AccountTypeDef) => {
    setMethodChoiceType(null);
    setActiveType(at);
    setAcctName(at.label);
    setAcctBalance("");
    setAcctRate("");
    setRentMonthly("");
    setInsAnnual("");
    setMaintAnnual("");
    setAcctAddress("");
    setAcctPlaceId("");
    setAcctLat(null);
    setAcctLng(null);
    setAcctAddressRejected(false);
    setAcctValueSource("market");
    setEstimating(null);
  };

  // Step 1 → step 2. Plaid-eligible types offer connect-or-manual; manual-only
  // types drop straight into the form.
  const selectType = (at: AccountTypeDef) => {
    if (at.plaidEligible) {
      setMethodChoiceType(at);
    } else {
      enterManualForm(at);
    }
  };

  // Poll the async value estimate for a freshly-created property (~10s cadence,
  // ~5min cap). Ends on ready/failed; on ready, refreshes the account list so
  // the estimated value shows.
  const pollValueEstimate = async (accountId: string) => {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      let res;
      try {
        res = await api.getValueEstimate(accountId);
      } catch {
        continue; // transient — keep polling until the cap
      }
      if (res.status === "ready") {
        setEstimating({ status: "ready", value: res.value ?? 0 });
        loadItems(false);
        return;
      }
      if (res.status === "failed" || res.status === "none") {
        setEstimating({ status: "failed" });
        return;
      }
    }
    // Hit the cap while the server job is still pending — it keeps running, so
    // a refresh may surface the value. Don't claim we'll keep trying here.
    setEstimating({ status: "timeout" });
  };

  const handleAddManualAccount = async () => {
    if (!activeType || !acctName.trim()) return;
    const isProperty = activeType.type === "real_estate";
    // Property value source: "own" pins the typed value as a persisted override;
    // "market" runs the auto-estimate off the address and ignores any value.
    const ownValueChosen = isProperty && acctValueSource === "own";
    // For a property, the address kicks off an estimate; a manual value is only
    // used under "My own value". For everything else the balance defaults to 0.
    const hasManualValue = isProperty
      ? ownValueChosen && acctBalance.trim() !== ""
      : acctBalance.trim() !== "";
    setAddingAccount(true);
    try {
      const metadata: Record<string, unknown> = {};
      if (activeType.isDebt && acctRate) metadata.interestRate = parseFloat(acctRate);
      if (activeType.subtype === "rental") {
        if (rentMonthly) metadata.monthlyRent = parseFloat(rentMonthly);
        if (insAnnual) metadata.annualInsurance = parseFloat(insAnnual);
        if (maintAnnual) metadata.annualMaintenance = parseFloat(maintAnnual);
      }
      if (isProperty && acctAddress.trim()) {
        metadata.address = acctAddress.trim();
        if (acctPlaceId) metadata.placeId = acctPlaceId;
        if (acctLat !== null) metadata.lat = acctLat;
        if (acctLng !== null) metadata.lng = acctLng;
      }
      // Skip the initial snapshot when a property has no manual value — the
      // estimate will supply it. Non-property accounts default to 0.
      const willEstimate = isProperty && !hasManualValue && acctAddress.trim() !== "";
      const result = await api.createManualAccount({
        name: acctName.trim(),
        type: activeType.type,
        subtype: activeType.subtype,
        balance: hasManualValue ? parseFloat(acctBalance) : willEstimate ? undefined : 0,
        metadata: Object.keys(metadata).length ? metadata : undefined,
        // Pin the typed value as a durable override so the estimate never
        // overwrites it (matches the detail/edit page's "My own value").
        ...(ownValueChosen ? { valueSource: "own" as const } : {}),
        linkedAccountId: pendingLinkedId || undefined,
      });

      const justAdded = activeType;
      const createdId = result.account.id;
      // The user chose "+ Add a new <counterpart>" in the link picker: after this
      // account is created, advance the modal straight to the counterpart's add
      // form, pre-linked to it (reuses the same pendingLinkedId flow as the
      // post-create banner). The counterpart type is derived from ACCOUNT_TYPES.
      const chainCounterpart = addCounterpartAfter;

      // Open the counterpart's add form pre-linked to the just-created account.
      const openCounterpartForm = () => {
        const target =
          justAdded.type === "real_estate"
            ? ACCOUNT_TYPES.find((at) => at.subtype === "mortgage")!
            : ACCOUNT_TYPES.find((at) => at.type === "real_estate")!;
        setAddCounterpartAfter(false);
        setPendingLinkedId(createdId);
        enterManualForm(target);
        setShowManualModal(true);
      };

      // Property with an address but no manual value → the estimate runs async.
      // Normally we hold the modal on the estimating spinner, but if the user
      // also asked to chain the counterpart, don't block: the new property's
      // account row polls its own estimate and shows the "Estimating…" pill
      // (driven by valueEstimate.status, not the modal `estimating` state), so we
      // just reload the list and advance to the counterpart form.
      if (willEstimate) {
        if (chainCounterpart) {
          loadItems();
          openCounterpartForm();
          return;
        }
        setEstimating({ status: "pending" });
        setPendingLinkedId(null);
        loadItems();
        void pollValueEstimate(createdId);
        return;
      }

      // Chaining the counterpart: skip the banner, reset the form for the new
      // type, and advance the modal to the pre-linked counterpart form.
      if (chainCounterpart) {
        loadItems();
        openCounterpartForm();
        return;
      }

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
            enterManualForm(mortgage);
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

  // Link-counterpart candidates for the add form. A property is secured by a
  // mortgage/loan (never a credit card), so the property form offers unlinked
  // `loan` accounts and the mortgage form offers real_estate accounts.
  const typeLabel = (type: string, subtype?: string | null) =>
    ACCOUNT_TYPES.find((at) => at.type === type && at.subtype === (subtype ?? undefined))?.label ??
    ACCOUNT_TYPES.find((at) => at.type === type)?.label ??
    type;
  const linkCandidateOptions: AccountPickerOption[] = items.flatMap((i) =>
    i.accounts
      .filter((a) => {
        if (!activeType) return false;
        if (activeType.type === "real_estate") return a.type === "loan" && !a.propertyAccountId;
        if (activeType.subtype === "mortgage") return a.type === "real_estate";
        return false;
      })
      .map((a) => ({
        id: a.id,
        name: a.name,
        institution: i.institutionName || "Manual",
        meta: typeLabel(a.type, a.subtype),
      })),
  );
  const offersLink =
    !!activeType && (activeType.type === "real_estate" || activeType.subtype === "mortgage");

  // Total tracked = sum of absolute balances across all accounts (a soft "scope" figure)
  const totalTracked = allAccounts.reduce((sum, a) => {
    const v = a.balance !== null ? parseFloat(a.balance) : 0;
    return sum + (Number.isNaN(v) ? 0 : Math.abs(v));
  }, 0);

  const linkedItems = items.filter((i) => i.institutionId !== "manual");
  const manualItems = items.filter((i) => i.institutionId === "manual");
  const manualAccounts = manualItems.flatMap((i) => i.accounts);
  const attentionItems = linkedItems.filter(isItemError);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const lastSync = items
    .map((i) => i.lastSyncedAt)
    .filter((v): v is string => !!v)
    .sort()
    .pop();
  const captionParts: string[] = [];
  if (totalAccounts > 0) captionParts.push(`${totalAccounts} account${totalAccounts !== 1 ? "s" : ""}`);
  if (items.length > 0) captionParts.push(`${items.length} institution${items.length !== 1 ? "s" : ""}`);
  if (totalTracked > 0) captionParts.push(`${formatTotal(totalTracked)} tracked`);
  if (lastSync) captionParts.push(`synced ${formatRelativeTime(lastSync)}`);

  const usedPct = billing
    ? Math.max(0, Math.min(100, (billing.usage.accounts / Math.max(1, billing.usage.maxAccounts)) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-[1040px] px-3 sm:px-12 pt-4 sm:pt-10 pb-6 sm:pb-28 text-content">
      {/* ── Page header — mirrors /money: title, live caption, action cluster ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em]">
            Accounts
          </h1>
          <p className="mt-1.5 flex items-center gap-2 text-[14px] font-medium text-content-muted">
            {!loading && totalAccounts > 0 && (
              <span
                className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-[rgb(var(--ui-accent))]"
                style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
                aria-hidden="true"
              />
            )}
            <span className="min-w-0">
              {loading
                ? "Loading your connections…"
                : captionParts.length > 0
                ? captionParts.join(" · ")
                : "Connect an account to start tracking your money"}
            </span>
          </p>
        </div>
        {!isDemoMode && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            {!isFree && (
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
              variant="primary"
              size="sm"
              onClick={() => setShowManualModal(true)}
              disabled={linking || syncing}
              leadingIcon={<Plus size={15} />}
            >
              Add account
            </Button>
          </div>
        )}
      </header>

      {/* Plan usage meter — free plan only, where the cap is meaningful. Over the
          cap we flip to coral and show which are syncing ("M of N"), with an
          upgrade nudge as the cap fills. */}
      {billing && isFree && (
        <div className="mt-5 rounded-ui-lg border border-line bg-panel shadow-ui-sm px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-[11.5px] font-bold uppercase tracking-[0.11em] text-content-muted">
              Free plan · account limit
            </span>
            <span className="text-[13.5px] font-bold ui-tnum">
              {overLimit ? (
                <span className="inline-flex items-center gap-1.5 text-content">
                  <Zap size={13} strokeWidth={2.5} className="shrink-0 text-[rgb(var(--ui-brand-ink))]" aria-hidden="true" />
                  {billing.usage.maxAccounts} of {billing.usage.accounts} syncing
                </span>
              ) : (
                <span className="text-content">
                  {billing.usage.accounts} of {billing.usage.maxAccounts} used
                </span>
              )}
            </span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-canvas-sunken">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-ui"
              style={{
                // Over the cap the meter shows synced-of-total (e.g. 3 of 22 → ~14%),
                // not a full bar — a full bar would read as maxed and contradict "3".
                width: `${overLimit ? (billing.usage.maxAccounts / Math.max(1, billing.usage.accounts)) * 100 : usedPct}%`,
                background: "rgb(var(--ui-brand))",
              }}
            />
          </div>
          {billing.usage.accounts >= billing.usage.maxAccounts && (
            <p className="mt-2.5 text-[12.5px] font-medium text-content-muted">
              {overLimit
                ? "Some accounts are frozen. "
                : "You've reached your plan limit. "}
              <button
                type="button"
                className="ui-focus rounded-ui-sm font-bold text-[rgb(var(--ui-brand-ink))] underline underline-offset-2 hover:opacity-80"
                onClick={handleUpgrade}
              >
                {overLimit ? "Upgrade to sync them all" : "Upgrade for unlimited"}
              </button>
            </p>
          )}
        </div>
      )}

      {/* Quick Import CTA */}
      <Link
        href="/quick-import"
        className="group mt-4 flex items-center gap-3 rounded-ui-lg border border-line bg-panel shadow-ui-sm px-4 py-3 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md hover:border-line-strong min-h-touch"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]">
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

      {/* Needs-attention — connections that stopped syncing, surfaced up top. */}
      {!loading && attentionItems.length > 0 && (
        <div className="mt-5 space-y-2.5">
          {attentionItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-ui-md border border-caution/30 bg-caution-soft px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <AlertTriangle size={16} className="shrink-0 text-caution" />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold text-caution">
                    {item.institutionName || "Institution"} needs attention
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-content-muted">
                    {item.status === "item_login_required"
                      ? "Login expired — reconnect to resume syncing"
                      : "Sync error — try reconnecting"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => focusItem(item.id)}
                className="ui-focus shrink-0 rounded-ui-sm px-2.5 py-1 text-[13px] font-bold text-caution hover:underline"
              >
                Review →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Loading skeleton — mirror the institution card outline. */}
      {loading && (
        <div className="mt-6 space-y-[18px]" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-ui-xl border border-line bg-panel shadow-ui-sm">
              <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
                <Skeleton className="h-10 w-10 rounded-ui-md" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="border-t border-line px-4 py-3.5 sm:px-5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state — the "connect your first account" moment. */}
      {!loading && items.length === 0 && (
        <FirstConnectEmptyState
          isDemoMode={isDemoMode}
          onAddAccount={() => setShowManualModal(true)}
        />
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
                expanded={!collapsedIds.has(item.id)}
                onToggle={() => toggleExpand(item.id)}
                onSync={() => handleSyncItem(item.id)}
                onAddAccounts={() => handleAddAccounts(item)}
                onDisconnect={() => handleDelete(item.id, item.institutionName ?? "Unknown Bank")}
                allAccounts={allAccounts}
                isFree={isFree}
                overLimit={overLimit}
                onEstimateResolved={() => loadItems(false)}
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
                expanded={!collapsedIds.has(item.id)}
                onToggle={() => toggleExpand(item.id)}
                onSync={() => {}}
                onAddAccounts={() => {}}
                onDisconnect={() => handleDelete(item.id, item.institutionName ?? "Manual")}
                allAccounts={allAccounts}
                isFree={isFree}
                overLimit={overLimit}
                onEstimateResolved={() => loadItems(false)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Add an account — always available below the lists. */}
      {!loading && items.length > 0 && !isDemoMode && (
        <button
          type="button"
          onClick={() => setShowManualModal(true)}
          className="ui-focus group mt-[18px] flex w-full items-center justify-center gap-2 rounded-ui-xl border border-dashed border-line-strong bg-canvas-sunken/40 px-4 py-4 text-[13.5px] font-bold text-content-secondary transition-colors hover:border-brand hover:bg-brand-softer hover:text-brand min-h-touch"
        >
          <Plus size={15} />
          Add an account
        </button>
      )}

      {/* ── Add Account Modal ── */}
      <Modal
        open={showManualModal}
        onClose={() => { setShowManualModal(false); resetManualForm(); }}
        title={
          activeType
            ? activeType.label
            : methodChoiceType
              ? methodChoiceType.label
              : "Add an account"
        }
        description={
          activeType || methodChoiceType
            ? undefined
            : "Pick an account type to connect it or enter it manually."
        }
        footer={
          activeType && estimating ? (
            <Button
              variant="primary"
              onClick={() => { setShowManualModal(false); resetManualForm(); }}
            >
              {estimating.status === "pending" ? "Continue in background" : "Done"}
            </Button>
          ) : activeType ? (
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
        {activeType && estimating ? (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-8 text-center">
            {estimating.status === "pending" ? (
              <>
                <RefreshCw size={22} className="animate-spin text-brand" />
                <div className="text-[14px] font-semibold text-content">Estimating value…</div>
                <p className="max-w-[19rem] text-[13px] text-content-secondary">
                  We’re looking up an estimate for this address. This usually takes about a minute — you can keep using the app while we finish.
                </p>
              </>
            ) : estimating.status === "ready" ? (
              <>
                <div className="text-[14px] font-semibold text-content">Estimated value</div>
                <div className="ui-tnum text-[26px] font-bold text-content">
                  {formatTotal(estimating.value)}
                </div>
                <p className="text-[13px] text-content-secondary">Added to your accounts.</p>
              </>
            ) : estimating.status === "timeout" ? (
              <>
                <div className="text-[14px] font-semibold text-content">
                  Taking longer than expected
                </div>
                <p className="max-w-[19rem] text-[13px] text-content-secondary">
                  We’re still working on it — refresh the account to check for the value.
                </p>
              </>
            ) : (
              <>
                <div className="text-[14px] font-semibold text-content">
                  Couldn’t estimate this address
                </div>
                <p className="max-w-[19rem] text-[13px] text-content-secondary">
                  Enter a value manually from the account’s page instead.
                </p>
              </>
            )}
          </div>
        ) : activeType ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-sunken px-2.5 py-1 text-[12px] font-semibold text-content-secondary">
                <span>{activeType.emoji}</span> {activeType.label}
              </span>
              <button
                type="button"
                onClick={() => { resetManualForm(); }}
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

            {activeType.type === "real_estate" && (
              <Field label="Address">
                <AddressAutocomplete
                  value={acctAddress}
                  onTextChange={(text) => {
                    setAcctAddress(text);
                    // Editing by hand invalidates the resolved geocode.
                    setAcctPlaceId("");
                    setAcctLat(null);
                    setAcctLng(null);
                    setAcctAddressRejected(false);
                  }}
                  onPick={(r) => {
                    setAcctAddress(r.address);
                    setAcctPlaceId(r.placeId);
                    setAcctLat(r.lat);
                    setAcctLng(r.lng);
                    setAcctAddressRejected(false);
                  }}
                  onReject={() => setAcctAddressRejected(true)}
                />
                {acctAddressRejected ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-negative">
                    Commercial properties aren't supported — enter a home address.
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
                    Add an address and we’ll estimate the value for you.
                  </p>
                )}
              </Field>
            )}

            {activeType.type === "real_estate" ? (
              <ValueSourceControl
                source={acctValueSource}
                onSourceChange={setAcctValueSource}
                ownValue={acctBalance}
                onOwnValueChange={setAcctBalance}
              />
            ) : (
              <Field label={activeType.isDebt ? "Amount owed" : "Balance"}>
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
            )}

            {offersLink && (
              <Field
                label={
                  activeType.type === "real_estate"
                    ? "Link a mortgage / loan (optional)"
                    : "Secured by a property (optional)"
                }
              >
                {addCounterpartAfter ? (
                  // The user chose "+ Add a new …": show the pending choice with a
                  // way to undo, in place of the picker. The counterpart's form
                  // opens (pre-linked) right after this account is created.
                  <div className="flex h-11 min-h-touch w-full items-center gap-2.5 rounded-ui-md border border-brand bg-brand-soft pl-3 pr-1.5 text-sm text-content shadow-ui-sm">
                    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-ui-sm bg-brand-softer text-brand">
                      <Plus className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {activeType.type === "real_estate"
                        ? "New mortgage — we'll set it up next"
                        : "New property — we'll set it up next"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAddCounterpartAfter(false)}
                      aria-label="Undo"
                      className="ui-focus grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm text-content-muted hover:bg-panel hover:text-content"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <AccountLinkPicker
                    options={linkCandidateOptions}
                    value={pendingLinkedId ?? ""}
                    onChange={(v) => setPendingLinkedId(v || null)}
                    placeholder={
                      activeType.type === "real_estate" ? "No mortgage" : "No property"
                    }
                    addLabel={
                      activeType.type === "real_estate"
                        ? "Add a new mortgage"
                        : "Add a new property"
                    }
                    onAdd={() => {
                      setPendingLinkedId(null);
                      setAddCounterpartAfter(true);
                    }}
                  />
                )}
                <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
                  {activeType.type === "real_estate"
                    ? "Tie an existing mortgage to this property so we can show your equity. You can also add one later."
                    : "Tie this loan to the property it's secured by. You can also add one later."}
                </p>
              </Field>
            )}

            {activeType.type === "real_estate" && activeType.subtype === "rental" && (
              <>
                <Field label="Monthly rent">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={rentMonthly}
                    onChange={(e) => setRentMonthly(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0"
                    className="ui-tnum"
                    leadingIcon={<span className="text-[13px]">$</span>}
                  />
                </Field>

                <Field label="Annual insurance">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={insAnnual}
                    onChange={(e) => setInsAnnual(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0"
                    className="ui-tnum"
                    leadingIcon={<span className="text-[13px]">$</span>}
                  />
                </Field>

                <Field label="Annual maintenance">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={maintAnnual}
                    onChange={(e) => setMaintAnnual(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0"
                    className="ui-tnum"
                    leadingIcon={<span className="text-[13px]">$</span>}
                  />
                </Field>
              </>
            )}

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
        ) : methodChoiceType ? (
          // Step 2a — Plaid-eligible type: connect automatically or enter by hand.
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-sunken px-2.5 py-1 text-[12px] font-semibold text-content-secondary">
                <span>{methodChoiceType.emoji}</span> {methodChoiceType.label}
              </span>
              <button
                type="button"
                onClick={() => setMethodChoiceType(null)}
                className="ui-focus ml-auto rounded-ui-sm text-[13px] font-semibold text-[rgb(var(--ui-brand-ink))] hover:opacity-80"
              >
                change type
              </button>
            </div>

            <button
              type="button"
              onClick={() => { setShowManualModal(false); resetManualForm(); handleLink(); }}
              disabled={linking}
              className="ui-focus group flex items-start gap-3.5 rounded-ui-lg border border-line bg-panel px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-brand hover:shadow-ui-sm disabled:opacity-60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-brand">
                <Zap size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-content">Connect automatically</span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-content-muted">
                  Securely link your institution so balances and transactions update on their own.
                </span>
              </span>
              <span className="mt-1 text-content-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </button>

            <button
              type="button"
              onClick={() => enterManualForm(methodChoiceType)}
              className="ui-focus group flex items-start gap-3.5 rounded-ui-lg border border-line bg-panel px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-ui-sm"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-content-secondary">
                <Pencil size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-content">Enter manually</span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-content-muted">
                  Add a balance yourself — a snapshot you can update anytime.
                </span>
              </span>
              <span className="mt-1 text-content-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          // Step 1 — grouped type picker.
          <div className="flex flex-col gap-5">
            {ACCOUNT_TYPE_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted">
                  {group.title}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group.types.map((at) => (
                    <button
                      key={at.label}
                      type="button"
                      onClick={() => selectType(at)}
                      className="ui-focus group flex min-h-touch items-center gap-3 rounded-ui-md border border-line bg-panel px-3.5 py-3 text-left text-[13.5px] font-semibold text-content-secondary transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-ui-sm"
                    >
                      <span className="text-[16px] leading-none">{at.emoji}</span>
                      <span className="leading-tight text-content">{at.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// First-connect empty state — the marquee moment for a brand-new user.
// ---------------------------------------------------------------------------

function FirstConnectEmptyState({
  isDemoMode, onAddAccount,
}: {
  isDemoMode: boolean;
  onAddAccount: () => void;
}) {
  const reassurances = [
    { icon: <ShieldCheck size={15} />, text: "Bank-level encryption" },
    { icon: <Lock size={15} />, text: "Read-only — we can't move money" },
    { icon: <Zap size={15} />, text: "Balances update automatically" },
  ];
  return (
    <section className="relative mt-7 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm px-6 py-10 sm:px-10 sm:py-12">
      {/* atmospheric wash — periwinkle + brand, matching the Money hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(110% 80% at 100% 0%, var(--ui-info-soft), transparent 58%)," +
            "radial-gradient(90% 70% at 0% 4%, var(--ui-accent-softer), transparent 60%)",
        }}
      />
      <div className="relative mx-auto flex max-w-md flex-col items-center text-center">
        <div className="grid h-14 w-14 place-items-center rounded-ui-lg bg-brand-soft text-brand shadow-ui-sm">
          <Building2 size={26} />
        </div>
        <h2 className="mt-5 font-editorial text-[22px] sm:text-[25px] font-bold tracking-[-0.022em]">
          Connect your first account
        </h2>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-content-muted">
          Link a bank, card, or brokerage to see balances, transactions, and your
          net-worth trend update on their own.
        </p>

        {!isDemoMode && (
          <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:justify-center">
            <Button
              variant="primary"
              className="w-full sm:w-auto"
              onClick={onAddAccount}
              leadingIcon={<Plus size={15} />}
            >
              Add account
            </Button>
          </div>
        )}

        <div className="mt-8 flex flex-col items-start gap-2.5 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-5">
          {reassurances.map((r) => (
            <div key={r.text} className="flex items-center gap-2 text-[12.5px] font-semibold text-content-muted">
              <span className="text-brand">{r.icon}</span>
              {r.text}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section header — accent dot + tracked label + right-aligned count
// ---------------------------------------------------------------------------

function SectionHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span
          className="h-[7px] w-[7px] shrink-0 rounded-full bg-[rgb(var(--ui-accent))]"
          style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
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
      ) : isManual ? (
        <Pencil size={size * 0.4} className="text-content-muted" />
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
  onAddAccounts,
  onDisconnect,
  allAccounts,
  isFree,
  overLimit,
  onEstimateResolved,
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
  onAddAccounts: () => void;
  onDisconnect: () => void;
  allAccounts: Account[];
  isFree: boolean;
  overLimit: boolean;
  onEstimateResolved: () => void;
}) {
  const isError = isItemError(item);
  const statusLabel = isManual
    ? "Manual entry"
    : isError
    ? "Needs attention"
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
        isHighlighted ? "border-brand" : isError ? "border-caution/40" : "border-line",
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
        <InstIcon institution={institutionName} isManual={isManual} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-editorial text-[17px] font-bold leading-tight tracking-[-0.01em]" title={institutionName}>
            {institutionName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-content-muted">
            <span className={cn("inline-flex items-center gap-1 font-semibold", isError && "text-caution")}>
              {isError && <AlertTriangle size={11} strokeWidth={2.4} aria-hidden="true" />}
              {statusLabel}
            </span>
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
        <span className="grid h-6 w-6 shrink-0 place-items-center text-content-faint">
          <ChevronDown size={18} className={cn("transition-transform duration-200 ease-ui", !expanded && "-rotate-90")} />
        </span>
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
                  overLimit={overLimit}
                  onEstimateResolved={onEstimateResolved}
                  linkedAccountName={account.propertyAccountId
                    ? allAccounts.find((a) => a.id === account.propertyAccountId)?.name ?? null
                    : allAccounts.find((a) => a.propertyAccountId === account.id)?.name ?? null}
                />
              ))}
            </div>
          )}

          {!isDemoMode && !isManual && (
            <div className="flex flex-wrap items-center gap-1 border-t border-line px-4 py-2.5 sm:px-5">
              <button
                type="button"
                onClick={onAddAccounts}
                className="ui-focus inline-flex min-h-touch items-center gap-1.5 rounded-ui-sm px-2.5 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-softer"
              >
                <Plus size={14} />
                Add accounts
              </button>
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
// Account row — name/mask · type · balance with status pill · chevron.
// The whole row navigates to the account detail page (edit/sync/delete live
// there); no per-row overflow menu.
// ---------------------------------------------------------------------------

function AccountRow({ account, overLimit, linkedAccountName, onEstimateResolved }: {
  account: Account; overLimit: boolean;
  linkedAccountName: string | null;
  onEstimateResolved: () => void;
}) {
  const balance = account.balance !== null ? parseFloat(account.balance) : null;
  const isNegative = balance !== null && balance < 0;
  const isFrozen = account.frozen === true;
  const [, setLocation] = useLocation();
  const openSettings = () => setLocation("/accounts/" + account.id);

  // A property whose value estimate is still pending — surface an "Estimating…"
  // pill and poll the estimate in the background so a value that lands after the
  // create modal closed still shows here. Ends on ready/failed (parent reloads
  // on ready). status pending → keep the pill; anything else clears it.
  const veStatus = (account.metadata?.valueEstimate as { status?: string } | undefined)?.status;
  const [estimating, setEstimating] = useState(veStatus === "pending");
  useEffect(() => {
    setEstimating(veStatus === "pending");
    if (veStatus !== "pending") return;
    let cancelled = false;
    const deadline = Date.now() + 5 * 60 * 1000;
    const tick = async () => {
      if (cancelled || Date.now() > deadline) { if (!cancelled) setEstimating(false); return; }
      try {
        const res = await api.getValueEstimate(account.id);
        if (cancelled) return;
        if (res.status === "ready") { setEstimating(false); onEstimateResolved(); return; }
        if (res.status === "failed" || res.status === "none") { setEstimating(false); return; }
      } catch {
        // transient — keep polling until the cap
      }
      if (!cancelled) setTimeout(tick, 10_000);
    };
    const t = setTimeout(tick, 10_000);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veStatus, account.id]);

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
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-3.5">
        <div className="text-right">
          <div className={cn("font-editorial text-[15px] font-extrabold tracking-[-0.015em] ui-tnum", isNegative && "text-negative")}>
            {balance !== null
              ? (isNegative ? "−" : "") + formatCurrency(String(Math.abs(balance)), account.currency)
              : "—"}
          </div>
          {isFrozen ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info">
              <Lock size={10} strokeWidth={2.2} aria-hidden="true" /> Frozen
            </span>
          ) : overLimit ? (
            <span className="mt-1 inline-flex items-center rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-bold text-positive">
              Active
            </span>
          ) : estimating ? (
            <span
              role="status"
              aria-live="polite"
              className="mt-1 inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info"
            >
              <RefreshCw size={10} strokeWidth={2.2} className="animate-spin" aria-hidden="true" /> Estimating…
            </span>
          ) : account.valueSource ? (
            <span className="mt-1 inline-flex">
              <ValueSourceBadge source={account.valueSource} />
            </span>
          ) : null}
        </div>

        <ChevronRight size={16} className="shrink-0 text-content-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
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
