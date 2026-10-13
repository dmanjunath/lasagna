import { useCallback, useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  Plus,
  Pencil,
  Sparkles,
  Home,
  ChevronRight,
  X,
  Zap,
} from "lucide-react";
import { api } from "../../lib/api.js";
import { MoneyInput } from "../uikit";
import { isNativeApp } from "../../lib/native";
import { useBilling, startUpgrade } from "../../lib/billing";
import { accountTypeKey, accountTypeLabel, accountTypesIn, type AccountTypeOption } from "../../lib/account-types";
import { Alert, Button, Field, Input, Modal, TextLink, useToast } from "../uikit";
import { useConfirm } from "../ds";
import { faviconUrl, institutionDomainFor } from "../ds/institutions";
import { AccountLinkPicker, type AccountPickerOption } from "../common/AccountLinkPicker";
import { AddressAutocomplete } from "../common/AddressAutocomplete";
import { AccountTypeMenu } from "./AccountTypeMenu";
import { ValueSourceControl, type ValueSourceChoice } from "../common/ValueSourceControl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



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
// Add-account picker — the two forms behind the connect button.
// ---------------------------------------------------------------------------

interface AddOption {
  label: string;
  // The account types this option can create. More than one renders a Select at
  // the top of the form, labelled `typeLabel`, because the specific type is what
  // decides the tax bucket, the debt maths and the rest of the fields.
  types: AccountTypeOption[];
  typeLabel?: string;
  // Set where the type answer actually adds fields below it, so the form is
  // taller after a type is picked than it was before. A category can offer seven
  // types and still render the same fields for every one of them, so the count of
  // types says nothing about this — and only this is worth a full-height phone
  // tray.
  growsWithType?: boolean;
}

// A monthly payment is asked for on an amortising loan only. A card's minimum is
// a percentage of its balance, and a mortgage with a rate amortises over its
// term, so for those the estimate is already right. For an auto or student loan
// it isn't: without a payment on file they get the card-shaped 2%-of-balance
// estimate (api/lib/debt-accounts).
const asksMinPayment = (t: AccountTypeOption) => t.type === "loan" && t.subtype !== "mortgage";

// Connecting through Plaid works the type out for us, so a type is only ever
// asked for on the two by-hand paths: one form for anything with a balance, and
// one for a property (which is valued from an address instead).
const MANUAL_OPTION: AddOption = {
  label: "Add a balance manually",
  typeLabel: "Account type",
  types: [...accountTypesIn("bank"), ...accountTypesIn("other"), ...accountTypesIn("debt")],
  // A debt type adds the interest rate, a mortgage adds the property link, and
  // the amortising loans add a monthly payment.
  growsWithType: true,
};

const PROPERTY_OPTION: AddOption = {
  label: "Add a property",
  typeLabel: "Property type",
  types: accountTypesIn("realEstate"),
  // A rental adds rent, insurance and maintenance.
  growsWithType: true,
};

// Deep links (?add=<type>[:<subtype>]) resolve against these, most specific
// first: MANUAL_OPTION holds no property types, so a property falls through.
const ADD_OPTIONS: AddOption[] = [MANUAL_OPTION, PROPERTY_OPTION];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Everything about adding and updating connections, for the Accounts page.
 *
 * The page that used to own this (/accounts, "Connected accounts") was folded
 * into Money, which is now Accounts. This hook carries its flows unchanged:
 * Plaid Link for a new institution, Plaid's update mode to add accounts to a
 * connection you already have (or repair one that needs to reconnect), the
 * by-hand forms, and the deep links other pages use (?autoLink, ?reconnect,
 * ?add&link). The page renders `modal` and `banners`, and calls the actions.
 *
 * `onChanged` runs whenever the connections may have changed, so the page can
 * reload its own data.
 */
