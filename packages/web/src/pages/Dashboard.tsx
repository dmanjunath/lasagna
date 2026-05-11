import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { useChatStore } from '../lib/chat-store';
import { formatMoney } from '../lib/utils';
import { SetupProgress, type SetupStep } from '../components/common/setup-progress';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function fmtK(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return fmt(value);
}

function fmtNetWorth(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}k`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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
  score = Math.min(100, Math.round(score));

  if (score >= 80) return { score, grade: 'Excellent', color: 'var(--lf-pos)' };
  if (score >= 65) return { score, grade: 'Good', color: 'var(--lf-cheese)' };
  if (score >= 50) return { score, grade: 'Fair', color: 'var(--lf-noodle)' };
  return { score, grade: 'Needs Work', color: 'var(--lf-sauce)' };
}

// ── sub-components ────────────────────────────────────────────────────────────

function Sparkline({ data, color = 'var(--lf-cheese)', height = 130, strokeWidth = 2 }: {
  data: Array<{ value: number; date?: string }>;
  color?: string;
  height?: number;
  strokeWidth?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(480);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgWidth(el.clientWidth || 480));
    ro.observe(el);
    setSvgWidth(el.clientWidth || 480);
    return () => ro.disconnect();
  }, []);

  const values = data.map(d => d.value);
  const dates = data.map(d => (d as { value: number; date?: string }).date || '');
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;

  const PL = 62, PB = 24, PT = 6, PR = 8;
  const W = svgWidth;
  const H = height + PT + PB;
  const PW = W - PL - PR;

  const pts = values.map((v, i) => [
    PL + (i / Math.max(values.length - 1, 1)) * PW,
    PT + height - ((v - min) / range) * height,
  ]);
  const pathD = 'M ' + pts.map(p => p.join(',')).join(' L ');
  const fillD = pathD + ` L ${PL + PW},${PT + height} L ${PL},${PT + height} Z`;

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const plotX = svgX - PL;
    const idx = Math.round((plotX / PW) * (values.length - 1));
    setHoverIdx(Math.max(0, Math.min(values.length - 1, idx)));
  }, [values.length, PW]);

  const fmtV = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`;

  const hx = hoverIdx !== null ? pts[hoverIdx][0] : null;
  const hy = hoverIdx !== null ? pts[hoverIdx][1] : null;
  const hv = hoverIdx !== null ? values[hoverIdx] : null;
  const hd = hoverIdx !== null && dates[hoverIdx] ? new Date(dates[hoverIdx]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const mid = (max + min) / 2;

  const firstDateStr = dates[0] ? new Date(dates[0]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
  const lastDateStr = dates[dates.length - 1] ? new Date(dates[dates.length - 1]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';

  const axisColor = '#D4C6B0';

  return (
    <div ref={wrapperRef} style={{ width: '100%' }}>
      <svg width={W} height={H} style={{ display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        <line x1={PL} y1={PT} x2={PL + PW} y2={PT} stroke={axisColor} strokeWidth={0.5} opacity={0.2} />
        <line x1={PL} y1={PT + height / 2} x2={PL + PW} y2={PT + height / 2} stroke={axisColor} strokeWidth={0.5} opacity={0.12} strokeDasharray="4 4" />
        <line x1={PL} y1={PT + height} x2={PL + PW} y2={PT + height} stroke={axisColor} strokeWidth={0.5} opacity={0.2} />
        {/* Y-axis labels — 13px actual pixels, matching hero sub-label color */}
        <text x={PL - 6} y={PT + 5} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor} opacity={0.75}>{fmtV(max)}</text>
        <text x={PL - 6} y={PT + height / 2 + 5} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor} opacity={0.5}>{fmtV(mid)}</text>
        <text x={PL - 6} y={PT + height + 5} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor} opacity={0.75}>{fmtV(min)}</text>
        {/* Chart */}
        <path d={fillD} fill="url(#sparkGrad)" />
        <path d={pathD} stroke={color} strokeWidth={strokeWidth} fill="none" />
        {/* Hover */}
        {hx !== null && hy !== null && hv !== null && (
          <g>
            <line x1={hx} x2={hx} y1={PT} y2={PT + height} stroke={color} strokeWidth={1} opacity={0.4} />
            <circle cx={hx} cy={hy} r={4} fill={color} />
            <rect x={Math.max(PL, Math.min(hx - 56, PL + PW - 120))} y={Math.max(PT, hy - 42)} width={120} height={38} rx={4} fill="rgba(0,0,0,0.8)" />
            {hd && (
              <text x={Math.max(PL, Math.min(hx - 56, PL + PW - 120)) + 8} y={Math.max(PT, hy - 42) + 14} fontFamily="'JetBrains Mono', monospace" fontSize={11} fill={axisColor} opacity={0.65}>
                {hd}
              </text>
            )}
            <text x={Math.max(PL, Math.min(hx - 56, PL + PW - 120)) + 8} y={Math.max(PT, hy - 42) + 30} fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor}>
              {fmtV(hv)}
            </text>
          </g>
        )}
        {/* X-axis labels */}
        {firstDateStr && <text x={PL} y={H - 4} textAnchor="start" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor} opacity={0.6}>{firstDateStr}</text>}
        {lastDateStr && <text x={PL + PW} y={H - 4} textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize={13} fill={axisColor} opacity={0.6}>{lastDateStr}</text>}
      </svg>
    </div>
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
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
          {label}
        </div>
      </div>
      <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 32, letterSpacing: '-0.025em', lineHeight: 1.05, marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)', marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--lf-rule)' }}>
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
  const [hovered, setHovered] = useState<number | null>(null);
  const total = cats.reduce((s, c) => s + c.total, 0) || 1;
  const r = 34, R = 52, cx = 60, cy = 60;
  let a0 = -Math.PI / 2;
  const slicedCats = cats.slice(0, 8);
  const paths = slicedCats.map((c, idx) => {
    const frac = c.total / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
    const x3 = cx + r * Math.cos(a0), y3 = cy + r * Math.sin(a0);
    const d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return { d, color: c.color, name: c.name, pct: Math.round(frac * 100), idx };
  });
  const hp = hovered !== null ? paths[hovered] : null;
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ cursor: 'pointer' }}>
      {paths.map((p) => (
        <path key={p.idx} d={p.d} fill={p.color}
          opacity={hovered === null ? 1 : hovered === p.idx ? 1 : 0.4}
          style={{ transition: 'opacity 0.15s' }}
          onMouseEnter={() => setHovered(p.idx)}
          onMouseLeave={() => setHovered(null)}
          onTouchStart={() => setHovered(hovered === p.idx ? null : p.idx)}
        />
      ))}
      {hp ? (
        <>
          <text x="60" y="54" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="9" fill="var(--lf-muted)">{hp.name.slice(0, 10)}</text>
          <text x="60" y="66" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="14" fill="var(--lf-ink)">{hp.pct}%</text>
        </>
      ) : (
        <>
          <text x="60" y="58" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="15" fill="var(--lf-ink)">{totalLabel}</text>
          <text x="60" y="72" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="var(--lf-muted)">monthly</text>
        </>
      )}
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
      const balances = balanceData.balances;
      let assets = 0, liabilities = 0, depository = 0, creditTotal = 0;

      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type === 'credit' || b.type === 'loan') {
          liabilities += Math.abs(val);
          if (b.type === 'credit') creditTotal += Math.abs(val);
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

      const spendCats = spendingData.categories.filter((c: { category: string }) => c.category !== 'income' && c.category !== 'transfer');
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
      setSetupSteps([
        { id: 'link-account', label: 'Link a bank account', description: 'Connect your bank to see balances and transactions', completed: hasLinked, action: '/accounts' },
        { id: 'set-income', label: 'Set annual income', description: 'Help us understand your earnings', completed: profileExists && profile.annualIncome !== null, action: '/profile' },
        { id: 'set-filing-status', label: 'Set filing status', description: 'Used for tax optimization recommendations', completed: profileExists && profile.filingStatus !== null, action: '/profile' },
        { id: 'set-risk-tolerance', label: 'Set risk tolerance', description: 'Tailor investment recommendations to your comfort', completed: profileExists && profile.riskTolerance !== null, action: '/profile' },
        { id: 'set-employer-match', label: 'Set employer match', description: 'Maximize your 401(k) contributions', completed: profileExists && profile.employerMatchPercent !== null, action: '/profile' },
        { id: 'create-goal', label: 'Create a financial goal', description: 'Set a target to work toward', completed: goalsData.goals.length > 0, action: '/goals' },
      ]);

      setInsights((insightsData.insights || []) as Insight[]);
      setPrioritySteps(prioritiesData.steps || []);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'dashboard',
        pageTitle: 'Dashboard',
        description: 'Overview of financial health including net worth, accounts, and plans.',
      });
    }
  }, [loading, setPageContext]);

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

  if (loading) return null;

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 40px)', paddingBottom: 'clamp(80px, 10vw, 48px)', maxWidth: 1400, margin: '0 auto' }}>
      <style>{`
        @media (max-width: 800px) {
          .dash-hero-grid { grid-template-columns: 1fr !important; }
          .dash-mini-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .dash-bottom-grid { grid-template-columns: 1fr !important; }
          .dash-layers-grid { grid-template-columns: 1fr !important; }
          .dash-banner { flex-direction: column !important; }
          .dash-banner > div { border-right: none !important; border-bottom: 1px solid var(--lf-rule); }
          .dash-banner > div:last-child { border-bottom: none !important; }
        }
        @media (max-width: 640px) {
          .dash-hero-grid { grid-template-columns: 1fr !important; }
          .dash-mini-grid { grid-template-columns: 1fr !important; }
          .dash-bottom-grid { grid-template-columns: 1fr !important; }
          .dash-layers-grid { grid-template-columns: 1fr !important; }
          .dash-banner-actions { flex-direction: column !important; gap: 8px !important; align-items: flex-start !important; }
          .dash-banner-actions > div { border-left: none !important; padding-left: 0 !important; }
        }
      `}</style>

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
            style={{ padding: '8px 16px', background: 'var(--lf-sauce)', color: 'var(--lf-paper)', border: 0, borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
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
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, lineHeight: 1.1, fontWeight: 400, margin: 0 }}>
            Dashboard
          </h1>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)', marginTop: 6 }}>
            Good {getGreeting()}, {firstName} · {getDayLabel()}
            {urgentCount > 0 && ` · ${urgentCount} urgent`}
          </div>
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
            Walk me through this →
          </button>
        </div>
      </motion.div>

      {/* Financial Level Banner */}
      {(prioritySteps.length > 0 || insights.filter(i => !i.dismissedAt).length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.35 }}
          style={{
            display: 'flex', alignItems: 'stretch', gap: 0,
            background: 'var(--lf-cream)', border: '1px solid var(--lf-rule)',
            borderRadius: 14, marginBottom: 20, overflow: 'hidden',
          }}
          className="dash-banner"
        >
          {/* Level indicator */}
          {prioritySteps.length > 0 && (() => {
            const currentStep = prioritySteps.find(s => s.status !== 'complete' && !s.skipped) || prioritySteps[0];
            const currentLevel = currentStep.order;
            return (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px',
                  borderRight: '1px solid var(--lf-rule)',
                  flex: '0 0 auto',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: LAYER_COLORS[Math.min(currentLevel - 1, LAYER_COLORS.length - 1)] || 'var(--lf-sauce)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 15,
                  color: 'var(--lf-paper)', fontWeight: 600, flexShrink: 0,
                }}>
                  {currentLevel}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
                    Level {currentLevel} · Current focus
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--lf-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentStep.title}
                  </div>
                  <button
                    onClick={() => navigate('/financial-level')}
                    style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-sauce)', background: 'none', border: 0, cursor: 'pointer', padding: 0, marginTop: 2 }}
                  >
                    View my level →
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Weekly actions */}
          {(() => {
            const weekActions = insights
              .filter(i => !i.dismissedAt)
              .sort((a, b) => {
                const urgRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
                return (urgRank[a.urgency] ?? 4) - (urgRank[b.urgency] ?? 4);
              })
              .slice(0, 2);
            if (weekActions.length === 0) return null;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 20px', flex: 1, minWidth: 0, overflow: 'hidden' }} className="dash-banner-actions">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span
                    style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)', flexShrink: 0 }}
                  >
                    This week
                  </span>
                  {weekActions.map((a, i) => (
                    <div
                      key={a.id}
                      onClick={() => navigate('/insights')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 13, color: 'var(--lf-ink-soft)', minWidth: 0, cursor: 'pointer',
                        ...(i > 0 ? { borderLeft: '1px solid var(--lf-rule)', paddingLeft: 16 } : {}),
                      }}
                    >
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: a.urgency === 'critical' || a.urgency === 'high' ? 'var(--lf-sauce)' : a.urgency === 'medium' ? 'var(--lf-cheese)' : 'var(--lf-basil)',
                      }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.title}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => navigate('/insights')}
                  style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-sauce)', background: 'none', border: 0, cursor: 'pointer', padding: 0, alignSelf: 'flex-start' }}
                >
                  View actions →
                </button>
              </div>
            );
          })()}
        </motion.div>
      )}

      {/* Hero — Net Worth */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        style={{
          background: 'var(--lf-ink)', color: 'var(--lf-paper)',
          borderRadius: 14, padding: 'clamp(20px, 4vw, 40px)', marginBottom: 20,
        }}
      >
        <div className="dash-hero-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 40, alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-cheese)' }}>
              Net Worth · live
            </div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 'clamp(48px, 10vw, 88px)', lineHeight: 0.95, letterSpacing: '-0.03em', marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {netWorth !== null ? formatMoney(netWorth, true) : '—'}
            </div>
            {netWorthChange !== null && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-cheese)', marginTop: 10 }}>
                {netWorthChange >= 0 ? '▲' : '▼'} {fmt(Math.abs(netWorthChange))}{nwChangePct}
              </div>
            )}
            <div style={{ display: 'flex', gap: 24, marginTop: 24, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0' }}>
              {totalAssets > 0 && <span>ASSETS · {formatMoney(totalAssets, true)}</span>}
              {totalLiabilities > 0 && <span>LIABILITIES · {formatMoney(totalLiabilities, true)}</span>}
              {healthScore && <span>HEALTH · {healthScore.score}/100</span>}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            {nwHistory.length > 1 ? (
              <Sparkline data={nwHistory} color="var(--lf-cheese)" height={130} strokeWidth={2} />
            ) : (
              <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D4C6B0', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
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
        className="dash-mini-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 20 }}
      >
        <MiniCard
          label="Emergency fund"
          value={emergencyFund > 0 ? formatMoney(emergencyFund, true) : '—'}
          sub={runwayMonths !== null ? `${runwayMonths.toFixed(1)} mo runway` : 'Cash in depository'}
          accent={runwayMonths === null ? 'var(--lf-muted)' : runwayMonths >= 6 ? 'var(--lf-basil)' : runwayMonths >= 3 ? 'var(--lf-cheese)' : 'var(--lf-sauce)'}
        />
        <MiniCard
          label="Monthly income"
          value={totalIncome > 0 ? formatMoney(totalIncome, true) : '—'}
          sub={savingsRate !== null && savingsRate > 0 ? `${savingsRate}% savings rate` : 'net after tax'}
          accent="var(--lf-cheese)"
        />
        <MiniCard
          label="Monthly spend"
          value={totalSpending > 0 ? formatMoney(totalSpending, true) : '—'}
          sub={spendingCategories.length > 0 ? `${spendingCategories.length} categories` : 'Link accounts to track'}
          accent="var(--lf-sauce)"
        />
        <MiniCard
          label="Total debt"
          value={totalDebt > 0 ? formatMoney(totalDebt, true) : '$0'}
          sub={debtFreeDate ? `debt-free by ${debtFreeDate}` : (totalDebt > 0 ? 'active liabilities' : 'debt-free!')}
          accent="var(--lf-burgundy)"
        />
      </motion.div>

      {/* Spend Donut + Goals + Health */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="dash-bottom-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 20 }}
      >
        {/* Spend Donut */}
        <div style={{ background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)', borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
              Monthly spend · by category
            </div>
            <button onClick={() => navigate('/spending')} style={{ fontSize: 13, color: 'var(--lf-sauce)', fontFamily: "'JetBrains Mono', monospace", background: 'none', border: 0, cursor: 'pointer' }}>
              details →
            </button>
          </div>
          {spendCatsForDonut.length > 0 ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <DonutMini cats={spendCatsForDonut} totalLabel={totalSpending > 0 ? fmtK(totalSpending) : '$0'} />
              <div style={{ flex: 1 }}>
                {spendCatsForDonut.slice(0, 4).map((c, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '8px 1fr auto', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 13 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                    <span style={{ color: 'var(--lf-ink-soft)', textTransform: 'capitalize' as const }}>{c.name.replace('_', ' ')}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
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
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)' }}>
              Goals · top 3
            </div>
            <button onClick={() => navigate('/goals')} style={{ fontSize: 13, color: 'var(--lf-sauce)', fontFamily: "'JetBrains Mono', monospace", background: 'none', border: 0, cursor: 'pointer' }}>
              {goals.length > 0 ? 'all →' : 'set goals →'}
            </button>
          </div>
          {goals.length > 0 ? (
            <div>
              {goals.slice(0, 3).map((g, i) => {
                const target = parseFloat(g.targetAmount);
                const current = parseFloat(g.currentAmount);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                const deadlineDate = g.deadline ? new Date(g.deadline) : null;
                const isPast = deadlineDate && deadlineDate < new Date();
                const color = pct >= 100 ? 'var(--lf-basil)' : isPast ? 'var(--lf-sauce)' : pct >= 50 ? 'var(--lf-cheese)' : 'var(--lf-sauce)';
                const deadlineStr = deadlineDate
                  ? deadlineDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                  : null;
                return (
                  <div key={g.id} style={{ padding: '8px 0', borderBottom: i < 2 ? '1px dashed var(--lf-rule)' : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                      <span>{g.icon || '⊙'} {g.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-muted)' }}>{Math.round(pct)}%</span>
                    </div>
                    {deadlineStr && (
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: isPast ? 'var(--lf-sauce)' : 'var(--lf-muted)', marginBottom: 4 }}>
                        {isPast ? 'overdue · ' : 'by '}{deadlineStr}
                      </div>
                    )}
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
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)', marginBottom: 12 }}>
            Financial health
          </div>
          {healthScore ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <HealthRing score={healthScore.score} color={healthScore.color} />
              <div style={{ flex: 1, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-muted)', lineHeight: 1.8 }}>
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
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-muted)', marginBottom: 12 }}>
          Walk me through
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
