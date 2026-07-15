import { useState, useEffect } from 'react';
import { CreditCard, Landmark, Pencil, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatMoney } from '../lib/utils';
import { usePageContext } from '../lib/page-context';
import { useChatStore } from '../lib/chat-store';
import { PageActions } from '../components/common/page-actions';
import {
  Button,
  Surface,
  Badge,
  Field,
  Input,
  EmptyState,
  Modal,
} from '../components/uikit';

interface DebtAccount {
  id: string;
  name: string;
  mask: string | null;
  balance: number;
  type: string;
  subtype: string | null;
  property: { id: string; name: string } | null;
  apr: number;
  minPayment: number;
  suggestedPayment: number;
  minPayoffDate: string;
  suggestedPayoffDate: string;
  payoffDate: string | null;
  liabilitySource: "plaid" | "manual" | null;
  liabilityLastSyncedAt: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Calculate months to pay off with given monthly payment */
function monthsToPayoff(balance: number, apr: number, payment: number): number {
  const monthlyRate = apr / 100 / 12;
  if (payment <= balance * monthlyRate) return 999;
  if (monthlyRate === 0) return Math.ceil(balance / payment);
  return Math.ceil(Math.log(payment / (payment - balance * monthlyRate)) / Math.log(1 + monthlyRate));
}

function addMonths(months: number): string {
  if (months >= 999) return 'Never (at minimum)';
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Calculate total interest paid (simple per-debt sum, no waterfall cascade) */
function calcTotalInterest(debts: DebtAccount[], paymentFn: (d: DebtAccount) => number): number {
  return debts.reduce((sum, d) => {
    const pmt = paymentFn(d);
    const months = monthsToPayoff(d.balance, d.apr, pmt);
    if (months >= 999) return sum + 999_999;
    return sum + Math.max(0, pmt * months - d.balance);
  }, 0);
}

/** Blended weighted-average APR */
function blendedApr(debts: DebtAccount[]): number {
  const totalBal = debts.reduce((s, d) => s + d.balance, 0);
  if (totalBal === 0) return 0;
  const weighted = debts.reduce((s, d) => s + d.apr * d.balance, 0);
  return Math.round((weighted / totalBal) * 10) / 10;
}

function debtTypeLabel(d: DebtAccount): string {
  if (d.type === 'credit') return 'Credit Card';
  if (d.subtype === 'mortgage' || d.name?.toLowerCase().includes('mortgage')) return 'Mortgage';
  if (d.subtype === 'student_loan' || d.name?.toLowerCase().includes('student')) return 'Student Loan';
  return 'Loan';
}

// Distinct hues for debt composition segments. Coral (viz-4) is the debt color,
// so it leads; the rest alternate through the Bright categorical palette to give
// at-a-glance separation between accounts, in both light and dark.
const DEBT_SHADES = [
  'var(--ui-viz-4)',
  'var(--ui-viz-3)',
  'var(--ui-viz-7)',
  'var(--ui-viz-5)',
  'var(--ui-viz-2)',
  'var(--ui-viz-6)',
];
function debtColor(i: number): string {
  return DEBT_SHADES[i % DEBT_SHADES.length];
}

// ── Page Component ────────────────────────────────────────────────────────────

export function Debt() {
  const { setPageContext } = usePageContext();
  const { openChat } = useChatStore();
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<DebtAccount[]>([]);
  const [totalDebt, setTotalDebt] = useState(0);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingDebt, setEditingDebt] = useState<DebtAccount | null>(null);
  const [strategy, setStrategy] = useState<'avalanche' | 'snowball'>('avalanche');

  const handleLoanDetailsSaved = () => {
    setEditingDebt(null);
    setRefreshKey((k) => k + 1);
  };

  const closeModal = () => setEditingDebt(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getDebts().catch(() => ({ debts: [] as Array<{ id: string; name: string; type: string; subtype: string | null; property: { id: string; name: string } | null; balance: number; interestRate: number | null; termMonths: number | null; originationDate: string | null; minimumPayment: number; payoffDate: string | null; liabilitySource: "plaid" | "manual" | null; liabilityLastSyncedAt: string | null; lastUpdated: string | null }>, totalDebt: 0, monthlyInterest: 0 })),
      api.getBalances().catch(() => ({ balances: [] })),
    ]).then(([debtResult, balanceData]) => {
      setHasAccounts(balanceData.balances.length > 0);
      const apiDebts = debtResult.debts;
      const apiTotal = debtResult.totalDebt;
      const mapped: DebtAccount[] = apiDebts.map((d) => {
        const isMortgage = d.name?.toLowerCase().includes('mortgage');
        const apr = d.interestRate ?? (d.type === 'credit' ? 21.99 : isMortgage ? 6.5 : 8.0);
        const minPay = d.minimumPayment;
        const isHighInterest = apr >= 7 && !isMortgage;
        const suggestedPay = isHighInterest ? Math.round(minPay * 1.8) : minPay;
        const minMonths = monthsToPayoff(d.balance, apr, minPay);
        const sugMonths = monthsToPayoff(d.balance, apr, suggestedPay);
        return {
          id: d.id,
          name: d.name,
          mask: (d as any).mask ?? null,
          balance: d.balance,
          type: d.type,
          subtype: d.subtype ?? null,
          property: d.property ?? null,
          apr: Math.round(apr * 100) / 100,
          minPayment: minPay,
          suggestedPayment: suggestedPay,
          minPayoffDate: addMonths(minMonths),
          suggestedPayoffDate: addMonths(sugMonths),
          payoffDate: d.payoffDate ?? null,
          liabilitySource: d.liabilitySource ?? null,
          liabilityLastSyncedAt: d.liabilityLastSyncedAt ?? null,
        };
      });

      mapped.sort((a, b) => b.apr - a.apr);
      setDebts(mapped);
      setTotalDebt(apiTotal);
    })
    .finally(() => setLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'debt',
        pageTitle: 'Debt Command Center',
        description: 'Debt overview with balances, interest rates, and payoff strategies.',
      });
    }
  }, [loading, setPageContext]);

  const hasDebt = totalDebt > 0;

  const avalancheOrder = [...debts].sort((a, b) => b.apr - a.apr);
  const snowballOrder = [...debts].sort((a, b) => a.balance - b.balance);

  const avalancheInterest = calcTotalInterest(avalancheOrder, d => d.suggestedPayment);
  const snowballInterest = calcTotalInterest(snowballOrder, d => d.suggestedPayment);
  const interestSavedVsSnowball = Math.round(Math.max(0, snowballInterest - avalancheInterest));

  const orderedDebts = strategy === 'avalanche' ? avalancheOrder : snowballOrder;
  const suggestedMonths = orderedDebts.length > 0
    ? Math.max(...orderedDebts.map(d => monthsToPayoff(d.balance, d.apr, d.suggestedPayment)))
    : 0;
  const minOnlyMonths = orderedDebts.length > 0
    ? Math.max(...orderedDebts.map(d => monthsToPayoff(d.balance, d.apr, d.minPayment)))
    : 0;

  const debtFreeDate = addMonths(suggestedMonths);
  const minOnlyDate = addMonths(minOnlyMonths);
  const totalMonthlyPayment = debts.reduce((s, d) => s + d.suggestedPayment, 0);
  const apr = blendedApr(debts);

  return (
    <div className="mx-auto max-w-[1120px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {loading ? null : !hasAccounts ? (
        <NoAccountsView />
      ) : hasDebt ? (
        <HasDebtView
          debts={debts}
          totalDebt={totalDebt}
          totalMonthlyPayment={totalMonthlyPayment}
          interestSavedVsSnowball={interestSavedVsSnowball}
          avalancheInterest={avalancheInterest}
          snowballInterest={snowballInterest}
          debtFreeDate={debtFreeDate}
          minOnlyDate={minOnlyDate}
          apr={apr}
          strategy={strategy}
          onStrategyChange={setStrategy}
          orderedDebts={orderedDebts}
          openChat={openChat}
          editingDebt={editingDebt}
          onEditDebt={setEditingDebt}
          onCloseModal={closeModal}
          onLoanDetailsSaved={handleLoanDetailsSaved}
        />
      ) : (
        <DebtFreeView openChat={openChat} />
      )}
    </div>
  );
}

