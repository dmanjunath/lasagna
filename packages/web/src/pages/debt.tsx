import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, CreditCard, Landmark } from 'lucide-react';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { useChatStore } from '../lib/chat-store';
import { Section } from '../components/common/section';
import { ActionItem } from '../components/common/action-item';
import { ContextualInsights } from '../components/common/contextual-insights';

interface DebtAccount {
  name: string;
  balance: number;
  type: string;
  apr: number;
  minPayment: number;
  suggestedPayment: number;
  minPayoffDate: string;
  suggestedPayoffDate: string;
}

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

function debtIcon(type: string) {
  if (type === 'credit') return <CreditCard className="w-5 h-5" />;
  return <Landmark className="w-5 h-5" />;
}

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

export function Debt() {
  const { setPageContext } = usePageContext();
  const { openChat } = useChatStore();
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<DebtAccount[]>([]);
  const [totalDebt, setTotalDebt] = useState(0);
  const [hasAccounts, setHasAccounts] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getDebts().catch(() => ({ debts: [] as Array<{ name: string; type: string; balance: number; interestRate: number | null; minimumPayment: number }>, totalDebt: 0, monthlyInterest: 0 })),
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
            name: d.name,
            balance: d.balance,
            type: d.type,
            apr: Math.round(apr * 100) / 100,
            minPayment: minPay,
            suggestedPayment: suggestedPay,
            minPayoffDate: addMonths(minMonths),
            suggestedPayoffDate: addMonths(sugMonths),
          };
        });

        // Sort by APR descending (avalanche order)
        mapped.sort((a, b) => b.apr - a.apr);
        setDebts(mapped);
        setTotalDebt(apiTotal);
      })
      .finally(() => setLoading(false));
  }, []);

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
  const totalMonthlyPayment = debts.reduce((s, d) => s + d.suggestedPayment, 0);

  const minOnlyMonths = debts.length > 0 ? Math.max(...debts.map((d) => monthsToPayoff(d.balance, d.apr, d.minPayment))) : 0;
  const suggestedMonths = debts.length > 0 ? Math.max(...debts.map((d) => monthsToPayoff(d.balance, d.apr, d.suggestedPayment))) : 0;
  const monthsSaved = minOnlyMonths - suggestedMonths;

  // Calculate total interest paid under min-only vs suggested plan
  const totalInterestMin = debts.reduce((sum, d) => {
    const months = monthsToPayoff(d.balance, d.apr, d.minPayment);
    return sum + (d.minPayment * months - d.balance);
  }, 0);
  const totalInterestSuggested = debts.reduce((sum, d) => {
    const months = monthsToPayoff(d.balance, d.apr, d.suggestedPayment);
    return sum + (d.suggestedPayment * months - d.balance);
  }, 0);
  const interestSavedVsMinimums = Math.round(Math.max(0, totalInterestMin - totalInterestSuggested));

  // Avalanche vs snowball: estimate savings by comparing interest order vs balance order
  const snowballOrder = [...debts].sort((a, b) => a.balance - b.balance);
  const avalancheInterest = debts.reduce((sum, d) => {
    const months = monthsToPayoff(d.balance, d.apr, d.suggestedPayment);
    return sum + (d.suggestedPayment * months - d.balance);
  }, 0);
  const snowballInterest = snowballOrder.reduce((sum, d) => {
    const months = monthsToPayoff(d.balance, d.apr, d.suggestedPayment);
    return sum + (d.suggestedPayment * months - d.balance);
  }, 0);
  const interestSavedVsSnowball = Math.round(Math.max(0, snowballInterest - avalancheInterest));

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <ContextualInsights types="debt" />
      {loading ? (
        <div className="flex items-center gap-2 text-text-muted py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : !hasAccounts ? (
        <motion.div {...fadeUp(0)} className="text-center py-16">
          <CreditCard className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h2 className="font-display text-2xl font-medium mb-2">No Accounts Linked</h2>
          <p className="text-text-muted text-sm max-w-md mx-auto mb-6">
            Add your credit cards and loans to see your debt breakdown, payoff timeline, and optimization strategy.
          </p>
          <a href="/accounts" className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-bg font-semibold text-sm rounded-xl hover:bg-accent/90 transition-colors">
            Add Accounts
          </a>
        </motion.div>
      ) : hasDebt ? (
        <HasDebtView
          debts={debts}
          totalDebt={totalDebt}
          totalMonthlyPayment={totalMonthlyPayment}
          interestSavedVsSnowball={interestSavedVsSnowball}
          minOnlyDate={addMonths(minOnlyMonths)}
          suggestedDate={addMonths(suggestedMonths)}
          monthsSaved={monthsSaved}
          interestSavedVsMinimums={interestSavedVsMinimums}
          openChat={openChat}
        />
      ) : (
        <DebtFreeView openChat={openChat} />
      )}
    </div>
  );
}