export function useAccountConnections({ onChanged }: { onChanged?: () => void } = {}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [, navigate] = useLocation();
  const { status: billing } = useBilling();
  // One source of truth for the plan. tenants.plan is the raw column, and only
  // /billing/status resolves a comped grant on top of it — reading the column
  // here showed a comped tenant the free chrome while the sidebar, which reads
  // billing, correctly showed Pro. An unknown plan reads as free, so a Pro-only
  // affordance (Sync all, the per-institution sync button) is never shown and
  // then taken away when billing lands a moment later.
  const isFree = billing ? billing.plan === "free" : true;
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newlyLinkedId, setNewlyLinkedId] = useState<string | null>(null);

  // Add-account modal state. Connect is the whole of step 1; the two by-hand
  // forms are the only second step, and Back returns to step 1.
  const [showManualModal, setShowManualModal] = useState(false);
  // The form that is open, and the specific type chosen in it. activeType stays
  // null until the user picks one (a form with a single type picks it for them)
  // — nothing is submitted under a guessed type.
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

  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const loadItems = (showLoader = true) => {
    if (showLoader) setLoading(true);
    api.getItems()
      .then((d) => setItems(d.items))
      .catch(() => setError("Failed to load accounts"))
      .finally(() => setLoading(false));
    onChangedRef.current?.();
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

  // ?reconnect=<itemId> — the account page's Reconnect lands here and starts
  // Plaid's update mode for that connection once the items have loaded.
  const reconnectFired = useRef(false);
  useEffect(() => {
    if (reconnectFired.current || loading) return;
    const itemId = new URLSearchParams(window.location.search).get("reconnect");
    if (!itemId) return;
    reconnectFired.current = true;
    window.history.replaceState({}, "", "/accounts");
    const item = items.find((i) => i.id === itemId);
    if (item) handleAddAccounts(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, items]);

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
        (await import("../../lib/load-plaid.js")).loadPlaidSdk(),
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
                  onChangedRef.current?.();
                  setSyncing(false);
                  setLinking(false);

                  if (newInst) {
                    setNewlyLinkedId(newInst.id);
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
            console.error(err);
            setError("Couldn't link that account. Try again.");
            setLinking(false);
          }
        },
        onExit: () => setLinking(false),
      });

      handler.open();
    } catch (err) {
      console.error(err);
      setError("Couldn't open the bank connection. Try again in a moment.");
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
        (await import("../../lib/load-plaid.js")).loadPlaidSdk(),
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
                  onChangedRef.current?.();
                  setSyncing(false);
                  setLinking(false);
                  setNewlyLinkedId(item.id);
                  setTimeout(() => setNewlyLinkedId(null), 3000);
                }
              } catch {
                clearInterval(poll);
                setSyncing(false);
                setLinking(false);
              }
            }, 2000);
          } catch {
            setError(`Couldn't update ${item.institutionName ?? "this connection"}. Try again.`);
            setLinking(false);
          }
        },
        onExit: () => setLinking(false),
      });

      handler.open();
    } catch {
      setError(`Couldn't open the connection to ${item.institutionName ?? "this institution"}. Try again.`);
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

  // The cap warning in the add dialog names upgrading as the way out, so it has
  // to offer it: on a phone the only other route is behind this modal's scrim.
  const [upgrading, setUpgrading] = useState(false);
  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      await startUpgrade();
    } catch (err) {
      // Toast, not the page banner: this is fired from inside the add dialog,
      // and the banner renders behind its scrim — blurred and half-clipped, so
      // a failed tap looked like nothing happened at all. Toast is z-[100] over
      // the modal's z-[90], and it is what plan-usage.tsx does for this call.
      toast({ tone: "negative", title: "Couldn't start checkout", description: "Try again in a moment." });
    } finally {
      setUpgrading(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setError("");
    try {
      await api.triggerSync();
      loadItems(false);
    } catch (err) {
      console.error(err);
      setError("Couldn't sync your accounts. Try again in a moment.");
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
      console.error(err);
      setError("Couldn't sync this account. Try again in a moment.");
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
    setActiveType(null);
    setTypedUnder(null);
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

  // Back walks one step: form → connect (see the Modal's onBack). Stable across
  // renders: Modal re-runs its focus effect when onBack changes, and that
  // effect's cleanup puts focus back on whatever held it, so a fresh function
  // per keystroke pulled focus out of the field being typed in.
  const backToConnect = useCallback(() => {
    leaveAddRun();
    setFormOption(null);
    // leaveAddRun reads only a ref and a setter, so the first render's copy is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Step 1 → the chosen form. Coming back to step 1 keeps the fields, so
  // switching to the other form is the one moment they stop applying.
  const selectOption = (opt: AddOption) => {
    if (typedUnder && typedUnder !== opt.label) {
      clearFormFields();
      setActiveType(null);
      setPendingLinkedId(null);
      setAddCounterpartAfter(false);
    }
    enterManualForm(opt);
  };

  // Close the dialog and hand straight off to Plaid. Connecting asks no type
  // question: Plaid already knows what each account is.
  const startConnect = () => {
    leaveAddRun();
    setShowManualModal(false);
    resetManualForm();
    handleLink();
  };

  const startDescribe = () => {
    leaveAddRun();
    setShowManualModal(false);
    resetManualForm();
    navigate("/quick-import");
  };

  // The quieter ways in, under the connect button. Equal weight to each other:
  // none of them is the recommended path, and the newest is not the loudest.
  const secondaryAdds = [
    { label: "Add a balance manually", icon: Pencil, run: () => selectOption(MANUAL_OPTION) },
    { label: "Add a property", icon: Home, run: () => selectOption(PROPERTY_OPTION) },
    { label: "Describe your accounts in plain English", icon: Sparkles, run: startDescribe },
  ];

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
      // so refresh the list and stop: everything below drives a dialog — the
      // counterpart form, a follow-up banner — that is
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

      const addedName = acctName.trim();

      // Chaining the counterpart: skip the banner, reset the form for the new
      // type, and advance the modal to the pre-linked counterpart form.
      if (chainCounterpart) {
        loadItems();
        openCounterpartForm();
        toast({ tone: "positive", title: `Added ${addedName}` });
        return;
      }

      // A property still being valued doesn't hold the dialog: its account row
      // polls the estimate and wears an "Estimating…" pill until it lands.
      resetManualForm();
      setPendingLinkedId(null);
      setShowManualModal(false);
      loadItems();
      toast({
        tone: "positive",
        title: `Added ${addedName}`,
        action: { label: "View account", onClick: () => navigate(`/accounts/${createdId}`) },
      });

      if (justAdded.type === "real_estate") {
        setLinkedBanner({
          message: "Have a mortgage on this property?",
          actionLabel: "Add the mortgage",
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
          actionLabel: "Add the property",
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
        type: a.type,
        isManual: i.institutionId === "manual",
        mask: a.mask,
      })),
  );
  const offersLink =
    !!formShape && (formShape.type === "real_estate" || formShape.subtype === "mortgage");

  // Connections a new account can be added to through Plaid's update mode.
  // A frozen institution is left out: an account added to it would freeze too.
  const native = isNativeApp();
  const addableItems = items.filter(
    (i) => i.institutionId !== "manual" && !(i.accounts.length > 0 && i.accounts.every((a) => a.frozen === true)),
  );

  // Close the dialog and run Plaid's update mode on an existing connection.
  const startAddTo = (item: PlaidItem) => {
    leaveAddRun();
    setShowManualModal(false);
    resetManualForm();
    handleAddAccounts(item);
  };

  const banners = (
    <>
      {error && <Alert tone="negative" className="mt-5">{error}</Alert>}
      {linkedBanner && (
        <Alert
          tone="info"
          className="mt-5"
          title={linkedBanner.message}
          action={
            <div className="flex items-center gap-1">
              <TextLink onClick={linkedBanner.onAction}>{linkedBanner.actionLabel}</TextLink>
              <button
                type="button"
                onClick={() => setLinkedBanner(null)}
                aria-label="Dismiss"
                className="ui-focus ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm text-content-muted hover:bg-canvas-sunken hover:text-content"
              >
                <X size={15} />
              </button>
            </div>
          }
        />
      )}
    </>
  );

  const modal = (
      <Modal
        open={showManualModal}
        onClose={closeAddModal}
        // Back walks one step: form → connect. It only moves the step, so
        // nothing typed is lost. It does leave the run, though: the step it came
        // from is the one an in-flight create belongs to, and that create must
        // not land on the step being walked to. `null` rather than undefined:
        // this dialog has steps, so the header holds the Back slot open even
        // where there's nowhere back to, and the title doesn't slide sideways
        // between steps.
        onBack={formOption ? backToConnect : null}
        // The type answer re-shapes the form beneath it, so the panel grows
        // downward instead of recentring under what's already filled in.
        stableTop
        // A full-height tray costs the empty sheet below a short form, so only a
        // form that actually grows under its type answer takes one. Everything
        // else, including a category whose every type renders the same fields,
        // sizes to its content.
        stableTopOnPhone={!!formOption?.growsWithType}
        title={formOption?.label ?? "Add an account"}
        footer={
          formOption ? (
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
        {formOption ? (
          <div className="flex flex-col gap-5">
            {/* The type comes first: it decides what the rest of the form is, so
                every type-specific field appends below and nothing already
                filled in ever moves. */}
            {formOption.types.length > 1 && (
              <Field label={formOption.typeLabel ?? "Type"}>
                <AccountTypeMenu
                  types={formOption.types}
                  value={activeType ? accountTypeKey(activeType.type, activeType.subtype) : ""}
                  onChange={chooseType}
                  ariaLabel={formOption.typeLabel ?? "Type"}
                  placeholder="Choose a type"
                  portal
                />
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
        ) : (
          // Step 1 — connecting is the whole answer for most people, and it asks
          // no type question: Plaid already knows what each account is. The ways
          // in for what Plaid cannot reach sit under it, equal to each other.
          <div className="flex flex-col gap-5">
            {/* At the cap, the next institution connects and then sits frozen.
                The plan meter lives in the sidebar, which on a phone is behind
                the hamburger — so without this the first the user hears of it is
                after handing over their bank credentials. */}
            {isFree && billing && billing.usage.institutions >= billing.usage.maxInstitutions && (
              <Alert
                tone="caution"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleUpgrade}
                    loading={upgrading}
                    disabled={upgrading}
                    // Reserves the slot the spinner takes, so the label does not
                    // shift right mid-flight. Same reason plan-usage does it.
                    leadingIcon={<Sparkles size={15} />}
                  >
                    Upgrade
                  </Button>
                }
              >
                {`You're at your free plan limit of ${billing.usage.maxInstitutions} institutions. A new one won't sync until you upgrade.`}
              </Alert>
            )}

            {/* Plaid's web SDK does not run inside the iOS app's WebView, so
                there the bank options are replaced by one note rather than
                offered and then refused after a tap. */}
            {native ? (
              <Alert tone="info">
                Connecting a bank isn't available in the app yet. Connect from the web and your accounts sync here.
              </Alert>
            ) : (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={startConnect}
              disabled={linking}
              leadingIcon={<Zap size={17} />}
            >
              Connect a new bank or card
            </Button>
            )}

            {/* A newly opened account at a bank you already connected is added
                through that connection (Plaid's update mode). Connecting the
                bank again would duplicate every account it holds. */}
            {!native && addableItems.length > 0 && (
              <div>
                <p className="mb-1.5 px-2 text-[12.5px] font-semibold text-content-muted">
                  Add an account at a bank you already connected
                </p>
                <div className="flex flex-col">
                  {addableItems.map((item) => {
                    const name = item.institutionName ?? "Your bank";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => startAddTo(item)}
                        disabled={linking}
                        className="ui-focus group flex min-h-touch items-center gap-3 rounded-ui-md px-2 py-1.5 text-left transition-colors active:bg-canvas-sunken [@media(hover:hover)]:hover:bg-canvas-sunken disabled:opacity-50"
                      >
                        <InstIcon institution={name} isManual={false} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-content">{name}</span>
                          <span className="block text-[12px] text-content-muted">
                            {isItemError(item) ? "Reconnect and add accounts" : `${item.accounts.length} account${item.accounts.length === 1 ? "" : "s"} connected`}
                          </span>
                        </span>
                        <ChevronRight
                          size={15}
                          className="shrink-0 text-content-faint transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col">
              {!native && addableItems.length > 0 && (
                <p className="mb-1.5 px-2 text-[12.5px] font-semibold text-content-muted">Or add one yourself</p>
              )}
              {secondaryAdds.map(({ label, icon: Icon, run }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => run()}
                  className="ui-focus group flex min-h-touch items-center gap-3 rounded-ui-md px-2 text-left text-[13.5px] font-semibold text-content-secondary transition-colors hover:bg-canvas-sunken hover:text-content"
                >
                  <Icon size={16} strokeWidth={1.75} className="shrink-0 text-content-muted" aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  <ChevronRight
                    size={15}
                    className="shrink-0 text-content-faint transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
  );

  return {
    modal,
    banners,
    /** Open the add dialog on its first step. */
    openAdd: () => setShowManualModal(true),
    /** Plaid update mode on one connection: add accounts to it, or repair it. */
    addAccountsTo: (item: { id: string }) => {
      const found = items.find((i) => i.id === item.id);
      if (found) handleAddAccounts(found);
    },
    syncItem: handleSyncItem,
    syncAll: handleSyncAll,
    disconnect: (item: { id: string; institutionName: string | null }) =>
      handleDelete(item.id, item.institutionName ?? "this institution"),
    items,
    /** The connection Plaid just added to, for a moment after it lands. */
    newlyLinkedId,
    linking,
    syncing,
    syncingItemId,
  };
}

// ---------------------------------------------------------------------------
// Institution icon — favicon, pencil for manual, or a monogram.
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
