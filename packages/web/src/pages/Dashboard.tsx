import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { MetricTile } from '../components/common/metric-tile';
import { ActionItem } from '../components/common/action-item';
import { Section } from '../components/common/section';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

interface BalanceEntry {
  accountId: string;
  name: string;
  type: string;
  mask: string | null;
  balance: string | null;
  available: string | null;
  currency: string;
  asOf: string | null;
}

const ACTION_ITEMS = [
  {
    title: 'Set 401(k) contribution to 4%',
    tag: 'INVEST',
    description:
      'Log into Fidelity and set your contribution rate to 4%. Your employer matches dollar-for-dollar — this is an instant 100% return.',
    impact: '+$2,080/yr free money',
    impactColor: 'green' as const,
    chatPrompt: 'How do I set up my 401(k) match?',
  },
  {
    title: 'Open & fund Roth IRA',
    tag: 'INVEST',
    description:
      'Open a Roth IRA at Vanguard or Fidelity. Invest in a 3-fund index portfolio (VTI/VXUS/BND). Contributions grow tax-free forever.',
    impact: 'Tax-free growth forever',
    impactColor: 'green' as const,
    chatPrompt: 'How do I open and fund a Roth IRA?',
  },
  {
    title: 'Check HSA eligibility',
    tag: 'TAX',
    description:
      'If you have a high-deductible health plan, you can contribute pre-tax dollars to an HSA — triple tax advantage for medical expenses.',
    impact: 'Triple tax advantage',
    impactColor: 'amber' as const,
    chatPrompt: 'Am I eligible for an HSA and how does it save on taxes?',
  },
  {
    title: 'Set up automatic monthly investment',
    tag: 'INVEST',
    description:
      'Auto-transfer a fixed amount each month to your investment account. Removes emotion from investing and builds wealth consistently.',
    impact: 'Dollar-cost averaging',
    impactColor: 'green' as const,
    chatPrompt: 'How do I set up automatic monthly investments?',
  },
  {
    title: 'Increase 401(k) pre-tax contributions',
    tag: 'TAX',
    description:
      'After maxing your Roth, bump 401(k) each raise. Target the $23,500/yr max for significant tax savings.',
    impact: 'Long-term wealth builder',
    impactColor: 'amber' as const,
    chatPrompt: 'How much should I contribute to my 401(k)?',
  },
  {
    title: 'Set up credit monitoring',
    tag: 'DEBT',
    description:
      'Free via Credit Karma or your bank. Catches fraud early and tracks your credit score over time.',
    impact: 'Early fraud detection',
    impactColor: 'green' as const,
    chatPrompt: 'How do I set up credit monitoring?',
  },
];

const ASK_PROMPTS = [
  {
    emoji: '\uD83C\uDFAF',
    text: 'What should I focus on first?',
    prompt: 'What should I focus on financially right now?',
  },
  {
    emoji: '\uD83D\uDCB0',
    text: 'Am I on track for my age?',
    prompt: 'Am I saving enough for my age?',
  },
  {
    emoji: '\uD83D\uDCC8',
    text: 'How can I grow my net worth?',
    prompt: 'What are the best ways to grow my net worth?',
  },
];

