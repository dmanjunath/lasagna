import { useEffect, useState, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
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
import { HIDDEN_AMOUNT, isAmountsHidden } from "../lib/hide-amounts";
import { HiddenAmount, MoneyInput } from "../components/uikit";
import { isNativeApp } from "../lib/native";
import { useBilling, startUpgrade } from "../lib/billing";
import { cn, stripAccountMask } from "../lib/utils";
import { accountTypeKey, accountTypeLabel, accountTypesIn, type AccountTypeOption } from "../lib/account-types";
import { Alert, Button, Field, Input, Modal, PageMeta, PageMetaItem, PageMetaSkeleton, Select, Skeleton } from "../components/uikit";
import { useConfirm } from "../components/ds";
import { PageTitle } from "../components/ds/PageTitle";
import { faviconUrl, institutionDomainFor } from "../components/ds/institutions";
import { AccountLinkPicker, type AccountPickerOption } from "../components/common/AccountLinkPicker";
import { AddressAutocomplete } from "../components/common/AddressAutocomplete";
import { ValueSourceBadge } from "../components/common/ValueSourceBadge";
import { ValueSourceControl, type ValueSourceChoice } from "../components/common/ValueSourceControl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: string, currency: string): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  const num = parseFloat(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatTotal(n: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// What the create route's 400s say, in the words of the field the person filled
// in. The route names the column and its limit ("apr must be a number between 0
// and 99.99"), which is a developer string, not an answer to act on. Anything
// else falls through to the generic message.
const ADD_ERROR_COPY: Record<string, string> = {
  name: "That name is too long. Try a shorter one.",
  apr: "Enter a rate between 0 and 99.99.",
  type: "Choose an account type.",
  subtype: "Choose an account type.",
};

const GENERIC_ADD_ERROR = "We couldn't add this account. Try again.";

function friendlyAddError(raw: string | undefined): string {
  const field = raw?.match(/^(\w+) must /)?.[1];
  return (field && ADD_ERROR_COPY[field]) || GENERIC_ADD_ERROR;
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
// Add-account picker — the top-level choices the modal opens on.
// ---------------------------------------------------------------------------

// How selecting a top-level option routes:
//   "plaid"       → connect-or-manual choice (Plaid is the preferred path)
//   "realEstate"  → straight into the real-estate form (address + estimate)
//   "manual"      → straight into the manual form
// ("Describe to add" is its own button below the list — it creates nothing here.)
type AddRoute = "plaid" | "realEstate" | "manual";

interface AddOption {
  label: string;
  hint: string;
  emoji: string;
  route: AddRoute;
  // The account types this option can create. More than one renders a Select at
  // the top of the manual form, labelled `typeLabel`, because the specific type
  // is what decides the tax bucket, the debt maths and the rest of the fields.
  types: AccountTypeOption[];
  typeLabel?: string;
  // Set where the type answer actually adds fields below it, so the form is
  // taller after a type is picked than it was before. A category can offer seven
  // types and still render the same fields for every one of them, so the count of
  // types says nothing about this — and only this is worth a full-height phone
  // tray.
  growsWithType?: boolean;
}

// The "Manual" card is a deliberate catch-all: one untyped account for anything
// with a balance. It names no specific kind, so it isn't in the catalog.
const MANUAL_CATCH_ALL: AccountTypeOption = {
  label: "Manual account",
  type: "depository",
  subtype: null,
  isDebt: false,
  category: "bank",
};

// A monthly payment is asked for on an amortising loan only. A card's minimum is
// a percentage of its balance, and a mortgage with a rate amortises over its
// term, so for those the estimate is already right. For an auto or student loan
// it isn't: without a payment on file they get the card-shaped 2%-of-balance
// estimate (api/lib/debt-accounts).
const asksMinPayment = (t: AccountTypeOption) => t.type === "loan" && t.subtype !== "mortgage";

const ADD_OPTIONS: AddOption[] = [
  {
    label: "Bank & Investments",
    hint: "Checking, savings, cash & brokerage",
    emoji: "💵",
    route: "plaid",
    typeLabel: "Account type",
    types: accountTypesIn("bank"),
  },
  {
    label: "Debt",
    hint: "Credit cards, Klarna, Afterpay, mortgage",
    emoji: "💳",
    route: "plaid",
    typeLabel: "Debt type",
    types: accountTypesIn("debt"),
    // Picking a type adds the interest rate, a mortgage adds the property link,
    // and the amortising loans add a monthly payment.
    growsWithType: true,
  },
  {
    label: "Real Estate",
    hint: "Home or rental. We'll estimate its value",
    emoji: "🏡",
    route: "realEstate",
    typeLabel: "Property type",
    types: accountTypesIn("realEstate"),
    // A rental adds rent, insurance and maintenance.
    growsWithType: true,
  },
  {
    label: "Other",
    hint: "Jewellery, watches, cars & more",
    emoji: "💎",
    route: "manual",
    types: accountTypesIn("other"),
  },
  {
    label: "Manual",
    hint: "Add any account with a balance yourself",
    emoji: "✏️",
    route: "manual",
    types: [MANUAL_CATCH_ALL],
  },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Accounts() {
  const confirm = useConfirm();
  const [, navigate] = useLocation();
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
  //   nothing set          → top-level picker (step 1)
  //   methodChoice set     → connect/manual choice (step 2a)
  //   formOption set       → the manual form (step 2b)
  // Back clears one pointer at a time, so the render order below walks the user
  // back through exactly the steps they came in by.
  const [showManualModal, setShowManualModal] = useState(false);
  // A Plaid-eligible category awaiting the connect-vs-manual choice.
  const [methodChoice, setMethodChoice] = useState<AddOption | null>(null);
  // The category whose manual form is open, and the specific type chosen in it.
  // activeType stays null until the user picks one (a category with a single
  // type picks it for them) — nothing is submitted under a guessed type.
  const [formOption, setFormOption] = useState<AddOption | null>(null);
  const [activeType, setActiveType] = useState<AccountTypeOption | null>(null);
  // The category the values currently in the fields were typed under. Back keeps
  // them, so only picking a *different* category clears them.
  const [typedUnder, setTypedUnder] = useState<string | null>(null);
  const [acctName, setAcctName] = useState("");
  const [acctBalance, setAcctBalance] = useState("");
  const [acctRate, setAcctRate] = useState("");
  const [acctMinPayment, setAcctMinPayment] = useState("");
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
  // A rejected create, shown inside the modal. The page-level banner sits behind
  // the overlay, so a failure there is invisible while the form is still open.
  const [addError, setAddError] = useState("");
  const addErrorRef = useRef<HTMLDivElement>(null);
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
  // Every way out of the add dialog stays live while a create is in flight, so a
  // create can outlive the form it was started from. Each submit takes the next
  // number here, and every way of leaving that form burns one too (see
  // `leaveAddRun` — the only thing that moves this). The POST still lands and the
  // refetch surfaces the account, but a create whose number has moved on no
  // longer drives what's on screen.
  const addRun = useRef(0);
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
    if (!openFormForType(type, subtype ?? null)) return;
    if (link) setPendingLinkedId(link);
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
      setError("Bank connections aren't available in the app yet. Connect from the web and your accounts will sync here.");
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
      setError("Bank connections aren't available in the app yet. Connect from the web and your accounts will sync here.");
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
    setError("");
    try {
      await api.deleteItem(id);
    } catch {
      // The item is still connected at Plaid, so it stays in the list. Saying
      // nothing would look like the disconnect worked.
      setError(`Could not disconnect ${institutionName}. Please try again.`);
      return;
    }
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

  const clearFormFields = () => {
    setAcctName("");
    setAcctBalance("");
    setAcctRate("");
    setAcctMinPayment("");
    setRentMonthly("");
    setInsAnnual("");
    setMaintAnnual("");
    setAcctAddress("");
    setAcctPlaceId("");
    setAcctLat(null);
    setAcctLng(null);
    setAcctAddressRejected(false);
    setAcctValueSource("market");
    setAddError("");
  };

  // Full wipe back to step 1. Wired only to Cancel, close, and a successful
  // create — Back moves the step pointer and keeps everything typed.
  const resetManualForm = () => {
    setFormOption(null);
    setMethodChoice(null);
    setActiveType(null);
    setTypedUnder(null);
    setEstimating(null);
    setPendingLinkedId(null);
    setAddCounterpartAfter(false);
    clearFormFields();
  };

  // Leave the form a create was started from — closing the dialog, but also
  // stepping back to an earlier step or walking off the page. The create keeps
  // going and still lands, but its number has moved on, so it no longer writes
  // over whatever the user moved on to. The spinner goes with it: the button it
  // belonged to isn't on screen any more. Every such exit must come through
  // here.
  const leaveAddRun = () => {
    addRun.current += 1;
    setAddingAccount(false);
  };

  // Every way out of the dialog: the X, Escape, the overlay, the swipe, Cancel.
  const closeAddModal = () => {
    leaveAddRun();
    setShowManualModal(false);
    resetManualForm();
  };

  // Open the manual form for a category. A single-type category picks its type;
  // anything else waits for the Select. Never clears what's already typed.
  const enterManualForm = (opt: AddOption) => {
    setFormOption(opt);
    setTypedUnder(opt.label);
    if (opt.types.length === 1) setActiveType(opt.types[0]);
  };

  // Open the manual form already set to a specific type — deep links and the
  // property↔mortgage chain. A link that names no subtype opens the right
  // category with the Select still unanswered rather than guessing one.
  const openFormForType = (type: string, subtype: string | null) => {
    const exact = (o: AddOption) => o.types.find((t) => t.type === type && t.subtype === subtype);
    const opt = ADD_OPTIONS.find(exact) ?? ADD_OPTIONS.find((o) => o.types.some((t) => t.type === type));
    if (!opt) return false;
    setFormOption(opt);
    setTypedUnder(opt.label);
    setActiveType(exact(opt) ?? (opt.types.length === 1 ? opt.types[0] : null));
    return true;
  };

  // A type change re-renders the rest of the form off the new type. It must not
  // leave a counterpart link behind for a type that doesn't offer one.
  const chooseType = (key: string) => {
    const next = formOption?.types.find((t) => accountTypeKey(t.type, t.subtype) === key);
    if (!next) return;
    // A card's purchase APR and a loan's interest rate are different numbers, so
    // a rate typed for one must not ride across to the other — 19.5 is an
    // ordinary card, and a mortgage nobody has. Loan to loan keeps it: the same
    // rate still means the same thing.
    if (activeType && activeType.isDebt && next.isDebt && activeType.type !== next.type) {
      setAcctRate("");
    }
    setActiveType(next);
    if (next.type !== "real_estate" && next.subtype !== "mortgage") {
      setPendingLinkedId(null);
      setAddCounterpartAfter(false);
    }
  };

  // Step 1 → step 2. Each top-level option routes to its own next step:
  //   plaid      → connect-or-manual choice (Plaid preferred)
  //   realEstate → straight into the property form
  //   manual     → straight into the manual form
  const selectOption = (opt: AddOption) => {
    // Coming back to step 1 keeps the fields, so switching category is the one
    // moment they stop applying.
    if (typedUnder && typedUnder !== opt.label) {
      clearFormFields();
      setActiveType(null);
      setPendingLinkedId(null);
      setAddCounterpartAfter(false);
    }
    if (opt.route === "plaid") {
      setMethodChoice(opt);
      setTypedUnder(opt.label);
    } else {
      // realEstate + manual both drop straight into the form.
      enterManualForm(opt);
    }
  };

  const startDescribe = () => {
    leaveAddRun();
    setShowManualModal(false);
    resetManualForm();
    navigate("/quick-import");
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
    const run = ++addRun.current;
    const onScreen = () => addRun.current === run;
    setAddingAccount(true);
    setAddError("");
    // A rate out of the column's range (numeric(6,4)) is dropped rather than
    // sent, so a typo can't fail the whole create.
    const rateTyped = acctRate.trim() !== "" ? Number(acctRate) : NaN;
    const rate = Number.isFinite(rateTyped) && rateTyped >= 0 && rateTyped <= 99.99 ? rateTyped : null;
    try {
      const metadata: Record<string, unknown> = {};
      if (activeType.isDebt) {
        // The typed liability shape (core/liability-metadata) — what
        // resolveDebtApr, the Debt page and the loan-details PATCH all read. The
        // legacy untyped `interestRate` key never reached accounts.apr, so a rate
        // entered here was invisible to the chat tools.
        const loanType =
          activeType.type === "credit"
            ? "credit_card"
            : activeType.subtype === "mortgage"
              ? "mortgage"
              : activeType.subtype === "student"
                ? "student_loan"
                : "other_loan";
        metadata.type = loanType;
        metadata.source = "manual";
        if (rate !== null) {
          if (loanType === "credit_card") {
            metadata.aprs = [{ aprType: "purchase_apr", aprPercentage: rate }];
          } else {
            metadata.interestRatePercentage = rate;
          }
        }
        const minPay = acctMinPayment.trim() !== "" ? Number(acctMinPayment) : NaN;
        if (asksMinPayment(activeType) && Number.isFinite(minPay) && minPay >= 0) {
          metadata.minimumPaymentAmount = minPay;
        }
      }
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
        subtype: activeType.subtype ?? undefined,
        balance: hasManualValue ? parseFloat(acctBalance) : willEstimate ? undefined : 0,
        // Column and metadata carry the same rate, the way the loan-details
        // PATCH keeps them in sync.
        ...(activeType.isDebt && rate !== null ? { apr: rate } : {}),
        metadata: Object.keys(metadata).length ? metadata : undefined,
        // Pin the typed value as a durable override so the estimate never
        // overwrites it (matches the detail/edit page's "My own value").
        ...(ownValueChosen ? { valueSource: "own" as const } : {}),
        linkedAccountId: pendingLinkedId || undefined,
      });

      // The dialog this create was started from is gone. The account is made,
      // so refresh the list and stop: everything below drives a dialog — an
      // estimating spinner, the counterpart form, a follow-up banner — that is
      // no longer this create's.
      if (!onScreen()) {
        loadItems();
        return;
      }

      const justAdded = activeType;
      const createdId = result.account.id;
      // The user chose "+ Add a new <counterpart>" in the link picker: after this
      // account is created, advance the modal straight to the counterpart's add
      // form, pre-linked to it (reuses the same pendingLinkedId flow as the
      // post-create banner). The counterpart type comes from the shared catalog.
      const chainCounterpart = addCounterpartAfter;

      // Open the counterpart's add form pre-linked to the just-created account.
      const openCounterpartForm = () => {
        resetManualForm();
        setPendingLinkedId(createdId);
        if (justAdded.type === "real_estate") openFormForType("loan", "mortgage");
        else openFormForType("real_estate", null);
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
            openFormForType("loan", "mortgage");
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
            openFormForType("real_estate", null);
            setShowManualModal(true);
          },
        });
      }
    } catch (err) {
      // Nowhere to show it once the dialog is gone, and holding it would surface
      // this failure on the next form the user opens.
      if (!onScreen()) return;
      // Surfaced inside the modal: the form is still open over the page banner.
      setAddError(friendlyAddError(err instanceof Error ? err.message : undefined));
      setTimeout(() => addErrorRef.current?.scrollIntoView({ block: "nearest" }), 0);
    } finally {
      // Closing already cleared it, and a later create may own the button now.
      if (onScreen()) setAddingAccount(false);
    }
  };

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

  const allAccounts = items.flatMap((i) => i.accounts);
  const totalAccounts = allAccounts.length;

  // Link-counterpart candidates for the add form. A property is secured by a
  // mortgage/loan (never a credit card), so the property form offers unlinked
  // `loan` accounts and the mortgage form offers real_estate accounts.
  // Which type the common part of the form is shaped by. Before a type is chosen
  // the category's first option stands in: every type within a category agrees on
  // asset-vs-debt and on whether it's a property, so the fields above the Select
  // answer never move once a type is picked.
  const formShape = formOption ? activeType ?? formOption.types[0] : null;
  const linkCandidateOptions: AccountPickerOption[] = items.flatMap((i) =>
    i.accounts
      .filter((a) => {
        if (!formShape) return false;
        if (formShape.type === "real_estate") return a.type === "loan" && !a.propertyAccountId;
        if (formShape.subtype === "mortgage") return a.type === "real_estate";
        return false;
      })
      .map((a) => ({
        id: a.id,
        name: a.name,
        institution: i.institutionName || "Manual",
        meta: accountTypeLabel(a.type, a.subtype),
      })),
  );
  const offersLink =
    !!formShape && (formShape.type === "real_estate" || formShape.subtype === "mortgage");

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
  const headerTags: ReactNode[] = [];
  if (totalAccounts > 0)
    headerTags.push(
      <PageMetaItem key="accounts" className="ui-tnum">{`${totalAccounts} account${totalAccounts !== 1 ? "s" : ""}`}</PageMetaItem>,
    );
  if (items.length > 0)
    headerTags.push(
      <PageMetaItem key="institutions" className="ui-tnum">{`${items.length} institution${items.length !== 1 ? "s" : ""}`}</PageMetaItem>,
    );
  if (totalTracked > 0)
    headerTags.push(
      <PageMetaItem key="tracked" className="ui-tnum">{`${formatTotal(totalTracked)} tracked`}</PageMetaItem>,
    );
  if (lastSync)
    headerTags.push(
      <PageMetaItem key="synced" className="ui-tnum">{`Synced ${formatRelativeTime(lastSync)}`}</PageMetaItem>,
    );

  const usedPct = billing
    ? Math.max(0, Math.min(100, (billing.usage.accounts / Math.max(1, billing.usage.maxAccounts)) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-[1040px] px-3 sm:px-12 pt-4 md:pt-10 pb-6 sm:pb-28 text-content">
      {/* ── Page header — mirrors /money: title, live caption, action cluster ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <PageTitle>Accounts</PageTitle>
          <PageMeta className="mt-0 md:mt-1.5">
            {loading ? (
              // Widths of the four runs below, so the placeholder wraps where
              // they wrap and the header holds still on load.
              <PageMetaSkeleton widths={['w-20', 'w-[76px]', 'w-32', 'w-[105px]']} />
            ) : (
              headerTags
            )}
          </PageMeta>
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
            <span className="text-[13px] font-semibold text-content-muted">
              Free plan account limit
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
                      ? "Login expired. Reconnect to resume syncing."
                      : "Sync error. Try reconnecting."}
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
          className="ui-focus group mt-[18px] flex h-12 w-full items-center justify-center gap-2 rounded-ui-xl border border-dashed border-line-strong bg-canvas-sunken/40 px-4 text-[13.5px] font-bold text-content-secondary transition-colors hover:border-brand hover:bg-brand-softer hover:text-brand min-h-touch"
        >
          <Plus size={15} />
          Add an account
        </button>
      )}

      {/* ── Add Account Modal ── */}
      <Modal
        open={showManualModal}
        onClose={closeAddModal}
        // Back walks one step: form → connect-vs-manual (or straight to the
        // picker when the category never offered it) → picker. It only moves the
        // step, so nothing typed is lost either way. It does leave the run,
        // though: the step it came from is the one an in-flight create belongs
        // to, and that create must not land on the step being walked to.
        // `null` rather than undefined: this dialog has steps, so the header
        // holds the Back slot open even where there's nowhere back to, and the
        // title doesn't slide sideways between steps.
        onBack={
          estimating
            ? null
            : formOption
              ? () => { leaveAddRun(); setFormOption(null); }
              : methodChoice
                ? () => { leaveAddRun(); setMethodChoice(null); }
                : null
        }
        // The type answer re-shapes the form beneath it, so the panel grows
        // downward instead of recentring under what's already filled in.
        stableTop
        // A full-height tray costs the empty sheet below a short form, so only a
        // form that actually grows under its type answer takes one. Everything
        // else, including a category whose every type renders the same fields,
        // sizes to its content.
        stableTopOnPhone={!!formOption?.growsWithType && !estimating}
        title={formOption?.label ?? methodChoice?.label ?? "Add an account"}
        description={
          formOption || methodChoice
            ? undefined
            : "Pick an account type to connect it or enter it manually."
        }
        footer={
          formOption && estimating ? (
            <Button variant="primary" onClick={closeAddModal}>
              {estimating.status === "pending" ? "Continue in background" : "Done"}
            </Button>
          ) : formOption ? (
          <>
            <Button variant="ghost" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAddManualAccount}
              disabled={!activeType || !acctName.trim() || addingAccount}
              loading={addingAccount}
              leadingIcon={<Plus size={15} />}
            >
              {addingAccount ? "Adding…" : "Add account"}
            </Button>
          </>
        ) : undefined}
      >
        {formOption && estimating ? (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-8 text-center">
            {estimating.status === "pending" ? (
              <>
                <RefreshCw size={22} className="animate-spin text-brand" />
                <div className="text-[14px] font-semibold text-content">Estimating value…</div>
                <p className="max-w-[19rem] text-[13px] text-content-secondary">
                  We’re looking up an estimate for this address. This usually takes about a minute, and you can keep using the app while we finish.
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
                  We’re still working on it. Refresh the account to check for the value.
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
        ) : formOption ? (
          <div className="flex flex-col gap-5">
            {/* The type comes first: it decides what the rest of the form is, so
                every type-specific field appends below and nothing already
                filled in ever moves. */}
            {formOption.types.length > 1 && (
              <Field label={formOption.typeLabel ?? "Type"}>
                <Select
                  value={activeType ? accountTypeKey(activeType.type, activeType.subtype) : ""}
                  onChange={(e) => chooseType(e.target.value)}
                  // Unanswered reads as answered when the placeholder is full
                  // strength, so mute it until a type is picked.
                  className={activeType ? undefined : "text-content-muted"}
                  autoFocus
                >
                  <option value="" disabled>Choose a type…</option>
                  {formOption.types.map((t) => {
                    const key = accountTypeKey(t.type, t.subtype);
                    return <option key={key} value={key}>{t.label}</option>;
                  })}
                </Select>
              </Field>
            )}

            <Field label="Account name">
              <Input
                type="text"
                value={acctName}
                onChange={(e) => setAcctName(e.target.value)}
                autoFocus={formOption.types.length === 1}
              />
            </Field>

            {formShape?.type === "real_estate" && (
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
                    Commercial properties aren't supported. Enter a home address.
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
                    Add an address and we’ll estimate the value for you.
                  </p>
                )}
              </Field>
            )}

            {formShape?.type === "real_estate" ? (
              <ValueSourceControl
                source={acctValueSource}
                onSourceChange={setAcctValueSource}
                ownValue={acctBalance}
                onOwnValueChange={setAcctBalance}
              />
            ) : (
              <Field label={formShape?.isDebt ? "Amount owed" : "Balance"}>
                <MoneyInput
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
                  formShape?.type === "real_estate"
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
                      {formShape?.type === "real_estate"
                        ? "New mortgage (we'll set it up next)"
                        : "New property (we'll set it up next)"}
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
                      formShape?.type === "real_estate" ? "No mortgage" : "No property"
                    }
                    addLabel={
                      formShape?.type === "real_estate"
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
                  {formShape?.type === "real_estate"
                    ? "Tie an existing mortgage to this property so we can show your equity. You can also add one later."
                    : "Tie this loan to the property it's secured by. You can also add one later."}
                </p>
              </Field>
            )}

            {activeType?.type === "real_estate" && activeType.subtype === "rental" && (
              <>
                <Field label="Monthly rent">
                  <MoneyInput
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
                  <MoneyInput
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
                  <MoneyInput
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

            {activeType?.isDebt && (
              <Field label="Interest rate (%)">
                <Input
                  type="number"
                  min={0}
                  max={99.99}
                  step={0.01}
                  value={acctRate}
                  onChange={(e) => setAcctRate(e.target.value)}
                  placeholder={activeType.type === "credit" ? "21.99" : "6.5"}
                  className="ui-tnum"
                />
              </Field>
            )}

            {activeType && asksMinPayment(activeType) && (
              <Field label="Monthly payment">
                <MoneyInput
                  type="text"
                  inputMode="decimal"
                  value={acctMinPayment}
                  onChange={(e) => setAcctMinPayment(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  className="ui-tnum"
                  leadingIcon={<span className="text-[13px]">$</span>}
                />
              </Field>
            )}

            {addError && (
              <div ref={addErrorRef}>
                <Alert tone="negative">{addError}</Alert>
              </div>
            )}
          </div>
        ) : methodChoice ? (
          // Step 2a — a Plaid-eligible category: connect automatically or by hand.
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => { leaveAddRun(); setShowManualModal(false); resetManualForm(); handleLink(); }}
              disabled={linking}
              className="ui-focus group flex items-start gap-3.5 rounded-ui-lg border border-line bg-panel px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-brand hover:shadow-ui-sm disabled:opacity-60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-brand">
                <Zap size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-content">Connect via Plaid</span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-content-muted">
                  Securely link your institution so balances and transactions update on their own.
                </span>
              </span>
              <span className="mt-1 text-content-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </button>

            <button
              type="button"
              onClick={() => enterManualForm(methodChoice)}
              className="ui-focus group flex items-start gap-3.5 rounded-ui-lg border border-line bg-panel px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-ui-sm"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-content-secondary">
                <Pencil size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-content">Enter manually</span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-content-muted">
                  Add a balance yourself: a snapshot you can update anytime.
                </span>
              </span>
              <span className="mt-1 text-content-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          // Step 1 — the six top-level choices.
          <div className="flex flex-col gap-2.5">
            {ADD_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => selectOption(opt)}
                className="ui-focus group flex min-h-touch items-center gap-3.5 rounded-ui-lg border border-line bg-panel px-4 py-3 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-ui-sm"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-[17px] leading-none">
                  {opt.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-content">{opt.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-content-muted">
                    {opt.hint}
                  </span>
                </span>
                <span className="text-content-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
              </button>
            ))}

            {/* Describe to add — the AI-magical path, set apart from the rest. */}
            <button
              type="button"
              onClick={startDescribe}
              className="ui-focus group relative mt-1.5 flex min-h-touch items-center gap-3.5 overflow-hidden rounded-ui-lg border border-brand/40 px-4 py-3 text-left shadow-ui-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-brand hover:shadow-ui-md"
              style={{
                background:
                  "radial-gradient(120% 140% at 0% 0%, var(--ui-accent-softer), transparent 60%)," +
                  "radial-gradient(120% 140% at 100% 100%, var(--ui-brand-softer), transparent 62%)",
              }}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-brand">
                <Sparkles size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[14px] font-bold text-content">Describe to add</span>
                  <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-brand">
                    AI
                  </span>
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-content-muted">
                  Type your accounts in plain English. We'll add them for you
                </span>
              </span>
              <span className="text-brand transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </button>
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
    { icon: <Lock size={15} />, text: "Read-only. We can't move money." },
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
// Section header - heading + right-aligned count
// ---------------------------------------------------------------------------

function SectionHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-[18px] font-semibold text-content">{title}</h2>
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
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-content-muted">
            <span className={cn("inline-flex items-center gap-1 font-semibold", isError && "text-caution")}>
              {isError && <AlertTriangle size={11} strokeWidth={2.4} aria-hidden="true" />}
              {statusLabel}
            </span>
            <span>{item.accounts.length} account{item.accounts.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <span className={cn("shrink-0 font-editorial text-[16px] font-extrabold tracking-[-0.015em] ui-tnum", totalNeg && "text-negative")}>
          {isAmountsHidden() ? <HiddenAmount /> : `${totalNeg ? "−" : ""}${formatTotal(Math.abs(total))}`}
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
                  lastSyncedAt={item.lastSyncedAt}
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

function AccountRow({ account, overLimit, linkedAccountName, lastSyncedAt, onEstimateResolved }: {
  account: Account; overLimit: boolean;
  linkedAccountName: string | null;
  /** Institution-level last-sync ISO — feeds the "Synced" badge hover tooltip. */
  lastSyncedAt: string | null;
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
              ••{account.mask}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-content-muted">
          <span>{accountTypeLabel(account.type, account.subtype)}</span>
          {linkedAccountName && <span>linked to {linkedAccountName}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-3.5">
        <div className="text-right">
          <div className={cn("font-editorial text-[15px] font-extrabold tracking-[-0.015em] ui-tnum", isNegative && "text-negative")}>
            {balance === null ? "—" : isAmountsHidden() ? (
              <HiddenAmount />
            ) : (
              (isNegative ? "−" : "") + formatCurrency(String(Math.abs(balance)), account.currency)
            )}
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
              <ValueSourceBadge source={account.valueSource} syncedAt={lastSyncedAt ?? undefined} onActivate={openSettings} />
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
