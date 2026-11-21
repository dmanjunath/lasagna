import { useState, useEffect } from 'react';
import { CreditCard, Landmark, Pencil, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatMoney, formatInstant, formatStoredMonth } from '../lib/utils';
import { accountTypeLabel } from '../lib/account-types';
import { HIDDEN_AMOUNT, isAmountsHidden, isMasked } from '../lib/hide-amounts';
import { HiddenAmount, MaskedText, MoneyInput } from '../components/uikit';
import { compareStrategies, simulatePayoff, type PayoffResult, type PayoffStrategy } from '@lasagna/core/debt-payoff';
import { PageTitle } from '../components/ds/PageTitle';
import { usePageContext } from '../lib/page-context';
import { useChatStore } from '../lib/chat-store';
import { PageActions } from '../components/common/page-actions';
import {
  Button,
  Surface,
  Badge,
  PageMeta,
  PageMetaItem,
  Field,
  Input,
  EmptyState,
  Modal,
  TextLink,
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
  /** What the old fixed plan put on top of the minimum (0.8x on a high-rate
   * non-mortgage debt). Only seeds the extra-payment field. */
  suggestedExtra: number;
  payoffDate: string | null;
  planRole: 'payoff' | 'clears-monthly' | 'needs-rate';
  paidInFullMonthly: boolean;
  liabilitySource: "plaid" | "manual" | null;
  liabilityLastSyncedAt: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function addMonths(months: number): string {
  if (!Number.isFinite(months)) return 'Never';
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return formatInstant(d, { month: 'short', year: 'numeric' });
}

/** "4 years 2 months", "11 months". */
function formatDuration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y > 0) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m > 0) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** The extra-payment field as a number. Empty, invalid or negative is none. */
function parseExtra(text: string): number {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Blended weighted-average APR */
function blendedApr(debts: DebtAccount[]): number {
  const totalBal = debts.reduce((s, d) => s + d.balance, 0);
  if (totalBal === 0) return 0;
  const weighted = debts.reduce((s, d) => s + d.apr * d.balance, 0);
  return Math.round((weighted / totalBal) * 10) / 10;
}

// Names the debt from the shared catalog (lib/account-types) so a subtype the
// create modal writes reads the same here as it does everywhere else. Subtype
// leads; the name is only sniffed when a synced loan carries no subtype at all.
function debtTypeLabel(d: DebtAccount): string {
  if (d.type === 'credit') return accountTypeLabel('credit', d.subtype);
  if (d.subtype) return accountTypeLabel(d.type, d.subtype);
  const name = d.name?.toLowerCase() ?? '';
  if (name.includes('mortgage')) return accountTypeLabel('loan', 'mortgage');
  if (name.includes('student')) return accountTypeLabel('loan', 'student');
  // Nothing on file says which kind of loan it is, so don't claim one. The add
  // form's "Other loan" is a choice the user made, not a reading of the data.
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
  const [paidInFullCards, setPaidInFullCards] = useState<DebtAccount[]>([]);
  const [needsRateCards, setNeedsRateCards] = useState<DebtAccount[]>([]);
  const [debtOnPlan, setDebtOnPlan] = useState(0);
  const [notInPlan, setNotInPlan] = useState({ amount: 0, count: 0 });
  const [hasAccounts, setHasAccounts] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingDebt, setEditingDebt] = useState<DebtAccount | null>(null);
  // Null until the user types: the field then shows the suggested extra.
  const [extraText, setExtraText] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche');

  const handleLoanDetailsSaved = () => {
    setEditingDebt(null);
    setRefreshKey((k) => k + 1);
  };

  const closeModal = () => setEditingDebt(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getDebts().catch(() => ({ debts: [] as Array<{ id: string; name: string; type: string; subtype: string | null; property: { id: string; name: string } | null; balance: number; interestRate: number | null; termMonths: number | null; originationDate: string | null; minimumPayment: number; payoffDate: string | null; planRole: 'payoff' | 'clears-monthly' | 'needs-rate'; paidInFull: boolean; paidInFullMonthly: boolean; liabilitySource: "plaid" | "manual" | null; liabilityLastSyncedAt: string | null; lastUpdated: string | null }>, totalDebt: 0, debtOnPayoffPlan: undefined, monthlyInterest: 0 })),
      api.getBalances().catch(() => ({ balances: [] })),
    ]).then(([debtResult, balanceData]) => {
      setHasAccounts(balanceData.balances.length > 0);
      const apiDebts = debtResult.debts;
      const mapped: DebtAccount[] = apiDebts.map((d) => {
        // Subtype first: a mortgage named for its lender ("Wells Fargo") was
        // reading as a generic loan and getting the 8% stand-in, not 6.5%.
        const isMortgage = d.subtype === 'mortgage' || d.name?.toLowerCase().includes('mortgage');
        // A card with no rate and no payment history gets no stand-in: it sits
        // outside the payoff math until the user adds the rate.
        const apr = d.planRole === 'needs-rate'
          ? 0
          : d.interestRate ?? (d.type === 'credit' ? 21.99 : isMortgage ? 6.5 : 8.0);
        const minPay = d.minimumPayment;
        const isHighInterest = apr >= 7 && !isMortgage;
        const suggestedExtra = isHighInterest ? Math.round(minPay * 1.8) - minPay : 0;
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
          suggestedExtra,
          payoffDate: d.payoffDate ?? null,
          // An API older than this page sends no planRole. Read its paidInFull
          // so a deploy in either order never drops every debt off the page.
          planRole: d.planRole ?? (d.paidInFull ? 'clears-monthly' : 'payoff'),
          paidInFullMonthly: d.paidInFullMonthly,
          liabilitySource: d.liabilitySource ?? null,
          liabilityLastSyncedAt: d.liabilityLastSyncedAt ?? null,
        };
      });

      mapped.sort((a, b) => b.apr - a.apr);
      // A card cleared in full each month is this month's spending, not a debt
      // to pay down: it drives none of the payoff math and is listed apart. A
      // card with no rate and no payment history is listed apart too, asking
      // for the rate, because the journey leaves it off for the same reason.
      const paydown = mapped.filter((d) => d.planRole === 'payoff');
      setDebts(paydown);
      setPaidInFullCards(mapped.filter((d) => d.planRole === 'clears-monthly'));
      setNeedsRateCards(mapped.filter((d) => d.planRole === 'needs-rate'));
      // The server's split of total debt, so this page and chat state the
      // same figures. An API older than this page sends none, so fall back to
      // adding up the rows until both are deployed.
      if (debtResult.debtOnPayoffPlan) {
        setDebtOnPlan(debtResult.debtOnPayoffPlan.amount);
        setNotInPlan(debtResult.debtOnPayoffPlan.notInPlan);
      } else {
        const off = mapped.filter((d) => d.planRole !== 'payoff');
        setDebtOnPlan(paydown.reduce((sum, d) => sum + d.balance, 0));
        setNotInPlan({ amount: off.reduce((sum, d) => sum + d.balance, 0), count: off.length });
      }
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

  const hasDebt = debtOnPlan > 0;

  // The extra field starts at what the old fixed plan suggested, so a card
  // holder lands on the same plan as before and a loans-only household on the
  // minimums, stated as such.
  const suggestedExtra = Math.round(debts.reduce((s, d) => s + d.suggestedExtra, 0));
  const extraValue = extraText ?? (suggestedExtra > 0 ? String(suggestedExtra) : '');
  const extra = parseExtra(extraValue);
  const payoffDebts = debts.map((d) => ({ id: d.id, balance: d.balance, apr: d.apr, minPayment: d.minPayment }));
  const comparison = compareStrategies(payoffDebts, extra);
  // Identical orders are never offered as a choice: the plan is the one order.
  const activeStrategy: PayoffStrategy = comparison.tie ? 'avalanche' : strategy;
  const plan = comparison[activeStrategy];
  const minimums = simulatePayoff(payoffDebts, 'avalanche', 0);
  // What $500 a month would do, offered while no extra is set.
  const preview = extra === 0 ? simulatePayoff(payoffDebts, 'avalanche', 500) : null;
  const byId = new Map(debts.map((d) => [d.id, d]));
  const orderedDebts = plan.order.map((id) => byId.get(id)!);

  const apr = blendedApr(debts);

  return (
    <div className="mx-auto max-w-[1120px] px-3 sm:px-11 pt-4 md:pt-9 pb-6 sm:pb-28 text-content">
      <style>{`
        /* The app sidebar makes viewport breakpoints lie about how much room
           this page has — at a 768px window the content column is only ~360px
           wide, where a viewport-keyed "sm:grid-cols-2" still fired and left
           two 175px cards. The section measures itself instead, marked with
           the shared .cq-inline from index.css (same marker the home hero and
           the goal form use). Stacked is the default, so browsers without
           container queries still get a working layout. */
        .debt-plan-summary { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @container (min-width: 560px) {
          .debt-plan-summary { grid-template-columns: 1fr 1fr; }
        }
        /* Off-plan card rows: the balance sits under the name until the list
           is wide enough to hold both on one line, so a phone never cuts the
           name down to a few letters to fit the balance and the button. */
        .debt-card-row-info { display: flex; flex-direction: column; gap: 2px; }
        @container (min-width: 480px) {
          .debt-card-row-info { flex-direction: row; align-items: center; gap: 14px; }
          .debt-card-row-amount { margin-left: auto; text-align: right; }
        }
      `}</style>
      {loading ? null : !hasAccounts ? (
        <NoAccountsView />
      ) : hasDebt ? (
        <HasDebtView
          debts={debts}
          paidInFullCards={paidInFullCards}
          needsRateCards={needsRateCards}
          debtOnPlan={debtOnPlan}
          notInPlan={notInPlan}
          apr={apr}
          orderedDebts={orderedDebts}
          extraValue={extraValue}
          onExtraChange={setExtraText}
          extra={extra}
          comparison={comparison}
          strategy={activeStrategy}
          onStrategyChange={setStrategy}
          plan={plan}
          minimums={minimums}
          preview={preview}
          openChat={openChat}
          onEditDebt={setEditingDebt}
        />
      ) : paidInFullCards.length > 0 || needsRateCards.length > 0 ? (
        <NoRevolvingDebtView
          paidInFullCards={paidInFullCards}
          needsRateCards={needsRateCards}
          onEdit={setEditingDebt}
        />
      ) : (
        <DebtFreeView openChat={openChat} />
      )}

      {editingDebt && (
        <LoanDetailsModal
          debt={editingDebt}
          onClose={closeModal}
          onSaved={handleLoanDetailsSaved}
        />
      )}
    </div>
  );
}

