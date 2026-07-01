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
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '../components/uikit';

interface DebtAccount {
  id: string;
  name: string;
  mask: string | null;
  balance: number;
  type: string;
  subtype: string | null;
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
      api.getDebts().catch(() => ({ debts: [] as Array<{ id: string; name: string; type: string; subtype: string | null; balance: number; interestRate: number | null; termMonths: number | null; originationDate: string | null; minimumPayment: number; payoffDate: string | null; liabilitySource: "plaid" | "manual" | null; liabilityLastSyncedAt: string | null; lastUpdated: string | null }>, totalDebt: 0, monthlyInterest: 0 })),
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
    <div className="mx-auto max-w-[1120px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
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

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, neg,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  neg?: boolean;
}) {
  return (
    <Surface pad="none" className="p-4 sm:p-[18px]">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">{label}</div>
      <div className={cn(
        'mt-1.5 font-editorial text-[24px] sm:text-[26px] font-extrabold leading-none tracking-[-0.02em] ui-tnum',
        neg ? 'text-negative' : 'text-content',
      )}>
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] font-semibold text-content-muted">{sub}</div>
    </Surface>
  );
}

// ── Composition bar ───────────────────────────────────────────────────────────

function CompositionBar({ debts }: { debts: DebtAccount[] }) {
  const segments = [...debts]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 6)
    .map((d, i) => ({
      label: d.name.replace(/\bMORTGAGE\b/gi, 'MTG'),
      value: d.balance,
      color: debtColor(i),
    }));
  const total = segments.reduce((s, seg) => s + Math.abs(seg.value), 0);
  if (total <= 0) return null;

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-canvas-sunken">
        {segments.map((seg, i) => {
          const pct = (Math.abs(seg.value) / total) * 100;
          return (
            <div
              key={i}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${pct}%`, background: seg.color, boxShadow: 'inset 0 0 0 1px rgb(var(--ui-panel) / 0.35)' }}
              title={`${seg.label} · ${formatCurrency(Math.abs(seg.value))}`}
            />
          );
        })}
      </div>
      <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-2">
        {segments.map((seg, i) => {
          const pct = Math.round((Math.abs(seg.value) / total) * 100);
          return (
            <div key={i} className="flex items-center gap-2 text-[12.5px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: seg.color }} aria-hidden />
              <span className="min-w-0 truncate font-semibold text-content-secondary">{seg.label}</span>
              <span className="ml-auto shrink-0 font-semibold text-content ui-tnum sm:ml-0">{formatCurrency(Math.abs(seg.value))}</span>
              <span className="shrink-0 text-content-muted ui-tnum">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Strategy card ─────────────────────────────────────────────────────────────

function StrategyCard({
  active, onSelect, label, title, amount, body, footnote, footnoteTone,
}: {
  active: boolean;
  onSelect: () => void;
  label: string;
  title: string;
  amount: string;
  body: string;
  footnote?: string;
  footnoteTone?: 'good' | 'bad';
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'relative flex flex-col rounded-ui-xl border bg-panel p-5 text-left shadow-ui-sm transition-[transform,box-shadow,border-color]',
        active
          ? 'border-brand ring-1 ring-[var(--ui-brand-ring)]'
          : 'border-line hover:-translate-y-0.5 hover:border-line-strong hover:shadow-ui-md',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-content-muted">{label}</span>
        {active && <Badge tone="brand" size="sm">Active</Badge>}
      </div>
      <h3 className="mt-1.5 font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">{title}</h3>
      <div className="mt-4 font-editorial text-[30px] sm:text-[34px] font-extrabold leading-none tracking-[-0.02em] text-content ui-tnum">
        {amount}
      </div>
      <div className="mt-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">Total interest paid</div>
      <p className="mt-3 text-[13.5px] leading-relaxed text-content-secondary">{body}</p>
      {footnote && (
        <span
          className={cn(
            'mt-3 text-[12px] font-bold ui-tnum',
            footnoteTone === 'good' ? 'text-[rgb(var(--ui-brand-ink))]' : 'text-negative',
          )}
        >
          {footnote}
        </span>
      )}
    </button>
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

  // Cheaper of the two strategies — the interest total surfaced in the KPI strip.
  const cheaperInterest = Math.min(avalancheInterest, snowballInterest);
  const totalInterest = Math.round(cheaperInterest);

  const subtitle = (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="text-negative ui-tnum font-extrabold">−{formatCurrency(totalDebt)}</span>
      <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
      <span>{debts.length} account{debts.length === 1 ? '' : 's'}</span>
      <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
      <span><b className="font-extrabold text-content ui-tnum">{apr}%</b> blended APR</span>
    </span>
  );

  return (
    <>
      <DebtHeader subtitle={subtitle} />

      {/* ── Hero: total debt + composition ── */}
      <section className="relative mt-6 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5 sm:p-[26px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 100% 0%, var(--ui-negative-soft), transparent 58%),' +
              'radial-gradient(90% 70% at 0% 4%, var(--ui-caution-soft), transparent 62%)',
          }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Total debt</div>
            <div className="mt-2 font-editorial text-[38px] sm:text-[52px] font-extrabold leading-[0.98] tracking-[-0.035em] text-negative ui-tnum">
              −{formatCurrency(totalDebt)}
            </div>
            <div className="mt-3 text-[13px] font-medium text-content-muted ui-tnum">
              {debts.length} account{debts.length === 1 ? '' : 's'} · {apr}% blended APR
            </div>
          </div>
        </div>
        {debts.length > 0 && (
          <div className="relative mt-6">
            <CompositionBar debts={debts} />
          </div>
        )}
      </section>

      {/* ── KPI strip ── */}
      <div className="mt-[18px] grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5">
        <StatCard label="Total debt" value={`−${formatCurrency(totalDebt)}`} sub={`${debts.length} account${debts.length === 1 ? '' : 's'}`} neg />
        <StatCard label="Blended APR" value={`${apr}%`} sub="weighted average" />
        <StatCard label="Monthly payment" value={formatCurrency(totalMonthlyPayment)} sub="suggested plan" />
        <StatCard label="Total interest" value={formatCurrency(totalInterest)} sub="over plan" />
      </div>

      {/* ── Payoff strategy ── */}
      <section className="mt-9">
        <div className="flex items-end justify-between gap-3 pb-4">
          <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">Payoff strategy</h2>
          <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-content-muted" aria-live="polite">
            Sorted · {strategy}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2" role="radiogroup" aria-label="Payoff strategy">
          <StrategyCard
            active={strategy === 'avalanche'}
            onSelect={() => onStrategyChange('avalanche')}
            label="Avalanche"
            title="Highest APR first"
            amount={formatCurrency(Math.round(avalancheInterest))}
            body="Mathematically optimal. Saves you the most money over the life of the plan."
            footnote={interestSavedVsSnowball > 0 ? `Saves ${formatCurrency(interestSavedVsSnowball)} vs snowball` : undefined}
            footnoteTone="good"
          />
          <StrategyCard
            active={strategy === 'snowball'}
            onSelect={() => onStrategyChange('snowball')}
            label="Snowball"
            title="Smallest balance first"
            amount={formatCurrency(Math.round(snowballInterest))}
            body="Quick psychological wins. You close accounts faster — useful if motivation matters more than dollars."
            footnote={interestSavedVsSnowball > 0 ? `Costs ${formatCurrency(interestSavedVsSnowball)} more in interest` : undefined}
            footnoteTone="bad"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">Debt-free</div>
              <div className="mt-1 text-[15px] font-bold text-content ui-tnum">{debtFreeDate}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">If minimum only</div>
              <div className="mt-1 text-[15px] font-bold text-content-muted ui-tnum">{minOnlyDate}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openChat('Should I use avalanche or snowball to pay off my debt?')}
            className="group inline-flex items-center gap-1.5 text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] transition-colors hover:text-brand"
          >
            Why this strategy?
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </section>

      {/* ── Accounts table ── */}
      <section className="mt-9">
        <h2 className="pb-3 font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">Accounts</h2>
        <Surface pad="none" className="overflow-hidden">
          <Table>
            <THead>
              <TR className="border-b border-line">
                <TH>Account</TH>
                <TH numeric>Balance</TH>
                <TH numeric>APR</TH>
                <TH numeric>Min pay</TH>
                <TH numeric>Payoff</TH>
                <TH numeric aria-label="Actions"><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {orderedDebts.map((d) => {
                const high = d.apr > 20;
                return (
                  <TR key={d.id}>
                    <TD>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="shrink-0 text-content-muted">
                          {d.type === 'credit' ? <CreditCard size={16} /> : <Landmark size={16} />}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-content">
                            {d.name}{d.mask ? ` ··${d.mask}` : ''}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge tone="neutral" size="sm">{debtTypeLabel(d)}</Badge>
                            {d.liabilitySource === 'plaid' && (
                              <Badge tone="brand" size="sm">Synced</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </TD>
                    <TD numeric>
                      <span className="text-negative">−{formatCurrency(d.balance)}</span>
                    </TD>
                    <TD numeric>
                      <span className={cn(high && 'font-bold text-negative')}>{d.apr}%</span>
                    </TD>
                    <TD numeric>{formatCurrency(d.minPayment)}/mo</TD>
                    <TD numeric className="text-content-muted">
                      {d.payoffDate
                        ? new Date(d.payoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                        : d.suggestedPayoffDate}
                    </TD>
                    <TD numeric>
                      <div className="flex items-center justify-end gap-1.5">
                        {!isDemo && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onEditDebt(d); }}
                            title="Edit loan details"
                            aria-label="Edit loan details"
                            className="ui-focus grid h-8 w-8 place-items-center rounded-ui-sm border border-line text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openChat(`Help me create a payoff plan for my ${d.name} (${d.apr}% APR, ${formatMoney(d.balance, true)} balance).`);
                          }}
                          trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}
                        >
                          Plan
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Surface>
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
            className="h-[7px] w-[7px] rounded-full bg-brand"
            style={{ boxShadow: '0 0 0 4px var(--ui-brand-soft)' }}
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
