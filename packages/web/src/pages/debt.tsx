import { useState, useEffect } from 'react';
import { CreditCard, Landmark, Pencil, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/utils';
import { usePageContext } from '../lib/page-context';
import { useChatStore } from '../lib/chat-store';
import { PageActions } from '../components/common/page-actions';
import {
  Page,
  Section,
  Card,
  Button,
  Pill,
  Eyebrow,
  DataTable,
  EmptyState,
  CompositionRibbon,
  StatStrip,
} from '../components/ds';
import type { DataTableColumn } from '../components/ds/DataTable';
import type { CompositionSegment } from '../components/ds/CompositionRibbon';

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

// Distinct hues for debt segments — sauce + crust + muted + cheese were
// the prior set's three browns, which read as one block. Alternating hue
// (red → brown → warm-grey → yellow) gives users at-a-glance separation.
const DEBT_SHADES = [
  'var(--lf-sauce)',
  'var(--lf-crust)',
  'var(--lf-muted)',
  'var(--lf-cheese)',
  'var(--lf-burgundy)',
  'var(--lf-sauce-deep)',
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
    <Page>
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
    </Page>
  );
}

// ── No Accounts View ──────────────────────────────────────────────────────────

function NoAccountsView() {
  return (
    <>
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Debt</h1>
          <span className="ds-page-bar__subtitle">No accounts linked</span>
        </div>
      </header>
      <div className="ds-page-bar__subtitle-mobile">No accounts linked</div>
      <Section>
        <EmptyState
          icon={<CreditCard size={40} />}
          title="No accounts linked"
          body="Add your credit cards and loans to see your debt breakdown, payoff timeline, and optimization strategy."
          cta={import.meta.env.VITE_DEMO_MODE !== "true" ? (
            <a href="/accounts" className="ds-btn ds-btn--primary">
              Add accounts
            </a>
          ) : undefined}
        />
      </Section>
    </>
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
  // Composition segments per account. Abbreviate "MORTGAGE" → "MTG" so the legend
  // stays scannable on mobile, and drop the ··mask suffix from the label (it adds
  // noise when stacked one-per-row).
  const compositionSegments: CompositionSegment[] = [...debts]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 6)
    .map((d, i) => ({
      label: d.name.replace(/\bMORTGAGE\b/gi, 'MTG'),
      value: d.balance,
      color: debtColor(i),
      negative: true,
    }));
  // Largest balance to identify <1% rows for de-emphasis (D5).
  const compositionTotal = compositionSegments.reduce((s, seg) => s + Math.abs(seg.value), 0);

  // Total interest delta: how much interest saved using avalanche vs snowball
  const cheaperInterest = Math.min(avalancheInterest, snowballInterest);
  const totalInterest = Math.round(cheaperInterest);

  // Debt table columns
  const cols: DataTableColumn<DebtAccount>[] = [
    {
      key: 'name',
      header: 'Account',
      cell: (d) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ flexShrink: 0, color: 'var(--lf-muted)' }}>
            {d.type === 'credit'
              ? <CreditCard size={16} />
              : <Landmark size={16} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, color: 'var(--lf-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.name}{d.mask ? ` ··${d.mask}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
              <Pill tone="cream">{debtTypeLabel(d)}</Pill>
              {d.liabilitySource === 'plaid' && (
                <Pill tone="basil">Synced</Pill>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      num: true,
      cell: (d) => <span className="ds-num">{formatCurrency(d.balance)}</span>,
    },
    {
      key: 'apr',
      header: 'APR',
      num: true,
      cell: (d) => {
        const high = d.apr > 20;
        return (
          <span className={`ds-num ${high ? 'ds-neg' : ''}`} style={{ fontWeight: high ? 600 : 400 }}>
            {d.apr}%
          </span>
        );
      },
    },
    {
      key: 'min',
      header: 'Min pay',
      num: true,
      cell: (d) => <span className="ds-num">{formatCurrency(d.minPayment)}/mo</span>,
    },
    {
      key: 'payoff',
      header: 'Payoff',
      num: true,
      muted: true,
      cell: (d) => (
        <span className="ds-num">
          {d.payoffDate
            ? new Date(d.payoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
            : d.suggestedPayoffDate}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (d) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {import.meta.env.VITE_DEMO_MODE !== 'true' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEditDebt(d); }}
              title="Edit loan details"
              aria-label="Edit loan details"
              style={{
                background: 'transparent', border: '1px solid var(--lf-rule)', borderRadius: 6,
                cursor: 'pointer', color: 'var(--lf-muted)', padding: 6, lineHeight: 0,
              }}
            >
              <Pencil size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openChat(`Help me create a payoff plan for my ${d.name} (${d.apr}% APR, ${formatMoney(d.balance, true)} balance).`);
            }}
            className="ds-btn ds-btn--ghost ds-btn--sm"
          >
            Plan →
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <style>{`
        .debt-strip { margin: 32px 0 48px; }

        /* Composition legend on mobile — force one item per row (vs the default
           wrap-onto-multiple-rows which mixes line heights). Each legend item
           becomes a clean: SWATCH · account name · amount · % strip. */
        @media (max-width: 640px) {
          .debt-ribbon-wrap .ds-ribbon__legend {
            flex-direction: column;
            gap: 8px;
            row-gap: 8px;
          }
          .debt-ribbon-wrap .ds-ribbon__legend-item {
            display: grid;
            grid-template-columns: auto 1fr auto;
            grid-template-areas:
              "swatch label  pct"
              ".      value  pct";
            align-items: baseline;
            gap: 4px 10px;
            width: 100%;
          }
          .debt-ribbon-wrap .ds-ribbon__swatch { grid-area: swatch; align-self: center; }
          .debt-ribbon-wrap .ds-ribbon__legend-label { grid-area: label; }
          .debt-ribbon-wrap .ds-ribbon__legend-value { grid-area: value; }
          .debt-ribbon-wrap .ds-ribbon__legend-item > span:last-child { grid-area: pct; }
        }

        /* De-emphasize the trailing tiny-% rows (D5). data-tiny is the count of
           sub-1% segments at the end of the legend, set by the page. */
        .debt-ribbon-wrap[data-tiny="1"] .ds-ribbon__legend-item:nth-last-child(-n+1),
        .debt-ribbon-wrap[data-tiny="2"] .ds-ribbon__legend-item:nth-last-child(-n+2),
        .debt-ribbon-wrap[data-tiny="3"] .ds-ribbon__legend-item:nth-last-child(-n+3),
        .debt-ribbon-wrap[data-tiny="4"] .ds-ribbon__legend-item:nth-last-child(-n+4) {
          opacity: 0.55;
          font-size: 11px;
        }
        .debt-ribbon-wrap[data-tiny="1"] .ds-ribbon__legend-item:nth-last-child(-n+1) .ds-ribbon__legend-label,
        .debt-ribbon-wrap[data-tiny="2"] .ds-ribbon__legend-item:nth-last-child(-n+2) .ds-ribbon__legend-label,
        .debt-ribbon-wrap[data-tiny="3"] .ds-ribbon__legend-item:nth-last-child(-n+3) .ds-ribbon__legend-label,
        .debt-ribbon-wrap[data-tiny="4"] .ds-ribbon__legend-item:nth-last-child(-n+4) .ds-ribbon__legend-label {
          font-size: 10px;
        }

        .debt-strategy {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0;
        }
        @media (min-width: 720px) {
          .debt-strategy { grid-template-columns: 1fr 1fr; }
        }
        .debt-strategy__col {
          padding: 20px 0;
        }
        /* The strategy columns are now <button>s — strip the default UA styles
           so they read as cards, and add a clear active state pill + ring. */
        .debt-strategy__col--btn {
          background: none;
          border: 0;
          width: 100%;
          text-align: left;
          font: inherit;
          color: inherit;
          cursor: pointer;
          border-radius: 10px;
          transition: background 0.15s, box-shadow 0.15s;
        }
        .debt-strategy__col--btn:hover:not(.is-active) {
          background: var(--lf-cream);
        }
        .debt-strategy__col--btn.is-active {
          background: var(--lf-cream);
          box-shadow: inset 0 0 0 1px var(--lf-sauce);
          padding-left: 14px;
          padding-right: 14px;
        }
        .debt-strategy__col--btn:focus-visible {
          outline: 2px solid var(--lf-sauce);
          outline-offset: 2px;
        }
        .debt-strategy__col + .debt-strategy__col {
          border-top: 1px solid var(--lf-rule);
        }
        @media (min-width: 720px) {
          .debt-strategy__col + .debt-strategy__col {
            border-top: none;
            border-left: 1px solid var(--lf-rule);
            padding-left: 28px;
          }
          .debt-strategy__col:first-child {
            padding-right: 28px;
          }
        }
        .debt-strategy__label {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--lf-muted);
          margin-bottom: 6px;
        }
        .debt-strategy__amount {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 500;
          font-size: clamp(28px, 3.4vw, 36px);
          line-height: 1.1;
          color: var(--lf-ink);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
        }
        .debt-strategy__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 500;
          font-size: 22px;
          color: var(--lf-ink);
          margin: 0 0 4px;
        }
        .debt-strategy__body {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.55;
          color: var(--lf-ink-soft);
          margin: 8px 0 0;
        }
        .debt-strategy__pill {
          display: inline-block;
          margin-top: 12px;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
      `}</style>

      {/* Iter 8: ds-page-bar replaces editorial PageHeader + Lede. Live
          monetary data stays out of the H1; subtitle carries the totals
          (inline on desktop, dropped below on mobile). */}
      {(() => {
        const subtitleText = `${formatCurrency(totalDebt)} across ${debts.length} account${debts.length === 1 ? '' : 's'} · ${apr}% blended`;
        const subtitleMobile = `${debts.length} account${debts.length === 1 ? '' : 's'} · ${apr}% blended`;
        return (
          <>
            <header className="ds-page-bar">
              <div className="ds-page-bar__title-group">
                <h1 className="ds-page-bar__title">Debt</h1>
                <span className="ds-page-bar__subtitle">{subtitleText}</span>
              </div>
            </header>
            <div className="ds-page-bar__subtitle-mobile">{subtitleMobile}</div>
          </>
        );
      })()}

      {/* Composition ribbon */}
      {compositionSegments.length > 0 && (() => {
        // Count trailing tiny segments (<1% of total) so we can de-emphasize them
        // in the legend via :nth-last-child. Segments are already sorted desc.
        let tinyCount = 0;
        for (let i = compositionSegments.length - 1; i >= 0; i--) {
          const pct = compositionTotal > 0 ? (Math.abs(compositionSegments[i].value) / compositionTotal) * 100 : 0;
          if (pct < 1) tinyCount++;
          else break;
        }
        return (
          <Section>
            <div className="debt-ribbon-wrap" data-tiny={tinyCount}>
              <CompositionRibbon
                leadDelta={`${debts.length} account${debts.length === 1 ? '' : 's'}`}
                segments={compositionSegments}
              />
            </div>
          </Section>
        );
      })()}

      {/* Stat strip */}
      <StatStrip
        className="debt-strip"
        items={[
          { label: 'Total debt', value: <span className="ds-num">{formatCurrency(totalDebt)}</span>, sub: `${debts.length} account${debts.length === 1 ? '' : 's'}`, tone: 'neg' },
          { label: 'Blended APR', value: <span className="ds-num">{apr}%</span>, sub: 'weighted average' },
          { label: 'Monthly payment', value: <span className="ds-num">{formatCurrency(totalMonthlyPayment)}</span>, sub: 'suggested plan' },
          { label: 'Total interest', value: <span className="ds-num">{formatCurrency(totalInterest)}</span>, sub: 'over plan' },
        ]}
      />

      {/* Payoff strategy — editorial comparison */}
      <Section
        title="Payoff strategy"
        actions={
          <span
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--lf-muted)',
            }}
            aria-live="polite"
          >
            Sorted · {strategy}
          </span>
        }
      >
        <div className="debt-strategy">
          <button
            type="button"
            role="radio"
            aria-checked={strategy === 'avalanche'}
            aria-pressed={strategy === 'avalanche'}
            onClick={() => onStrategyChange('avalanche')}
            className={`debt-strategy__col debt-strategy__col--btn ${strategy === 'avalanche' ? 'is-active' : ''}`}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span className="debt-strategy__label" style={{ marginBottom: 0 }}>Avalanche</span>
              {strategy === 'avalanche' && <Pill tone="sauce">Active</Pill>}
            </div>
            <h3 className="debt-strategy__title">Highest APR first</h3>
            <div className="debt-strategy__amount" style={{ marginTop: 12 }}>
              {formatCurrency(Math.round(avalancheInterest))}
            </div>
            <div className="debt-strategy__label" style={{ marginTop: 4 }}>Total interest paid</div>
            <p className="debt-strategy__body">
              Mathematically optimal. Saves you the most money over the life of the plan.
            </p>
            {interestSavedVsSnowball > 0 && (
              <span className="debt-strategy__pill" style={{ color: 'var(--lf-basil)' }}>
                Saves {formatCurrency(interestSavedVsSnowball)} vs snowball
              </span>
            )}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={strategy === 'snowball'}
            aria-pressed={strategy === 'snowball'}
            onClick={() => onStrategyChange('snowball')}
            className={`debt-strategy__col debt-strategy__col--btn ${strategy === 'snowball' ? 'is-active' : ''}`}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span className="debt-strategy__label" style={{ marginBottom: 0 }}>Snowball</span>
              {strategy === 'snowball' && <Pill tone="sauce">Active</Pill>}
            </div>
            <h3 className="debt-strategy__title">Smallest balance first</h3>
            <div className="debt-strategy__amount" style={{ marginTop: 12 }}>
              {formatCurrency(Math.round(snowballInterest))}
            </div>
            <div className="debt-strategy__label" style={{ marginTop: 4 }}>Total interest paid</div>
            <p className="debt-strategy__body">
              Quick psychological wins. You close accounts faster — useful if motivation matters more than dollars.
            </p>
            {interestSavedVsSnowball > 0 && (
              <span className="debt-strategy__pill" style={{ color: 'var(--lf-sauce)' }}>
                Costs {formatCurrency(interestSavedVsSnowball)} more in interest
              </span>
            )}
          </button>
        </div>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--lf-rule)',
          gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <Eyebrow>Debt-free</Eyebrow>
              <div className="ds-num" style={{ fontSize: 15, fontWeight: 500, marginTop: 4 }}>{debtFreeDate}</div>
            </div>
            <div>
              <Eyebrow>If minimum only</Eyebrow>
              <div className="ds-num" style={{ fontSize: 15, fontWeight: 500, marginTop: 4, color: 'var(--lf-muted)' }}>{minOnlyDate}</div>
            </div>
          </div>
          <Button variant="link" onClick={() => openChat('Should I use avalanche or snowball to pay off my debt?')}>
            Why this strategy? →
          </Button>
        </div>
      </Section>

      {/* Accounts table — the sort indicator now sits next to the strategy
          toggle above (D2), so this section keeps just its title. */}
      <Section
        title="Accounts"
      >
        <Card flush>
          <DataTable
            columns={cols}
            rows={orderedDebts}
            rowKey={(d) => d.id}
            hover
          />
        </Card>
      </Section>

      <Section>
        <PageActions types="debt" />
      </Section>

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

  const inputStyle: React.CSSProperties = {
    marginTop: 4,
    width: '100%',
    background: 'var(--lf-cream)',
    border: '1px solid var(--lf-rule)',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 14,
    color: 'var(--lf-ink)',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(31,26,22,0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, margin: '0 16px' }}>
        <div style={{
          background: 'var(--lf-paper)',
          border: '1px solid var(--lf-rule)',
          borderRadius: 12,
          padding: 28,
        }}>
          {/* Header with hairline-bottom */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            paddingBottom: 16, marginBottom: 20,
            borderBottom: '1px solid var(--lf-rule)',
          }}>
            <div style={{ minWidth: 0 }}>
              <Eyebrow>Update loan details</Eyebrow>
              <h3 className="ds-h3" style={{ marginTop: 6 }}>{debt.name}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--lf-muted)', padding: 2 }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(loanType === "mortgage" || loanType === "other_loan") && (
              <label>
                <Eyebrow>Maturity / Payoff Date</Eyebrow>
                <input type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} style={inputStyle} />
              </label>
            )}
            {loanType === "student_loan" && (
              <label>
                <Eyebrow>Expected Payoff Date</Eyebrow>
                <input type="date" value={expectedPayoffDate} onChange={e => setExpectedPayoffDate(e.target.value)} style={inputStyle} />
              </label>
            )}
            {loanType !== "credit_card" && (
              <label>
                <Eyebrow>Interest Rate (%)</Eyebrow>
                <input
                  type="number" step="0.01" min="0"
                  value={interestRate}
                  onChange={e => setInterestRate(e.target.value)}
                  placeholder={loanType === "mortgage" ? "e.g. 3.5" : "e.g. 6.5"}
                  className="ds-num"
                  style={inputStyle}
                />
              </label>
            )}
            {(loanType === "mortgage" || loanType === "other_loan") && (
              <label>
                <Eyebrow>Origination Date</Eyebrow>
                <input type="date" value={originationDate} onChange={e => setOriginationDate(e.target.value)} style={inputStyle} />
              </label>
            )}
            {loanType === "credit_card" && (
              <label>
                <Eyebrow>Purchase APR (%)</Eyebrow>
                <input
                  type="number" step="0.01" min="0"
                  value={purchaseApr}
                  onChange={e => setPurchaseApr(e.target.value)}
                  placeholder="e.g. 21.99"
                  className="ds-num"
                  style={inputStyle}
                />
              </label>
            )}
            {(loanType === "student_loan" || loanType === "credit_card" || loanType === "other_loan") && (
              <label>
                <Eyebrow>Minimum Payment ($)</Eyebrow>
                <input
                  type="number" step="1" min="0"
                  value={minPayment}
                  onChange={e => setMinPayment(e.target.value)}
                  placeholder="e.g. 250"
                  className="ds-num"
                  style={inputStyle}
                />
              </label>
            )}
            {loanType === "student_loan" && (
              <label>
                <Eyebrow>Repayment Plan</Eyebrow>
                <input
                  type="text"
                  value={repaymentPlanType}
                  onChange={e => setRepaymentPlanType(e.target.value)}
                  placeholder="e.g. income_driven, standard"
                  style={inputStyle}
                />
              </label>
            )}

            {error && <p className="ds-body ds-body--sm ds-neg">{error}</p>}

            <div style={{
              display: 'flex', gap: 8, marginTop: 8,
              paddingTop: 16, borderTop: '1px solid var(--lf-rule)',
            }}>
              <Button type="button" variant="ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>
                Cancel
              </Button>
              <Button type="submit" variant="ink" disabled={saving} style={{ flex: 1, justifyContent: 'center' }}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Debt-Free View ────────────────────────────────────────────────────────────

function DebtFreeView({ openChat }: { openChat: (prompt: string) => void }) {
  return (
    <>
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Debt</h1>
          <span className="ds-page-bar__subtitle ds-pos">$0 — debt-free</span>
        </div>
      </header>
      <div className="ds-page-bar__subtitle-mobile"><span className="ds-pos">$0 — debt-free</span></div>

      <Section title="What's next?" eyebrow="now that you're debt-free">
        <Card>
          <p className="ds-body">
            Redirect those payments into investments and savings.
          </p>
          <div style={{ marginTop: 16 }}>
            <Button
              variant="ink"
              onClick={() => openChat('I just paid off all my debt. What should I do with the extra cash flow?')}
            >
              Walk me through this →
            </Button>
          </div>
        </Card>
      </Section>

      <Section>
        <PageActions types="debt" />
      </Section>
    </>
  );
}
