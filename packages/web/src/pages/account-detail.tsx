import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRoute, useLocation } from 'wouter';
import { ChevronDown, ChevronLeft, RefreshCw, Pencil, Trash2, TrendingUp, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { startUpgrade } from '../lib/billing';
import { cn, stripAccountMask } from '../lib/utils';
import { Button, Field, Input, Select, SegmentedControl, Skeleton } from '../components/uikit';
import { useConfirm, filterByRange, type Range, type TrendPoint } from '../components/ds';
import { smoothLinePath, niceTicks, pickXLabels } from '../components/ds/TrendChart';
import { InstIcon } from '../components/common/InstIcon';
import { AddressAutocomplete } from '../components/common/AddressAutocomplete';
import { ValueSourceBadge, type ValueSource } from '../components/common/ValueSourceBadge';
import { ValueSourceControl } from '../components/common/ValueSourceControl';
import { AccountLinkPicker, type AccountPickerOption } from '../components/common/AccountLinkPicker';
import { TransactionList } from '../components/transactions/TransactionList';

// ---------------------------------------------------------------------------
// Account detail page. Shows the account's balance-over-time history as the
// hero, plus the settings (reclassify type/subtype, rename manual accounts,
// the three balance overrides) and sync/delete actions. Replaces the old
// AccountSettingsModal — all of that modal's logic is ported here.
// ---------------------------------------------------------------------------

interface TypeOption {
  label: string;
  type: string;
  subtype: string | null;
}

// Mirrors the manual-account creation list on /accounts, with Checking and
// Savings split so saving never collapses a synced subtype into one bucket.
const TYPE_OPTIONS: TypeOption[] = [
  { label: 'Checking', type: 'depository', subtype: 'checking' },
  { label: 'Savings', type: 'depository', subtype: 'savings' },
  { label: '401(k) / 403(b)', type: 'investment', subtype: '401k' },
  { label: 'Roth IRA', type: 'investment', subtype: 'roth_ira' },
  { label: 'Traditional IRA', type: 'investment', subtype: 'ira' },
  { label: 'Brokerage', type: 'investment', subtype: 'brokerage' },
  { label: 'HSA', type: 'investment', subtype: 'hsa' },
  { label: 'Primary Residence', type: 'real_estate', subtype: 'primary' },
  { label: 'Rental Property', type: 'real_estate', subtype: 'rental' },
  { label: 'Other Asset', type: 'alternative', subtype: null },
  { label: 'Credit Card', type: 'credit', subtype: null },
  { label: 'Student Loan', type: 'loan', subtype: 'student' },
  { label: 'Auto Loan', type: 'loan', subtype: 'auto' },
  { label: 'Mortgage', type: 'loan', subtype: 'mortgage' },
];

const LIABILITY_TYPES = new Set(['credit', 'loan']);
const keyFor = (type: string, subtype: string | null) => `${type}:${subtype ?? ''}`;
const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// getItems' account type doesn't declare the per-account overrides, but the
// API returns them — widen it locally so we can read them without a `any`.
type ApiAccount = Awaited<ReturnType<typeof api.getItems>>['items'][number]['accounts'][number];
type DetailAccount = ApiAccount & {
  excludeFromNetWorth?: boolean;
  excludeTransactions?: boolean;
  invertBalance?: boolean;
  apr?: string | null;
  metadata?: Record<string, unknown> | null;
  propertyAccountId?: string | null;
};
type Snapshot = Awaited<ReturnType<typeof api.getHistory>>['snapshots'][number];

interface LoadedData {
  acct: DetailAccount;
  institution: string;
  isManual: boolean;
  status: string;
  lastSyncedAt: string | null;
  snapshots: Snapshot[];
  // Every account across all items — for the property↔mortgage link pickers
  // and reverse lookups (which debts point at this property).
  allAccounts: DetailAccount[];
  // accountId → institution display name, for favicons in the link pickers.
  accountInstitution: Record<string, string>;
}

export function AccountDetail() {
  const [, params] = useRoute('/accounts/:id');
  const id = params?.id ?? '';
  const [, setLocation] = useLocation();
  const confirm = useConfirm();

  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Settings form state (initialized from the loaded account each load).
  const [name, setName] = useState('');
  const [typeKey, setTypeKey] = useState('');
  const [excludeFromNetWorth, setExcludeNW] = useState(false);
  const [excludeTransactions, setExcludeTx] = useState(false);
  const [invertBalance, setInvert] = useState(false);
  const [saving, setSaving] = useState(false);

  // Loan-detail form state (credit/loan accounts only). Pre-filled in load()
  // from the account's parsed metadata + apr column. Mirrors LoanDetailsModal.
  const [interestRate, setInterestRate] = useState('');
  const [minPayment, setMinPayment] = useState('');
  const [originationDate, setOriginationDate] = useState('');
  const [loanTermYears, setLoanTermYears] = useState('');
  const [repaymentPlanType, setRepaymentPlanType] = useState('');
  const [purchaseApr, setPurchaseApr] = useState('');
  // Snapshot of the loaded loan values so Save only patches when one changed.
  const initialLoanRef = useRef<Record<string, string>>({});

  // Linked property (debt accounts only) — the real_estate account this debt
  // is secured by. Only sent in the PATCH when it changed, since the endpoint
  // rejects the field on non-debt accounts.
  const [linkedPropertyId, setLinkedPropertyId] = useState('');
  const initialLinkRef = useRef('');
  // Property-side "link a mortgage" picker — linking only fires on the
  // explicit Link button, never on select change (keyboard trap otherwise).
  const [pendingDebtId, setPendingDebtId] = useState('');

  // Property-detail form state (real_estate accounts only). Pre-filled in
  // load() from the account's parsed metadata. Mirrors the loan-detail form.
  const [address, setAddress] = useState('');
  // Google Places identity + geocode, set when an autocomplete result is picked.
  const [placeId, setPlaceId] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [annualInsurance, setAnnualInsurance] = useState('');
  const [annualMaintenance, setAnnualMaintenance] = useState('');
  const initialPropRef = useRef<Record<string, string>>({});
  // Value source for a real_estate account: 'market' uses our auto-estimate,
  // 'own' pins the user's own value as the source of truth (a persisted
  // override the estimate never overwrites). Initialized from metadata in load().
  const [valueSourceChoice, setValueSourceChoice] = useState<'market' | 'own'>('market');
  const [ownValue, setOwnValue] = useState('');
  const initialValueSourceRef = useRef<'market' | 'own'>('market');
  // Set when the address picker rejects a commercial place, cleared on next edit.
  const [addressRejected, setAddressRejected] = useState(false);

  // Presentation state — chart range, hover readout, and the collapsible
  // settings panel (hidden by default so the page leads with the chart).
  const [range, setRange] = useState<Range>('6M');
  const [chartHoverIdx, setChartHoverIdx] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Editable value for manual accounts (e.g. re-valuing a home). Synced
  // accounts get their balance from the provider, so it's not editable there.
  const [editValue, setEditValue] = useState('');
  const settingsRef = useRef<HTMLButtonElement>(null);
  const openSettings = () => {
    setSettingsOpen(true);
    requestAnimationFrame(() =>
      settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  // Sync / delete actions.
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Transient success confirmation (Saved ✓ / Synced ✓), auto-clears.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
  }, []);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      const [{ items }, history] = await Promise.all([
        api.getItems(),
        // A history failure (e.g. brand-new manual account) shouldn't make the
        // whole account read as not-found — fall back to no snapshots.
        api.getHistory(id).catch(() => ({ snapshots: [] as Snapshot[] })),
      ]);
      let found: Omit<LoadedData, 'snapshots' | 'allAccounts' | 'accountInstitution'> | null = null;
      for (const item of items) {
        const match = (item.accounts as DetailAccount[]).find((a) => a.id === id);
        if (match) {
          found = {
            acct: match,
            institution: item.institutionName || 'Manual',
            isManual: item.institutionId === 'manual',
            status: item.status,
            lastSyncedAt: item.lastSyncedAt,
          };
          break;
        }
      }
      if (!found) {
        setNotFound(true);
        return;
      }
      const accountInstitution: Record<string, string> = {};
      for (const item of items) {
        const inst = item.institutionName || 'Manual';
        for (const a of item.accounts) accountInstitution[a.id] = inst;
      }
      setData({
        ...found,
        snapshots: history.snapshots,
        allAccounts: items.flatMap((i) => i.accounts as DetailAccount[]),
        accountInstitution,
      });
      setName(found.acct.name);
      setTypeKey(keyFor(found.acct.type, found.acct.subtype));
      setExcludeNW(Boolean(found.acct.excludeFromNetWorth));
      setExcludeTx(Boolean(found.acct.excludeTransactions));
      setInvert(Boolean(found.acct.invertBalance));
      setEditValue(found.acct.balance ?? '');

      // Pre-fill loan-detail fields from parsed metadata + the apr column.
      const meta = (found.acct.metadata ?? {}) as Record<string, unknown>;
      const aprCol = found.acct.apr != null ? String(found.acct.apr) : '';
      const num = (v: unknown) =>
        typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
      const dateStr = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');
      const purchaseAprMeta = Array.isArray(meta.aprs)
        ? (meta.aprs as Array<{ aprType?: string; aprPercentage?: number }>).find(
            (a) => a.aprType === 'purchase_apr',
          )?.aprPercentage
        : undefined;
      const loanVals = {
        interestRate: num(meta.interestRatePercentage) || aprCol,
        minPayment: num(meta.minimumPaymentAmount),
        originationDate: dateStr(meta.originationDate),
        loanTermYears: num(meta.loanTermYears),
        repaymentPlanType: typeof meta.repaymentPlanType === 'string' ? meta.repaymentPlanType : '',
        purchaseApr: (purchaseAprMeta !== undefined ? String(purchaseAprMeta) : '') || aprCol,
      };
      setInterestRate(loanVals.interestRate);
      setMinPayment(loanVals.minPayment);
      setOriginationDate(loanVals.originationDate);
      setLoanTermYears(loanVals.loanTermYears);
      setRepaymentPlanType(loanVals.repaymentPlanType);
      setPurchaseApr(loanVals.purchaseApr);
      initialLoanRef.current = loanVals;

      // Linked property (debt side of the property↔mortgage link).
      setLinkedPropertyId(found.acct.propertyAccountId ?? '');
      initialLinkRef.current = found.acct.propertyAccountId ?? '';

      // Pre-fill property-detail fields from parsed metadata.
      const propVals = {
        address: typeof meta.address === 'string' ? meta.address : '',
        placeId: typeof meta.placeId === 'string' ? meta.placeId : '',
        lat: num(meta.lat),
        lng: num(meta.lng),
        monthlyRent: num(meta.monthlyRent),
        annualInsurance: num(meta.annualInsurance),
        annualMaintenance: num(meta.annualMaintenance),
      };
      setAddress(propVals.address);
      setPlaceId(propVals.placeId);
      setLat(propVals.lat);
      setLng(propVals.lng);
      setMonthlyRent(propVals.monthlyRent);
      setAnnualInsurance(propVals.annualInsurance);
      setAnnualMaintenance(propVals.annualMaintenance);
      initialPropRef.current = propVals;

      // Value source — an override flag on the estimate blob means the user
      // pinned their own value; otherwise we're using the market estimate.
      const ve = (meta.valueEstimate ?? {}) as Record<string, unknown>;
      const source: 'market' | 'own' = ve.override === true ? 'own' : 'market';
      setValueSourceChoice(source);
      initialValueSourceRef.current = source;
      setOwnValue(source === 'own' ? (found.acct.balance ?? '') : '');
      setAddressRejected(false);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1040px] px-3 sm:px-12 pt-4 sm:pt-10 pb-6 sm:pb-28 text-content">
        <Skeleton className="h-8 w-16 rounded-ui-md" />
        <div className="mt-5 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-11 w-56" />
          <Skeleton className="mt-6 h-[200px] w-full rounded-ui-md" />
        </div>
        <div className="mt-8 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5">
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="mx-auto max-w-[1040px] px-3 sm:px-12 pt-4 sm:pt-10 pb-6 sm:pb-28 text-content">
        <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em]">
          Account not found
        </h1>
        <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
          <p className="mb-4 text-[14px] text-content-muted">
            We couldn't find this account. It may have been deleted.
          </p>
          <Button variant="primary" onClick={() => setLocation('/money')}>Back to money</Button>
        </div>
      </div>
    );
  }

  const { acct, institution, isManual, status, lastSyncedAt, snapshots } = data;
  const balance = parseFloat(acct.balance ?? '0');
  const typeLabel = titleCaseType(acct.type, acct.subtype);
  const displayName = titleCase(stripAccountMask(acct.name, acct.mask));
  const needsAttention = status === 'error' || status === 'item_login_required';

  // Snapshots → ascending TrendPoints for the shared interactive chart.
  const allPoints: TrendPoint[] = snapshots
    .map((s) => ({ date: s.snapshotAt, value: parseFloat(s.balance ?? '0') }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const chartPoints = filterByRange(allPoints, range);
  const hasHistory = allPoints.length >= 2;

  // Preserve a synced type/subtype that isn't one of our presets so saving
  // doesn't silently reclassify it.
  const initialKey = keyFor(acct.type, acct.subtype);
  const knownKeys = new Set(TYPE_OPTIONS.map((o) => keyFor(o.type, o.subtype)));
  const options: TypeOption[] = knownKeys.has(initialKey)
    ? TYPE_OPTIONS
    : [{ label: titleCaseType(acct.type, acct.subtype), type: acct.type, subtype: acct.subtype }, ...TYPE_OPTIONS];

  const chosen = options.find((o) => keyFor(o.type, o.subtype) === typeKey) ?? options[0];
  const wasLiability = LIABILITY_TYPES.has(acct.type);
  const willBeLiability = LIABILITY_TYPES.has(chosen.type);
  // Reclassifying across the asset/liability line flips this account's sign in
  // net worth — warn before it happens.
  const crossesBucket = wasLiability !== willBeLiability;
  const displayedBalance = invertBalance ? -balance : balance;

  // Mirror LoanDetailsModal's loanType derivation, off the persisted type.
  const isLiabilityAcct = acct.type === 'credit' || acct.type === 'loan';
  const lowerName = acct.name.toLowerCase();
  const loanType: 'mortgage' | 'student_loan' | 'credit_card' | 'other_loan' =
    acct.type === 'credit'
      ? 'credit_card'
      : acct.subtype === 'mortgage' || lowerName.includes('mortgage')
        ? 'mortgage'
        : acct.subtype === 'student' || acct.subtype === 'student_loan' || lowerName.includes('student')
          ? 'student_loan'
          : 'other_loan';

  // Property side of the property↔mortgage link — which debts point here.
  const isPropertyAcct = acct.type === 'real_estate';
  const linkedDebts = data.allAccounts.filter((a) => a.propertyAccountId === acct.id);
  const debtTotal = linkedDebts.reduce((s, d) => s + Math.abs(parseFloat(d.balance ?? '0')), 0);
  const equity = balance - debtTotal;

  // Rich link-picker options. A property is secured by a mortgage/loan — NOT a
  // credit card — so the loan picker offers `type === 'loan'` only. The
  // property picker (debt-side "Secured by") offers real_estate accounts.
  const optFor = (a: DetailAccount): AccountPickerOption => ({
    id: a.id,
    name: titleCase(a.name),
    institution: data.accountInstitution[a.id] ?? 'Manual',
    meta: titleCaseType(a.type, a.subtype),
  });
  const loanOptions: AccountPickerOption[] = data.allAccounts
    .filter((a) => a.type === 'loan' && !a.propertyAccountId)
    .sort((a, b) => Number(b.subtype === 'mortgage') - Number(a.subtype === 'mortgage'))
    .map(optFor);
  const propertyOptions: AccountPickerOption[] = data.allAccounts
    .filter((a) => a.type === 'real_estate')
    .map(optFor);

  // Key facts strip — read-only, derived straight from the persisted account so
  // it stays stable while the Settings form is being edited. Only defined keys
  // render, so the strip is naturally short for simple accounts.
  const meta = (acct.metadata ?? {}) as Record<string, unknown>;
  const metaNum = (v: unknown) =>
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
  const metaDate = (v: unknown) => {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const aprVal = metaNum(meta.interestRatePercentage) ?? (acct.apr != null ? metaNum(acct.apr) : null);
  const minPmtVal = metaNum(meta.minimumPaymentAmount);
  // Payoff comes from a Plaid-synced maturity/expected-payoff date when present;
  // otherwise it's derived from the manually-entered origination date + term so
  // the info isn't lost after we stopped collecting a payoff date directly.
  const derivedPayoff = (() => {
    if (typeof meta.originationDate !== 'string') return null;
    const years = metaNum(meta.loanTermYears);
    if (years == null || years <= 0) return null;
    const d = new Date(meta.originationDate);
    if (Number.isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + Math.round(years));
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  })();
  const payoffVal = metaDate(meta.maturityDate) ?? metaDate(meta.expectedPayoffDate) ?? derivedPayoff;
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Type', value: typeLabel },
    {
      label: isManual ? 'Source' : 'Synced',
      value: isManual ? 'Manual entry' : lastSyncedAt ? relativeTime(lastSyncedAt) : 'Connected',
    },
  ];
  if (isLiabilityAcct && aprVal != null) facts.push({ label: 'APR', value: `${aprVal}%` });
  if (isLiabilityAcct && minPmtVal != null) facts.push({ label: 'Min payment', value: fmtUsd(minPmtVal) });
  if (isLiabilityAcct && payoffVal) facts.push({ label: loanType === 'credit_card' ? 'Due' : 'Payoff', value: payoffVal });
  const linkedPropertyName = acct.propertyAccountId
    ? data.allAccounts.find((a) => a.id === acct.propertyAccountId)?.name
    : undefined;
  if (isLiabilityAcct && linkedPropertyName) facts.push({ label: 'Property', value: titleCase(linkedPropertyName) });
  if (isPropertyAcct && linkedDebts.length > 0) {
    facts.push({ label: 'Mortgage', value: titleCase(linkedDebts[0].name) });
    facts.push({ label: 'Equity', value: fmtUsd(equity) });
  }

  const save = async () => {
    setActionError(null);
    if (crossesBucket) {
      const ok = await confirm({
        title: 'Change net worth?',
        body: `Reclassifying this account moves it ${willBeLiability ? 'into debt' : 'into assets'} and will change your net worth.`,
        confirmLabel: 'Save change',
      });
      if (!ok) return;
    }
    // Changing a property's address re-kicks the value estimate server-side and
    // will replace the current value — warn before it happens silently. Only
    // when using the market estimate; an own-value override isn't re-estimated.
    if (isPropertyAcct && valueSourceChoice === 'market') {
      const newAddress = address.trim();
      const prevAddress = (initialPropRef.current.address ?? '').trim();
      if (newAddress && newAddress !== prevAddress) {
        const ok = await confirm({
          title: 'Re-estimate this home?',
          body: "Changing the address will re-estimate this home's value and replace the current one.",
          confirmLabel: 'Change address',
        });
        if (!ok) return;
      }
    }
    setSaving(true);
    try {
      if (isManual) {
        const newBalance = parseFloat(editValue);
        if (!Number.isNaN(newBalance) && newBalance !== parseFloat(acct.balance ?? '0')) {
          await api.updateManualAccount(id, { balance: newBalance });
        }
      }
      await api.updateAccount(id, {
        type: chosen.type,
        subtype: chosen.subtype,
        excludeFromNetWorth,
        excludeTransactions,
        invertBalance,
        // Renames stick across syncs (sync only sets name on first insert).
        ...(name.trim() && name.trim() !== acct.name ? { name: name.trim() } : {}),
        // Only send the link when it changed — the endpoint rejects the field
        // on non-debt accounts, and it's a debt-side-only setting.
        ...(isLiabilityAcct && linkedPropertyId !== initialLinkRef.current
          ? { propertyAccountId: linkedPropertyId || null }
          : {}),
      });

      // Persist loan-detail edits (credit/loan accounts) when any field changed.
      if (isLiabilityAcct) {
        const cur: Record<string, string> = {
          interestRate, minPayment,
          originationDate, loanTermYears, repaymentPlanType, purchaseApr,
        };
        const init = initialLoanRef.current;
        const changed = Object.keys(cur).some((k) => cur[k] !== (init[k] ?? ''));
        if (changed) {
          // APR/min-payment are required numbers on a loan — clearing the
          // field saves 0 rather than silently keeping the old value.
          const numOr0 = (s: string) => (s.trim() === '' ? 0 : parseFloat(s));
          const term = parseInt(loanTermYears, 10);
          const body: Record<string, unknown> = { type: loanType };
          if (loanType === 'mortgage') {
            body.interestRatePercentage = numOr0(interestRate);
            if (originationDate) body.originationDate = originationDate;
            if (Number.isFinite(term) && term > 0) body.loanTermYears = term;
          } else if (loanType === 'student_loan') {
            body.interestRatePercentage = numOr0(interestRate);
            body.minimumPaymentAmount = numOr0(minPayment);
            if (originationDate) body.originationDate = originationDate;
            if (Number.isFinite(term) && term > 0) body.loanTermYears = term;
            if (repaymentPlanType) body.repaymentPlanType = repaymentPlanType;
          } else if (loanType === 'credit_card') {
            body.minimumPaymentAmount = numOr0(minPayment);
            body.aprs = [{ aprType: 'purchase_apr', aprPercentage: numOr0(purchaseApr) }];
          } else {
            body.interestRatePercentage = numOr0(interestRate);
            body.minimumPaymentAmount = numOr0(minPayment);
            if (originationDate) body.originationDate = originationDate;
            if (Number.isFinite(term) && term > 0) body.loanTermYears = term;
          }
          if (Object.keys(body).length > 1) await api.patchLoanDetails(id, body);
        }
      }

      // Persist property-detail edits (real_estate accounts) when any field
      // changed. Cleared fields are sent as null — the endpoint deletes them.
      if (isPropertyAcct) {
        const cur: Record<string, string> = {
          address, placeId, lat, lng, monthlyRent, annualInsurance, annualMaintenance,
        };
        const init = initialPropRef.current;
        const changedKeys = Object.keys(cur).filter((k) => cur[k] !== (init[k] ?? ''));
        const body: Record<string, unknown> = {};
        const stringKeys = new Set(['address', 'placeId']);
        for (const k of changedKeys) {
          const v = cur[k].trim();
          // address/placeId stay text; the rest are numeric.
          body[k] = v === '' ? null : stringKeys.has(k) ? v : parseFloat(v);
        }
        // Value-source switch: 'own' pins the user's value (override); 'market'
        // clears it and re-enables the auto-estimate. Only send when it changed,
        // or when re-typing an own value while already on 'own'.
        const sourceChanged = valueSourceChoice !== initialValueSourceRef.current;
        if (valueSourceChoice === 'own') {
          const ownNum = parseFloat(ownValue);
          const ownChanged = ownValue.trim() !== '' && ownNum !== parseFloat(acct.balance ?? '0');
          if (sourceChanged || ownChanged) {
            body.valueSource = 'own';
            if (!Number.isNaN(ownNum)) body.ownValue = ownNum;
          }
        } else if (sourceChanged) {
          body.valueSource = 'market';
        }
        if (Object.keys(body).length > 0) {
          await api.patchPropertyDetails(id, body);
        }
      }

      await load();
      showFlash('Saved ✓');
    } catch {
      setActionError("Couldn't save changes. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // Link/unlink a debt to THIS property — these PATCH the debt account (not
  // the one this page's Save batches for), so they act immediately.
  const linkDebt = async (debtId: string) => {
    setActionError(null);
    setSaving(true);
    try {
      await api.updateAccount(debtId, { propertyAccountId: id });
      await load();
      showFlash('Linked ✓');
    } catch {
      setActionError("Couldn't link that account. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const unlinkDebt = async (debtId: string) => {
    setActionError(null);
    setSaving(true);
    try {
      await api.updateAccount(debtId, { propertyAccountId: null });
      await load();
      showFlash('Unlinked ✓');
    } catch {
      setActionError("Couldn't unlink that account. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setActionPending(true);
    setActionError(null);
    try {
      await api.syncAccount(id);
      await load();
      showFlash('Synced ✓');
    } catch {
      setActionError('Could not sync this account. Please try again.');
    } finally {
      setActionPending(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete "${titleCase(acct.name)}"?`,
      body: 'The account and its full balance history will be permanently removed. This can’t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setActionPending(true);
    setActionError(null);
    try {
      await api.deleteManualAccount(id);
      setLocation('/money');
    } catch {
      setActionError('Could not delete this account. Please try again.');
      setActionPending(false);
    }
  };

  const settingsSummary = [
    typeLabel,
    excludeFromNetWorth && 'Not counted',
    excludeTransactions && 'Tx hidden',
    invertBalance && 'Inverted',
  ].filter(Boolean).join(' · ');

  const hoveredPoint = hasHistory && chartHoverIdx !== null ? chartPoints[chartHoverIdx] : null;
  const heroPts = chartPoints.length > 0 ? chartPoints : allPoints;
  const heroLatest = heroPts.length > 0 ? heroPts[heroPts.length - 1] : null;
  const heroFirst = heroPts.length > 0 ? heroPts[0] : null;
  const heroValue = hoveredPoint ? hoveredPoint.value : heroLatest ? heroLatest.value : balance;
  const heroChange = heroLatest && heroFirst ? heroLatest.value - heroFirst.value : 0;
  const balanceLabel = isLiabilityAcct ? 'Balance owed' : 'Account value';
  // Source-of-truth badge — prefer the server-computed value, fall back to the
  // manual/synced split for older item payloads.
  const valueSource: ValueSource =
    (acct as { valueSource?: ValueSource }).valueSource ?? (isManual ? 'manual' : 'synced');

  return (
    <div className="mx-auto max-w-[1040px] px-3 sm:px-12 pt-4 sm:pt-10 pb-6 sm:pb-28 text-content">
      {/* ── Back — desktop only; mobile gets the top-bar back button ── */}
      <button
        type="button"
        onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation('/money'); }}
        className="ui-focus -ml-2 mb-2 hidden min-h-touch items-center gap-1 rounded-ui-sm px-2 text-[13px] font-semibold text-content-muted transition-colors hover:text-content sm:mb-3 sm:ml-0 sm:inline-flex sm:min-h-0 sm:px-0"
      >
        <ChevronLeft size={16} /> Back
      </button>

      {/* ── Identity header — avatar · name · institution/mask/type · actions ── */}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <InstIcon institution={institution} isManual={isManual} />
          <div className="min-w-0">
            <h1 className="font-editorial text-[26px] sm:text-[32px] font-bold leading-[1.1] tracking-[-0.028em]">
              {displayName}
            </h1>
            {/* Type lives in the key-facts strip below — keep it out of here to
                avoid repeating it three times (title + pill + Type row). */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13.5px] font-medium text-content-muted">
              <span>{institution}</span>
              {acct.mask && (
                <>
                  <span className="text-content-faint">·</span>
                  <span className="ui-tnum">••{acct.mask}</span>
                </>
              )}
              {acct.frozen && (
                <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info">
                  <Lock size={10} strokeWidth={2.2} aria-hidden="true" /> Frozen
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-2.5 sm:flex">
          <Button variant="secondary" size="sm" onClick={openSettings} leadingIcon={<Pencil size={14} />}>
            Edit
          </Button>
          {!isManual && (
            <Button
              variant="secondary"
              size="sm"
              disabled={actionPending}
              onClick={handleSync}
              leadingIcon={<RefreshCw size={14} className={actionPending ? 'animate-spin' : ''} />}
            >
              {actionPending ? 'Syncing…' : 'Sync'}
            </Button>
          )}
          {isManual && (
            <Button variant="destructive" size="sm" disabled={actionPending} onClick={handleDelete} leadingIcon={<Trash2 size={14} />}>
              {actionPending ? '…' : 'Delete'}
            </Button>
          )}
        </div>
      </header>

      {acct.frozen && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 rounded-ui-md border border-info/30 bg-info-soft px-4 py-3">
          <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-info">
            <Lock size={13} strokeWidth={2.2} aria-hidden="true" />
            Frozen — over the Free plan's account limit, so it isn't syncing.
          </span>
          <button
            type="button"
            onClick={() => { startUpgrade().catch(() => {}); }}
            className="ui-focus shrink-0 rounded-ui-sm text-[13px] font-bold text-brand hover:underline"
          >
            Upgrade to resume →
          </button>
        </div>
      )}

      {needsAttention && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 rounded-ui-md border border-caution/30 bg-caution-soft px-4 py-3">
          <span className="text-[13.5px] font-semibold text-caution">
            {status === 'item_login_required' ? 'Login expired — reconnect to resume syncing.' : 'This account needs attention — try reconnecting.'}
          </span>
          <button
            type="button"
            onClick={() => setLocation('/accounts')}
            className="ui-focus shrink-0 rounded-ui-sm text-[13px] font-bold text-brand hover:underline"
          >
            Reconnect →
          </button>
        </div>
      )}

      {(actionError || flash) && (
        <p
          role="status"
          aria-live="polite"
          className={cn('mt-3 text-[12.5px] font-semibold', actionError ? 'text-negative' : 'text-[rgb(var(--ui-brand-ink))]')}
        >
          {actionError ?? flash}
        </p>
      )}

      {/* ── Balance hero — the interactive value-history chart + key facts. ── */}
      <section className="relative mt-6 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 100% 0%, var(--ui-info-soft), transparent 56%),' +
              'radial-gradient(90% 70% at 0% 4%, var(--ui-brand-softer), transparent 60%)',
          }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">{balanceLabel}</div>
              {valueSource && <ValueSourceBadge source={valueSource} size="md" />}
            </div>
            <div className="mt-2 font-editorial text-[34px] sm:text-[44px] font-extrabold leading-[0.98] tracking-[-0.035em] ui-tnum">
              {fmtUsd(heroValue)}
            </div>
            <div className="mt-3 flex min-h-7 items-center gap-2.5 flex-wrap">
              {hoveredPoint ? (
                <span className="text-[13.5px] font-medium text-content-muted ui-tnum">
                  {new Date(hoveredPoint.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              ) : hasHistory && heroChange !== 0 ? (
                <>
                  <DeltaChip delta={heroChange} />
                  <span className="text-[13px] font-medium text-content-muted">over this period</span>
                </>
              ) : (
                <span className="text-[13px] font-medium text-content-muted">
                  {isManual ? 'Manually tracked' : lastSyncedAt ? `Synced ${relativeTime(lastSyncedAt)}` : 'Connected'}
                </span>
              )}
            </div>
          </div>
          {hasHistory && chartPoints.length >= 2 && (
            <SegmentedControl
              aria-label="Time range"
              value={range}
              onChange={(r) => setRange(r as Range)}
              options={[
                { value: '1M', label: '1M' },
                { value: '6M', label: '6M' },
                { value: '1Y', label: '1Y' },
                { value: 'All', label: 'All' },
              ]}
            />
          )}
        </div>

        {hasHistory ? (
          chartPoints.length >= 2 ? (
            <div className="relative mt-5 pr-2 sm:pr-0">
              <ValueChart points={chartPoints} range={range} onHoverChange={setChartHoverIdx} />
            </div>
          ) : (
            <p className="relative mt-5 py-9 text-center text-[13px] text-content-muted">
              No data in this range.
            </p>
          )
        ) : (
          <div className="relative mt-5 grid place-items-center rounded-ui-md border border-dashed border-line-strong bg-canvas-sunken/40 px-3 py-8 text-center">
            <div className="mb-2.5 grid h-11 w-11 place-items-center rounded-ui-md bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]">
              <TrendingUp size={20} />
            </div>
            <div className="text-[15px] font-semibold">No history yet</div>
            <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-content-muted">
              A value trend appears once we have a few days of history.
            </p>
          </div>
        )}

        {/* Key facts — read-only, at-a-glance context for this one account. */}
        <div className="relative mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 sm:flex sm:flex-wrap sm:gap-x-10">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-faint">{f.label}</div>
              <div className="mt-1 truncate text-[15px] font-bold text-content ui-tnum">{f.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Value-estimate status — pending/ready/failed, ported from the create
          modal so an estimate resolving after creation stays honest here too. */}
      {isPropertyAcct && (
        <PropertyEstimateStatus accountId={id} meta={meta} onResolved={load} />
      )}

      {/* ── Settings — collapsible, organized into on-skin sub-sections. ── */}
      <section className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm">
        <button
          ref={settingsRef}
          type="button"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((o) => !o)}
          className={cn(
            'ui-focus flex w-full items-center gap-3 rounded-t-ui-xl px-4 py-4 text-left transition-colors hover:bg-brand-softer sm:px-5',
            settingsOpen ? 'border-b border-line' : 'rounded-b-ui-xl',
          )}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-content-secondary">
            <Pencil size={14} />
          </span>
          <span className="shrink-0 font-editorial text-[16.5px] font-bold tracking-[-0.01em]">Settings</span>
          {!settingsOpen && (
            <span className="ml-auto min-w-0 truncate text-[13px] font-medium text-content-muted">{settingsSummary}</span>
          )}
          <span className="grid h-6 w-6 shrink-0 place-items-center text-content-faint sm:ml-3">
            <ChevronDown size={18} className={cn('transition-transform duration-200 ease-ui', !settingsOpen && '-rotate-90')} />
          </span>
        </button>

        {settingsOpen && (
          <div className="p-4 sm:p-6">
            {/* Address + value source lead the settings for a property — the
                address drives valuation, so it's the most important field. */}
            {isPropertyAcct && (
              <SettingsGroup title="Address & value">
                <Field label="Address">
                  <AddressAutocomplete
                    value={address}
                    onTextChange={(text) => {
                      // Hand-editing invalidates the resolved place/geocode.
                      setAddress(text);
                      setPlaceId('');
                      setLat('');
                      setLng('');
                      setAddressRejected(false);
                    }}
                    onPick={(r) => {
                      setAddress(r.address);
                      setPlaceId(r.placeId);
                      setLat(r.lat != null ? String(r.lat) : '');
                      setLng(r.lng != null ? String(r.lng) : '');
                      setAddressRejected(false);
                    }}
                    onReject={() => setAddressRejected(true)}
                  />
                  {addressRejected && (
                    <p className="mt-2 text-[12px] leading-relaxed text-negative">
                      Commercial properties aren't supported — enter a home address.
                    </p>
                  )}
                </Field>

                <div className="mt-4">
                  <ValueSourceControl
                    source={valueSourceChoice}
                    onSourceChange={setValueSourceChoice}
                    ownValue={ownValue}
                    onOwnValueChange={setOwnValue}
                  />
                </div>
              </SettingsGroup>
            )}

            {/* Details — name is editable for every account; value only for
                manual ones (synced balances come from the provider). */}
            <SettingsGroup title="Details" className={isPropertyAcct ? 'mt-6' : undefined}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input type="text" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                {/* Property value is edited in "Address & value" above (via the
                    value-source control), so skip the plain Value field here. */}
                {isManual && !isPropertyAcct && (
                  <Field label="Value">
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="ui-tnum"
                    />
                  </Field>
                )}
              </div>
              {!isManual && (
                <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
                  The balance syncs from your bank and can't be edited. Renaming only changes
                  how the account appears here.
                </p>
              )}
            </SettingsGroup>

            {/* Classification — the reclassify select + cross-bucket warning. */}
            <SettingsGroup title="Classification" className="mt-6">
              <Field label="Account type">
                <Select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
                  {options.map((o) => (
                    <option key={keyFor(o.type, o.subtype)} value={keyFor(o.type, o.subtype)}>{o.label}</option>
                  ))}
                </Select>
                {crossesBucket && (
                  <p className="mt-2 text-[12px] leading-relaxed text-negative">
                    This moves the account {willBeLiability ? 'into debt' : 'into assets'} — it will change your net worth.
                  </p>
                )}
              </Field>
            </SettingsGroup>

            {/* Display — the three balance-override toggles. */}
            <SettingsGroup title="Display" className="mt-6">
              <div className="divide-y divide-line">
                <Toggle
                  checked={excludeFromNetWorth}
                  onChange={setExcludeNW}
                  label="Exclude from net worth"
                  description={`Keep the account visible but leave its ${fmtUsd(Math.abs(displayedBalance))} out of net-worth totals and the chart.`}
                />
                <Toggle
                  checked={excludeTransactions}
                  onChange={setExcludeTx}
                  label="Exclude transactions"
                  description="Hide this account's transactions from spending and activity views."
                />
                <Toggle
                  checked={invertBalance}
                  onChange={setInvert}
                  label="Invert balance"
                  description={`Flip the sign of the balance. Currently counts as ${fmtUsd(displayedBalance)}${invertBalance ? ` (was ${fmtUsd(balance)})` : ''}.`}
                />
              </div>
            </SettingsGroup>

            {isLiabilityAcct && (
              <SettingsGroup title="Loan details" className="mt-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  {loanType !== 'credit_card' && (
                    <Field label="Interest rate (APR %)">
                      <Input type="number" step="0.01" min="0" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="ui-tnum" />
                    </Field>
                  )}
                  {loanType === 'credit_card' && (
                    <Field label="Purchase APR (%)">
                      <Input type="number" step="0.01" min="0" value={purchaseApr} onChange={(e) => setPurchaseApr(e.target.value)} className="ui-tnum" />
                    </Field>
                  )}
                  {loanType !== 'credit_card' && (
                    <Field label="Origination date">
                      <Input type="date" value={originationDate} onChange={(e) => setOriginationDate(e.target.value)} />
                    </Field>
                  )}
                  {loanType !== 'credit_card' && (
                    <Field label="Loan term (years)">
                      <Input type="number" step="1" min="1" max="50" value={loanTermYears} onChange={(e) => setLoanTermYears(e.target.value)} className="ui-tnum" />
                    </Field>
                  )}
                  {(loanType === 'student_loan' || loanType === 'credit_card' || loanType === 'other_loan') && (
                    <Field label="Minimum payment ($)">
                      <Input type="number" step="1" min="0" value={minPayment} onChange={(e) => setMinPayment(e.target.value)} className="ui-tnum" />
                    </Field>
                  )}
                  {loanType === 'student_loan' && (
                    <Field label="Repayment plan type">
                      <Input type="text" value={repaymentPlanType} onChange={(e) => setRepaymentPlanType(e.target.value)} />
                    </Field>
                  )}
                </div>
              </SettingsGroup>
            )}

            {/* Linked property — the debt side of the property↔mortgage link. */}
            {isLiabilityAcct && (
              <SettingsGroup title="Linked property" className="mt-6">
                {linkedPropertyId && (
                  <button
                    type="button"
                    onClick={() => setLocation(`/accounts/${linkedPropertyId}`)}
                    className="ui-focus mb-3 inline-flex items-center gap-1 rounded-ui-sm text-[13px] font-bold text-brand hover:underline"
                  >
                    View {titleCase(data.allAccounts.find((a) => a.id === linkedPropertyId)?.name ?? 'property')} →
                  </button>
                )}
                <Field label="Secured by">
                  <AccountLinkPicker
                    options={propertyOptions}
                    value={linkedPropertyId}
                    onChange={setLinkedPropertyId}
                    disabled={saving}
                    placeholder="No property"
                    addLabel="Add a property"
                    onAdd={() => setLocation(`/accounts?add=real_estate&link=${id}`)}
                  />
                  <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
                    Tie this loan to the property it's secured by — its page will show your equity.
                  </p>
                </Field>
              </SettingsGroup>
            )}

            {/* Mortgage — the property side. Link/unlink act immediately since
                they mutate the debt account, not the one Save batches for. */}
            {isPropertyAcct && (
              <SettingsGroup title="Mortgage" className="mt-6">
                {linkedDebts.length > 0 ? (
                  <div className="divide-y divide-line rounded-ui-md border border-line">
                    {linkedDebts.map((d) => (
                      <div key={d.id} className="flex items-center gap-3 px-3.5 py-3">
                        <button
                          type="button"
                          onClick={() => setLocation(`/accounts/${d.id}`)}
                          className="ui-focus min-w-0 flex-1 rounded-ui-sm text-left"
                        >
                          <span className="block truncate text-[14px] font-semibold text-content">{titleCase(d.name)}</span>
                          <span className="mt-0.5 block text-[12.5px] text-content-muted ui-tnum">
                            {fmtUsd(Math.abs(parseFloat(d.balance ?? '0')))} owed
                          </span>
                        </button>
                        <Button size="sm" variant="ghost" disabled={saving} onClick={() => unlinkDebt(d.id)}>
                          Unlink
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Field label="Link a mortgage / loan">
                    <div className="flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <AccountLinkPicker
                          options={loanOptions}
                          value={pendingDebtId}
                          onChange={setPendingDebtId}
                          disabled={saving}
                          placeholder="Choose a loan…"
                          addLabel="Add a mortgage"
                          onAdd={() => setLocation(`/accounts?add=loan:mortgage&link=${id}`)}
                        />
                      </div>
                      <Button size="sm" disabled={!pendingDebtId || saving} onClick={() => { linkDebt(pendingDebtId); setPendingDebtId(''); }}>
                        Link
                      </Button>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
                      Tie the loan that's secured by this property — we'll show your equity here.
                    </p>
                  </Field>
                )}
              </SettingsGroup>
            )}

            {isPropertyAcct && acct.subtype === 'rental' && (
              <SettingsGroup title="Rental economics" className="mt-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Monthly rent ($)">
                    <Input type="number" step="1" min="0" value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} className="ui-tnum" />
                  </Field>
                  <Field label="Annual insurance ($)">
                    <Input type="number" step="1" min="0" value={annualInsurance} onChange={(e) => setAnnualInsurance(e.target.value)} className="ui-tnum" />
                  </Field>
                  <Field label="Annual maintenance ($)">
                    <Input type="number" step="1" min="0" value={annualMaintenance} onChange={(e) => setAnnualMaintenance(e.target.value)} className="ui-tnum" />
                  </Field>
                </div>
              </SettingsGroup>
            )}

            <div className="mt-7 flex flex-wrap items-center gap-2.5 border-t border-line pt-5">
              <Button variant="primary" disabled={saving} loading={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              {/* The top status line sits off-viewport when the panel is scrolled
                  down, so mirror it next to Save. aria-hidden — the top line
                  already announces via role="status". */}
              {(actionError || flash) && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'text-[12.5px] font-semibold',
                    actionError ? 'text-negative' : 'text-[rgb(var(--ui-brand-ink))]',
                  )}
                >
                  {actionError ?? flash}
                </span>
              )}
              {/* Sync / delete also surfaced here for mobile (header actions are desktop-only). */}
              {!isManual && (
                <Button
                  variant="secondary"
                  disabled={actionPending}
                  onClick={handleSync}
                  className="sm:hidden"
                  leadingIcon={<RefreshCw size={14} className={actionPending ? 'animate-spin' : ''} />}
                >
                  {actionPending ? 'Syncing…' : 'Sync'}
                </Button>
              )}
              {isManual && (
                <Button
                  variant="destructive"
                  disabled={actionPending}
                  onClick={handleDelete}
                  className="ml-auto sm:hidden"
                  leadingIcon={<Trash2 size={14} />}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Transactions — this account's activity, searchable + paginated. ── */}
      <section className="mt-6">
        <TransactionList accountId={id} title="Transactions" />
      </section>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Property value-estimate status — durable, honest states for the detail page.
// Pending: poll the same endpoint the create modal uses (~10s, ~5min cap).
//   still pending at the cap → "Taking longer than expected — refresh".
//   failed / no estimate     → "Couldn't estimate — enter a value manually".
// Ready is silent: the value is already the balance and the hero badge says so.
// Advisory estimates (user typed their own value) surface nothing here.
// ---------------------------------------------------------------------------

function PropertyEstimateStatus({
  accountId,
  meta,
  onResolved,
}: {
  accountId: string;
  meta: Record<string, unknown>;
  onResolved: () => void;
}) {
  const ve = meta.valueEstimate as { status?: string; advisory?: boolean; override?: boolean } | undefined;
  const initialStatus = ve?.status;
  const [state, setState] = useState<'pending' | 'ready' | 'failed' | 'no-home' | 'timeout' | null>(
    initialStatus === 'pending' ? 'pending' : null,
  );

  useEffect(() => {
    if (initialStatus !== 'pending') { setState(null); return; }
    setState('pending');
    let cancelled = false;
    const deadline = Date.now() + 5 * 60 * 1000;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) { setState('timeout'); return; }
      try {
        const res = await api.getValueEstimate(accountId);
        if (cancelled) return;
        if (res.status === 'ready') { setState('ready'); onResolved(); return; }
        if (res.status === 'failed' || res.status === 'none') {
          // A "no home value" failure gets a distinct, clearer message than a
          // generic couldn't-estimate error.
          setState(res.reason === 'no_home_value' ? 'no-home' : 'failed');
          return;
        }
      } catch {
        // transient — keep polling until the cap
      }
      if (!cancelled) setTimeout(tick, 10_000);
    };
    const t = setTimeout(tick, 10_000);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatus, accountId]);

  // Advisory / override (user's own value is the source of truth) or
  // resolved-to-ready: nothing to show.
  if (ve?.advisory || ve?.override || state === null || state === 'ready') return null;

  const copy =
    state === 'pending'
      ? { title: 'Estimating value…', body: 'We’re looking up an estimate for this address. This usually takes about a minute.' }
      : state === 'timeout'
        ? { title: 'Taking longer than expected', body: 'We’re still working on it — refresh to check for the value.' }
        : state === 'no-home'
          ? { title: "Couldn’t find a home value for this address", body: 'It may be commercial or unlisted — switch to “My own value” below to enter it yourself.' }
          : { title: 'Couldn’t estimate this address', body: 'Enter a value manually in Settings below.' };

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 flex items-center gap-2.5 rounded-ui-md border border-line bg-info-soft px-4 py-3"
    >
      {state === 'pending' && <RefreshCw size={15} className="shrink-0 animate-spin text-info" aria-hidden="true" />}
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold text-content">{copy.title}</span>
        <span className="mt-0.5 block text-[12.5px] text-content-muted">{copy.body}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings sub-section — an eyebrow label over grouped controls.
// ---------------------------------------------------------------------------

function SettingsGroup({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">{title}</p>
      {children}
    </div>
  );
}

// Relative time for the "synced" facts/subtitle (e.g. "3h ago").
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Delta chip — sign + arrow + tinted color (never color-only). Mirrors Money.
// ---------------------------------------------------------------------------

function DeltaChip({ delta }: { delta: number }) {
  const positive = delta >= 0;
  return (
    <span
      className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13px] font-bold ui-tnum"
      style={{
        background: positive ? 'var(--ui-positive-soft)' : 'var(--ui-negative-soft)',
        color: positive ? 'rgb(var(--ui-positive))' : 'rgb(var(--ui-negative))',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {positive ? <path d="M12 7l7 8H5z" /> : <path d="M12 17 5 9h14z" />}
      </svg>
      {positive ? '+' : '−'}{fmtUsd(Math.abs(delta))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Value trend chart — brand area+line on --ui-* tokens. Mirrors Money's chart:
// smooth spline + nice ticks + hover crosshair that bubbles the index up.
// ---------------------------------------------------------------------------

const CHART_H = 250;
const CHART_M = { top: 16, right: 12, bottom: 34, left: 56 };

function ValueChart({ points, range, onHoverChange }: { points: TrendPoint[]; range: Range; onHoverChange?: (i: number | null) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(680);
  const [hoverIdx, setHoverIdxRaw] = useState<number | null>(null);
  const setHoverIdx = (i: number | null) => { setHoverIdxRaw(i); onHoverChange?.(i); };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setChartW(el.clientWidth || 680);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = chartW - CHART_M.left - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;

  const { yMin, yMax, yTicks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = (rawMax - rawMin) * 0.08 || Math.abs(rawMax) * 0.08 || 1;
    return { yMin: rawMin - pad, yMax: rawMax + pad, yTicks: niceTicks(rawMin - pad, rawMax + pad, 4) };
  }, [points]);

  // Y-axis label formatter that keeps adjacent gridlines distinct. For a
  // small-range account (e.g. 17,001–17,078) the default "$17K" abbreviation
  // collapses every tick to the same string — so add precision, and fall back
  // to a full grouped figure once one decimal still isn't enough.
  const formatYTick = useMemo(() => {
    const maxAbs = Math.max(...yTicks.map((t) => Math.abs(t)), 1);
    const step = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 0;
    const unit = maxAbs >= 1e6 ? 1e6 : maxAbs >= 1e3 ? 1e3 : 1;
    const suffix = unit >= 1e6 ? 'M' : unit >= 1e3 ? 'K' : '';
    const decimals = unit > 1 && step > 0 && step < unit
      ? Math.min(2, Math.max(1, Math.ceil(Math.log10(unit / step))))
      : 0;
    return (t: number): string => {
      if (unit > 1 && decimals >= 2) {
        return t.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      }
      return `${t < 0 ? '-' : ''}$${(Math.abs(t) / unit).toFixed(decimals)}${suffix}`;
    };
  }, [yTicks]);

  const xAt = (i: number) => CHART_M.left + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v: number) => CHART_M.top + innerH - ((v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

  const xy = useMemo<Array<[number, number]>>(
    () => points.map((p, i) => [xAt(i), yAt(p.value)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, chartW, yMin, yMax],
  );
  const linePath = useMemo(() => smoothLinePath(xy), [xy]);
  const baseY = (CHART_M.top + innerH).toFixed(2);
  const areaPath = linePath
    ? `${linePath} L ${xAt(points.length - 1).toFixed(2)} ${baseY} L ${xAt(0).toFixed(2)} ${baseY} Z`
    : '';

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const xLabels = useMemo(() => pickXLabels(points, range), [points, range]);

  const pointerToIdx = (clientX: number): number | null => {
    const root = wrapRef.current;
    if (!root || points.length <= 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = chartW / rect.width;
    const localX = (clientX - rect.left) * scale;
    const ratio = (localX - CHART_M.left) / Math.max(1, innerW);
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        viewBox={`0 0 ${chartW} ${CHART_H}`}
        role="img"
        aria-label="Account value trend chart"
        className="block w-full"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id="ad-area-ui" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity="0.24" />
            <stop offset="55%" stopColor="var(--ui-viz-2)" stopOpacity="0.07" />
            <stop offset="100%" stopColor="var(--ui-viz-2)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ad-line-ui" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--ui-viz-2)" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={CHART_M.left} y1={yAt(t)} x2={chartW - CHART_M.right} y2={yAt(t)}
              stroke="var(--ui-hairline)" strokeWidth={1} strokeDasharray="2 5"
            />
            <text
              x={CHART_M.left - 12} y={yAt(t)} dy="0.32em" textAnchor="end"
              fill="rgb(var(--ui-content-faint))"
              style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatYTick(t)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#ad-area-ui)" />
        <path
          d={linePath} fill="none" stroke="url(#ad-line-ui)"
          strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
        />

        {!hover && points.length > 0 && (
          <>
            <circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].value)} r={11} fill="var(--ui-viz-2)" fillOpacity={0.12} />
            <circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].value)} r={5.5} fill="var(--ui-viz-2)" stroke="rgb(var(--ui-panel))" strokeWidth={3} />
          </>
        )}
        {hover && hoverIdx !== null && (
          <g>
            <line x1={xAt(hoverIdx)} y1={CHART_M.top} x2={xAt(hoverIdx)} y2={CHART_M.top + innerH} stroke="rgb(var(--ui-content-muted))" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 4" />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={14} fill="var(--ui-viz-2)" fillOpacity={0.16} />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={5.5} fill="var(--ui-viz-2)" stroke="rgb(var(--ui-panel))" strokeWidth={3} />
          </g>
        )}

        {xLabels.map(({ idx, label }) => (
          <text key={`${idx}-${label}`} x={xAt(idx)} y={CHART_H - 10} textAnchor="middle" fill="rgb(var(--ui-content-muted))" style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{label}</text>
        ))}
      </svg>

      {/* Pointer overlay — snaps hover to the nearest x-domain point. */}
      <div
        className="absolute inset-0"
        style={{ touchAction: 'pan-y', cursor: 'crosshair' }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerLeave={() => setHoverIdx(null)}
        onPointerCancel={() => setHoverIdx(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle — Bright switch (brand when on).
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="ui-focus flex w-full items-start gap-3 py-3.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-content">{label}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-content-muted">{description}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-150 ease-ui',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-panel shadow-ui-sm transition-[left] duration-150 ease-ui"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
    </button>
  );
}

// Matches the dashboard's titleCase (short words like "CPC"/"529" stay caps).
function titleCase(raw: string): string {
  return raw
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function titleCaseType(type: string, subtype: string | null): string {
  const base = subtype || type;
  return base.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
