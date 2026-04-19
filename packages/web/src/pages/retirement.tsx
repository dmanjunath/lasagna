import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  Calendar,
  Wallet,
  TrendingUp,
  Flame,
  Clock,
  ArrowRight,
  PiggyBank,
  RefreshCw,
  Building2,
  Plus,
} from "lucide-react";
import { cn, formatMoney } from "../lib/utils";
import { api } from "../lib/api";
import { usePageContext } from "../lib/page-context";
import { Section } from "../components/common/section";
import { StatCard } from "../components/common/stat-card";
import { Button } from "../components/ui/button";
import { PageActions } from "../components/common/page-actions";

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
  const data = [];
  let value = portfolioValue;
  const rate = expectedReturn / 100;
  for (let age = currentAge; age <= Math.max(retirementAge + 20, 90); age++) {
    data.push({
      age,
      value: Math.round(value),
      label: age === retirementAge ? "Retirement" : undefined,
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
  const [employerMatchPct, setEmployerMatchPct] = useState(0);
  const [allocation, setAllocation] = useState<Record<string, number>>({});
  const [riskTolerance, setRiskTolerance] = useState<string | null>(null);
  const [filingStatus, setFilingStatus] = useState<string | null>(null);

  // Interactive controls
  const [retirementAge, setRetirementAge] = useState(65);
  const [monthlyRetirementSpend, setMonthlyRetirementSpend] = useState(5000);
  const [selectedStrategy, setSelectedStrategy] = useState("constant_dollar");

  // Load all data
  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getPortfolioAllocation().catch(() => ({ allocation: null, totalValue: 0 })),
      api.getSpendingSummary().catch(() => ({ totalSpending: 0, totalIncome: 0 })),
    ]).then(([balanceData, profileData, portfolioData, spendingData]) => {
      const balances = balanceData.balances;
      setHasAccounts(balances.length > 0);

      // Portfolio value from balances
      let assets = 0;
      let liabilities = 0;
      for (const b of balances) {
        const val = parseFloat(b.balance || "0");
        if (b.type === "credit" || b.type === "loan") {
          liabilities += val;
        } else {
          assets += val;
        }
      }
      const netWorth = assets - liabilities;
      if (netWorth > 0) setPortfolioValue(netWorth);

      // Profile
      const profile = profileData.financialProfile;
      if (profile) {
        if (profile.age) setCurrentAge(profile.age);
        if (profile.annualIncome) setAnnualIncome(profile.annualIncome);
        if (profile.retirementAge) setRetirementAge(profile.retirementAge);
        if (profile.employerMatchPercent) setEmployerMatchPct(profile.employerMatchPercent);
        if (profile.riskTolerance) setRiskTolerance(profile.riskTolerance);
        if (profile.filingStatus) setFilingStatus(profile.filingStatus);
      }

      // Allocation
      if (portfolioData.allocation) {
        setAllocation(portfolioData.allocation);
      }

      // Spending — summary returns current month data by default
      if (spendingData.totalSpending > 0) {
        const monthlySpend = Math.round(spendingData.totalSpending);
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
        pageId: "retirement",
        pageTitle: "Retirement Planning",
        description: "Retirement readiness overview with projections and modeling.",
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

  // Computed values
  const yearsUntilRetirement = Math.max(0, retirementAge - currentAge);
  const expectedReturn = Object.keys(allocation).length > 0
    ? getExpectedReturn(allocation)
    : 7.0;
  const annualExpenses = monthlyRetirementSpend * 12;
  const fireNumber = annualExpenses * 25;

  // Estimate annual savings (income - expenses - tax estimate)
  const estimatedTaxRate = 0.25;
  const afterTaxIncome = annualIncome * (1 - estimatedTaxRate);
  const annualSavings = Math.max(0, afterTaxIncome - monthlyExpenses * 12);
  const savingsRate = afterTaxIncome > 0 ? (annualSavings / afterTaxIncome) * 100 : 0;

  // Portfolio at retirement (FV with contributions)
  const rate = expectedReturn / 100;
  let portfolioAtRetirement = portfolioValue;
  for (let i = 0; i < yearsUntilRetirement; i++) {
    portfolioAtRetirement = portfolioAtRetirement * (1 + rate) + annualSavings;
  }

  // Years money lasts (using spend rate)
  const conservativeRate = rate * 0.6; // lower return in retirement
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
  const readinessColor = readiness >= 80 ? "text-success" : readiness >= 50 ? "text-warning" : "text-danger";
  const readinessBg = readiness >= 80 ? "stroke-success" : readiness >= 50 ? "stroke-warning" : "stroke-danger";
  const readinessTrack = readiness >= 80 ? "stroke-success/20" : readiness >= 50 ? "stroke-warning/20" : "stroke-danger/20";

  // Projection chart data
  const projectionData = buildProjectionData(
    currentAge,
    retirementAge,
    portfolioValue,
    annualSavings,
    expectedReturn
  );

  const strategies = [
    { id: "constant_dollar", label: "Constant Dollar" },
    { id: "percent_portfolio", label: "% of Portfolio" },
    { id: "guardrails", label: "Guardrails" },
    { id: "rules_based", label: "Rules-Based" },
  ];

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-accent" />
          <p className="text-text-secondary">Loading your financial data...</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!hasAccounts) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center"
        >
          <Building2 className="w-16 h-16 text-text-secondary mb-6" />
          <h2 className="font-display text-2xl md:text-3xl font-medium mb-3">
            No Accounts Linked
          </h2>
          <p className="text-text-secondary max-w-md mb-8">
            Connect your bank and investment accounts to see your retirement projections based on real data.
          </p>
          <Button onClick={() => navigate("/accounts")}>
            <Plus className="w-4 h-4 mr-2" />
            Link Your First Account
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 md:mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">Retirement Plan</h1>
        <p className="text-text-secondary mt-2">Your path to financial independence</p>
      </motion.div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 md:mb-8">
        <StatCard
          icon={Calendar}
          label="Age Timeline"
          value={`${currentAge} → ${retirementAge}`}
          description={`${yearsUntilRetirement} years to go`}
          delay={0}
        />
        <StatCard
          icon={Wallet}
          label="Portfolio Value"
          value={formatMoney(portfolioValue, true)}
          delay={0.05}
        />
        <StatCard
          icon={TrendingUp}
          label="Monthly Spending"
          value={formatMoney(monthlyRetirementSpend)}
          description="Estimated in retirement"
          delay={0.1}
        />
        <StatCard
          icon={PiggyBank}
          label="Savings Rate"
          value={`${savingsRate.toFixed(0)}%`}
          description={`${formatMoney(annualSavings, true)}/yr`}
          delay={0.15}
        />
      </div>

      {/* Key Projections */}
      <Section title="Key Projections">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-5 h-5 text-text-secondary" />
              <span className="text-sm text-text-secondary font-medium">Portfolio at Retirement</span>
            </div>
            <div className="font-display text-2xl font-semibold tabular-nums text-success">
              {formatMoney(portfolioAtRetirement, true)}
            </div>
            <p className="text-text-secondary text-xs mt-2">
              At {expectedReturn.toFixed(1)}% avg return
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-5 h-5 text-text-secondary" />
              <span className="text-sm text-text-secondary font-medium">Years Money Lasts</span>
            </div>
            <div className={cn(
              "font-display text-2xl font-semibold tabular-nums",
              yearsMoneyLasts >= 30 ? "text-success" : yearsMoneyLasts >= 20 ? "text-warning" : "text-danger"
            )}>
              {yearsMoneyLasts >= 60 ? "60+" : yearsMoneyLasts} years
            </div>
            <p className="text-text-secondary text-xs mt-2">
              Until age {retirementAge + yearsMoneyLasts}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="w-5 h-5 text-text-secondary" />
              <span className="text-sm text-text-secondary font-medium">Monthly Income</span>
            </div>
            <div className="font-display text-2xl font-semibold tabular-nums">
              {formatMoney(monthlyRetirementIncome)}
            </div>
            <p className="text-text-secondary text-xs mt-2">
              Sustainable (4% rule)
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="glass-card rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-5 h-5 text-text-secondary" />
              <span className="text-sm text-text-secondary font-medium">FIRE Number</span>
            </div>
            <div className="font-display text-2xl font-semibold tabular-nums">
              {formatMoney(fireNumber, true)}
            </div>
            <p className="text-text-secondary text-xs mt-2">
              25x annual expenses
            </p>
          </motion.div>
        </div>
      </Section>

      <PageActions types={["retirement", "savings", "portfolio"]} />

      {/* Retirement Readiness + Projection Chart */}
      <Section title="Retirement Readiness">
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Circular Progress */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card rounded-2xl p-6 flex flex-col items-center justify-center"
          >
            <div className="relative w-40 h-40 mb-4">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  className={readinessTrack}
                  strokeWidth="8"
                />
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  className={readinessBg}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(readiness / 100) * 327} 327`}
                  style={{ transition: "stroke-dasharray 0.8s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={cn("font-display text-3xl font-semibold tabular-nums", readinessColor)}>
                  {readiness.toFixed(0)}%
                </span>
                <span className="text-text-secondary text-xs">ready</span>
              </div>
            </div>
            <p className="text-text-secondary text-sm text-center">
              {readiness >= 80 ? "You're on track for retirement!" :
               readiness >= 50 ? "Getting there — keep saving." :
               "More savings needed to reach your goal."}
            </p>
          </motion.div>

          {/* Projection Chart */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card rounded-2xl p-6 lg:col-span-2"
          >
            <h4 className="text-sm text-text-secondary font-medium mb-4">Portfolio Projection</h4>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projectionData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="projGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="age"
                    tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `$${(v / 1000000).toFixed(1)}M`}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "12px",
                      fontSize: "13px",
                    }}
                    formatter={(value: number) => [formatMoney(value), "Portfolio"]}
                    labelFormatter={(label: number) => `Age ${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    fill="url(#projGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* Interactive Modeling */}
      <Section title="Model Your Retirement">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card rounded-2xl p-4 md:p-6"
        >
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Retirement Age Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-text-secondary font-medium">Retirement Age</label>
                <span className="text-sm font-semibold tabular-nums text-accent">{retirementAge}</span>
              </div>
              <input
                type="range"
                min={50}
                max={75}
                step={1}
                value={retirementAge}
                onChange={(e) => setRetirementAge(parseInt(e.target.value))}
                className="w-full accent-accent h-1.5"
              />
              <div className="flex justify-between text-xs text-text-secondary">
                <span>50</span>
                <span>75</span>
              </div>
            </div>

            {/* Monthly Spending Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-text-secondary font-medium">Monthly Retirement Spending</label>
                <span className="text-sm font-semibold tabular-nums text-accent">{formatMoney(monthlyRetirementSpend)}</span>
              </div>
              <input
                type="range"
                min={2000}
                max={20000}
                step={500}
                value={monthlyRetirementSpend}
                onChange={(e) => setMonthlyRetirementSpend(parseInt(e.target.value))}
                className="w-full accent-accent h-1.5"
              />
              <div className="flex justify-between text-xs text-text-secondary">
                <span>$2k</span>
                <span>$20k</span>
              </div>
            </div>
          </div>

          {/* Strategy Selector */}
          <div className="mb-6">
            <label className="text-sm text-text-secondary font-medium mb-2 block">Withdrawal Strategy</label>
            <div className="flex flex-wrap gap-2">
              {strategies.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedStrategy(s.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                    selectedStrategy === s.id
                      ? "bg-accent/10 text-accent border-accent/30"
                      : "border-border text-text-secondary hover:text-text hover:border-accent/20"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Run Full Simulation Button */}
          <Button
            onClick={() => navigate("/probability")}
            className="w-full sm:w-auto"
          >
            Run Full Simulation
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </motion.div>
      </Section>

    </div>
  );
}
