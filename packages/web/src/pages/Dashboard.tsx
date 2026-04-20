import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { useChatStore } from '../lib/chat-store';
import { SetupProgress, type SetupStep } from '../components/common/setup-progress';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function fmtK(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `$${Math.round(value / 1_000)}k`;
  return fmt(value);
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function getDayLabel(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

// ── brand colors ──────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  income:             'var(--lf-pos)',
  housing:            'var(--lf-sauce)',
  transportation:     'var(--lf-basil)',
  food_dining:        'var(--lf-cheese)',
  groceries:          '#D4B053',
  utilities:          'var(--lf-burgundy)',
  healthcare:         '#A68965',
  insurance:          'var(--lf-crust)',
  entertainment:      'var(--lf-noodle)',
  shopping:           '#8B6B45',
  subscriptions:      '#6B5040',
  savings_investment: 'var(--lf-pos)',
  debt_payment:       'var(--lf-sauce-deep)',
  transfer:           '#8B7E6F',
  other:              '#7A5C3F',
};

const LAYER_COLORS = [
  'var(--lf-sauce)',
  'var(--lf-cheese)',
  'var(--lf-noodle)',
  'var(--lf-basil)',
  'var(--lf-crust)',
  'var(--lf-burgundy)',
  '#A68965',
  '#7A5C3F',
];

// ── interfaces ─────────────────────────────────────────────────────────────

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

interface Insight {
  id: string;
  category: string;
  urgency: string;
  title: string;
  description: string;
  impact: string | null;
  chatPrompt: string | null;
  dismissedAt: string | null;
  actedOnAt: string | null;
}

interface PriorityStep {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  status: string;
  progress: number;
  skipped: boolean;
}

// ── health score ──────────────────────────────────────────────────────────────

function calcHealthScore(data: {
  netWorth: number | null;
  totalDebt: number;
  emergencyFundMonths: number;
  hasProfile: boolean;
  hasAccounts: boolean;
  savingsRate: number | null;
}): { score: number; grade: string; color: string } {
  let score = 0;
  if (data.netWorth !== null && data.netWorth > 0)
    score += Math.min(25, Math.floor(data.netWorth / 10_000));
  score += Math.min(25, data.emergencyFundMonths * 4);
  if (data.netWorth !== null && data.netWorth > 0) {
    const debtRatio = data.totalDebt / (data.netWorth + data.totalDebt);
    score += Math.floor((1 - debtRatio) * 25);
  } else if (data.totalDebt === 0) {
    score += 25;
  }
  if (data.hasAccounts) score += 8;
  if (data.hasProfile) score += 7;
  if (data.savingsRate !== null && data.savingsRate > 0)
    score += Math.min(10, Math.floor(data.savingsRate * 50));
  score = Math.min(100, score);

  if (score >= 80) return { score, grade: 'Excellent', color: 'var(--lf-pos)' };
  if (score >= 65) return { score, grade: 'Good', color: 'var(--lf-cheese)' };
  if (score >= 50) return { score, grade: 'Fair', color: 'var(--lf-noodle)' };
  return { score, grade: 'Needs Work', color: 'var(--lf-sauce)' };
}

// ── sub-components ────────────────────────────────────────────────────────────

function Sparkline({ data, color = 'var(--lf-cheese)', height = 140, width = 520, strokeWidth = 2 }: {
  data: Array<{ value: number }>;
  color?: string;
  height?: number;
  width?: number;
  strokeWidth?: number;
}) {
  const values = data.map(d => d.value);
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - ((v - min) / range) * height,
  ]);
  const d = 'M ' + pts.map(p => p.join(',')).join(' L ');
  const dFill = d + ` L ${width},${height} L 0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={dFill} fill="url(#sparkGrad)" />
      <path d={d} stroke={color} strokeWidth={strokeWidth} fill="none" />
    </svg>
  );
}

function MiniCard({ label, value, sub, accent }: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div style={{ background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {accent && <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, display: 'inline-block', flexShrink: 0 }} />}
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
          {label}
        </div>
      </div>
      <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 32, letterSpacing: '-0.025em', lineHeight: 1.05, marginTop: 10 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-muted)', marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--lf-rule)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function DonutMini({ cats, totalLabel }: {
  cats: Array<{ name: string; total: number; color: string }>;
  totalLabel: string;
}) {
  const total = cats.reduce((s, c) => s + c.total, 0) || 1;
  const r = 34, R = 52, cx = 60, cy = 60;
  let a0 = -Math.PI / 2;
  const paths = cats.slice(0, 8).map(c => {
    const frac = c.total / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
    const x3 = cx + r * Math.cos(a0), y3 = cy + r * Math.sin(a0);
    const d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return { d, color: c.color };
  });
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} />)}
      <text x="60" y="58" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="15" fill="var(--lf-ink)">{totalLabel}</text>
      <text x="60" y="72" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="var(--lf-muted)">monthly</text>
    </svg>
  );
}

function HealthRing({ score, color }: { score: number; color: string }) {
  const R = 36, C = 2 * Math.PI * R;
  const off = C * (1 - score / 100);
  return (
    <svg width="90" height="90" viewBox="0 0 90 90">
      <circle cx="45" cy="45" r={R} stroke="var(--lf-cream)" strokeWidth="6" fill="none" />
      <circle cx="45" cy="45" r={R} stroke={color} strokeWidth="6" fill="none"
        strokeDasharray={C} strokeDashoffset={off} strokeLinecap="round"
        transform="rotate(-90 45 45)" style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x="45" y="50" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="22" fill="var(--lf-ink)">{score}</text>
    </svg>
  );
}

function LayersCompact({ steps }: { steps: PriorityStep[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8 }}>
      {steps.slice(0, 6).map((step, i) => {
        const color = LAYER_COLORS[i] || '#7A5C3F';
        const lightText = i === 2 || i === 3;
        return (
          <div key={step.id} style={{
            background: color,
            color: lightText ? 'var(--lf-ink)' : 'var(--lf-paper)',
            padding: '10px 14px',
            borderRadius: 10,
            marginLeft: `${i * 3}%`,
            marginRight: `${(Math.min(steps.length, 6) - 1 - i) * 2}%`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 13,
            boxShadow: '0 6px 12px -8px rgba(0,0,0,0.3)',
            opacity: step.status === 'queued' || step.skipped ? 0.5 : 1,
          }}>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, opacity: 0.7 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ fontWeight: 500 }}>{step.title}</span>
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              {step.progress}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ActionsCard({ insights, totalCount, navigate }: {
  insights: Insight[];
  totalCount: number;
  navigate: (path: string) => void;
}) {
  const urgColor = (u: string) => {
    if (u === 'critical' || u === 'high') return 'var(--lf-sauce)';
    if (u === 'medium') return 'var(--lf-cheese)';
    return 'var(--lf-basil)';
  };
  const active = insights.filter(i => !i.dismissedAt);
  const shown = active.slice(0, 5);
  return (
    <div style={{ background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)', borderRadius: 14, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
            Today's actions · AI-generated
          </div>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, marginTop: 4 }}>
            Prioritized by urgency.
          </div>
        </div>
        <button
          onClick={() => navigate('/insights')}
          style={{ fontSize: 12, color: 'var(--lf-sauce)', fontFamily: "'JetBrains Mono', monospace", background: 'none', border: 0, cursor: 'pointer' }}
        >
          all {totalCount} →
        </button>
      </div>
      {shown.length === 0 ? (
        <div style={{ color: 'var(--lf-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
          No actions yet.
          <br />
          <button
            onClick={() => navigate('/insights')}
            style={{ color: 'var(--lf-sauce)', background: 'none', border: 0, cursor: 'pointer', fontSize: 13, marginTop: 8 }}
          >
            Generate insights →
          </button>
        </div>
      ) : (
        shown.map((a, i) => (
          <div key={a.id} style={{
            display: 'grid', gridTemplateColumns: '12px 1fr auto',
            gap: 14, alignItems: 'center',
            padding: '12px 0',
            borderBottom: i < shown.length - 1 ? '1px solid var(--lf-rule)' : 0,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: urgColor(a.urgency) }} />
            <div style={{ fontSize: 14, fontWeight: 500 }}>{a.title}</div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--lf-cream)', color: 'var(--lf-ink-soft)',
              textTransform: 'capitalize' as const, whiteSpace: 'nowrap' as const,
            }}>
              {a.category}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { tenant } = useAuth();
  const { setPageContext } = usePageContext();
  const { openChat } = useChatStore();
  const [, navigate] = useLocation();

  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [netWorthChange, setNetWorthChange] = useState<number | null>(null);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalLiabilities, setTotalLiabilities] = useState(0);
  const [totalDebt, setTotalDebt] = useState(0);
  const [emergencyFund, setEmergencyFund] = useState(0);
  const [monthlySpend, _setMonthlySpend] = useState<number | null>(null);
  const [runwayMonths, setRunwayMonths] = useState<number | null>(null);
  const [accountCount, setAccountCount] = useState(0);
  const [institutionCount, setInstitutionCount] = useState(0);
  const [debtFreeDate, setDebtFreeDate] = useState<string | null>(null);
  const [setupSteps, setSetupSteps] = useState<SetupStep[]>([]);
  const [nwHistory, setNwHistory] = useState<Array<{ date: string; value: number }>>([]);
  const [spendingCategories, setSpendingCategories] = useState<Array<{ category: string; total: number; count: number; percentage: number }>>([]);
  const [totalSpending, setTotalSpending] = useState(0);
  const [totalIncome, setTotalIncome] = useState(0);
  const [goals, setGoals] = useState<Array<{ id: string; name: string; targetAmount: string; currentAmount: string; deadline: string | null; category: string; status: string; icon: string | null }>>([]);
  const [healthScore, setHealthScore] = useState<{ score: number; grade: string; color: string } | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [prioritySteps, setPrioritySteps] = useState<PriorityStep[]>([]);
  const [hasPlaidAccounts, setHasPlaidAccounts] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as BalanceEntry[] })),
      api.getItems().catch(() => ({ items: [] as Array<{ id: string; institutionId: string | null }> })),
      api.getDebts().catch(() => ({ debts: [] as Array<{ id: string; name: string; balance: number; interestRate: number | null; minimumPayment: number }>, totalDebt: 0, monthlyInterest: 0 })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getNetWorthHistory().catch(() => ({ history: [] as Array<{ date: string; value: number }> })),
      api.getPlans().catch(() => ({ plans: [] as Array<{ id: string }> })),
      api.getSpendingSummary().catch(() => ({ categories: [], totalSpending: 0, totalIncome: 0, netCashFlow: 0, period: { start: '', end: '' } })),
      api.getGoals().catch(() => ({ goals: [] })),
      api.getInsights().catch(() => ({ insights: [] })),
      api.getPriorities().catch(() => ({ steps: [], currentStepId: '', summary: {} })),
    ]).then(([balanceData, itemData, debtData, profileData, historyData, plansData, spendingData, goalsData, insightsData, prioritiesData]) => {
      const onboardingDone = localStorage.getItem('lasagna_onboarding_done');
      if (balanceData.balances.length === 0 && !profileData.financialProfile && !onboardingDone) {
        navigate('/onboarding', { replace: true });
        return;
      }

      const balances = balanceData.balances;
      let assets = 0, liabilities = 0, depository = 0, creditTotal = 0;

      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type === 'credit' || b.type === 'loan') {
          liabilities += val;
          if (b.type === 'credit') creditTotal += val;
        } else {
          assets += val;
          if (b.type === 'depository') depository += val;
        }
      }

      setTotalAssets(assets);
      setTotalLiabilities(liabilities);
      if (balances.length > 0) setNetWorth(assets - liabilities);
      setTotalDebt(liabilities);
      setEmergencyFund(depository);
      setAccountCount(balances.length);

      const realPlaidItems = itemData.items.filter(item => item.institutionId && item.institutionId !== 'manual');
      setHasPlaidAccounts(realPlaidItems.length > 0);
      setInstitutionCount(itemData.items.length);

      const nwHist = historyData.history;
      setNwHistory(nwHist);
      if (nwHist.length >= 2) {
        setNetWorthChange(nwHist[nwHist.length - 1].value - nwHist[nwHist.length - 2].value);
      }

      const profile = profileData.financialProfile;
      const profileExists = profile !== null && profile !== undefined;
      const hasProfile = profileExists && profile.annualIncome !== null;

      const spendCats = spendingData.categories.filter((c: { category: string }) => c.category !== 'income');
      setSpendingCategories(spendCats);
      setTotalSpending(spendingData.totalSpending);
      setTotalIncome(spendingData.totalIncome);

      // Runway months
      if (depository > 0 && spendingData.totalSpending > 0) {
        setRunwayMonths(depository / spendingData.totalSpending);
      }

      setGoals(goalsData.goals);

      // Debt-free date
      const debtsForCalc = debtData.debts;
      const totalDebtAmt = debtData.totalDebt;
      if (totalDebtAmt > 0 && debtsForCalc.length > 0) {
        const totalMin = debtsForCalc.reduce((s: number, d: { minimumPayment: number }) => s + (d.minimumPayment || 0), 0);
        let weightedApr = 0, totalBal = 0;
        for (const d of debtsForCalc) {
          const apr = d.interestRate ?? 0;
          weightedApr += apr * d.balance;
          totalBal += d.balance;
        }
        const avgApr = totalBal > 0 ? weightedApr / totalBal : 0;
        const monthlyRate = avgApr / 100 / 12;
        if (totalMin > 0) {
          let months: number;
          if (monthlyRate > 0 && totalMin > totalDebtAmt * monthlyRate) {
            months = Math.ceil(-Math.log(1 - (totalDebtAmt * monthlyRate) / totalMin) / Math.log(1 + monthlyRate));
          } else if (monthlyRate === 0) {
            months = Math.ceil(totalDebtAmt / totalMin);
          } else {
            months = -1;
          }
          if (months > 0) {
            const target = new Date();
            target.setMonth(target.getMonth() + months);
            const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            setDebtFreeDate(`${mn[target.getMonth()]} ${target.getFullYear()}`);
          }
        }
      }

      // Health score
      const emergencyMonths = creditTotal > 0 ? depository / creditTotal : (depository > 0 ? 12 : 0);
      const savingsRate = spendingData.totalIncome > 0 ? (spendingData.totalIncome - spendingData.totalSpending) / spendingData.totalIncome : null;
      setHealthScore(calcHealthScore({
        netWorth: assets - liabilities,
        totalDebt: liabilities,
        emergencyFundMonths: emergencyMonths,
        hasProfile: profileExists && profile.annualIncome !== null,
        hasAccounts: itemData.items.length > 0,
        savingsRate,
      }));

      // Setup steps
      const hasLinked = itemData.items.length > 0;
      const hasProfileBasics = profileExists && profile.age !== null && profile.annualIncome !== null;
      setSetupSteps([
        { id: 'link-account', label: 'Link a bank account', description: 'Connect your bank to see balances and transactions', completed: hasLinked, action: '/accounts' },
        { id: 'complete-profile', label: 'Complete your profile', description: 'Add your age and income for personalized advice', completed: hasProfileBasics, action: '/profile' },
        { id: 'set-income', label: 'Set income & employment', description: 'Help us understand your earnings', completed: profileExists && profile.annualIncome !== null, action: '/profile' },
        { id: 'set-filing-status', label: 'Set filing status', description: 'Used for tax optimization recommendations', completed: profileExists && profile.filingStatus !== null, action: '/profile' },
        { id: 'set-risk-tolerance', label: 'Set risk tolerance', description: 'Tailor investment recommendations to your comfort', completed: profileExists && profile.riskTolerance !== null, action: '/profile' },
        { id: 'set-employer-match', label: 'Set employer match', description: 'Maximize your 401(k) contributions', completed: profileExists && profile.employerMatchPercent !== null, action: '/profile' },
        { id: 'review-plan', label: 'Review your financial plan', description: 'Generate a personalized financial plan', completed: plansData.plans.length > 0, action: '/plans' },
      ]);

      setInsights((insightsData.insights || []) as Insight[]);
      setPrioritySteps((prioritiesData.steps || []).slice(0, 6));
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'dashboard',
        pageTitle: 'Dashboard',
        description: 'Overview of financial health including net worth, accounts, and plans.',
        data: { netWorth, netWorthChange, accountCount, institutionCount, totalSpending, totalIncome, totalDebt, emergencyFund, debtFreeDate },
      });
    }
  }, [loading, netWorth, netWorthChange, accountCount, institutionCount, totalSpending, totalIncome, totalDebt, emergencyFund, debtFreeDate, setPageContext]);

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'there' : (rawName.split(' ')[0] || 'there');
  const completedSteps = setupSteps.filter(s => s.completed).length;
  const allSetupComplete = completedSteps === setupSteps.length;

  const savingsRate = totalIncome > 0 ? Math.round((1 - totalSpending / totalIncome) * 100) : null;

  const nwChangeSign = netWorthChange !== null ? (netWorthChange >= 0 ? '+' : '') : '';
  const nwChangePct = (netWorthChange !== null && netWorth !== null && netWorth !== 0)
    ? ` · ${nwChangeSign}${((netWorthChange / Math.abs(netWorth - netWorthChange)) * 100).toFixed(1)}% MoM`
    : '';

  const spendCatsForDonut = useMemo(() =>
    spendingCategories.map(c => ({
      name: c.category,
      total: c.total,
      color: CAT_COLORS[c.category] || '#7A5C3F',
    })),
    [spendingCategories]
  );

  const urgentCount = insights.filter(i => !i.dismissedAt && (i.urgency === 'critical' || i.urgency === 'high')).length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '80px 40px', color: 'var(--lf-muted)' }}>
        <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto' }}>

      {/* Setup progress — only if incomplete */}
      {!allSetupComplete && (
        <div style={{ marginBottom: 24 }}>
          <SetupProgress steps={setupSteps} />
        </div>
      )}

      {/* Link accounts nudge */}
      {!hasPlaidAccounts && accountCount > 0 && (
        <div style={{
          marginBottom: 20, background: 'rgba(201,84,58,0.06)',
          border: '1px solid rgba(201,84,58,0.2)', borderRadius: 14,
          padding: '14px 20px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>Link your bank for automatic updates</div>
            <div style={{ color: 'var(--lf-muted)', fontSize: 13, marginTop: 2 }}>Your balances are manual snapshots. Connect via Plaid for real-time tracking.</div>
          </div>
          <button
            onClick={() => navigate('/accounts')}
            style={{ padding: '8px 16px', background: 'var(--lf-sauce)', color: 'var(--lf-paper)', border: 0, borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
          >
            Link Account
          </button>
        </div>
      )}

      {/* PageHeader */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, flexWrap: 'wrap' as const, gap: 16 }}
      >
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
            Good {getGreeting()}, {firstName} · {getDayLabel()}
            {urgentCount > 0 && ` · ${urgentCount} urgent`}
          </div>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 44, letterSpacing: '-0.02em', marginTop: 6, lineHeight: 1.05, fontWeight: 400 }}>
            Your{' '}
            <em style={{ fontStyle: 'italic', color: 'var(--lf-sauce)' }}>layers today.</em>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate('/accounts')}
            style={{ padding: '10px 18px', borderRadius: 999, border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)', color: 'var(--lf-ink)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            Sync
          </button>
          <button
            onClick={() => openChat('What should I focus on financially right now?')}
            style={{ padding: '10px 18px', borderRadius: 999, border: '1px solid var(--lf-ink)', background: 'var(--lf-ink)', color: 'var(--lf-paper)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            Ask LasagnaFi →
          </button>
        </div>
      </motion.div>

      {/* Hero — Net Worth */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        style={{
          background: 'var(--lf-ink)', color: 'var(--lf-paper)',
          borderRadius: 14, padding: 40, marginBottom: 20,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-cheese)' }}>
              Net Worth · live
            </div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 88, lineHeight: 0.95, letterSpacing: '-0.03em', marginTop: 10 }}>
              {netWorth !== null ? fmtK(netWorth) : '—'}
            </div>
            {netWorthChange !== null && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-cheese)', marginTop: 10 }}>
                {netWorthChange >= 0 ? '▲' : '▼'} {fmt(Math.abs(netWorthChange))}{nwChangePct}
              </div>
            )}
            <div style={{ display: 'flex', gap: 24, marginTop: 24, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#D4C6B0' }}>
              {totalAssets > 0 && <span>ASSETS · {fmtK(totalAssets)}</span>}
              {totalLiabilities > 0 && <span>LIABILITIES · {fmtK(totalLiabilities)}</span>}
              {healthScore && <span>HEALTH · {healthScore.score}/100</span>}
            </div>
          </div>
          <div style={{ overflow: 'hidden' }}>
            {nwHistory.length > 1 ? (
              <Sparkline data={nwHistory} color="var(--lf-cheese)" width={480} height={130} strokeWidth={2} />
            ) : (
              <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D4C6B0', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                Link accounts to see history
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* 4 Mini Cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}
      >
        <MiniCard
          label="Emergency fund"
          value={emergencyFund > 0 ? fmtK(emergencyFund) : '—'}
          sub={runwayMonths !== null ? `${runwayMonths.toFixed(1)} mo runway` : 'Cash in depository'}
          accent="var(--lf-basil)"
        />
        <MiniCard
          label="Monthly income"
          value={totalIncome > 0 ? fmtK(totalIncome) : '—'}
          sub={savingsRate !== null && savingsRate > 0 ? `${savingsRate}% savings rate` : 'net after tax'}
          accent="var(--lf-cheese)"
        />
        <MiniCard
          label="Monthly spend"
          value={totalSpending > 0 ? fmtK(totalSpending) : '—'}
          sub={spendingCategories.length > 0 ? `${spendingCategories.length} categories` : 'Link accounts to track'}
          accent="var(--lf-sauce)"
        />
        <MiniCard
          label="Total debt"
          value={totalDebt > 0 ? fmtK(totalDebt) : '$0'}
          sub={debtFreeDate ? `debt-free by ${debtFreeDate}` : (totalDebt > 0 ? 'active liabilities' : 'debt-free!')}
          accent="var(--lf-burgundy)"
        />
      </motion.div>

      {/* Layers + Actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 20, marginBottom: 20 }}
      >
        <div style={{ background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)', borderRadius: 14, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
                Your priorities
              </div>
              <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, marginTop: 4 }}>
                The lasagna, top-down.
              </div>
            </div>
            <button
              onClick={() => navigate('/priorities')}
              style={{ fontSize: 12, color: 'var(--lf-sauce)', fontFamily: "'JetBrains Mono', monospace", background: 'none', border: 0, cursor: 'pointer' }}
            >
              open →
            </button>
          </div>
          {prioritySteps.length > 0 ? (
            <LayersCompact steps={prioritySteps} />
          ) : (
            <div style={{ color: 'var(--lf-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              Complete your profile to see priorities.
            </div>
          )}
        </div>

        <ActionsCard
          insights={insights}
          totalCount={insights.filter(i => !i.dismissedAt).length}
          navigate={navigate}
        />
      </motion.div>

      {/* Spend Donut + Goals + Health */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}
      >
        {/* Spend Donut */}
        <div style={{ background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)', borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
              Monthly spend · by category
            </div>
            <button onClick={() => navigate('/spending')} style={{ fontSize: 12, color: 'var(--lf-sauce)', fontFamily: "'JetBrains Mono', monospace", background: 'none', border: 0, cursor: 'pointer' }}>
              details →
            </button>
          </div>
          {spendCatsForDonut.length > 0 ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <DonutMini cats={spendCatsForDonut} totalLabel={totalSpending > 0 ? fmtK(totalSpending) : '$0'} />
              <div style={{ flex: 1 }}>
                {spendCatsForDonut.slice(0, 4).map((c, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '8px 1fr auto', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                    <span style={{ color: 'var(--lf-ink-soft)', textTransform: 'capitalize' as const }}>{c.name.replace('_', ' ')}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                      {totalSpending > 0 ? Math.round((c.total / totalSpending) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--lf-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No spending data yet.
            </div>
          )}
        </div>

        {/* Goals */}
        <div style={{ background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)', borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
              Goals · top 3
            </div>
            <button onClick={() => navigate('/goals')} style={{ fontSize: 12, color: 'var(--lf-sauce)', fontFamily: "'JetBrains Mono', monospace", background: 'none', border: 0, cursor: 'pointer' }}>
              {goals.length > 0 ? 'all →' : 'set goals →'}
            </button>
          </div>
          {goals.length > 0 ? (
            <div>
              {goals.slice(0, 3).map((g, i) => {
                const target = parseFloat(g.targetAmount);
                const current = parseFloat(g.currentAmount);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                const color = pct >= 100 ? 'var(--lf-basil)' : pct >= 50 ? 'var(--lf-cheese)' : 'var(--lf-sauce)';
                return (
                  <div key={g.id} style={{ padding: '8px 0', borderBottom: i < 2 ? '1px dashed var(--lf-rule)' : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                      <span>{g.icon || '⊙'} {g.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--lf-muted)' }}>{Math.round(pct)}%</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--lf-cream)', borderRadius: 2 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: 'var(--lf-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No goals set yet.
            </div>
          )}
        </div>

        {/* Financial Health */}
        <div style={{ background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)', borderRadius: 14, padding: 20 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)', marginBottom: 12 }}>
            Financial health
          </div>
          {healthScore ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <HealthRing score={healthScore.score} color={healthScore.color} />
              <div style={{ flex: 1, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-muted)', lineHeight: 1.8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Cash</span>
                  <span style={{ color: emergencyFund > 0 && runwayMonths !== null && runwayMonths >= 6 ? 'var(--lf-pos)' : 'var(--lf-cheese)' }}>
                    {emergencyFund > 0 && runwayMonths !== null && runwayMonths >= 6 ? 'strong' : emergencyFund > 0 ? 'fair' : '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Debt</span>
                  <span style={{ color: totalDebt === 0 ? 'var(--lf-pos)' : totalDebt < 5000 ? 'var(--lf-cheese)' : 'var(--lf-sauce)' }}>
                    {totalDebt === 0 ? 'none' : totalDebt < 5000 ? 'fair' : 'high'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Savings</span>
                  <span style={{ color: savingsRate !== null && savingsRate >= 20 ? 'var(--lf-pos)' : savingsRate !== null && savingsRate > 0 ? 'var(--lf-cheese)' : 'var(--lf-muted)' }}>
                    {savingsRate !== null ? `${savingsRate}%` : '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Grade</span>
                  <span style={{ color: healthScore.color }}>{healthScore.grade}</span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--lf-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              Add accounts to calculate score.
            </div>
          )}
        </div>
      </motion.div>

      {/* Mobile ask prompts */}
      <div className="md:hidden" style={{ marginTop: 20 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)', marginBottom: 12 }}>
          Ask LasagnaFi
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            'What should I focus on financially right now?',
            'Am I saving enough for my age?',
            'How can I grow my net worth?',
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => openChat(prompt)}
              style={{
                padding: '12px 16px', background: 'var(--lf-paper)',
                border: '1px solid var(--lf-rule)', borderRadius: 12,
                textAlign: 'left', cursor: 'pointer', fontSize: 13,
                color: 'var(--lf-ink-soft)',
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
