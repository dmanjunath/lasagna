import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, CreditCard, Landmark, Pencil, X } from 'lucide-react';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { useChatStore } from '../lib/chat-store';
import { PageActions } from '../components/common/page-actions';

interface DebtAccount {
  id: string;
  name: string;
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

// ── Styles ──────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: 'var(--lf-paper)',
    border: '1px solid var(--lf-rule)',
    borderRadius: 14,
  } as React.CSSProperties,
  darkCard: {
    background: 'var(--lf-ink)',
    color: 'var(--lf-paper)',
    borderRadius: 14,
  } as React.CSSProperties,
  eyebrow: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: 'var(--lf-muted)',
  } as React.CSSProperties,
  serif: {
    fontFamily: "'Instrument Serif', Georgia, serif",
  } as React.CSSProperties,
};

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
  if (payment <= balance * monthlyRate) return 999; // never pays off
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
    if (months >= 999) return sum + 999_999; // treat as huge
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

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

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

      // Default sort: avalanche (highest APR first)
      mapped.sort((a, b) => b.apr - a.apr);
      setDebts(mapped);
      setTotalDebt(apiTotal);
    })
    .finally(() => setLoading(false));
  }, [refreshKey]);

  // Page context for chat
  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'debt',
        pageTitle: 'Debt Command Center',
        description: `Debt overview: ${debts.length} accounts, ${formatCurrency(totalDebt)} total.`,
        data: {
          totalDebt,
          debtCount: debts.length,
          debts: debts.map(d => ({ name: d.name, balance: d.balance, apr: d.apr, minPayment: d.minPayment, type: d.type })),
          totalMonthlyPayment: debts.reduce((s, d) => s + d.minPayment, 0),
        },
      });
    }
  }, [loading, totalDebt, debts.length, setPageContext]);

  const hasDebt = totalDebt > 0;

  // ── Strategy calculations ─────────────────────────────────────────────────
  const avalancheOrder = [...debts].sort((a, b) => b.apr - a.apr);
  const snowballOrder = [...debts].sort((a, b) => a.balance - b.balance);

  const avalancheInterest = calcTotalInterest(avalancheOrder, d => d.suggestedPayment);
  const snowballInterest = calcTotalInterest(snowballOrder, d => d.suggestedPayment);
  const interestSavedVsSnowball = Math.round(Math.max(0, snowballInterest - avalancheInterest));

  // Payoff date under current strategy (max across debts at suggested payment)
  const orderedDebts = strategy === 'avalanche' ? avalancheOrder : snowballOrder;
  const suggestedMonths = orderedDebts.length > 0
    ? Math.max(...orderedDebts.map(d => monthsToPayoff(d.balance, d.apr, d.suggestedPayment)))
    : 0;
  const minOnlyMonths = orderedDebts.length > 0
    ? Math.max(...orderedDebts.map(d => monthsToPayoff(d.balance, d.apr, d.minPayment)))
    : 0;

  const debtFreeDate = addMonths(suggestedMonths);
  const totalMonthlyPayment = debts.reduce((s, d) => s + d.suggestedPayment, 0);
  const apr = blendedApr(debts);

  // Progress toward debt-free: percent of max payoff months already elapsed (proxy: 0% at start)
  // We show progress as months-elapsed / total-months — no historical data available
  // DATA-NEEDED: historical debt balance to show YTD paydown progress
  const progressPct = suggestedMonths > 0 && suggestedMonths < 999
    ? Math.min(99, Math.round((1 / suggestedMonths) * 100)) // represents 1 month in
    : 0;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(16px, 4vw, 28px)', paddingBottom: 'clamp(80px, 12vw, 48px)' }}>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--lf-muted)', padding: '24px 0' }}>
          <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 14 }}>Loading…</span>
        </div>
      ) : !hasAccounts ? (
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
          minOnlyDate={addMonths(minOnlyMonths)}
          apr={apr}
          progressPct={progressPct}
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

// ── No Accounts View ──────────────────────────────────────────────────────────

function NoAccountsView() {
  return (
    <motion.div
      {...fadeUp(0)}
      style={{ textAlign: 'center', padding: '64px 0' }}
    >
      <CreditCard style={{ width: 48, height: 48, color: 'var(--lf-muted)', margin: '0 auto 16px' }} />
      <h2 style={{ ...S.serif, fontSize: 28, color: 'var(--lf-ink)', marginBottom: 8 }}>
        No Accounts Linked
      </h2>
      <p style={{ fontSize: 14, color: 'var(--lf-muted)', maxWidth: 380, margin: '0 auto 24px' }}>
        Add your credit cards and loans to see your debt breakdown, payoff timeline, and optimization strategy.
      </p>
      {import.meta.env.VITE_DEMO_MODE !== "true" && (
        <a
          href="/accounts"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 20px',
            background: 'var(--lf-sauce)',
            color: 'var(--lf-paper)',
            fontWeight: 600, fontSize: 14,
            borderRadius: 10,
            textDecoration: 'none',
          }}
        >
          Add Accounts
        </a>
      )}
    </motion.div>
  );
}

