import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import {
  Page,
  Section,
  Card,
  Button,
  Pill,
  useConfirm,
  SkeletonLine,
  SkeletonBlock,
  TrendChart,
  filterByRange,
  type Range,
  type TrendPoint,
} from '../components/ds';

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
      <Page>
        <Section>
          <Card>
            <SkeletonLine width="40%" height={28} style={{ marginBottom: 16 }} />
            <SkeletonBlock height={150} />
          </Card>
        </Section>
        <Section>
          <Card>
            <SkeletonBlock height={120} />
          </Card>
        </Section>
      </Page>
    );
  }

  if (notFound || !data) {
    return (
      <Page>
        <header className="ds-page-bar">
          <div className="ds-page-bar__title-group">
            <h1 className="ds-page-bar__title">Account not found</h1>
          </div>
        </header>
        <Section>
          <Card>
            <p style={{ margin: '0 0 16px', color: 'var(--lf-muted)', fontFamily: "'Geist', system-ui, sans-serif" }}>
              We couldn't find this account. It may have been deleted.
            </p>
            <Button variant="ink" onClick={() => setLocation('/money')}>Back to money</Button>
          </Card>
        </Section>
      </Page>
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

  const headerActions = (
    <div className="ds-money-header-actions">
      <Button variant="ghost" size="sm" onClick={openSettings} icon={<Pencil size={12} />}>
        Edit
      </Button>
      {!isManual && (
        <Button
          variant="ghost"
          size="sm"
          disabled={actionPending}
          onClick={handleSync}
          icon={<RefreshCw size={12} className={actionPending ? 'animate-spin' : ''} />}
        >
          {actionPending ? 'Syncing…' : 'Sync'}
        </Button>
      )}
      {isManual && (
        <Button variant="ghost" size="sm" className="ad-delete" disabled={actionPending} onClick={handleDelete}>
          {actionPending ? '…' : 'Delete'}
        </Button>
      )}
    </div>
  );

  const settingsSummary = [
    typeLabel,
    excludeFromNetWorth && 'Not counted',
    excludeTransactions && 'Tx hidden',
    invertBalance && 'Inverted',
  ].filter(Boolean).join(' · ');

  return (
    <Page>
      <style>{`
        .ad-back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 4px; }
        .ad-delete:hover { color: var(--lf-sauce); }
        .ds-money-header-actions { display: none; }
        @media (min-width: 640px) {
          .ds-money-header-actions { display: flex; flex-direction: row; align-items: center; gap: 10px; }
        }
        .ad-settings-toggle {
          display: flex; align-items: center; gap: 8px; width: 100%;
          padding: 14px 16px; background: var(--lf-surface);
          border: 1px solid var(--lf-rule-neutral); border-radius: 12px;
          box-shadow: var(--shadow-card); cursor: pointer; color: var(--lf-ink);
          font: inherit; text-align: left; transition: border-color 0.15s;
        }
        .ad-settings-toggle:hover { border-color: var(--lf-rule); }
        .ad-settings-toggle svg { color: var(--lf-muted); flex-shrink: 0; }
        .ad-settings-toggle__label {
          font-family: 'Geist', system-ui, sans-serif; font-size: 15px; font-weight: 500;
        }
        .ad-settings-toggle__summary {
          margin-left: auto; font-family: 'Geist', system-ui, sans-serif; font-size: 13px;
          color: var(--lf-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          min-width: 0;
        }
      `}</style>

      <Button variant="ghost" size="sm" className="ad-back" onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation('/money'); }} icon={<ChevronLeft size={16} />}>
        Back
      </Button>

      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">{titleCase(acct.name)}</h1>
          <span className="ds-page-bar__caption">{acct.mask ? `${institution} · ••${acct.mask}` : institution}</span>
        </div>
        {headerActions}
      </header>

      {(actionError || flash) && (
        <p role="status" aria-live="polite" style={{ margin: '0 0 8px', fontSize: 12, color: actionError ? 'var(--lf-neg)' : 'var(--lf-sauce)', fontFamily: "'Geist', system-ui, sans-serif" }}>
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
          <figure className="ds-figure">
            <div className="ds-figure__head">
              <div className="ds-figure__lead">
                <span className="ds-figure__label">Value history</span>
                <span className="ds-figure__value ds-num">{fmtUsd(displayValue)}</span>
                {hoveredPoint ? (
                  <span className="ds-figure__delta ds-num" style={{ color: 'var(--lf-muted)' }}>
                    {new Date(hoveredPoint.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                ) : change !== 0 && (
                  <span className={`ds-delta-chip ds-delta-chip--${change >= 0 ? 'pos' : 'neg'}`}>
                    {change >= 0 ? '↑' : '↓'} {fmtUsd(Math.abs(change))}
                  </span>
                )}
              </div>
              <div role="radiogroup" aria-label="Time range" className="ds-figure__range">
                {(['1M', '6M', '1Y', 'All'] as Range[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    role="radio"
                    aria-checked={range === r}
                    className="ds-figure__range-btn"
                  >
                    <Pill tone={range === r ? 'ink' : 'ghost'}>{r}</Pill>
                  </button>
                ))}
              </div>
            </div>
            {chartPoints.length >= 2 ? (
              <TrendChart points={chartPoints} range={range} onHoverChange={setChartHoverIdx} />
            ) : (
              <p className="ds-caption" style={{ padding: '36px 0', textAlign: 'center', color: 'var(--lf-muted)' }}>
                No data in this range.
              </p>
            )}
          </figure>
        );
      })() : (
        <figure className="ds-figure">
          <div className="ds-figure__head">
            <div className="ds-figure__lead">
              <span className="ds-figure__label">Value</span>
              <span className="ds-figure__value ds-num">{fmtUsd(allPoints[0]?.value ?? balance)}</span>
            </div>
          </div>
          <p className="ds-caption" style={{ marginTop: 4, color: 'var(--lf-muted)' }}>No history yet</p>
        </figure>
      )}

      {/* ── Settings — collapsed behind a toggle (hidden by default). ── */}
      <Section>
        <button
          ref={settingsRef}
          type="button"
          className="ad-settings-toggle"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((o) => !o)}
        >
          {settingsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="ad-settings-toggle__label">Account settings</span>
          {!settingsOpen && <span className="ad-settings-toggle__summary">{settingsSummary}</span>}
        </button>

        {settingsOpen && (
        <Card style={{ marginTop: 12 }}>
          {isManual ? (
            <>
              <Field label="Name">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Value">
                <input
                  type="number"
                  inputMode="decimal"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  style={inputStyle}
                />
              </Field>
            </>
          ) : (
            <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, background: 'var(--lf-cream-deep)', color: 'var(--lf-muted)' }}>
              <span style={{ color: 'var(--lf-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleCase(acct.name)}</span>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>Synced · read-only</span>
            </div>
          )}

          <Field label="Account type">
            <div style={{ position: 'relative' }}>
              <select value={typeKey} onChange={(e) => setTypeKey(e.target.value)} style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', paddingRight: 36, cursor: 'pointer' }}>
                {options.map((o) => (
                  <option key={keyFor(o.type, o.subtype)} value={keyFor(o.type, o.subtype)}>{o.label}</option>
                ))}
              </select>
              <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--lf-muted)', pointerEvents: 'none' }} />
            </div>
            {crossesBucket && (
              <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.4, color: 'var(--lf-neg)' }}>
                This moves the account {willBeLiability ? 'into debt' : 'into assets'} — it will change your net worth.
              </p>
            )}
          </Field>

          <div style={{ height: 1, background: 'var(--lf-rule)', margin: '16px 0' }} />

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

          {isLiabilityAcct && (
            <>
              <div style={{ height: 1, background: 'var(--lf-rule)', margin: '16px 0' }} />
              <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: 'var(--lf-ink-soft)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                Loan details
              </p>
              {(loanType === 'mortgage' || loanType === 'other_loan') && (
                <Field label="Maturity / payoff date">
                  <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} style={inputStyle} />
                </Field>
              )}
              {loanType === 'student_loan' && (
                <Field label="Expected payoff date">
                  <input type="date" value={expectedPayoffDate} onChange={(e) => setExpectedPayoffDate(e.target.value)} style={inputStyle} />
                </Field>
              )}
              {loanType !== 'credit_card' && (
                <Field label="Interest rate (APR %)">
                  <input type="number" step="0.01" min="0" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} style={inputStyle} />
                </Field>
              )}
              {loanType === 'credit_card' && (
                <Field label="Purchase APR (%)">
                  <input type="number" step="0.01" min="0" value={purchaseApr} onChange={(e) => setPurchaseApr(e.target.value)} style={inputStyle} />
                </Field>
              )}
              {(loanType === 'mortgage' || loanType === 'other_loan') && (
                <Field label="Origination date">
                  <input type="date" value={originationDate} onChange={(e) => setOriginationDate(e.target.value)} style={inputStyle} />
                </Field>
              )}
              {(loanType === 'student_loan' || loanType === 'credit_card' || loanType === 'other_loan') && (
                <Field label="Minimum payment ($)">
                  <input type="number" step="1" min="0" value={minPayment} onChange={(e) => setMinPayment(e.target.value)} style={inputStyle} />
                </Field>
              )}
              {loanType === 'student_loan' && (
                <Field label="Repayment plan type">
                  <input type="text" value={repaymentPlanType} onChange={(e) => setRepaymentPlanType(e.target.value)} style={inputStyle} />
                </Field>
              )}
            </>
          )}

          <div style={{ marginTop: 20 }}>
            <Button variant="ink" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card>
        )}
      </Section>
    </Page>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--lf-ink-soft)', marginBottom: 6, letterSpacing: '0.02em' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

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
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        width: '100%',
        padding: '12px 0',
        background: 'none',
        border: 0,
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--lf-ink)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--lf-muted)', marginTop: 2, lineHeight: 1.4 }}>{description}</span>
      </span>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 38,
          height: 22,
          borderRadius: 999,
          background: checked ? 'var(--lf-sauce)' : 'var(--lf-rule)',
          position: 'relative',
          transition: 'background 0.15s ease',
          marginTop: 2,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'var(--lf-paper)',
            transition: 'left 0.15s ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}
        />
      </span>
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--lf-cream)',
  border: '1px solid var(--lf-rule)',
  borderRadius: 8,
  fontSize: 16,
  color: 'var(--lf-ink)',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

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
