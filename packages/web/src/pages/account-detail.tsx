import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { ChevronDown, ChevronLeft, RefreshCw, Pencil, Trash2, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Button, Field, Input, Select, SegmentedControl, Skeleton } from '../components/uikit';
import { useConfirm, filterByRange, type Range, type TrendPoint } from '../components/ds';
import { smoothLinePath, niceTicks, pickXLabels, formatShortMoney } from '../components/ds/TrendChart';

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
};
type Snapshot = Awaited<ReturnType<typeof api.getHistory>>['snapshots'][number];

interface LoadedData {
  acct: DetailAccount;
  institution: string;
  isManual: boolean;
  snapshots: Snapshot[];
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
  const [maturityDate, setMaturityDate] = useState('');
  const [expectedPayoffDate, setExpectedPayoffDate] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [minPayment, setMinPayment] = useState('');
  const [originationDate, setOriginationDate] = useState('');
  const [repaymentPlanType, setRepaymentPlanType] = useState('');
  const [purchaseApr, setPurchaseApr] = useState('');
  // Snapshot of the loaded loan values so Save only patches when one changed.
  const initialLoanRef = useRef<Record<string, string>>({});

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
      let found: Omit<LoadedData, 'snapshots'> | null = null;
      for (const item of items) {
        const match = (item.accounts as DetailAccount[]).find((a) => a.id === id);
        if (match) {
          found = {
            acct: match,
            institution: item.institutionName || 'Manual',
            isManual: item.institutionId === 'manual',
          };
          break;
        }
      }
      if (!found) {
        setNotFound(true);
        return;
      }
      setData({ ...found, snapshots: history.snapshots });
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
        maturityDate: dateStr(meta.maturityDate),
        expectedPayoffDate: dateStr(meta.expectedPayoffDate),
        interestRate: num(meta.interestRatePercentage) || aprCol,
        minPayment: num(meta.minimumPaymentAmount),
        originationDate: dateStr(meta.originationDate),
        repaymentPlanType: typeof meta.repaymentPlanType === 'string' ? meta.repaymentPlanType : '',
        purchaseApr: (purchaseAprMeta !== undefined ? String(purchaseAprMeta) : '') || aprCol,
      };
      setMaturityDate(loanVals.maturityDate);
      setExpectedPayoffDate(loanVals.expectedPayoffDate);
      setInterestRate(loanVals.interestRate);
      setMinPayment(loanVals.minPayment);
      setOriginationDate(loanVals.originationDate);
      setRepaymentPlanType(loanVals.repaymentPlanType);
      setPurchaseApr(loanVals.purchaseApr);
      initialLoanRef.current = loanVals;
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
      <div className="mx-auto max-w-[1040px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-24 sm:pb-28 text-content">
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
      <div className="mx-auto max-w-[1040px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-24 sm:pb-28 text-content">
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

  const { acct, institution, isManual, snapshots } = data;
  const balance = parseFloat(acct.balance ?? '0');
  const typeLabel = titleCaseType(acct.type, acct.subtype);

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
    setSaving(true);
    try {
      if (isManual) {
        const manualUpdate: { name?: string; balance?: number } = {};
        if (name.trim() && name.trim() !== acct.name) manualUpdate.name = name.trim();
        const newBalance = parseFloat(editValue);
        if (!Number.isNaN(newBalance) && newBalance !== parseFloat(acct.balance ?? '0')) {
          manualUpdate.balance = newBalance;
        }
        if (Object.keys(manualUpdate).length > 0) {
          await api.updateManualAccount(id, manualUpdate);
        }
      }
      await api.updateAccount(id, {
        type: chosen.type,
        subtype: chosen.subtype,
        excludeFromNetWorth,
        excludeTransactions,
        invertBalance,
      });

      // Persist loan-detail edits (credit/loan accounts) when any field changed.
      if (isLiabilityAcct) {
        const cur: Record<string, string> = {
          maturityDate, expectedPayoffDate, interestRate, minPayment,
          originationDate, repaymentPlanType, purchaseApr,
        };
        const init = initialLoanRef.current;
        const changed = Object.keys(cur).some((k) => cur[k] !== (init[k] ?? ''));
        if (changed) {
          const body: Record<string, unknown> = { type: loanType };
          if (loanType === 'mortgage') {
            if (maturityDate) body.maturityDate = maturityDate;
            if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
            if (originationDate) body.originationDate = originationDate;
          } else if (loanType === 'student_loan') {
            if (expectedPayoffDate) body.expectedPayoffDate = expectedPayoffDate;
            if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
            if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
            if (repaymentPlanType) body.repaymentPlanType = repaymentPlanType;
          } else if (loanType === 'credit_card') {
            if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
            if (purchaseApr)
              body.aprs = [{ aprType: 'purchase_apr', aprPercentage: parseFloat(purchaseApr) }];
          } else {
            if (maturityDate) body.maturityDate = maturityDate;
            if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
            if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
            if (originationDate) body.originationDate = originationDate;
          }
          if (Object.keys(body).length > 1) await api.patchLoanDetails(id, body);
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

  return (
    <div className="mx-auto max-w-[1040px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-24 sm:pb-28 text-content">
      {/* ── Back ── */}
      <button
        type="button"
        onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation('/money'); }}
        className="ui-focus mb-2 inline-flex items-center gap-1 rounded-ui-sm text-[13px] font-semibold text-content-muted transition-colors hover:text-content"
      >
        <ChevronLeft size={16} /> Back
      </button>

      {/* ── Page header ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em]">
            {titleCase(acct.name)}
          </h1>
          <p className="mt-1.5 text-[14px] font-medium text-content-muted">
            {acct.mask ? `${institution} · ••${acct.mask}` : institution}
          </p>
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

      {(actionError || flash) && (
        <p
          role="status"
          aria-live="polite"
          className={cn('mt-3 text-[12.5px] font-semibold', actionError ? 'text-negative' : 'text-[rgb(var(--ui-brand-ink))]')}
        >
          {actionError ?? flash}
        </p>
      )}

      {/* ── Value history — full-width interactive chart (matches Money). ── */}
      {hasHistory ? (() => {
        const hoveredPoint = chartHoverIdx !== null ? chartPoints[chartHoverIdx] : null;
        const pts = chartPoints.length > 0 ? chartPoints : allPoints;
        const latest = pts[pts.length - 1];
        const first = pts[0];
        const displayValue = hoveredPoint ? hoveredPoint.value : latest.value;
        const change = latest.value - first.value;
        return (
          <section className="relative mt-6 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5 sm:p-[26px]">
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
                <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Value history</div>
                <div className="mt-2 font-editorial text-[34px] sm:text-[44px] font-extrabold leading-[0.98] tracking-[-0.035em] ui-tnum">
                  {fmtUsd(displayValue)}
                </div>
                <div className="mt-3 flex items-center gap-2.5 flex-wrap">
                  {hoveredPoint ? (
                    <span className="text-[13.5px] font-medium text-content-muted ui-tnum">
                      {new Date(hoveredPoint.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  ) : change !== 0 ? (
                    <DeltaChip delta={change} />
                  ) : null}
                </div>
              </div>
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
            </div>
            {chartPoints.length >= 2 ? (
              <div className="relative mt-5 pr-2 sm:pr-0">
                <ValueChart points={chartPoints} range={range} onHoverChange={setChartHoverIdx} />
              </div>
            ) : (
              <p className="relative mt-5 py-9 text-center text-[13px] text-content-muted">
                No data in this range.
              </p>
            )}
          </section>
        );
      })() : (
        <section className="relative mt-6 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5 sm:p-[26px]">
          <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Value</div>
          <div className="mt-2 font-editorial text-[34px] sm:text-[44px] font-extrabold leading-[0.98] tracking-[-0.035em] ui-tnum">
            {fmtUsd(allPoints[0]?.value ?? balance)}
          </div>
          <div className="mt-4 grid place-items-center rounded-ui-md border border-dashed border-line-strong bg-canvas-sunken/40 px-3 py-9 text-center">
            <div className="mb-2.5 grid h-11 w-11 place-items-center rounded-ui-md bg-brand-soft text-brand">
              <TrendingUp size={20} />
            </div>
            <div className="text-[15px] font-semibold">No history yet</div>
            <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-content-muted">
              A value trend appears once we have a few days of history.
            </p>
          </div>
        </section>
      )}

      {/* ── Settings — collapsible Bright accordion (hidden by default). ── */}
      <section className="mt-8 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm">
        <button
          ref={settingsRef}
          type="button"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((o) => !o)}
          className={cn(
            'ui-focus flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-brand-softer sm:px-5',
            settingsOpen && 'border-b border-line',
          )}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center text-content-faint">
            <ChevronDown size={18} className={cn('transition-transform duration-200 ease-ui', !settingsOpen && '-rotate-90')} />
          </span>
          <span className="shrink-0 font-editorial text-[16.5px] font-bold tracking-[-0.01em]">Account settings</span>
          {!settingsOpen && (
            <span className="ml-auto min-w-0 truncate text-[13px] font-medium text-content-muted">{settingsSummary}</span>
          )}
        </button>

        {settingsOpen && (
          <div className="p-4 sm:p-6">
            {isManual ? (
              <div className="space-y-4">
                <Field label="Name">
                  <Input type="text" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Value">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="ui-tnum"
                  />
                </Field>
              </div>
            ) : (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-ui-md border border-line bg-canvas-sunken px-3.5 py-3">
                <span className="min-w-0 truncate text-[14px] font-semibold text-content">{titleCase(acct.name)}</span>
                <span className="shrink-0 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.06em] text-content-muted">Synced · read-only</span>
              </div>
            )}

            <div className="mt-4">
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
            </div>

            <div className="my-5 h-px bg-line" />

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

            {isLiabilityAcct && (
              <>
                <div className="my-5 h-px bg-line" />
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">
                  Loan details
                </p>
                <div className="space-y-4">
                  {(loanType === 'mortgage' || loanType === 'other_loan') && (
                    <Field label="Maturity / payoff date">
                      <Input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
                    </Field>
                  )}
                  {loanType === 'student_loan' && (
                    <Field label="Expected payoff date">
                      <Input type="date" value={expectedPayoffDate} onChange={(e) => setExpectedPayoffDate(e.target.value)} />
                    </Field>
                  )}
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
                  {(loanType === 'mortgage' || loanType === 'other_loan') && (
                    <Field label="Origination date">
                      <Input type="date" value={originationDate} onChange={(e) => setOriginationDate(e.target.value)} />
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
              </>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <Button variant="primary" disabled={saving} loading={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
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
                  className="sm:hidden"
                  leadingIcon={<Trash2 size={14} />}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
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
        className="block w-full touch-none"
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
              {formatShortMoney(t)}
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
        style={{ touchAction: 'none', cursor: 'crosshair' }}
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