// ── Has Debt View ─────────────────────────────────────────────────────────────

function HasDebtView({
  debts, totalDebt, totalMonthlyPayment, interestSavedVsSnowball,
  avalancheInterest, snowballInterest,
  debtFreeDate, minOnlyDate, apr, progressPct,
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
  progressPct: number;
  strategy: 'avalanche' | 'snowball';
  onStrategyChange: (s: 'avalanche' | 'snowball') => void;
  orderedDebts: DebtAccount[];
  openChat: (prompt: string) => void;
  editingDebt: DebtAccount | null;
  onEditDebt: (debt: DebtAccount) => void;
  onCloseModal: () => void;
  onLoanDetailsSaved: () => void;
}) {
  return (
    <>
      {/* ── Page Header ── */}
      <motion.div {...fadeUp(0)} style={{ marginBottom: 28 }}>
        <p style={S.eyebrow}>
          Debt &middot; {debts.length} account{debts.length !== 1 ? 's' : ''}
        </p>
        <h1 style={{ ...S.serif, fontSize: 38, color: 'var(--lf-ink)', marginTop: 4, lineHeight: 1.15 }}>
          Debt-free by{' '}
          <em style={{ fontStyle: 'italic', color: 'var(--lf-sauce)' }}>{debtFreeDate}.</em>
        </h1>
      </motion.div>

      {/* ── Two-column hero ── */}
      <motion.div
        {...fadeUp(0.06)}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        {/* LEFT: dark card — total debt overview */}
        <div style={{ ...S.darkCard, padding: 28 }}>
          <p style={{ ...S.eyebrow, color: 'rgba(251,246,236,0.5)', marginBottom: 12 }}>
            Total debt
          </p>
          <p style={{ ...S.serif, fontSize: 48, lineHeight: 1, color: 'var(--lf-paper)', marginBottom: 4 }}>
            {formatCurrency(totalDebt)}
          </p>

          {/* DATA-NEEDED: YTD change in debt balance for accurate "change this year" figure */}
          <p style={{ fontSize: 13, color: 'rgba(251,246,236,0.45)', marginBottom: 20 }}>
            YTD paydown data unavailable
          </p>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
            <div>
              <p style={{ ...S.eyebrow, color: 'rgba(251,246,236,0.45)', marginBottom: 4 }}>Blended APR</p>
              <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--lf-cheese)' }}>{apr}%</p>
            </div>
            <div>
              <p style={{ ...S.eyebrow, color: 'rgba(251,246,236,0.45)', marginBottom: 4 }}>Monthly payment</p>
              <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--lf-paper)' }}>{formatCurrency(totalMonthlyPayment)}</p>
            </div>
          </div>

          {/* Progress bar to debt-free */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ ...S.eyebrow, color: 'rgba(251,246,236,0.45)' }}>Progress</p>
              <p style={{ ...S.eyebrow, color: 'rgba(251,246,236,0.45)' }}>{debtFreeDate}</p>
            </div>
            <div style={{ height: 6, background: 'rgba(251,246,236,0.12)', borderRadius: 3 }}>
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: 'var(--lf-basil)',
                  borderRadius: 3,
                  transition: 'width 0.6s ease',
                }}
              />
            </div>
          </div>
        </div>

        {/* RIGHT: strategy selector */}
        <div style={{ ...S.card, padding: 28 }}>
          <p style={{ ...S.eyebrow, marginBottom: 16 }}>Strategy</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Avalanche option */}
            <button
              type="button"
              onClick={() => onStrategyChange('avalanche')}
              style={{
                display: 'block',
                textAlign: 'left',
                width: '100%',
                padding: '16px 18px',
                borderRadius: 10,
                border: strategy === 'avalanche'
                  ? '1.5px solid var(--lf-sauce)'
                  : '1.5px solid var(--lf-rule)',
                background: strategy === 'avalanche'
                  ? 'rgba(201,84,58,0.06)'
                  : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--lf-ink)', marginBottom: 2 }}>
                    Avalanche
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--lf-muted)', lineHeight: 1.4 }}>
                    Highest APR first &middot; saves the most interest
                  </p>
                </div>
                {strategy === 'avalanche' && (
                  <span style={{
                    ...S.eyebrow,
                    color: 'var(--lf-sauce)',
                    background: 'rgba(201,84,58,0.1)',
                    padding: '3px 8px',
                    borderRadius: 20,
                    flexShrink: 0,
                    marginLeft: 8,
                  }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--lf-sauce)', marginTop: 8 }}>
                {formatCurrency(Math.round(avalancheInterest))} total interest
              </p>
            </button>

            {/* Snowball option */}
            <button
              type="button"
              onClick={() => onStrategyChange('snowball')}
              style={{
                display: 'block',
                textAlign: 'left',
                width: '100%',
                padding: '16px 18px',
                borderRadius: 10,
                border: strategy === 'snowball'
                  ? '1.5px solid var(--lf-sauce)'
                  : '1.5px solid var(--lf-rule)',
                background: strategy === 'snowball'
                  ? 'rgba(201,84,58,0.06)'
                  : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--lf-ink)', marginBottom: 2 }}>
                    Snowball
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--lf-muted)', lineHeight: 1.4 }}>
                    Smallest balance first &middot; quick psychological wins
                  </p>
                </div>
                {strategy === 'snowball' && (
                  <span style={{
                    ...S.eyebrow,
                    color: 'var(--lf-sauce)',
                    background: 'rgba(201,84,58,0.1)',
                    padding: '3px 8px',
                    borderRadius: 20,
                    flexShrink: 0,
                    marginLeft: 8,
                  }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--lf-muted)', marginTop: 8 }}>
                {formatCurrency(Math.round(snowballInterest))} total interest
              </p>
            </button>

            {/* Savings callout */}
            {interestSavedVsSnowball > 0 && (
              <p style={{ fontSize: 13, color: 'var(--lf-basil)', padding: '8px 12px', background: 'rgba(90,107,63,0.08)', borderRadius: 8 }}>
                Avalanche saves you{' '}
                <strong>{formatCurrency(interestSavedVsSnowball)}</strong> vs snowball.
              </p>
            )}

            <button
              type="button"
              onClick={() => openChat('Should I use avalanche or snowball to pay off my debt?')}
              style={{
                marginTop: 2,
                fontSize: 13,
                color: 'var(--lf-muted)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                padding: 0,
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Ask Claude which is better for me →
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── Debt order table ── */}
      <motion.div {...fadeUp(0.12)}>
        <div style={{ ...S.card, overflow: 'hidden', marginBottom: 20 }}>
          {/* Table header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 22px',
            borderBottom: '1px solid var(--lf-rule)',
          }}>
            <p style={{ ...S.eyebrow }}>
              Debt order &middot; {strategy}
            </p>
            <p style={{ fontSize: 13, color: 'var(--lf-muted)' }}>
              Minimum only: <span style={{ fontWeight: 600 }}>{minOnlyDate}</span>
            </p>
          </div>

          {/* Debt rows */}
          {orderedDebts.map((d, i) => (
            <DebtRow
              key={d.id}
              debt={d}
              rank={i + 1}
              isFirst={i === 0}
              isLast={i === orderedDebts.length - 1}
              onEdit={onEditDebt}
            />
          ))}
        </div>
      </motion.div>

      <PageActions types="debt" />

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

// ── Debt Row ──────────────────────────────────────────────────────────────────

function DebtRow({
  debt: d, rank, isFirst, isLast, onEdit,
}: {
  debt: DebtAccount;
  rank: number;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (d: DebtAccount) => void;
}) {
  const highApr = d.apr > 20;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: 'clamp(12px, 3vw, 16px) clamp(12px, 3vw, 22px)',
        borderBottom: isLast ? 'none' : '1px solid var(--lf-rule-soft)',
        background: isFirst ? 'rgba(201,84,58,0.03)' : 'transparent',
        flexWrap: 'wrap',
      }}
    >
      {/* Rank chip */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          fontWeight: 500,
          background: isFirst ? 'rgba(201,84,58,0.12)' : 'var(--lf-cream)',
          color: isFirst ? 'var(--lf-sauce)' : 'var(--lf-muted)',
          border: isFirst ? '1px solid rgba(201,84,58,0.2)' : '1px solid var(--lf-rule)',
        }}
      >
        {rank}
      </div>

      {/* Icon */}
      <div style={{ flexShrink: 0, color: 'var(--lf-muted)' }}>
        {d.type === 'credit'
          ? <CreditCard style={{ width: 18, height: 18 }} />
          : <Landmark style={{ width: 18, height: 18 }} />
        }
      </div>

      {/* Name / type / badges */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--lf-ink)' }}>{d.name}</span>
          <span style={{
            ...S.eyebrow,
            background: 'var(--lf-cream)',
            color: 'var(--lf-muted)',
            padding: '2px 7px',
            borderRadius: 20,
            border: '1px solid var(--lf-rule)',
          }}>
            {debtTypeLabel(d)}
          </span>
          {import.meta.env.VITE_DEMO_MODE !== "true" && (
            <button
              type="button"
              onClick={() => onEdit(d)}
              title="Edit loan details"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--lf-muted)', padding: 2, lineHeight: 0,
              }}
            >
              <Pencil style={{ width: 12, height: 12 }} />
            </button>
          )}
          {d.liabilitySource === "plaid" && (
            <span style={{
              ...S.eyebrow,
              color: 'var(--lf-basil)',
              background: 'rgba(90,107,63,0.1)',
              padding: '2px 7px',
              borderRadius: 20,
            }}
              title={d.liabilityLastSyncedAt ? `Synced ${new Date(d.liabilityLastSyncedAt).toLocaleDateString()}` : undefined}
            >
              Synced
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--lf-muted)' }}>
            Balance{' '}
            <strong style={{ color: 'var(--lf-ink)' }}>{formatCurrency(d.balance)}</strong>
          </span>
          <span style={{ fontSize: 13, color: highApr ? 'var(--lf-sauce)' : 'var(--lf-muted)', fontWeight: highApr ? 600 : 400 }}>
            {d.apr}% APR{highApr ? ' ⚠' : ''}
          </span>
          <span style={{ fontSize: 13, color: 'var(--lf-muted)' }}>
            Min <strong style={{ color: 'var(--lf-ink)' }}>{formatCurrency(d.minPayment)}/mo</strong>
          </span>
        </div>
        {/* Payoff date note */}
        {d.type !== 'credit' && (
          <p style={{ fontSize: 12, color: 'var(--lf-muted)', marginTop: 3 }}>
            {d.payoffDate ? (
              <>
                Payoff:{' '}
                <span style={{ color: 'var(--lf-basil)', fontWeight: 600 }}>
                  {new Date(d.payoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </span>
              </>
            ) : import.meta.env.VITE_DEMO_MODE !== "true" ? (
              <button
                type="button"
                onClick={() => onEdit(d)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--lf-cheese)', fontWeight: 600, fontSize: 12 }}
              >
                Unknown — add details
              </button>
            ) : (
              <span style={{ color: 'var(--lf-cheese)', fontWeight: 600 }}>Unknown payoff date</span>
            )}
            {' '}
            &middot; Your plan:{' '}
            <span style={{ color: 'var(--lf-basil)', fontWeight: 600 }}>{d.suggestedPayoffDate}</span>
          </p>
        )}
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={() => {}}
        style={{
          flexShrink: 0,
          padding: '7px 14px',
          borderRadius: 8,
          border: '1px solid var(--lf-rule)',
          background: 'var(--lf-cream)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--lf-ink)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'border-color 0.15s',
        }}
        onMouseEnter={e => ((e.target as HTMLButtonElement).style.borderColor = 'var(--lf-sauce)')}
        onMouseLeave={e => ((e.target as HTMLButtonElement).style.borderColor = 'var(--lf-rule)')}
      >
        Payoff plan →
      </button>
    </div>
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
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--lf-muted)',
    marginBottom: 2,
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
      <div
        style={{
          ...S.card,
          padding: 24,
          width: '100%',
          maxWidth: 380,
          margin: '0 16px',
          boxShadow: '0 8px 32px rgba(31,26,22,0.18)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--lf-ink)' }}>{debt.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--lf-muted)', marginTop: 2 }}>Update loan details</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--lf-muted)', padding: 2 }}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(loanType === "mortgage" || loanType === "other_loan") && (
            <label>
              <span style={labelStyle}>Maturity / Payoff Date</span>
              <input type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} style={inputStyle} />
            </label>
          )}
          {loanType === "student_loan" && (
            <label>
              <span style={labelStyle}>Expected Payoff Date</span>
              <input type="date" value={expectedPayoffDate} onChange={e => setExpectedPayoffDate(e.target.value)} style={inputStyle} />
            </label>
          )}
          {loanType !== "credit_card" && (
            <label>
              <span style={labelStyle}>Interest Rate (%)</span>
              <input
                type="number" step="0.01" min="0"
                value={interestRate}
                onChange={e => setInterestRate(e.target.value)}
                placeholder={loanType === "mortgage" ? "e.g. 3.5" : "e.g. 6.5"}
                style={inputStyle}
              />
            </label>
          )}
          {(loanType === "mortgage" || loanType === "other_loan") && (
            <label>
              <span style={labelStyle}>Origination Date</span>
              <input type="date" value={originationDate} onChange={e => setOriginationDate(e.target.value)} style={inputStyle} />
            </label>
          )}
          {loanType === "credit_card" && (
            <label>
              <span style={labelStyle}>Purchase APR (%)</span>
              <input
                type="number" step="0.01" min="0"
                value={purchaseApr}
                onChange={e => setPurchaseApr(e.target.value)}
                placeholder="e.g. 21.99"
                style={inputStyle}
              />
            </label>
          )}
          {(loanType === "student_loan" || loanType === "credit_card" || loanType === "other_loan") && (
            <label>
              <span style={labelStyle}>Minimum Payment ($)</span>
              <input
                type="number" step="1" min="0"
                value={minPayment}
                onChange={e => setMinPayment(e.target.value)}
                placeholder="e.g. 250"
                style={inputStyle}
              />
            </label>
          )}
          {loanType === "student_loan" && (
            <label>
              <span style={labelStyle}>Repayment Plan</span>
              <input
                type="text"
                value={repaymentPlanType}
                onChange={e => setRepaymentPlanType(e.target.value)}
                placeholder="e.g. income_driven, standard"
                style={inputStyle}
              />
            </label>
          )}

          {error && <p style={{ fontSize: 12, color: 'var(--lf-sauce)' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 14, fontWeight: 600,
                border: '1px solid var(--lf-rule)',
                background: 'transparent',
                color: 'var(--lf-muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: 'var(--lf-sauce)',
                color: 'var(--lf-paper)',
                border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Debt-Free View ────────────────────────────────────────────────────────────

function DebtFreeView({ openChat }: { openChat: (prompt: string) => void }) {
  return (
    <>
      <motion.div {...fadeUp(0)} style={{ marginBottom: 28 }}>
        <p style={S.eyebrow}>Debt &middot; 0 accounts</p>
        <h1 style={{ ...S.serif, fontSize: 38, color: 'var(--lf-ink)', marginTop: 4, lineHeight: 1.15 }}>
          You're{' '}
          <em style={{ fontStyle: 'italic', color: 'var(--lf-basil)' }}>completely debt-free.</em>
        </h1>
      </motion.div>

      <motion.div {...fadeUp(0.06)} style={{ ...S.darkCard, padding: 32, marginBottom: 20 }}>
        <p style={{ ...S.eyebrow, color: 'rgba(251,246,236,0.5)', marginBottom: 8 }}>Total debt</p>
        <p style={{ ...S.serif, fontSize: 56, color: 'var(--lf-paper)', lineHeight: 1 }}>$0</p>
        <p style={{ fontSize: 14, color: 'rgba(251,246,236,0.55)', marginTop: 12 }}>
          Every dollar you earn stays in your pocket. Keep building your financial safety net.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <span style={{
            ...S.eyebrow,
            color: 'var(--lf-basil)',
            background: 'rgba(90,107,63,0.18)',
            padding: '5px 12px',
            borderRadius: 20,
          }}>
            No credit card debt
          </span>
          <span style={{
            ...S.eyebrow,
            color: 'var(--lf-basil)',
            background: 'rgba(90,107,63,0.18)',
            padding: '5px 12px',
            borderRadius: 20,
          }}>
            No active loans
          </span>
        </div>
      </motion.div>

      <motion.div {...fadeUp(0.12)} style={{ ...S.card, padding: 24, textAlign: 'center', marginBottom: 20 }}>
        <p style={{ ...S.serif, fontSize: 28, color: 'var(--lf-ink)', marginBottom: 8 }}>
          What's next?
        </p>
        <p style={{ fontSize: 14, color: 'var(--lf-muted)', marginBottom: 16 }}>
          Now that you're debt-free, redirect those payments into investments and savings.
        </p>
        <button
          type="button"
          onClick={() => openChat('I just paid off all my debt. What should I do with the extra cash flow?')}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            background: 'var(--lf-sauce)',
            color: 'var(--lf-paper)',
            border: 'none',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Ask Claude what's next →
        </button>
      </motion.div>

      <PageActions types="debt" />
    </>
  );
}
