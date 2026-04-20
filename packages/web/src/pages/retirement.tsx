import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { formatMoney } from '../lib/utils';

// Historical average annual returns by asset class
const HISTORICAL_RETURNS: Record<string, number> = {
  usStocks: 10.0,
  intlStocks: 7.5,
  bonds: 5.0,
  reits: 9.5,
  cash: 2.0,
};

function getExpectedReturn(allocation: Record<string, number>): number {
  const total = Object.values(allocation).reduce((s, v) => s + v, 0);
  if (total === 0) return 7;
  let weighted = 0;
  for (const [key, pct] of Object.entries(allocation)) {
    const ret = HISTORICAL_RETURNS[key] ?? 7;
    weighted += pct * ret;
  }
  return weighted / total;
}

function buildProjectionData(
  currentAge: number,
  retirementAge: number,
  portfolioValue: number,
  annualContribution: number,
  expectedReturn: number
) {
  const data: { age: number; value: number; label?: string }[] = [];
  let value = portfolioValue;
  const rate = expectedReturn / 100;
  for (let age = currentAge; age <= Math.max(retirementAge + 20, 90); age++) {
    data.push({
      age,
      value: Math.round(value),
      label: age === retirementAge ? 'Retirement' : undefined,
    });
    if (age < retirementAge) {
      value = value * (1 + rate) + annualContribution;
    } else {
      // Post-retirement: no contributions, just growth
      value = value * (1 + rate * 0.6); // more conservative post-retirement
    }
    if (value < 0) value = 0;
  }
  return data;
}

// ── Inline SVG Projection Chart ──────────────────────────────────────────────
function ProjectionLine({ data }: { data: { age: number; value: number; label?: string }[] }) {
  if (!data.length) return null;
  const w = 600; const h = 120; const pad = 10;
  const maxV = Math.max(...data.map(d => d.value));
  const minV = Math.min(...data.map(d => d.value));
  const range = maxV - minV || 1;
  const xScale = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const yScale = (v: number) => h - pad - ((v - minV) / range) * (h - pad * 2);
  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');
  const retireIdx = data.findIndex(d => d.label === 'Retirement');

  // Area fill path
  const areaPath = [
    `M ${xScale(0)},${h - pad}`,
    ...data.map((d, i) => `L ${xScale(i)},${yScale(d.value)}`),
    `L ${xScale(data.length - 1)},${h - pad}`,
    'Z',
  ].join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 120 }}>
      <defs>
        <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--lf-sauce)" stopOpacity={0.18} />
          <stop offset="100%" stopColor="var(--lf-sauce)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#projFill)" />
      <polyline fill="none" stroke="var(--lf-sauce)" strokeWidth={2} points={points} />
      {retireIdx >= 0 && (
        <line
          x1={xScale(retireIdx)} y1={pad}
          x2={xScale(retireIdx)} y2={h - pad}
          stroke="var(--lf-muted)" strokeWidth={1} strokeDasharray="3,3"
        />
      )}
      {retireIdx >= 0 && (
        <text
          x={xScale(retireIdx) + 4}
          y={pad + 10}
          fill="var(--lf-muted)"
          fontSize={8}
          fontFamily="'JetBrains Mono', monospace"
        >
          Retirement
        </text>
      )}
    </svg>
  );
}

// ── Eyebrow label ─────────────────────────────────────────────────────────────
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--lf-muted)',
      marginBottom: 6,
    }}>
      {children}
    </p>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--lf-paper)',
      border: '1px solid var(--lf-rule)',
      borderRadius: 14,
      padding: 20,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Readiness ring ────────────────────────────────────────────────────────────