export function Dashboard() {
  const { tenant } = useAuth();
  const { setPageContext, openChat } = usePageContext();
  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [totalDebt, setTotalDebt] = useState<number>(0);
  const [emergencyFund, setEmergencyFund] = useState<number>(0);
  const [monthlySpend, setMonthlySpend] = useState<number | null>(null);
  const [runwayMonths, setRunwayMonths] = useState<number | null>(null);
  const [accountCount, setAccountCount] = useState(0);
  const [institutionCount, setInstitutionCount] = useState(0);

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as BalanceEntry[] })),
      api.getItems().catch(() => ({ items: [] })),
    ]).then(([balanceData, itemData]) => {
      const balances = balanceData.balances;

      let totalAssets = 0;
      let totalLiabilities = 0;
      let depositoryTotal = 0;
      let creditTotal = 0;

      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type === 'credit' || b.type === 'loan') {
          totalLiabilities += val;
          if (b.type === 'credit') creditTotal += val;
        } else {
          totalAssets += val;
          if (b.type === 'depository') depositoryTotal += val;
        }
      }

      if (balances.length > 0) {
        setNetWorth(totalAssets - totalLiabilities);
      }
      setTotalDebt(totalLiabilities);
      setEmergencyFund(depositoryTotal);
      setAccountCount(balances.length);

      if (creditTotal > 0) {
        setMonthlySpend(creditTotal);
        if (depositoryTotal > 0) {
          setRunwayMonths(Math.floor(depositoryTotal / creditTotal));
        }
      }

      setInstitutionCount(itemData.items.length);
    }).finally(() => setLoading(false));
  }, []);

  // Set page context for floating chat
  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'dashboard',
        pageTitle: 'Dashboard',
        description: 'Overview of financial health including net worth, accounts, and plans.',
        data: {
          netWorth,
          accountCount,
          institutionCount,
          monthlySpend,
          runwayMonths,
          totalDebt,
          emergencyFund,
        },
      });
    }
  }, [loading, netWorth, accountCount, institutionCount, monthlySpend, runwayMonths, totalDebt, emergencyFund, setPageContext]);

  const firstName = tenant?.name?.split(' ')[0] || 'there';

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-medium tracking-tight">
          {getGreeting()} <span className="capitalize">{firstName}</span>
        </h2>
      </motion.div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-muted py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : (
        <>
          {/* Metric Tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
            <MetricTile
              label="NET WORTH"
              value={netWorth !== null ? formatCurrency(netWorth) : '\u2014'}
              subtitle={netWorth !== null ? `Across ${accountCount} account${accountCount !== 1 ? 's' : ''}` : 'Link accounts to track'}
              status={netWorth !== null && netWorth > 0 ? 'success' : 'default'}
              delay={0}
            />
            {totalDebt > 0 && (
              <MetricTile
                label="TOTAL DEBT"
                value={formatCurrency(totalDebt)}
                subtitle="Active liabilities"
                status="danger"
                delay={0.04}
              />
            )}
            <MetricTile
              label="EMERGENCY FUND"
              value={emergencyFund > 0 ? formatCurrency(emergencyFund) : '\u2014'}
              subtitle={
                emergencyFund > 0 && monthlySpend
                  ? `${Math.round((emergencyFund / monthlySpend) * 10) / 10} months saved`
                  : 'Cash in depository accounts'
              }
              status={
                emergencyFund > 0 && monthlySpend && emergencyFund / monthlySpend >= 6
                  ? 'success'
                  : emergencyFund > 0
                    ? 'warning'
                    : 'default'
              }
              delay={0.08}
            />
            <MetricTile
              label="MONTHLY SPEND"
              value={monthlySpend !== null ? formatCurrency(monthlySpend) : '\u2014'}
              subtitle={monthlySpend !== null ? 'From credit card balances' : 'Link a credit card'}
              delay={0.12}
            />
            <MetricTile
              label="RUNWAY"
              value={runwayMonths !== null ? `${runwayMonths} mo` : '\u2014'}
              subtitle={runwayMonths !== null ? 'Months of expenses covered' : 'Based on cash & spending'}
              status={
                runwayMonths !== null && runwayMonths >= 6
                  ? 'success'
                  : runwayMonths !== null
                    ? 'warning'
                    : 'default'
              }
              delay={0.16}
            />
            <MetricTile
              label="LINKED ACCOUNTS"
              value={String(institutionCount)}
              subtitle={
                institutionCount > 0
                  ? `${accountCount} account${accountCount !== 1 ? 's' : ''} total`
                  : 'No accounts linked'
              }
              status={institutionCount > 0 ? 'success' : 'warning'}
              delay={0.2}
            />
          </div>

          {/* Action Items */}
          <Section title="Action Items">
            <div className="bg-bg-elevated border border-border rounded-xl px-4">
              {ACTION_ITEMS.map((item, i) => (
                <ActionItem
                  key={item.title}
                  title={item.title}
                  tag={item.tag}
                  description={item.description}
                  impact={item.impact}
                  impactColor={item.impactColor}
                  chatPrompt={item.chatPrompt}
                  defaultOpen={i === 0}
                />
              ))}
            </div>
          </Section>

          {/* Ask Lasagna — mobile only */}
          <Section title="Ask Lasagna" className="md:hidden">
            <div className="grid grid-cols-1 gap-2">
              {ASK_PROMPTS.map((p) => (
                <button
                  key={p.prompt}
                  type="button"
                  onClick={() => openChat(p.prompt)}
                  className="flex items-center gap-3 bg-bg-elevated border border-border rounded-xl px-4 py-3 text-left hover:border-accent/40 transition-colors"
                >
                  <span className="text-lg">{p.emoji}</span>
                  <span className="text-sm text-text-secondary font-medium">{p.text}</span>
                </button>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