// ── Page header ───────────────────────────────────────────────────────────────

function DebtHeader({ subtitle }: { subtitle?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
          Debt
        </h1>
        {subtitle && (
          <p className="mt-2 text-[14.5px] font-semibold text-content-muted">{subtitle}</p>
        )}
      </div>
    </header>
  );
}

// ── No Accounts View ──────────────────────────────────────────────────────────

function NoAccountsView() {
  return (
    <>
      <DebtHeader subtitle="No accounts linked" />
      <div className="mt-8">
        <EmptyState
          icon={<CreditCard size={24} />}
          title="No accounts linked"
          description="Add your credit cards and loans to see your debt breakdown, payoff timeline, and optimization strategy."
          action={import.meta.env.VITE_DEMO_MODE !== "true" ? (
            <a href="/accounts">
              <Button>Add accounts</Button>
            </a>
          ) : undefined}
        />
      </div>
    </>
  );
}

// ── KPI (supporting stat, lighter than the hero) ──────────────────────────────

function Kpi({ label, value, sub, neg }: { label: string; value: React.ReactNode; sub: string; neg?: boolean }) {
  return (
    <div className="border-l-2 border-line pl-3.5">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">{label}</div>
      <div className={cn(
        'mt-1.5 font-editorial text-[22px] sm:text-[24px] font-extrabold leading-none tracking-[-0.02em] ui-tnum',
        neg ? 'text-negative' : 'text-content',
      )}>
        {value}
      </div>
      <div className="mt-1.5 truncate text-[11.5px] font-medium text-content-muted">{sub}</div>
    </div>
  );
}