function ReadinessRing({ pct }: { pct: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 80 ? 'var(--lf-basil)' : pct >= 50 ? 'var(--lf-cheese)' : 'var(--lf-sauce)';
  return (
    <div style={{ position: 'relative', width: 140, height: 140 }}>
      <svg
        viewBox="0 0 120 120"
        style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}
      >
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--lf-rule)" strokeWidth={8} />
        <circle
          cx="60" cy="60" r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 28,
          color,
          lineHeight: 1,
        }}>
          {pct.toFixed(0)}%
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--lf-muted)',
          marginTop: 2,
        }}>
          ready
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function Retirement() {
  const [, navigate] = useLocation();
  const { setPageContext } = usePageContext();
  const [loading, setLoading] = useState(true);
  const [hasAccounts, setHasAccounts] = useState(false);

  // Data from API
  const [currentAge, setCurrentAge] = useState(30);
  const [annualIncome, setAnnualIncome] = useState(0);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState(5000);
  const [allocation, setAllocation] = useState<Record<string, number>>({});
  const [riskTolerance, setRiskTolerance] = useState<string | null>(null);
  const [filingStatus, setFilingStatus] = useState<string | null>(null);

  // Interactive controls
  const [retirementAge, setRetirementAge] = useState(65);
  const [monthlyRetirementSpend, setMonthlyRetirementSpend] = useState(5000);
  const [selectedStrategy, setSelectedStrategy] = useState('constant_dollar');

  // Load all data
  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getPortfolioAllocation().catch(() => ({ allocation: null, totalValue: 0 })),
      api.getSpendingSummary().catch(() => ({ totalSpending: 0, totalIncome: 0 })),
    ]).then(([balanceData, profileData, portfolioData, spendingData]) => {
      const balances = (balanceData as { balances: Array<{ balance?: string; type?: string }> }).balances;
      setHasAccounts(balances.length > 0);

      // Portfolio value from balances
      let assets = 0;
      let liabilities = 0;
      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type === 'credit' || b.type === 'loan') {
          liabilities += val;
        } else {
          assets += val;
        }
      }
      const netWorth = assets - liabilities;
      if (netWorth > 0) setPortfolioValue(netWorth);

      // Profile
      const profile = (profileData as { financialProfile: Record<string, unknown> | null }).financialProfile;
      if (profile) {
        if (profile.age) setCurrentAge(profile.age as number);
        if (profile.annualIncome) setAnnualIncome(profile.annualIncome as number);
        if (profile.retirementAge) setRetirementAge(profile.retirementAge as number);
        if (profile.riskTolerance) setRiskTolerance(profile.riskTolerance as string);
        if (profile.filingStatus) setFilingStatus(profile.filingStatus as string);
      }

      // Allocation
      const pd = portfolioData as { allocation: Record<string, number> | null; totalValue: number };
      if (pd.allocation) {
        setAllocation(pd.allocation);
      }

      // Spending — summary returns current month data by default
      const sd = spendingData as { totalSpending: number; totalIncome: number };
      if (sd.totalSpending > 0) {
        const monthlySpend = Math.round(sd.totalSpending);
        if (monthlySpend > 0) {
          setMonthlyExpenses(monthlySpend);
          setMonthlyRetirementSpend(monthlySpend);
        }
      }
    }).finally(() => setLoading(false));
  }, []);

  // Set page context
  useEffect(() => {
    if (!loading && hasAccounts) {
      setPageContext({
        pageId: 'retirement',
        pageTitle: 'Retirement Planning',
        description: 'Retirement readiness overview with projections and modeling.',
        data: {
          currentAge,
          retirementAge,
          portfolioValue,
          monthlyRetirementSpend,
          annualIncome,
          filingStatus,
          riskTolerance,
        },
      });
    }
  }, [loading, hasAccounts, currentAge, retirementAge, portfolioValue, monthlyRetirementSpend, annualIncome, filingStatus, riskTolerance, setPageContext]);

  // ── Computed values ──────────────────────────────────────────────────────
  const yearsUntilRetirement = Math.max(0, retirementAge - currentAge);
  const expectedReturn = Object.keys(allocation).length > 0
    ? getExpectedReturn(allocation)
    : 7.0;
  const annualExpenses = monthlyRetirementSpend * 12;
  const fireNumber = annualExpenses * 25;

  const estimatedTaxRate = 0.25;
  const afterTaxIncome = annualIncome * (1 - estimatedTaxRate);
  const annualSavings = Math.max(0, afterTaxIncome - monthlyExpenses * 12);

  // Portfolio at retirement (FV with contributions)
  const rate = expectedReturn / 100;
  let portfolioAtRetirement = portfolioValue;
  for (let i = 0; i < yearsUntilRetirement; i++) {
    portfolioAtRetirement = portfolioAtRetirement * (1 + rate) + annualSavings;
  }

  // Years money lasts
  const conservativeRate = rate * 0.6;
  let yearsMoneyLasts = 0;
  let tempValue = portfolioAtRetirement;
  while (tempValue > 0 && yearsMoneyLasts < 60) {
    tempValue = tempValue * (1 + conservativeRate) - annualExpenses;
    if (tempValue > 0) yearsMoneyLasts++;
    else break;
  }

  // Monthly retirement income (4% rule)
  const monthlyRetirementIncome = Math.round((portfolioAtRetirement * 0.04) / 12);

  // Readiness
  const readiness = fireNumber > 0 ? Math.min(100, (portfolioValue / fireNumber) * 100) : 0;
  const readinessLabel =
    readiness >= 80 ? "You're on track!" :
    readiness >= 50 ? 'Getting there — keep saving.' :
    'More savings needed.';

  // Projection chart data
  const projectionData = buildProjectionData(
    currentAge,
    retirementAge,
    portfolioValue,
    annualSavings,
    expectedReturn
  );

  const strategies = [
    { id: 'constant_dollar', label: 'Constant Dollar' },
    { id: 'percent_portfolio', label: '% of Portfolio' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'rules_based', label: 'Rules-Based' },
  ];

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--lf-paper)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--lf-muted)',
          }}>
            Loading your financial data...
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!hasAccounts) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--lf-paper)', padding: '24px 28px 48px' }} className="scrollbar-thin">
        <div style={{
          maxWidth: 960,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
        }}>
          <Card style={{ padding: '48px 40px', textAlign: 'center', maxWidth: 480 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>&#127968;</div>
            <h2 style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 26,
              color: 'var(--lf-ink)',
              marginBottom: 12,
              fontWeight: 400,
            }}>
              No Accounts Linked
            </h2>
            <p style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              color: 'var(--lf-muted)',
              marginBottom: 28,
              lineHeight: 1.6,
            }}>
              Connect your bank and investment accounts to see your retirement projections based on real data.
            </p>
            <button
              onClick={() => navigate('/accounts')}
              style={{
                background: 'var(--lf-sauce)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 22px',
                fontFamily: "'Geist', system-ui, sans-serif",
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              + Link Your First Account
            </button>
          </Card>
        </div>
      </div>
    );
  }

  // ── Main content ───────────────────────────────────────────────────────────
  return (
    <div
      style={{ flex: 1, overflowY: 'auto', background: 'var(--lf-paper)' }}
      className="scrollbar-thin"
    >
      <div style={{ padding: '24px 28px 48px', maxWidth: 960, margin: '0 auto' }}>

        {/* Page header */}
        <div style={{ marginBottom: 28 }}>
          <Eyebrow>Retirement Planning</Eyebrow>
          <h1 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 28,
            fontWeight: 400,
            color: 'var(--lf-ink)',
            margin: 0,
            lineHeight: 1.2,
          }}>
            Your Path to Financial Independence
          </h1>
          <p style={{
            fontFamily: "'Geist', system-ui, sans-serif",
            color: 'var(--lf-muted)',
            marginTop: 6,
            fontSize: 14,
          }}>
            Age {currentAge} &rarr; Retire at {retirementAge} &middot; {yearsUntilRetirement} years to go
          </p>
        </div>

        {/* ── Hero stat row ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}>
          {/* Years to Retire */}
          <Card>
            <Eyebrow>Years to Retire</Eyebrow>
            <div style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 36,
              color: 'var(--lf-ink)',
              lineHeight: 1,
            }}>
              {yearsUntilRetirement}
            </div>
            <div style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 12,
              color: 'var(--lf-muted)',
              marginTop: 6,
            }}>
              Retire at {retirementAge}
            </div>
          </Card>

          {/* Portfolio Today */}
          <Card>
            <Eyebrow>Portfolio Today</Eyebrow>
            <div style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: portfolioValue >= 1_000_000 ? 28 : 32,
              color: 'var(--lf-ink)',
              lineHeight: 1,
            }}>
              {portfolioValue > 0 ? formatMoney(portfolioValue, true) : '—'}
            </div>
            <div style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 12,
              color: 'var(--lf-muted)',
              marginTop: 6,
            }}>
              Net worth
            </div>
          </Card>

          {/* FIRE Number */}
          <Card>
            <Eyebrow>FIRE Number</Eyebrow>
            <div style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: fireNumber >= 1_000_000 ? 28 : 32,
              color: 'var(--lf-ink)',
              lineHeight: 1,
            }}>
              {formatMoney(fireNumber, true)}
            </div>
            <div style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 12,
              color: 'var(--lf-muted)',
              marginTop: 6,
            }}>
              25x annual expenses
            </div>
          </Card>

          {/* Readiness */}
          <Card>
            <Eyebrow>Readiness</Eyebrow>
            <div style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 36,
              color: readiness >= 80 ? 'var(--lf-basil)' : readiness >= 50 ? 'var(--lf-cheese)' : 'var(--lf-sauce)',
              lineHeight: 1,
            }}>
              {readiness.toFixed(0)}%
            </div>
            {/* Progress bar */}
            <div style={{
              height: 4,
              background: 'var(--lf-rule)',
              borderRadius: 2,
              marginTop: 10,
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, readiness)}%`,
                background: readiness >= 80 ? 'var(--lf-basil)' : readiness >= 50 ? 'var(--lf-cheese)' : 'var(--lf-sauce)',
                borderRadius: 2,
                transition: 'width 0.6s ease',
              }} />
            </div>
          </Card>
        </div>

        {/* ── Projection chart ──────────────────────────────────────────────── */}
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <Eyebrow>Portfolio Projection</Eyebrow>
              <div style={{
                fontFamily: "'Geist', system-ui, sans-serif",
                fontSize: 13,
                color: 'var(--lf-muted)',
              }}>
                At {expectedReturn.toFixed(1)}% avg return &middot; {annualSavings > 0 ? `${formatMoney(annualSavings, true)}/yr contributions` : 'no contributions estimated'}
              </div>
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: 'var(--lf-muted)',
              textAlign: 'right',
            }}>
              Age {currentAge} &rarr; {Math.max(retirementAge + 20, 90)}
            </div>
          </div>
          <ProjectionLine data={projectionData} />
          {/* Age axis ticks */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 6,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: 'var(--lf-muted)',
          }}>
            <span>{currentAge}</span>
            <span>{Math.round((currentAge + Math.max(retirementAge + 20, 90)) / 2)}</span>
            <span>{Math.max(retirementAge + 20, 90)}</span>
          </div>
        </Card>

        {/* ── Retirement income row ─────────────────────────────────────────── */}
        <div style={{ marginBottom: 8 }}>
          <Eyebrow>At Retirement</Eyebrow>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}>
          {/* Portfolio at Retirement */}
          <Card>
            <Eyebrow>Projected Portfolio</Eyebrow>
            <div style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 28,
              color: 'var(--lf-pos)',
              lineHeight: 1,
            }}>
              {formatMoney(portfolioAtRetirement, true)}
            </div>
            <div style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 12,
              color: 'var(--lf-muted)',
              marginTop: 6,
            }}>
              At age {retirementAge}
            </div>
          </Card>

          {/* Monthly Income */}
          <Card>
            <Eyebrow>Monthly Income</Eyebrow>
            <div style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 28,
              color: 'var(--lf-ink)',
              lineHeight: 1,
            }}>
              {formatMoney(monthlyRetirementIncome)}
            </div>
            <div style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 12,
              color: 'var(--lf-muted)',
              marginTop: 6,
            }}>
              Sustainable (4% rule)
            </div>
            {/* Bar: income vs spend */}
            <div style={{ height: 4, background: 'var(--lf-rule)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, (monthlyRetirementIncome / Math.max(monthlyRetirementSpend, 1)) * 100)}%`,
                background: monthlyRetirementIncome >= monthlyRetirementSpend ? 'var(--lf-basil)' : 'var(--lf-sauce)',
                borderRadius: 2,
                transition: 'width 0.6s ease',
              }} />
            </div>
          </Card>

          {/* Money Lasts */}
          <Card>
            <Eyebrow>Money Lasts</Eyebrow>
            <div style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 28,
              color: yearsMoneyLasts >= 30 ? 'var(--lf-basil)' : yearsMoneyLasts >= 20 ? 'var(--lf-cheese)' : 'var(--lf-sauce)',
              lineHeight: 1,
            }}>
              {yearsMoneyLasts >= 60 ? '60+' : yearsMoneyLasts} yrs
            </div>
            <div style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 12,
              color: 'var(--lf-muted)',
              marginTop: 6,
            }}>
              Until age {retirementAge + Math.min(yearsMoneyLasts, 60)}
            </div>
          </Card>
        </div>

        {/* ── Readiness + controls ──────────────────────────────────────────── */}
        <Card style={{ marginBottom: 20 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '180px 1fr',
            gap: 28,
            alignItems: 'center',
          }}>
            {/* Readiness ring */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <ReadinessRing pct={readiness} />
              <p style={{
                fontFamily: "'Geist', system-ui, sans-serif",
                fontSize: 12,
                color: 'var(--lf-muted)',
                textAlign: 'center',
                lineHeight: 1.5,
              }}>
                {readinessLabel}
              </p>
            </div>

            {/* Interactive sliders */}
            <div>
              <Eyebrow>Model Your Retirement</Eyebrow>

              {/* Retirement Age Slider */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{
                    fontFamily: "'Geist', system-ui, sans-serif",
                    fontSize: 13,
                    color: 'var(--lf-ink-soft)',
                  }}>
                    Retirement Age
                  </label>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    color: 'var(--lf-sauce)',
                    fontWeight: 600,
                  }}>
                    {retirementAge}
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={80}
                  step={1}
                  value={retirementAge}
                  onChange={(e) => setRetirementAge(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--lf-sauce)' }}
                />
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: 'var(--lf-muted)',
                  marginTop: 4,
                }}>
                  <span>50</span>
                  <span>80</span>
                </div>
              </div>

              {/* Monthly Retirement Spend Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{
                    fontFamily: "'Geist', system-ui, sans-serif",
                    fontSize: 13,
                    color: 'var(--lf-ink-soft)',
                  }}>
                    Monthly Retirement Spending
                  </label>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    color: 'var(--lf-sauce)',
                    fontWeight: 600,
                  }}>
                    {formatMoney(monthlyRetirementSpend)}
                  </span>
                </div>
                <input
                  type="range"
                  min={2000}
                  max={20000}
                  step={500}
                  value={monthlyRetirementSpend}
                  onChange={(e) => setMonthlyRetirementSpend(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--lf-sauce)' }}
                />
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: 'var(--lf-muted)',
                  marginTop: 4,
                }}>
                  <span>$2k</span>
                  <span>$20k</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* ── Withdrawal strategy tabs ──────────────────────────────────────── */}
        <Card>
          <Eyebrow>Withdrawal Strategy</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {strategies.map((s) => {
              const active = selectedStrategy === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedStrategy(s.id)}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 20,
                    border: active ? '1px solid var(--lf-sauce)' : '1px solid var(--lf-rule)',
                    background: active ? 'rgba(201,84,58,0.08)' : 'transparent',
                    color: active ? 'var(--lf-sauce)' : 'var(--lf-muted)',
                    fontFamily: "'Geist', system-ui, sans-serif",
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <div style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid var(--lf-rule)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <p style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 13,
              color: 'var(--lf-muted)',
              lineHeight: 1.5,
            }}>
              {selectedStrategy === 'constant_dollar' && 'Withdraw a fixed inflation-adjusted dollar amount each year.'}
              {selectedStrategy === 'percent_portfolio' && 'Withdraw a fixed percentage of your portfolio balance annually.'}
              {selectedStrategy === 'guardrails' && 'Adjust withdrawals up or down based on portfolio performance guardrails.'}
              {selectedStrategy === 'rules_based' && 'Follow a rules-based system that responds to market conditions.'}
            </p>
            <button
              onClick={() => navigate('/probability')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 18px',
                borderRadius: 8,
                border: '1px solid var(--lf-sauce)',
                background: 'var(--lf-sauce)',
                color: '#fff',
                fontFamily: "'Geist', system-ui, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                marginLeft: 16,
              }}
            >
              Run Full Simulation &#8594;
            </button>
          </div>
        </Card>

      </div>
    </div>
  );
}
