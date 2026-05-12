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
    <div className="rounded-xl p-4 sm:p-5 border border-border bg-paper">
      <div className="flex items-center gap-2">
        {accent && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />}
        <div className="font-mono text-xs sm:text-sm tracking-wide uppercase text-muted truncate">
          {label}
        </div>
      </div>
      <div className="font-serif text-xl sm:text-2xl lg:text-3xl leading-[1.05] mt-2 sm:mt-2.5
                     overflow-hidden text-ellipsis whitespace-nowrap">
        {value}
      </div>
      {sub && (
        <div className="font-mono text-xs sm:text-sm text-muted mt-2.5 pt-2.5 
                    border-t border-dashed border-border truncate">
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
    <div className="px-4 pb-24 md:px-6 md:pb-6 lg:px-10 max-w-7xl mx-auto w-full">
       {/* Link accounts nudge */}
       {!hasPlaidAccounts && accountCount > 0 && (
         <div className="mb-5 p-4 rounded-xl flex items-center justify-between gap-4"
              style={{
                background: 'rgba(201,84,58,0.06)',
                border: '1px solid rgba(201,84,58,0.2)',
              }}>
           <div className="flex-1 min-w-0">
             <div className="font-medium text-sm">Link your bank for automatic updates</div>
             <div className="text-xs text-muted mt-1">
               Your balances are manual snapshots. Connect via Plaid for real-time tracking.
             </div>
           </div>
           <button
             onClick={() => navigate('/accounts')}
             className="px-4 py-2.5 rounded-full text-sm font-medium whitespace-nowrap"
             style={{ background: 'var(--lf-sauce)', color: 'var(--lf-paper)', border: 0 }}
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
         className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6"
       >
         <div>
           <h1 className="font-serif text-3xl sm:text-4xl font-normal leading-tight">
             Dashboard
           </h1>
           <div className="font-mono text-xs tracking-wider uppercase text-muted mt-2">
             Good {getGreeting()}, {firstName} · {getDayLabel()}
             {urgentCount > 0 && ` · ${urgentCount} urgent`}
           </div>
         </div>
         <div className="flex gap-2 sm:gap-3">
           <button
             onClick={() => navigate('/accounts')}
             className="mobile-button"
             style={{ background: 'var(--lf-paper)', color: 'var(--lf-ink)', border: '1px solid var(--lf-rule)' }}
           >
             Sync
           </button>
           <button
             onClick={() => openChat('What should I focus on financially right now?')}
             className="mobile-button"
             style={{ background: 'var(--lf-ink)', color: 'var(--lf-paper)', border: '1px solid var(--lf-ink)' }}
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
           className="flex flex-col sm:flex-row items-stretch gap-0 sm:gap-0 rounded-xl mb-5 overflow-hidden"
           style={{
             background: 'var(--lf-cream)',
             border: '1px solid var(--lf-rule)',
           }}
         >
           {/* Level indicator */}
           {prioritySteps.length > 0 && (() => {
             const currentStep = prioritySteps.find(s => s.status !== 'complete' && !s.skipped) || prioritySteps[0];
             const currentLevel = currentStep.order;
             return (
               <div className="flex items-center gap-3.5 p-3.5 sm:p-4 border-b sm:border-b-0 sm:border-r border-rule flex-shrink-0">
                 <div className="w-9 h-9 rounded-lg flex items-center justify-center font-mono text-sm font-semibold flex-shrink-0 text-paper"
                      style={{
                        background: LAYER_COLORS[Math.min(currentLevel - 1, LAYER_COLORS.length - 1)] || 'var(--lf-sauce)',
                      }}>
                   {currentLevel}
                 </div>
                 <div className="min-w-0 flex-1">
                   <div className="font-mono text-xs tracking-wide uppercase text-muted">
                     Level {currentLevel} · Current focus
                   </div>
                   <div className="text-sm font-medium text-ink truncate">
                     {currentStep.title}
                   </div>
                   <button
                     onClick={() => navigate('/financial-level')}
                     className="font-mono text-xs text-sauce mt-0.5 bg-transparent border-0 cursor-pointer p-0"
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
              <div className="flex flex-col gap-1.5 p-3.5 sm:p-4 flex-1 min-w-0 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <span className="font-mono text-xs tracking-wide uppercase text-muted flex-shrink-0">
                    This week
                  </span>
                  {weekActions.map((a, i) => (
                    <div
                      key={a.id}
                      onClick={() => navigate('/insights')}
                      className="flex items-center gap-2 text-sm text-ink-soft min-w-0 cursor-pointer
                               sm:pl-4 sm:border-l border-rule"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                        ${a.urgency === 'critical' || a.urgency === 'high' ? 'bg-sauce' : 
                          a.urgency === 'medium' ? 'bg-cheese' : 'bg-basil'}`} />
                      <span className="truncate">
                        {a.title}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => navigate('/insights')}
                  className="font-mono text-xs text-sauce mt-1 bg-transparent border-0 cursor-pointer p-0 self-start"
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
        className="rounded-xl p-5 sm:p-8 lg:p-10 mb-5"
        style={{
          background: 'var(--lf-ink)',
          color: 'var(--lf-paper)',
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10 items-center">
          <div>
            <div className="font-mono text-sm tracking-wide uppercase text-cheese mb-2.5">
              Net Worth · live
            </div>
            <div className="font-serif text-4xl sm:text-5xl lg:text-6xl leading-[0.95] tracking-tight
                         overflow-hidden text-ellipsis whitespace-nowrap">
              {netWorth !== null ? formatMoney(netWorth, true) : '—'}
            </div>
            {netWorthChange !== null && (
              <div className="font-mono text-sm text-cheese mt-2.5">
                {netWorthChange >= 0 ? '▲' : '▼'} {fmt(Math.abs(netWorthChange))}{nwChangePct}
              </div>
            )}
            <div className="flex flex-wrap gap-4 sm:gap-6 mt-6 font-mono text-sm" style={{ color: '#D4C6B0' }}>
              {totalAssets > 0 && <span>ASSETS · {formatMoney(totalAssets, true)}</span>}
              {totalLiabilities > 0 && <span>LIABILITIES · {formatMoney(totalLiabilities, true)}</span>}
              {healthScore && <span>HEALTH · {healthScore.score}/100</span>}
            </div>
          </div>
          <div className="min-w-0">
            {nwHistory.length > 1 ? (
              <Sparkline data={nwHistory} color="var(--lf-cheese)" height={130} strokeWidth={2} />
            ) : (
              <div className="h-32 flex items-center justify-center text-xs" style={{ color: '#D4C6B0', fontFamily: "'JetBrains Mono', monospace" }}>
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
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5"
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
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5"
      >
        {/* Spend Donut */}
        <div className="rounded-xl p-5 border border-rule bg-paper">
          <div className="flex justify-between items-baseline mb-3">
            <div className="font-mono text-sm tracking-wide uppercase text-muted">
              Monthly spend · by category
            </div>
            <button onClick={() => navigate('/spending')} className="text-sm text-sauce font-mono bg-transparent border-0 cursor-pointer">
              details →
            </button>
          </div>
          {spendCatsForDonut.length > 0 ? (
            <div className="flex gap-4 items-center">
              <DonutMini cats={spendCatsForDonut} totalLabel={totalSpending > 0 ? fmtK(totalSpending) : '$0'} />
              <div className="flex-1 min-w-0">
                {spendCatsForDonut.slice(0, 4).map((c, i) => (
                  <div key={i} className="grid grid-cols-[8px_1fr_auto] gap-2 items-center py-1 text-sm">
                    <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: c.color }} />
                    <span className="text-ink-soft capitalize truncate">{c.name.replace('_', ' ')}</span>
                    <span className="font-mono text-sm">
                      {totalSpending > 0 ? Math.round((c.total / totalSpending) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-muted text-sm text-center py-6">
              No spending data yet.
            </div>
          )}
        </div>

        {/* Goals */}
        <div className="rounded-xl p-5 border border-rule bg-paper">
          <div className="flex justify-between items-baseline mb-3">
            <div className="font-mono text-sm tracking-wide uppercase text-muted">
              Goals · top 3
            </div>
            <button onClick={() => navigate('/goals')} className="text-sm text-sauce font-mono bg-transparent border-0 cursor-pointer">
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
                  <div key={g.id} className={`py-2 ${i < 2 ? 'border-b border-dashed border-rule' : ''}`}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="truncate">{g.icon || '⊙'} {g.name}</span>
                      <span className="font-mono text-sm text-muted">{Math.round(pct)}%</span>
                    </div>
                    {deadlineStr && (
                      <div className={`font-mono text-sm mb-1 ${isPast ? 'text-sauce' : 'text-muted'}`}>
                        {isPast ? 'overdue · ' : 'by '}{deadlineStr}
                      </div>
                    )}
                    <div className="h-1 bg-cream rounded overflow-hidden">
                      <div className="h-full rounded transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-muted text-sm text-center py-6">
              No goals set yet.
            </div>
          )}
        </div>

        {/* Financial Health */}
        <div className="rounded-xl p-5 border border-rule bg-paper md:col-span-2 lg:col-span-1">
          <div className="font-mono text-sm tracking-wide uppercase text-muted mb-3">
            Financial health
          </div>
          {healthScore ? (
            <div className="flex items-center gap-5">
              <HealthRing score={healthScore.score} color={healthScore.color} />
              <div className="flex-1 font-mono text-sm text-muted leading-relaxed">
                <div className="flex justify-between">
                  <span>Cash</span>
                  <span className={
                    emergencyFund > 0 && runwayMonths !== null && runwayMonths >= 6 ? 'text-pos' :
                    emergencyFund > 0 ? 'text-cheese' : ''
                  }>
                    {emergencyFund > 0 && runwayMonths !== null && runwayMonths >= 6 ? 'strong' : emergencyFund > 0 ? 'fair' : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Debt</span>
                  <span className={
                    totalDebt === 0 ? 'text-pos' :
                    totalDebt < 5000 ? 'text-cheese' : 'text-sauce'
                  }>
                    {totalDebt === 0 ? 'none' : totalDebt < 5000 ? 'fair' : 'high'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Savings</span>
                  <span className={
                    savingsRate !== null && savingsRate >= 20 ? 'text-pos' :
                    savingsRate !== null && savingsRate > 0 ? 'text-cheese' : ''
                  }>
                    {savingsRate !== null ? `${savingsRate}%` : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Grade</span>
                  <span style={{ color: healthScore.color }}>{healthScore.grade}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-muted text-sm text-center py-6">
              Add accounts to calculate score.
            </div>
          )}
        </div>
      </motion.div>

      {/* Mobile ask prompts */}
      <div className="md:hidden mt-5">
        <div className="font-mono text-sm tracking-wide uppercase text-muted mb-3">
          Walk me through
        </div>
        <div className="flex flex-col gap-2">
          {[
            'What should I focus on financially right now?',
            'Am I saving enough for my age?',
            'How can I grow my net worth?',
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => openChat(prompt)}
              className="mobile-button text-left text-sm text-ink-soft"
              style={{
                background: 'var(--lf-paper)',
                border: '1px solid var(--lf-rule)',
                borderRadius: '12px',
                padding: '12px 16px',
                textAlign: 'left',
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