// ── Debt ribbon — one confident, full-width composition chart ──────────────────
// Segments grow to their balance; wide ones carry an inline label. Coral leads
// (debt colour), matching the portfolio allocation bar as the primary-page bar.

function DebtRibbon({ debts }: { debts: DebtAccount[] }) {
  const segs = [...debts]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 6)
    .map((d, i) => ({
      label: `${d.name}${d.mask ? ` ··${d.mask}` : ''}`.replace(/\bMORTGAGE\b/gi, 'MTG'),
      value: Math.abs(d.balance),
      color: debtColor(i),
    }));
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;

  return (
    <div
      className="flex h-[52px] gap-[3px] overflow-hidden rounded-[14px]"
      style={{ boxShadow: 'var(--ui-shadow-sm), inset 0 1.5px 0 rgba(255,255,255,0.24)' }}
      role="img"
      aria-label="Debt composition by balance"
    >
      {segs.map((s, i) => {
        const pct = (s.value / total) * 100;
        const wide = pct >= 9;
        return (
          <div
            key={`${s.label}-${i}`}
            className="relative flex h-full items-center px-3"
            style={{
              flexGrow: s.value,
              minWidth: 5,
              background: s.color,
              backgroundImage:
                'linear-gradient(170deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 52%, rgba(0,0,0,0.12))',
              borderRadius: i === 0 ? '11px 4px 4px 11px' : i === segs.length - 1 ? '4px 11px 11px 4px' : '4px',
            }}
            title={`${s.label} · ${pct.toFixed(1)}% · ${formatCurrency(s.value)}`}
          >
            {wide && (
              <span className="truncate text-[12.5px] font-extrabold text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.32)' }}>
                {s.label} · {pct.toFixed(0)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Debt breakdown — the legible two-column legend for the ribbon ──────────────

function DebtBreakdown({ debts }: { debts: DebtAccount[] }) {
  const rows = [...debts]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 6)
    .map((d, i) => ({
      label: `${d.name}${d.mask ? ` ··${d.mask}` : ''}`.replace(/\bMORTGAGE\b/gi, 'MTG'),
      value: Math.abs(d.balance),
      color: debtColor(i),
    }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return null;

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-0.5 sm:grid-cols-2">
      {rows.map((r, i) => {
        const pct = (r.value / total) * 100;
        return (
          <div key={`${r.label}-${i}`} className="flex items-center gap-3 px-1 py-2">
            <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: r.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content" title={r.label}>{r.label}</span>
            <span className="shrink-0 whitespace-nowrap text-right ui-tnum">
              <span className="font-editorial text-[14px] font-extrabold tracking-[-0.01em] text-content">{formatCurrency(r.value)}</span>
              <span className="ml-2 text-[12.5px] font-semibold text-content-muted">{pct < 0.1 ? '<0.1%' : `${pct.toFixed(0)}%`}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Strategy option — a compact, outcome-first radio choice ────────────────────

function StrategyOption({
  active, onSelect, title, sub, interest, note, noteTone,
}: {
  active: boolean;
  onSelect: () => void;
  title: string;
  sub: string;
  interest: string;
  note: string;
  noteTone: 'good' | 'bad' | 'flat';
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'group relative flex items-center gap-3.5 rounded-ui-lg border bg-panel p-4 text-left transition-[transform,box-shadow,border-color]',
        active
          ? 'border-[rgb(var(--ui-accent))] shadow-ui-md ring-1 ring-[var(--ui-accent-soft)]'
          : 'border-line shadow-ui-sm hover:-translate-y-0.5 hover:border-line-strong hover:shadow-ui-md',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center self-start rounded-full border-2 transition-colors',
          active ? 'border-[rgb(var(--ui-accent))]' : 'border-line-strong',
        )}
        aria-hidden
      >
        {active && <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--ui-accent))]" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-editorial text-[16px] font-bold tracking-[-0.015em] text-content">{title}</span>
          <span className="text-[11.5px] font-semibold text-content-muted">{sub}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-content-muted ui-tnum">
          <span><span className="font-bold text-content">{interest}</span> interest</span>
          <span className="text-content-faint">·</span>
          <span
            className={cn(
              'font-bold',
              noteTone === 'good' && 'text-[rgb(var(--ui-brand-ink))]',
              noteTone === 'bad' && 'text-negative',
              noteTone === 'flat' && 'text-content-muted',
            )}
          >
            {note}
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Attack sequence — the concrete "fastest way out": which balance to hit
// first, then the rest. Reorders live when the strategy changes. ──────────────

function AttackList({ debts, strategy }: { debts: DebtAccount[]; strategy: 'avalanche' | 'snowball' }) {
  return (
    <ol key={strategy} className="animate-fade-in flex flex-col gap-2">
      {debts.map((d, i) => {
        const focus = i === 0;
        const high = d.apr > 20;
        const extra = Math.max(0, d.suggestedPayment - d.minPayment);
        const role = focus
          ? extra > 0
            ? `Focus here — put ${formatCurrency(extra)}/mo extra on this`
            : 'Focus here first, then roll the freed-up payment down'
          : `Pay the ${formatCurrency(d.minPayment)}/mo minimum for now`;
        return (
          <li
            key={d.id}
            className={cn(
              'flex items-center gap-3.5 rounded-ui-lg border px-3.5 py-3 transition-colors',
              focus ? 'border-[rgb(var(--ui-accent))] bg-[var(--ui-accent-softer)]' : 'border-line bg-panel',
            )}
          >
            <span
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-extrabold ui-tnum',
                focus ? 'bg-[rgb(var(--ui-accent))] text-white' : 'bg-canvas-sunken text-content-secondary',
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[14px] font-semibold text-content">
                  {d.name}{d.mask ? ` ··${d.mask}` : ''}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ui-tnum',
                    high ? 'bg-negative-soft text-negative' : 'bg-canvas-sunken text-content-muted',
                  )}
                >
                  {d.apr}%
                </span>
                {focus && (
                  <span className="shrink-0 rounded-full bg-[var(--ui-accent-soft)] px-1.5 py-0.5 text-[10.5px] font-bold text-[rgb(var(--ui-accent-ink))]">
                    Attack first
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[12px] font-medium text-content-muted">{role}</div>
            </div>
            <div className="shrink-0 text-right font-editorial text-[15px] font-extrabold tracking-[-0.015em] text-negative ui-tnum">
              −{formatCurrency(d.balance)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Account card — one liability, all key fields, used at every width ──────────

function AccountStat({ label, value, neg }: { label: string; value: string; neg?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-content-muted">{label}</div>
      <div className={cn('mt-0.5 truncate text-[13.5px] font-bold ui-tnum', neg ? 'text-negative' : 'text-content')}>{value}</div>
    </div>
  );
}

function AccountCard({
  debt: d, maxBalance, isDemo, onEdit, onPlan, className,
}: {
  debt: DebtAccount;
  maxBalance: number;
  isDemo: boolean;
  onEdit: () => void;
  onPlan: () => void;
  className?: string;
}) {
  const high = d.apr > 20;
  const share = maxBalance > 0 ? Math.max(4, (Math.abs(d.balance) / maxBalance) * 100) : 0;
  const payoff = d.payoffDate
    ? new Date(d.payoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : d.suggestedPayoffDate;
  return (
    <div className={cn("flex flex-col rounded-ui-xl border border-line bg-panel p-4 shadow-ui-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-ui-md", className)}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-md bg-canvas-sunken text-content-secondary">
          {d.type === 'credit' ? <CreditCard size={16} /> : <Landmark size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-content">
            {d.name}{d.mask ? ` ··${d.mask}` : ''}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral" size="sm">{debtTypeLabel(d)}</Badge>
            {d.property && <span className="text-[12px] font-medium text-content-muted">on {d.property.name}</span>}
            {d.liabilitySource === 'plaid' && <Badge tone="brand" size="sm">Synced</Badge>}
          </div>
        </div>
        <div className="shrink-0 pt-0.5 text-right font-editorial text-[17px] font-extrabold tracking-[-0.015em] text-negative ui-tnum">
          −{formatCurrency(d.balance)}
        </div>
      </div>

      {/* share-of-debt bar — visual weight of this balance vs the largest */}
      <div className="mt-3 h-[6px] w-full overflow-hidden rounded-full bg-canvas-sunken">
        <div className="h-full rounded-full" style={{ width: `${share}%`, background: 'rgb(var(--ui-negative))', opacity: 0.85 }} />
      </div>

      <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-line pt-3.5">
        <AccountStat label="APR" value={`${d.apr}%`} neg={high} />
        <AccountStat label="Min pay" value={`${formatCurrency(d.minPayment)}/mo`} />
        <AccountStat label="Payoff" value={payoff} />
      </div>

      <div className="mt-3.5 flex items-center gap-2">
        {!isDemo && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit loan details"
            className="ui-focus grid h-11 w-11 shrink-0 place-items-center rounded-ui-sm border border-line text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
          >
            <Pencil size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={onPlan}
          className="ui-focus inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-ui-sm bg-brand-soft text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-ui-sm"
        >
          Plan payoff
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Has Debt View ─────────────────────────────────────────────────────────────

function HasDebtView({
  debts, totalDebt, totalMonthlyPayment, interestSavedVsSnowball,
  avalancheInterest, snowballInterest,
  debtFreeDate, minOnlyDate, apr,
  strategy, onStrategyChange, orderedDebts,
  openChat, editingDebt, onEditDebt, onCloseModal, onLoanDetailsSaved,
}: {
  debts: DebtAccount[];
  totalDebt: number;
  totalMonthlyPayment: number;
  interestSavedVsSnowball: number;
  avalancheInterest: number;
  snowballInterest: number;
  debtFreeDate: string;
  minOnlyDate: string;
  apr: number;
  strategy: 'avalanche' | 'snowball';
  onStrategyChange: (s: 'avalanche' | 'snowball') => void;
  orderedDebts: DebtAccount[];
  openChat: (prompt: string) => void;
  editingDebt: DebtAccount | null;
  onEditDebt: (debt: DebtAccount) => void;
  onCloseModal: () => void;
  onLoanDetailsSaved: () => void;
}) {
  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

  // Highest-rate account — `debts` arrives pre-sorted by APR desc, so the head
  // is the avalanche target. Surfaced as a distinct KPI (never the blended APR).
  const highest = debts[0];
  const highRateCount = debts.filter((d) => d.apr > 20).length;
  const totalMinPayment = debts.reduce((s, d) => s + d.minPayment, 0);
  const maxBalance = debts.reduce((m, d) => Math.max(m, Math.abs(d.balance)), 0);

  const activeInterest = strategy === 'avalanche' ? avalancheInterest : snowballInterest;
  const noNeverDate = !debtFreeDate.toLowerCase().startsWith('never');
  const focusTarget = orderedDebts[0];

  return (
    <>
      {/* ── Purpose-led header: the page's job stated up top ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
              aria-hidden
            />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Debt</span>
          </div>
          <h1 className="mt-2 font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
            How fast can you be debt-free?
          </h1>
          <p className="mt-1.5 inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] font-medium text-content-muted">
            <span><b className="font-extrabold text-content ui-tnum">{debts.length}</b> account{debts.length === 1 ? '' : 's'}</span>
            {highRateCount > 0 && (
              <>
                <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
                <span><b className="font-extrabold text-negative ui-tnum">{highRateCount}</b> at a punishing rate</span>
              </>
            )}
          </p>
        </div>
      </header>

      {/* ── HERO — one confident answer: how much, how long, what it costs ── */}
      <section className="relative mt-6 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 100% 0%, var(--ui-negative-soft), transparent 58%),' +
              'radial-gradient(90% 70% at 0% 4%, var(--ui-caution-soft), transparent 62%)',
          }}
        />
        <div className="relative">
          <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Total debt</div>
          <div className="mt-2 font-editorial text-[40px] sm:text-[56px] font-extrabold leading-[0.9] tracking-[-0.035em] text-negative ui-tnum">
            −{formatCurrency(totalDebt)}
          </div>
          <p className="mt-4 max-w-[54ch] text-[14.5px] leading-[1.55] text-content-secondary ui-tnum">
            {noNeverDate ? (
              <>
                On your <strong className="font-bold text-content">{strategy}</strong> plan you&apos;re debt-free by{' '}
                <strong className="font-bold text-content">{debtFreeDate}</strong> — and it costs about{' '}
                <strong className="font-bold text-negative">{formatCurrency(Math.round(activeInterest))}</strong> in interest along the way.
              </>
            ) : (
              <>
                At minimum payments this debt never clears. Put more toward the highest-rate balance to set a real
                debt-free date and cut the interest you&apos;re paying.
              </>
            )}
          </p>

          {debts.length > 0 && (
            <div className="mt-6">
              <DebtRibbon debts={debts} />
              <div className="mt-5">
                <DebtBreakdown debts={debts} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Supporting KPIs — distinct from the hero + strategy figures ── */}
      <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Kpi label="Blended APR" value={`${apr}%`} sub="weighted average" />
        <Kpi label="Monthly payment" value={formatCurrency(totalMonthlyPayment)} sub="suggested plan" />
        <Kpi label="Minimum due" value={formatCurrency(totalMinPayment)} sub="required each month" />
        {highest && (
          <Kpi label="Highest rate" value={`${highest.apr}%`} sub={debtTypeLabel(highest)} neg={highest.apr > 20} />
        )}
      </div>

      {/* ── YOUR PAYOFF PLAN — pick a method, see the concrete order to attack ── */}
      <section className="mt-11">
        <div className="flex items-center gap-2.5 pb-4">
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full bg-[rgb(var(--ui-accent))]"
            style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
            aria-hidden
          />
          <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.02em] text-content">Your payoff plan</h2>
          <span className="ml-auto text-[10.5px] font-bold uppercase tracking-[0.14em] text-content-muted" aria-live="polite">
            {strategy}
          </span>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)]">
          {/* left: the method chooser — impact shown as a direct A/B */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Payoff strategy">
              <StrategyOption
                active={strategy === 'avalanche'}
                onSelect={() => onStrategyChange('avalanche')}
                title="Avalanche"
                sub="Highest APR first"
                interest={formatCurrency(Math.round(avalancheInterest))}
                note={interestSavedVsSnowball > 0 ? `Saves ${formatCurrency(interestSavedVsSnowball)}` : 'Lowest-cost order'}
                noteTone="good"
              />
              <StrategyOption
                active={strategy === 'snowball'}
                onSelect={() => onStrategyChange('snowball')}
                title="Snowball"
                sub="Smallest balance first"
                interest={formatCurrency(Math.round(snowballInterest))}
                note={interestSavedVsSnowball > 0 ? `+${formatCurrency(interestSavedVsSnowball)} more` : 'Closes accounts fastest'}
                noteTone={interestSavedVsSnowball > 0 ? 'bad' : 'flat'}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-ui-lg border border-line bg-canvas-sunken px-3.5 py-3">
              <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-content-muted">Debt-free</div>
                  <div className="mt-0.5 text-[14px] font-bold text-content ui-tnum">{debtFreeDate}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-content-muted">At minimums</div>
                  <div className="mt-0.5 text-[14px] font-bold text-content-muted ui-tnum">{minOnlyDate}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openChat('Should I use avalanche or snowball to pay off my debt?')}
                className="group ui-focus touch-target-inline inline-flex items-center gap-1.5 rounded-ui-sm text-[13px] font-bold text-[rgb(var(--ui-brand-ink))] transition-colors hover:text-brand"
              >
                Why this strategy?
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>

          {/* right: the concrete order — the actionable "fastest way out" */}
          <div>
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">Pay in this order</span>
              {focusTarget && (
                <span className="text-[12px] font-semibold text-content-muted">
                  Start with <b className="text-content">{focusTarget.name}{focusTarget.mask ? ` ··${focusTarget.mask}` : ''}</b>
                </span>
              )}
            </div>
            <AttackList debts={orderedDebts} strategy={strategy} />
          </div>
        </div>
      </section>

      {/* ── ACCOUNTS — the ledger, two-column cards; every field visible ── */}
      <section className="mt-11">
        <div className="flex items-center gap-2.5 pb-3">
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full bg-[rgb(var(--ui-accent))]"
            style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
            aria-hidden
          />
          <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.02em] text-content">Accounts</h2>
          <span className="ml-auto text-[10.5px] font-bold uppercase tracking-[0.14em] text-content-muted">
            {orderedDebts.length} total
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {orderedDebts.map((d, i) => (
            <AccountCard
              key={d.id}
              debt={d}
              maxBalance={maxBalance}
              isDemo={isDemo}
              // A lone final card in the 2-col grid would leave an empty right
              // column — center it across the row instead of orphaning it.
              className={
                orderedDebts.length % 2 === 1 && i === orderedDebts.length - 1
                  ? "lg:col-span-2 lg:mx-auto lg:w-[calc(50%-6px)]"
                  : undefined
              }
              onEdit={() => onEditDebt(d)}
              onPlan={() => openChat(`Help me create a payoff plan for my ${d.name} (${d.apr}% APR, ${formatMoney(d.balance, true)} balance).`)}
            />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <PageActions types="debt" />
      </section>

      {editingDebt && (
        <LoanDetailsModal
          debt={editingDebt}
          onClose={onCloseModal}
          onSaved={onLoanDetailsSaved}
        />
      )}
    </>
  );
}

// ── Loan Details Modal ────────────────────────────────────────────────────────

function LoanDetailsModal({
  debt,
  onClose,
  onSaved,
}: {
  debt: DebtAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maturityDate, setMaturityDate] = useState("");
  const [expectedPayoffDate, setExpectedPayoffDate] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [minPayment, setMinPayment] = useState("");
  const [originationDate, setOriginationDate] = useState("");
  const [repaymentPlanType, setRepaymentPlanType] = useState("");
  const [purchaseApr, setPurchaseApr] = useState("");

  const isCredit = debt.type === "credit";
  const loanType: "mortgage" | "student_loan" | "credit_card" | "other_loan" = isCredit
    ? "credit_card"
    : debt.subtype === "mortgage"
      ? "mortgage"
      : debt.subtype === "student_loan"
        ? "student_loan"
        : debt.name.toLowerCase().includes("mortgage")
          ? "mortgage"
          : debt.name.toLowerCase().includes("student")
            ? "student_loan"
            : "other_loan";

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { type: loanType };
      if (loanType === "mortgage") {
        if (maturityDate) body.maturityDate = maturityDate;
        if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
        if (originationDate) body.originationDate = originationDate;
      } else if (loanType === "student_loan") {
        if (expectedPayoffDate) body.expectedPayoffDate = expectedPayoffDate;
        if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
        if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
        if (repaymentPlanType) body.repaymentPlanType = repaymentPlanType;
      } else if (loanType === "credit_card") {
        if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
        if (purchaseApr)
          body.aprs = [{ aprType: "purchase_apr", aprPercentage: parseFloat(purchaseApr) }];
      } else {
        if (maturityDate) body.maturityDate = maturityDate;
        if (interestRate) body.interestRatePercentage = parseFloat(interestRate);
        if (minPayment) body.minimumPaymentAmount = parseFloat(minPayment);
        if (originationDate) body.originationDate = originationDate;
      }
      const hasData = Object.keys(body).length > 1;
      if (!hasData) {
        setError("Please fill in at least one field.");
        return;
      }
      await api.patchLoanDetails(debt.id, body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={debt.name}
      description="Update loan details"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {(loanType === "mortgage" || loanType === "other_loan") && (
          <Field label="Maturity / Payoff date">
            <Input type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} />
          </Field>
        )}
        {loanType === "student_loan" && (
          <Field label="Expected payoff date">
            <Input type="date" value={expectedPayoffDate} onChange={e => setExpectedPayoffDate(e.target.value)} />
          </Field>
        )}
        {loanType !== "credit_card" && (
          <Field label="Interest rate (%)">
            <Input
              type="number" step="0.01" min="0"
              value={interestRate}
              onChange={e => setInterestRate(e.target.value)}
              placeholder={loanType === "mortgage" ? "e.g. 3.5" : "e.g. 6.5"}
              className="ui-tnum"
            />
          </Field>
        )}
        {(loanType === "mortgage" || loanType === "other_loan") && (
          <Field label="Origination date">
            <Input type="date" value={originationDate} onChange={e => setOriginationDate(e.target.value)} />
          </Field>
        )}
        {loanType === "credit_card" && (
          <Field label="Purchase APR (%)">
            <Input
              type="number" step="0.01" min="0"
              value={purchaseApr}
              onChange={e => setPurchaseApr(e.target.value)}
              placeholder="e.g. 21.99"
              className="ui-tnum"
            />
          </Field>
        )}
        {(loanType === "student_loan" || loanType === "credit_card" || loanType === "other_loan") && (
          <Field label="Minimum payment ($)">
            <Input
              type="number" step="1" min="0"
              value={minPayment}
              onChange={e => setMinPayment(e.target.value)}
              placeholder="e.g. 250"
              className="ui-tnum"
            />
          </Field>
        )}
        {loanType === "student_loan" && (
          <Field label="Repayment plan">
            <Input
              type="text"
              value={repaymentPlanType}
              onChange={e => setRepaymentPlanType(e.target.value)}
              placeholder="e.g. income_driven, standard"
            />
          </Field>
        )}

        {error && <p className="text-[12px] font-semibold text-negative">{error}</p>}
      </form>
    </Modal>
  );
}

// ── Debt-Free View ────────────────────────────────────────────────────────────

function DebtFreeView({ openChat }: { openChat: (prompt: string) => void }) {
  return (
    <>
      <DebtHeader
        subtitle={<span className="text-[rgb(var(--ui-brand-ink))] font-extrabold ui-tnum">$0 — debt-free</span>}
      />

      <section className="mt-8">
        <div className="mb-2 flex items-center gap-2.5">
          <span
            className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
            style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
            aria-hidden
          />
          <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
            Now that you're debt-free
          </span>
        </div>
        <Surface pad="lg" className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(120% 90% at 100% 0%, var(--ui-brand-soft), transparent 60%)' }}
          />
          <div className="relative">
            <h2 className="font-editorial text-[22px] font-bold tracking-[-0.018em] text-content">What's next?</h2>
            <p className="mt-2 max-w-[52ch] text-[14.5px] leading-relaxed text-content-secondary">
              Redirect those payments into investments and savings.
            </p>
            <div className="mt-5">
              <Button
                onClick={() => openChat('I just paid off all my debt. What should I do with the extra cash flow?')}
                trailingIcon={<ArrowRight className="h-4 w-4" />}
              >
                Walk me through this
              </Button>
            </div>
          </div>
        </Surface>
      </section>

      <section className="mt-12">
        <PageActions types="debt" />
      </section>
    </>
  );
}