/* ─── Has Debt View ─── */

function HasDebtView({
  debts,
  totalDebt,
  totalMonthlyPayment,
  interestSavedVsSnowball,
  minOnlyDate,
  suggestedDate,
  monthsSaved,
  interestSavedVsMinimums,
  openChat,
}: {
  debts: DebtAccount[];
  totalDebt: number;
  totalMonthlyPayment: number;
  interestSavedVsSnowball: number;
  minOnlyDate: string;
  suggestedDate: string;
  monthsSaved: number;
  interestSavedVsMinimums: number;
  openChat: (prompt: string) => void;
}) {
  // Calculate dynamic impacts from actual debt data
  const highestAprDebt = debts[0]; // already sorted by APR desc
  const avgAprReduction = 6; // average negotiated reduction
  const negotiateSavings = highestAprDebt
    ? Math.round(highestAprDebt.balance * (avgAprReduction / 100 / 12))
    : 50;

  const balanceTransferSavings = highestAprDebt
    ? Math.round(highestAprDebt.balance * (highestAprDebt.apr / 100))
    : 924;

  const badgeColor = (i: number) => {
    if (i === 0) return 'bg-danger/20 text-danger border-danger/30';
    if (i === 1) return 'bg-warning/20 text-warning border-warning/30';
    return 'bg-surface-hover text-text-muted border-border';
  };

  return (
    <>
      {/* Hero Card */}
      <motion.div {...fadeUp(0)} className="glass-card p-6 mb-6 relative overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-danger" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-danger/70">
            Debt Command Center
          </span>
        </div>
        <div className="font-display text-3xl md:text-4xl font-semibold tracking-tight mb-1">
          {formatCurrency(totalDebt)}
        </div>
        <p className="text-sm text-text-secondary">
          Avalanche strategy active &middot; Paying highest APR first
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-danger/15 text-danger">
            {debts.length} active debt{debts.length !== 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-success/15 text-success">
            {formatCurrency(totalMonthlyPayment)}/mo payments
          </span>
        </div>
      </motion.div>

      {/* Payoff Strategy */}
      <motion.div {...fadeUp(0.08)}>
        <Section title="Payoff Strategy">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-success">
                Avalanche Method — Active
              </span>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              Pay minimums on everything, then throw all extra cash at the{' '}
              <strong className="text-text-primary">highest APR</strong> debt first. This saves the
              most money mathematically.
            </p>

            <div className="divide-y divide-border">
              <StatRow label="Your strategy" value="Avalanche (highest APR first)" valueClass="text-success" />
              <StatRow label="Alternative" value="Snowball (smallest balance first)" valueClass="text-text-muted" />
              <StatRow
                label="Interest saved vs snowball"
                value={formatCurrency(interestSavedVsSnowball)}
                valueClass="text-success"
              />
            </div>

            <div className="mt-3 p-3 rounded-lg bg-white/[0.03] text-xs text-text-secondary">
              <strong className="text-text-primary">Snowball</strong> pays smallest balance first
              for quicker wins.{' '}
              <strong className="text-text-primary">Avalanche</strong> targets highest APR to
              minimize total interest. Avalanche saves you{' '}
              {formatCurrency(interestSavedVsSnowball)} here.
            </div>

            <button
              type="button"
              onClick={() => openChat('Should I switch to snowball method?')}
              className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg bg-success/10 text-success text-sm font-semibold hover:bg-success/20 transition-colors"
            >
              Should I switch to snowball? &rarr;
            </button>
          </div>
        </Section>
      </motion.div>

      {/* Payoff Timeline */}
      <motion.div {...fadeUp(0.16)}>
        <Section title="Payoff Timeline">
          <div className="glass-card p-5">
            <div className="divide-y divide-border">
              <StatRow label="Minimum payments only" value={minOnlyDate} valueClass="text-danger" />
              <StatRow label="Suggested plan" value={suggestedDate} valueClass="text-success" />
              <StatRow label="Time saved" value={`${monthsSaved} months`} valueClass="text-success" />
              <StatRow
                label="Interest saved vs minimums"
                value={formatCurrency(interestSavedVsMinimums)}
                valueClass="text-success"
              />
            </div>
          </div>
        </Section>
      </motion.div>

      {/* Payoff Order */}
      <motion.div {...fadeUp(0.24)}>
        <Section title="Payoff Order">
          <div className="space-y-3">
            {debts.map((d, i) => (
              <div
                key={`${d.name}-${i}`}
                className={`glass-card p-4 flex items-center gap-3.5 ${i === 0 ? 'border-danger/25' : ''}`}
              >
                {/* Numbered badge */}
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0 border ${badgeColor(i)}`}
                >
                  {debtIcon(d.type)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold">{d.name}</div>
                  <div className="text-[13px] text-text-muted mt-0.5">
                    {d.apr}% APR &middot; Min {formatCurrency(d.minPayment)}/mo &middot; Paying{' '}
                    {formatCurrency(d.suggestedPayment)}/mo
                  </div>
                  <div className="text-[11px] text-text-muted mt-1">
                    Min payoff:{' '}
                    <span className="text-danger">{d.minPayoffDate}</span> &middot; Your plan:{' '}
                    <span className="text-success">{d.suggestedPayoffDate}</span>
                  </div>
                </div>

                {/* Balance */}
                <div className="text-right flex-shrink-0">
                  <div className={`text-base font-bold ${i === 0 ? 'text-danger' : ''}`}>
                    {formatCurrency(d.balance)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </motion.div>

      {/* Actions */}
      <motion.div {...fadeUp(0.32)}>
        <Section title="Actions">
          <div className="bg-bg-elevated border border-border rounded-xl px-4">
            <ActionItem
              title="Call to negotiate lower APR"
              tag="DEBT"
              description="Call the number on the back of your card and ask for a hardship rate reduction or balance transfer offer. Average reduction: 5-7%."
              impact={`Saves ~$${negotiateSavings}/mo interest`}
              impactColor="red"
              chatPrompt="Walk me through exactly what to say when I call my credit card company to negotiate a lower interest rate. What scripts work best?"
              defaultOpen
            />
            <ActionItem
              title="Set up autopay on all debts"
              tag="DEBT"
              description="Never miss a payment and protect your credit score. Some lenders give a 0.25% rate discount for autopay."
              impact="Protects credit score"
              impactColor="green"
              chatPrompt="How do I set up autopay on my credit cards and loans? Any tips to avoid overdraft issues?"
            />
            <ActionItem
              title="Increase monthly payment"
              tag="DEBT"
              description="Even an extra $70/mo shaves months off payoff and saves hundreds in interest."
              impact="Debt-free sooner"
              impactColor="amber"
              chatPrompt="If I increase my monthly debt payment by $200, how much faster will I be debt-free and how much interest will I save?"
            />
            <ActionItem
              title="Check balance transfer card offers"
              tag="DEBT"
              description="A 0% APR balance transfer card could eliminate interest on your highest-rate card for 15-18 months."
              impact={`${formatCurrency(balanceTransferSavings)}/yr saved`}
              impactColor="amber"
              chatPrompt="What are the best 0% APR balance transfer cards right now? How does the transfer process work and what are the fees?"
            />
          </div>
        </Section>
      </motion.div>
    </>
  );
}

/* ─── Debt-Free View ─── */

function DebtFreeView({ openChat }: { openChat: (prompt: string) => void }) {
  return (
    <>
      {/* Hero Card */}
      <motion.div {...fadeUp(0)} className="glass-card p-6 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-success" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
            Debt Status
          </span>
        </div>
        <div className="font-display text-3xl md:text-4xl font-semibold tracking-tight mb-1">
          Debt-free! 🎉
        </div>
        <p className="text-sm text-text-secondary">
          You have no outstanding debt. Keep building your financial safety net.
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-success/15 text-success">
            ✓ $0 credit card debt
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-success/15 text-success">
            ✓ No active loans
          </span>
        </div>
      </motion.div>

      {/* Stay Debt-Free */}
      <motion.div {...fadeUp(0.08)}>
        <Section title="Stay Debt-Free">
          <div className="bg-bg-elevated border border-border rounded-xl px-4">
            <ActionItem
              title="Set credit cards to autopay full balance"
              tag="DEBT"
              description="Use credit cards for rewards but never carry a balance. Autopay the full statement balance, not minimum."
              impact="$0 interest forever"
              impactColor="green"
              chatPrompt="How do I stay debt-free?"
              defaultOpen
            />
            <ActionItem
              title="Set up credit monitoring"
              tag="DEBT"
              description="Free via Credit Karma or your bank. Catches fraud early and tracks your credit score over time."
              impact="Early fraud detection"
              impactColor="green"
              chatPrompt="How do I set up credit monitoring?"
            />
            <ActionItem
              title="Keep emergency fund at 6 months"
              tag="SAVINGS"
              description="Your emergency fund is your insurance against new debt. Keep it topped up."
              impact="Debt prevention buffer"
              impactColor="green"
              chatPrompt="How much should I keep in my emergency fund?"
            />
          </div>
        </Section>
      </motion.div>

      {/* Interest saved */}
      <motion.div {...fadeUp(0.16)}>
        <div className="glass-card p-5 text-center">
          <div className="text-2xl font-bold text-success mb-1">$0</div>
          <p className="text-sm text-text-secondary">
            in interest payments — every dollar stays in your pocket.
          </p>
        </div>
      </motion.div>
    </>
  );
}

/* ─── Shared Components ─── */

function StatRow({
  label,
  value,
  valueClass = '',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-center py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