// ── Page header ───────────────────────────────────────────────────────────────

function DebtHeader({ tags }: { tags?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <PageTitle className="sm:text-[36px]">Debt</PageTitle>
        {tags && <PageMeta className="mt-0 md:mt-1.5">{tags}</PageMeta>}
      </div>
    </header>
  );
}

// ── No Accounts View ──────────────────────────────────────────────────────────

function NoAccountsView() {
  return (
    <>
      <DebtHeader />
      <div className="mt-0 md:mt-8">
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
  const masked = isMasked(value);
  return (
    <div className="border-l-2 border-line pl-3.5">
      <div className="text-[12px] font-semibold text-content-muted">{label}</div>
      <div className={cn(
        'mt-1.5 font-editorial text-[22px] sm:text-[24px] font-extrabold leading-none tracking-[-0.02em] ui-tnum',
        neg && !masked ? 'text-negative' : 'text-content',
      )}>
        {masked ? <HiddenAmount /> : value}
      </div>
      <div className="mt-1.5 truncate text-[11.5px] font-medium text-content-muted">{sub}</div>
    </div>
  );
}

// ── Debt ribbon — one confident, full-width composition chart ──────────────────
// Segments grow to their balance. Coral leads (debt colour), matching the
// portfolio allocation bar as the primary-page bar. No in-segment labels: the
// legend directly beneath names every segment with its amount and share, and
// white-on-slate inside the smallest segment measured ~2.6:1 in dark mode.

function DebtRibbon({ debts }: { debts: DebtAccount[] }) {
  const segs = [...debts]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 6)
    .map((d, i) => ({
      label: `${d.name}${d.mask ? ` ••${d.mask}` : ''}`,
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
        return (
          <div
            key={`${s.label}-${i}`}
            className="h-full"
            style={{
              flexGrow: s.value,
              minWidth: 5,
              background: s.color,
              backgroundImage:
                'linear-gradient(170deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 52%, rgba(0,0,0,0.12))',
              borderRadius: i === 0 ? '11px 4px 4px 11px' : i === segs.length - 1 ? '4px 11px 11px 4px' : '4px',
            }}
            title={`${s.label}, ${pct.toFixed(1)}%, ${formatCurrency(s.value)}`}
          />
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
      name: d.name,
      mask: d.mask,
      label: `${d.name}${d.mask ? ` ••${d.mask}` : ''}`,
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
            {/* The mask is the disambiguator between two accounts called
                "Mortgage", so it must survive the truncation: the name gives up
                characters and the digits stay. One string ellipsised as a whole
                cut mid-mask ("Drifton Ct. Mortgage Loan ••…") on phones. */}
            <span className="flex min-w-0 flex-1 items-center text-[13.5px] font-semibold text-content" title={r.label}>
              <span className="min-w-0 truncate">{r.name}</span>
              {r.mask && <span className="shrink-0">&nbsp;••{r.mask}</span>}
            </span>
            <span className="shrink-0 whitespace-nowrap text-right ui-tnum">
              <span className="font-editorial text-[14px] font-extrabold tracking-[-0.01em] text-negative"><MaskedText text={formatCurrency(r.value)} /></span>
              <span className="ml-2 text-[12.5px] font-semibold text-content-muted">{pct < 0.1 ? '<0.1%' : `${pct.toFixed(0)}%`}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Order: one statement when the orders tie, a choice when they differ ──────

/** What to call this set of debts in a sentence, so the claim stays true. */
function debtsNoun(debts: DebtAccount[]): string {
  const mortgage = accountTypeLabel('loan', 'mortgage');
  if (debts.every((d) => debtTypeLabel(d) === mortgage)) return 'mortgages';
  if (debts.every((d) => d.type === 'credit')) return 'cards';
  if (debts.every((d) => d.type === 'loan')) return 'loans';
  return 'debts';
}

function OrderStatement({ debts, extra, clears }: { debts: DebtAccount[]; extra: number; clears: boolean }) {
  // One debt has no order to talk about. A plan that never clears is already
  // said in the hero, and no order fixes it. "Same as paying only the
  // minimums" is said once, under the debt-free date.
  if (debts.length === 1 || !clears) return null;
  const text =
    extra === 0
      ? `With no extra payment, the order you pay these ${debtsNoun(debts)} in does not change anything. What changes it is paying more.`
      : 'Paying the highest rate first or the smallest balance first comes out the same here.';
  return (
    <p className="rounded-ui-lg border border-line bg-panel p-4 text-[13.5px] leading-[1.55] text-content-secondary shadow-ui-sm">
      {text}
    </p>
  );
}

function StrategyChoice({
  comparison, strategy, onChange, openChat,
}: {
  comparison: ReturnType<typeof compareStrategies>;
  strategy: PayoffStrategy;
  onChange: (s: PayoffStrategy) => void;
  openChat: (prompt: string) => void;
}) {
  const { avalanche: a, snowball: b } = comparison;
  // Each claim shows only on the order the numbers bear it out for.
  const cheaper: PayoffStrategy | null =
    Math.round(a.totalInterest) < Math.round(b.totalInterest) ? 'avalanche'
      : Math.round(b.totalInterest) < Math.round(a.totalInterest) ? 'snowball' : null;
  const firstClose: PayoffStrategy | null =
    a.firstClearedMonths < b.firstClearedMonths ? 'avalanche'
      : b.firstClearedMonths < a.firstClearedMonths ? 'snowball' : null;
  const options: { value: PayoffStrategy; title: string; result: PayoffResult }[] = [
    { value: 'avalanche', title: 'Highest rate first', result: a },
    { value: 'snowball', title: 'Smallest balance first', result: b },
  ];
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const next: PayoffStrategy = strategy === 'avalanche' ? 'snowball' : 'avalanche';
    onChange(next);
    (e.currentTarget.querySelector(`[data-value="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div>
      <div className="debt-plan-summary" role="radiogroup" aria-label="Payoff order" onKeyDown={onKeyDown}>
        {options.map((o) => {
          const active = o.value === strategy;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-value={o.value}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cn(
                'ui-focus flex items-start gap-3 rounded-ui-lg border p-4 text-left shadow-ui-sm transition-colors',
                active ? 'border-brand bg-brand-softer' : 'border-line bg-panel hover:border-line-strong',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
                  active ? 'border-[rgb(var(--ui-brand-ink))]' : 'border-line-strong',
                )}
              >
                {active && <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--ui-brand-ink))]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-editorial text-[16px] font-bold tracking-[-0.015em] text-content">{o.title}</span>
                  {cheaper === o.value && <Badge tone="brand" size="sm">Lowest-cost order</Badge>}
                  {firstClose === o.value && <Badge tone="neutral" size="sm">Closes accounts fastest</Badge>}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-x-3 text-[12.5px] text-content-muted ui-tnum">
                  <span>Debt-free <span className="font-bold text-content">{addMonths(o.result.months)}</span></span>
                  {Number.isFinite(o.result.totalInterest) && (
                    <span>
                      <span className="font-bold text-content"><MaskedText text={formatCurrency(Math.round(o.result.totalInterest))} /></span> interest
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2.5">
        <TextLink onClick={() => openChat('Should I pay my highest-rate debt first or my smallest balance first?')}>
          Which order should I pick?
        </TextLink>
      </div>
    </div>
  );
}

// ── Payoff order — the concrete "fastest way out": which balance to pay down
// first, then the rest. ──────────────────────────────────────────────────────

function AttackList({ debts, extra, ranked }: { debts: DebtAccount[]; extra: number; ranked: boolean }) {
  // Unranked when the order changes nothing: no ordinals, no lead row.
  const List = ranked ? 'ol' : 'ul';
  return (
    <List className="animate-fade-in flex flex-col gap-2">
      {debts.map((d, i) => {
        const focus = ranked && i === 0;
        const high = d.apr > 20;
        // Every row states the amount to SEND, so the column is one scale and
        // sums to the "Monthly payment" KPI above it. The lead row used to show
        // only the increment ($20) next to siblings showing totals ($4,075),
        // which made the column add up to $6,527 — neither KPI — and left the
        // figure the user actually pays on that card ($45) nowhere on the page.
        const role = focus && extra > 0
          ? `${formatCurrency(d.minPayment + extra)}/mo, ${formatCurrency(extra)} above the minimum`
          : `${formatCurrency(d.minPayment)}/mo minimum`;
        return (
          <li
            key={d.id}
            className={cn(
              'flex items-center gap-3.5 rounded-ui-lg border px-3.5 py-3 transition-colors',
              focus ? 'border-brand bg-brand-softer' : 'border-line bg-panel',
            )}
          >
            {ranked && <span
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-extrabold ui-tnum',
                // brand-ink is the token that stays legible as a fill in both
                // modes: deep green under white in light, bright green under
                // the dark panel colour in dark. A flat --ui-brand fill puts
                // white on 5/178/121, which measures 2.75:1.
                focus ? 'bg-[rgb(var(--ui-brand-ink))] text-[rgb(var(--ui-panel))]' : 'bg-canvas-sunken text-content-secondary',
              )}
            >
              {i + 1}
            </span>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {/* Same split as the legend: the name gives up characters so
                    the mask's digits survive the ellipsis. */}
                <span
                  className="flex min-w-0 items-center text-[14px] font-semibold text-content"
                  title={`${d.name}${d.mask ? ` ••${d.mask}` : ''}`}
                >
                  <span className="min-w-0 truncate">{d.name}</span>
                  {d.mask && <span className="shrink-0">&nbsp;••{d.mask}</span>}
                </span>
                <Badge tone={high ? 'negative' : 'neutral'} size="sm" className="shrink-0 ui-tnum">
                  {d.apr}%
                </Badge>
              </div>
              {/* No "first" chip on the lead row. The section heading says "Pay
                  in this order", the card above says "Highest rate first", and
                  this is item 1 of an <ol> — a fourth statement of the same
                  fact, and at 390px it pushed the row's only real instruction
                  onto a third line. The ordinal carries it without colour. */}
              {/* Wraps rather than truncates. This line is the instruction for
                  the row, and at 768-834 (desktop sidebar plus a narrow window)
                  ellipsising it hid the payment: "Pay the $4,075/mo minimum
                  for n…". A name can survive an ellipsis; an amount cannot. */}
              <div className="mt-0.5 text-balance text-[12px] font-medium text-content-muted">{role}</div>
            </div>
            <div className="shrink-0 text-right font-editorial text-[15px] font-extrabold tracking-[-0.015em] text-negative ui-tnum">
              {isAmountsHidden() ? <HiddenAmount /> : formatCurrency(d.balance)}
            </div>
          </li>
        );
      })}
    </List>
  );
}

// ── Account card — one liability, all key fields, used at every width ──────────

function AccountStat({ label, value, neg }: { label: string; value: string; neg?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] font-semibold text-content-muted">{label}</div>
      <div className={cn('mt-0.5 truncate text-[13.5px] font-bold ui-tnum', neg && !isMasked(value) ? 'text-negative' : 'text-content')}>
        {isMasked(value) ? <HiddenAmount /> : value}
      </div>
    </div>
  );
}

function AccountCard({
  debt: d, planPayoff, maxBalance, isDemo, onEdit, onPlan, className,
}: {
  debt: DebtAccount;
  /** This debt's payoff month under the plan above, already formatted. */
  planPayoff: string;
  maxBalance: number;
  isDemo: boolean;
  onEdit: () => void;
  onPlan: () => void;
  className?: string;
}) {
  const high = d.apr > 20;
  const share = maxBalance > 0 ? Math.max(4, (Math.abs(d.balance) / maxBalance) * 100) : 0;
  const payoff = planPayoff;
  return (
    <div className={cn("flex flex-col rounded-ui-xl border border-line bg-panel p-4 shadow-ui-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-ui-md", className)}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-md bg-canvas-sunken text-content-secondary">
          {d.type === 'credit' ? <CreditCard size={16} /> : <Landmark size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-content">
            {d.name}{d.mask ? ` ••${d.mask}` : ''}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral" size="sm">{debtTypeLabel(d)}</Badge>
            {d.property && <span className="text-[12px] font-medium text-content-muted">on {d.property.name}</span>}
            {d.liabilitySource === 'plaid' && <Badge tone="brand" size="sm">Synced</Badge>}
          </div>
        </div>
        <div className="shrink-0 pt-0.5 text-right font-editorial text-[17px] font-extrabold tracking-[-0.015em] text-negative ui-tnum">
          {isAmountsHidden() ? <HiddenAmount /> : formatCurrency(d.balance)}
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
          <Button variant="neutral" size="icon" className="shrink-0" onClick={onEdit} aria-label="Edit loan details">
            <Pencil size={15} />
          </Button>
        )}
        <Button variant="secondary" className="flex-1" onClick={onPlan} trailingIcon={<ArrowRight className="h-4 w-4" />}>
          Plan payoff
        </Button>
      </div>
    </div>
  );
}

// ── Has Debt View ─────────────────────────────────────────────────────────────

function HasDebtView({
  debts, paidInFullCards, needsRateCards, debtOnPlan, notInPlan, apr, orderedDebts,
  extraValue, onExtraChange, extra, comparison, strategy, onStrategyChange, plan, minimums, preview,
  openChat, onEditDebt,
}: {
  debts: DebtAccount[];
  paidInFullCards: DebtAccount[];
  needsRateCards: DebtAccount[];
  debtOnPlan: number;
  notInPlan: { amount: number; count: number };
  apr: number;
  orderedDebts: DebtAccount[];
  extraValue: string;
  onExtraChange: (text: string) => void;
  extra: number;
  comparison: ReturnType<typeof compareStrategies>;
  strategy: PayoffStrategy;
  onStrategyChange: (s: PayoffStrategy) => void;
  plan: PayoffResult;
  minimums: PayoffResult;
  preview: PayoffResult | null;
  openChat: (prompt: string, title?: string) => void;
  onEditDebt: (debt: DebtAccount) => void;
}) {
  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

  // Highest-rate account — `debts` arrives pre-sorted by APR desc, so the head
  // is the first target. Surfaced as a distinct KPI (never the blended APR).
  const highest = debts[0];
  const highRateCount = debts.filter((d) => d.apr > 20).length;
  const totalMinPayment = debts.reduce((s, d) => s + d.minPayment, 0);
  const maxBalance = debts.reduce((m, d) => Math.max(m, Math.abs(d.balance)), 0);

  const debtFreeDate = addMonths(plan.months);
  const noNeverDate = Number.isFinite(plan.months);
  const totalInterest = plan.totalInterest;
  const sameAsMinimums = extra === 0;
  const extraInvalid = extraValue.trim() !== '' && !(Number(extraValue) >= 0);
  // The order only matters when there is extra to send and more than one debt
  // to send it to.
  const ranked = extra > 0 && debts.length > 1;

  // Cards that clear every month or have no rate on file are owed but kept
  // off the plan, so the hero names the plan's total and says what it leaves out.

  return (
    <>
      {/* ── Purpose-led header: the page's job stated up top ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
            How fast can you be debt-free?
          </h1>
          <PageMeta>
            <PageMetaItem className="ui-tnum">{debts.length} account{debts.length === 1 ? '' : 's'}</PageMetaItem>
            {highRateCount > 0 && (
              <PageMetaItem tone="negative" className="ui-tnum">{highRateCount} at a punishing rate</PageMetaItem>
            )}
            {needsRateCards.length > 0 && (
              <PageMetaItem tone="caution" className="ui-tnum">
                Rate not on file for {needsRateCards.length} card{needsRateCards.length === 1 ? '' : 's'}
              </PageMetaItem>
            )}
          </PageMeta>
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
          <div className="text-[14px] font-semibold text-content-muted">
            {notInPlan.count > 0 ? 'Debt in your payoff plan' : 'Total debt'}
          </div>
          <div className="mt-2 font-editorial text-[40px] sm:text-[56px] font-extrabold leading-[0.9] tracking-[-0.035em] text-negative ui-tnum">
            {/* Owed by definition under this label, so red and unsigned. */}
            {isAmountsHidden() ? <HiddenAmount /> : formatCurrency(debtOnPlan)}
          </div>
          {notInPlan.count > 0 && (
            <div className="mt-2.5 text-[13px] font-medium text-content-muted ui-tnum">
              <MaskedText text={formatCurrency(notInPlan.amount)} /> on {notInPlan.count} card{notInPlan.count === 1 ? '' : 's'} is not in the plan
            </div>
          )}
          <p className="mt-4 max-w-[54ch] text-[14.5px] leading-[1.55] text-content-secondary ui-tnum">
            {noNeverDate ? (
              <>
                {/* The plan below: the extra each month, in the order chosen. */}
                You&apos;re debt-free by{' '}
                <strong className="font-bold text-content">{debtFreeDate}</strong>, and it costs about{' '}
                <strong className="font-bold text-negative">{isAmountsHidden() ? <HiddenAmount /> : formatCurrency(Math.round(totalInterest))}</strong> in interest along the way.
              </>
            ) : extra === 0 ? (
              <>
                At minimum payments this debt never clears. Put more toward the highest-rate balance to set a real
                debt-free date and cut the interest you&apos;re paying.
              </>
            ) : (
              <>At this payment the debt still never clears. Raise the extra amount below to set a real debt-free date.</>
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

      {/* ── Supporting KPIs — distinct from the hero figures ── */}
      {/* With no extra the plan's payment is the minimum due, so that tile
          would say the same figure twice. */}
      <div className={cn('mt-7 grid grid-cols-2 gap-x-6 gap-y-6', extra > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        <Kpi label="Blended APR" value={`${apr}%`} sub="weighted average" />
        {extra > 0 && (
          <Kpi label="Monthly payment" value={formatCurrency(totalMinPayment + extra)} sub="minimums plus extra" />
        )}
        <Kpi label="Minimum due" value={formatCurrency(totalMinPayment)} sub="required each month" />
        {highest && (
          <Kpi label="Highest rate" value={`${highest.apr}%`} sub={debtTypeLabel(highest)} neg={highest.apr > 20} />
        )}
      </div>

      {/* ── YOUR PAYOFF PLAN — the lever (extra each month), what it does, then
          the order. Two orders are offered as a choice only when they cost
          different amounts or finish in different months. */}
      <section className="cq-inline mt-11">
        <div className="flex items-center gap-2.5 pb-4">
          <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.02em] text-content">Your payoff plan</h2>
        </div>

        <div className="debt-plan-summary">
          <div className="rounded-ui-lg border border-line bg-panel p-4 shadow-ui-sm">
            <Field
              label="Extra each month"
              error={extraInvalid ? 'Enter an amount of $0 or more.' : undefined}
              hint={
                extraInvalid ? undefined : extra > 0 ? (
                  Number.isFinite(plan.months) && Number.isFinite(minimums.months) ? (
                    <span className="ui-tnum">
                      {minimums.months > plan.months
                        ? `${formatDuration(minimums.months - plan.months)} sooner than paying only the minimums, and `
                        : 'Same finish as paying only the minimums, and '}
                      <MaskedText text={formatCurrency(Math.round(minimums.totalInterest - plan.totalInterest))} /> less in interest.
                    </span>
                  ) : null
                ) : preview && Number.isFinite(preview.months) ? (
                  <span className="ui-tnum">
                    Add $500/month and you are debt-free in {addMonths(preview.months)}
                    {Number.isFinite(minimums.totalInterest) && (
                      <>, saving <MaskedText text={formatCurrency(Math.round(minimums.totalInterest - preview.totalInterest))} /> in interest</>
                    )}.
                  </span>
                ) : null
              }
            >
              <MoneyInput
                type="number" step="1" min="0"
                value={extraValue}
                onChange={(e) => onExtraChange(e.target.value)}
                placeholder="0"
                invalid={extraInvalid}
                leadingIcon={<span className="text-[13px]">$</span>}
                className="ui-tnum"
              />
            </Field>
          </div>

          <div className="flex flex-wrap content-start gap-x-6 gap-y-2.5 rounded-ui-lg border border-line bg-panel p-4 shadow-ui-sm" aria-live="polite">
            <div>
              <div className="text-[12px] font-semibold text-content-muted">Debt-free</div>
              <div className="mt-0.5 text-[14px] font-bold text-content ui-tnum">{debtFreeDate}</div>
              {sameAsMinimums && (
                <div className="mt-0.5 text-[12px] font-medium text-content-muted">same as paying only the minimums</div>
              )}
            </div>
            {!sameAsMinimums && plan.months !== minimums.months && (
              <div>
                <div className="text-[12px] font-semibold text-content-muted">At minimums</div>
                <div className="mt-0.5 text-[14px] font-bold text-content-muted ui-tnum">{addMonths(minimums.months)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3">
          {comparison.tie ? (
            <OrderStatement debts={debts} extra={extra} clears={noNeverDate} />
          ) : (
            <StrategyChoice comparison={comparison} strategy={strategy} onChange={onStrategyChange} openChat={openChat} />
          )}
        </div>

        {/* The order, at the section's full width so long account names and
            their payment line have room. */}
        <h3 className="mb-2.5 mt-6 text-[15px] font-semibold text-content">
          {ranked ? 'Pay in this order' : debts.length === 1 ? 'Your payment' : 'Your payments'}
        </h3>
        <AttackList debts={orderedDebts} extra={extra} ranked={ranked} />
      </section>

      <NeedsRateSection cards={needsRateCards} onEdit={onEditDebt} className="mt-11" />

      {/* ── ACCOUNTS — the ledger, two-column cards; every field visible ── */}
      <section className="mt-11">
        <div className="flex items-center gap-2.5 pb-3">
          <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.02em] text-content">Accounts</h2>
          <span className="ml-auto text-[12px] font-semibold text-content-muted">
            {orderedDebts.length} total
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {orderedDebts.map((d, i) => (
            <AccountCard
              key={d.id}
              debt={d}
              planPayoff={
                // The lender's stored date while this debt gets only its
                // minimum, the plan's month once extra speeds it up.
                d.payoffDate && plan.monthsById[d.id] >= minimums.monthsById[d.id]
                  ? formatStoredMonth(d.payoffDate)
                  : addMonths(plan.monthsById[d.id])
              }
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
              onPlan={() => openChat(`Help me create a payoff plan for my ${d.name} (${d.apr}% APR, ${formatMoney(d.balance, true)} balance).`, `${d.name} payoff plan`)}
            />
          ))}
        </div>
      </section>

      <PaidInFullSection cards={paidInFullCards} onEdit={onEditDebt} className="mt-11" />

      <section className="mt-12">
        <PageActions types="debt" />
      </section>
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
  const [paidInFull, setPaidInFull] = useState(debt.paidInFullMonthly);

  const isCredit = debt.type === "credit";
  const loanType: "mortgage" | "student_loan" | "credit_card" | "other_loan" = isCredit
    ? "credit_card"
    : debt.subtype === "mortgage"
      ? "mortgage"
      : debt.subtype === "student" || debt.subtype === "student_loan"
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
      // The paid-in-full designation is an account flag, saved on its own so it
      // never freezes Plaid sync the way a manual loan-detail edit does.
      const loanDetailChanged = Object.keys(body).length > 1;
      const paidInFullChanged = paidInFull !== debt.paidInFullMonthly;
      if (!loanDetailChanged && !paidInFullChanged) {
        setError("Please fill in at least one field.");
        return;
      }
      if (loanDetailChanged) await api.patchLoanDetails(debt.id, body);
      if (paidInFullChanged) await api.updateAccount(debt.id, { paidInFullMonthly: paidInFull });
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
      title={`${debt.name}${debt.mask ? ` ••${debt.mask}` : ''}`}
      description={isCredit ? "Update card details" : "Update loan details"}
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
            <MoneyInput
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
        {loanType === "credit_card" && (
          <div className="border-t border-line pt-1">
            <Toggle
              checked={paidInFull}
              onChange={setPaidInFull}
              label="Clears every month"
              description="Keeps this card off your payoff plan and out of interest totals. Turn on if you clear the statement balance each month."
            />
          </div>
        )}

        {error && <p className="text-[12px] font-semibold text-negative">{error}</p>}
      </form>
    </Modal>
  );
}

// ── Paid-in-full cards — balances cleared every month, outside the payoff plan ─
// Listed because they are real balances owed now, but kept apart from the payoff
// math: no APR, no interest, no attack order. A transactor's balance is this
// month's spending, not a debt to eliminate.

function PaidInFullSection({
  cards, onEdit, className,
}: {
  cards: DebtAccount[];
  onEdit?: (debt: DebtAccount) => void;
  className?: string;
}) {
  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
  const editable = onEdit && !isDemo;
  if (cards.length === 0) return null;
  return (
    <section className={className}>
      <div className="flex items-center gap-2.5 pb-1">
        <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.02em] text-content">Clears every month</h2>
        {cards.length > 1 && (
          <span className="ml-auto text-[12px] font-semibold text-content-muted">
            {cards.length} cards
          </span>
        )}
      </div>
      <p className="max-w-[60ch] pb-3.5 text-[13px] leading-[1.5] text-content-muted">
        {cards.length === 1 ? 'This card costs no interest.' : 'These cost no interest.'}
      </p>
      <ul className="cq-inline flex flex-col gap-2">
        {cards.map((d) => (
          <li key={d.id} className="flex items-center gap-3.5 rounded-ui-lg border border-line bg-panel px-3.5 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-md bg-canvas-sunken text-content-secondary">
              <CreditCard size={16} />
            </span>
            <div className="debt-card-row-info min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-semibold text-content">{d.name}</span>
                {d.mask && <span className="shrink-0 font-semibold text-content-muted">••{d.mask}</span>}
                {d.liabilitySource === 'plaid' && <Badge tone="brand" size="sm">Synced</Badge>}
              </div>
              <div className="debt-card-row-amount shrink-0 font-editorial text-[15px] font-extrabold tracking-[-0.015em] text-content ui-tnum">
                <MaskedText text={formatCurrency(d.balance)} />
              </div>
            </div>
            {editable && (
              <button
                type="button"
                onClick={() => onEdit(d)}
                aria-label={`Edit ${d.name}${d.mask ? ` ••${d.mask}` : ''}`}
                className="ui-focus grid h-11 w-11 shrink-0 place-items-center rounded-ui-sm border border-line text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
              >
                <Pencil size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Rate not on file — a card we have never seen carry, with no rate ─────────
// Not in the payoff plan (here or on the journey), because ranking it by a
// guessed rate is what made the two disagree. Asked about once, here.

function NeedsRateSection({
  cards, onEdit, className,
}: {
  cards: DebtAccount[];
  onEdit: (debt: DebtAccount) => void;
  className?: string;
}) {
  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
  if (cards.length === 0) return null;
  return (
    <section className={className}>
      <div className="flex items-center gap-2.5 pb-1">
        <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.02em] text-content">Rate not on file</h2>
        {cards.length > 1 && (
          <span className="ml-auto text-[12px] font-semibold text-content-muted">
            {cards.length} cards
          </span>
        )}
      </div>
      <p className="max-w-[60ch] pb-3.5 text-[13px] leading-[1.5] text-content-muted">
        {cards.length === 1
          ? 'We do not know what this card charges, so it is not in your payoff plan. Add the rate to see where it belongs.'
          : 'We do not know what these cards charge, so they are not in your payoff plan. Add the rate to see where each one belongs.'}
      </p>
      <ul className="cq-inline flex flex-col gap-2">
        {cards.map((d) => (
          <li key={d.id} className="flex items-center gap-3.5 rounded-ui-lg border border-line bg-panel px-3.5 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-md bg-canvas-sunken text-content-secondary">
              <CreditCard size={16} />
            </span>
            <div className="debt-card-row-info min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-semibold text-content">{d.name}</span>
                {d.mask && <span className="shrink-0 font-semibold text-content-muted">••{d.mask}</span>}
                {d.liabilitySource === 'plaid' && <Badge tone="brand" size="sm">Synced</Badge>}
              </div>
              <div className="debt-card-row-amount shrink-0 font-editorial text-[15px] font-extrabold tracking-[-0.015em] text-content ui-tnum">
                <MaskedText text={formatCurrency(d.balance)} />
              </div>
            </div>
            {!isDemo && (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => onEdit(d)}
                aria-label={`Add rate for ${d.name}${d.mask ? ` ••${d.mask}` : ''}`}
              >
                Add rate
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── No Revolving Debt View — nothing to pay down, every card clears or needs a rate ─

function NoRevolvingDebtView({
  paidInFullCards, needsRateCards, onEdit,
}: {
  paidInFullCards: DebtAccount[];
  needsRateCards: DebtAccount[];
  onEdit: (debt: DebtAccount) => void;
}) {
  const needsRate = needsRateCards.length;
  return (
    <>
      <DebtHeader
        tags={needsRate > 0 ? (
          <PageMetaItem>No payoff plan yet</PageMetaItem>
        ) : (
          <PageMetaItem tone="positive">No debt to pay down</PageMetaItem>
        )}
      />
      <NeedsRateSection cards={needsRateCards} onEdit={onEdit} className="mt-8" />
      <PaidInFullSection cards={paidInFullCards} onEdit={onEdit} className={needsRate > 0 ? 'mt-11' : 'mt-8'} />
      <section className="mt-12">
        <PageActions types="debt" />
      </section>
    </>
  );
}

// ── Toggle — the design-system switch, matching the account settings idiom ─────

function Toggle({
  checked, onChange, label, description,
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
      className="ui-focus flex w-full items-start gap-3 text-left"
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

// ── Debt-Free View ────────────────────────────────────────────────────────────

function DebtFreeView({ openChat }: { openChat: (prompt: string) => void }) {
  return (
    <>
      <DebtHeader tags={<PageMetaItem tone="positive" className="ui-tnum">$0, debt-free</PageMetaItem>} />

      <section className="mt-8">
        <h2 className="mb-2 font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.02em] text-content">
          Now that you're debt-free
        </h2>
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
