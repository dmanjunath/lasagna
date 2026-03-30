import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Target, TrendingUp, AlertTriangle, RefreshCw, Calendar, Wallet, Building2, Plus } from "lucide-react";
import { cn, formatMoney } from "../lib/utils";
import { api } from "../lib/api";
import { usePageContext } from "../lib/page-context";
import { FanChart } from "../components/charts/fan-chart";
import { SpaghettiChart } from "../components/charts/spaghetti-chart";
import { HistogramChart } from "../components/charts/histogram-chart";
import { RollingPeriodsChart } from "../components/charts/rolling-periods-chart";
import { Button } from "../components/ui/button";
import { Section } from "../components/common/section";
import { StatCard } from "../components/common/stat-card";
import { Clock } from "lucide-react";

type MonteCarloView = "fan" | "spaghetti";

interface Allocation {
  usStocks: number;
  intlStocks: number;
  bonds: number;
  reits: number;
  cash: number;
}

interface PortfolioPreset {
  id: string;
  label: string;
  allocation: Allocation;
}

// Historical average annual returns (approximate long-term averages)
const HISTORICAL_RETURNS: Record<keyof Allocation, number> = {
  usStocks: 10.0,    // S&P 500 ~10% since 1926
  intlStocks: 7.5,   // MSCI EAFE ~7-8%
  bonds: 5.0,        // Aggregate bonds ~5%
  reits: 9.5,        // REITs ~9-10%
  cash: 2.0,         // T-bills/money market ~2%
};

const PRESETS: PortfolioPreset[] = [
  { id: "conservative", label: "Conservative", allocation: { usStocks: 30, intlStocks: 10, bonds: 50, reits: 5, cash: 5 } },
  { id: "balanced", label: "Balanced", allocation: { usStocks: 45, intlStocks: 15, bonds: 30, reits: 5, cash: 5 } },
  { id: "growth", label: "Growth", allocation: { usStocks: 60, intlStocks: 20, bonds: 15, reits: 5, cash: 0 } },
  { id: "aggressive", label: "Aggressive", allocation: { usStocks: 70, intlStocks: 20, bonds: 5, reits: 5, cash: 0 } },
];

function allocationTotal(a: Allocation): number {
  return a.usStocks + a.intlStocks + a.bonds + a.reits + a.cash;
}

function getExpectedReturn(allocation: Allocation): number {
  const total = allocationTotal(allocation);
  if (total === 0) return 0;
  return (
    (allocation.usStocks * HISTORICAL_RETURNS.usStocks +
     allocation.intlStocks * HISTORICAL_RETURNS.intlStocks +
     allocation.bonds * HISTORICAL_RETURNS.bonds +
     allocation.reits * HISTORICAL_RETURNS.reits +
     allocation.cash * HISTORICAL_RETURNS.cash) / total
  );
}

export function ProbabilityOfSuccess() {
  const [, navigate] = useLocation();
  const { setPageContext } = usePageContext();
  const [initialLoading, setInitialLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [totalValue, setTotalValue] = useState(0);
  const [mcView, setMcView] = useState<MonteCarloView>("fan");
  const [hasAccounts, setHasAccounts] = useState(false);

  // Parameters - seeded from real data
  const [retirementAge, setRetirementAge] = useState(65);
  const [lifeExpectancy, setLifeExpectancy] = useState(95);
  const [monthlySpend, setMonthlySpend] = useState(5000);
  const [allocation, setAllocation] = useState<Allocation>({ usStocks: 60, intlStocks: 10, bonds: 25, reits: 5, cash: 0 });
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const currentAllocationRef = useRef<Allocation | null>(null);

  // Results
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [percentiles, setPercentiles] = useState<any[]>([]);
  const [histogram, setHistogram] = useState<any[]>([]);
  const [samplePaths, setSamplePaths] = useState<any[]>([]);
  const [backtestPeriods, setBacktestPeriods] = useState<any[]>([]);
  const [backtestSummary, setBacktestSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Load real data from user's accounts
  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] })),
      api.getPortfolioAllocation().catch(() => ({ allocation: null, totalValue: 0 })),
    ]).then(([balanceData, portfolioData]) => {
      const balances = balanceData.balances;

      // Compute total portfolio value from ALL accounts
      let assets = 0;
      let liabilities = 0;
      let creditSpend = 0;

      for (const b of balances) {
        const val = parseFloat(b.balance || "0");
        if (b.type === "credit" || b.type === "loan") {
          liabilities += val;
          if (b.type === "credit") creditSpend += val;
        } else {
          assets += val;
        }
      }

      const netWorth = assets - liabilities;
      setHasAccounts(balances.length > 0);

      if (netWorth > 0) {
        setTotalValue(netWorth);
      }

      // Seed monthly spend from credit card balances
      if (creditSpend > 0) {
        setMonthlySpend(Math.round(creditSpend / 100) * 100); // round to nearest 100
      }

      // Seed allocation from actual portfolio if available
      if (portfolioData.allocation) {
        const real = portfolioData.allocation;
        const realTotal = real.usStocks + real.intlStocks + real.bonds + real.reits + real.cash;
        if (realTotal > 0) {
          // Convert fractions to percentages
          const scale = realTotal <= 1 ? 100 : 1;
          const realAlloc: Allocation = {
            usStocks: Math.round(real.usStocks * scale),
            intlStocks: Math.round(real.intlStocks * scale),
            bonds: Math.round(real.bonds * scale),
            reits: Math.round(real.reits * scale),
            cash: Math.round(real.cash * scale),
          };
          // Adjust rounding to hit exactly 100
          const diff = 100 - allocationTotal(realAlloc);
          realAlloc.usStocks += diff;

          currentAllocationRef.current = realAlloc;
          setAllocation(realAlloc);
          setActivePreset("current");
        }
      }
    }).finally(() => setInitialLoading(false));
  }, []);

  // Set page context for floating chat
  useEffect(() => {
    if (!initialLoading && hasAccounts) {
      setPageContext({
        pageId: 'probability-of-success',
        pageTitle: 'Probability of Success',
        description: 'Monte Carlo simulation and historical backtesting for retirement planning.',
        data: {
          totalValue,
          retirementAge,
          monthlySpend,
          allocation,
          successRate,
          backtestSummary,
        },
      });
    }
  }, [initialLoading, hasAccounts, totalValue, retirementAge, lifeExpectancy, monthlySpend, allocation, successRate, backtestSummary, setPageContext]);

  const runSimulations = useCallback(async () => {
    if (totalValue <= 0) return;
    try {
      setSimulating(true);
      setError(null);
      setWarning(null);

      const years = lifeExpectancy - retirementAge;
      const annualWithdrawal = monthlySpend * 12;

      // Run Monte Carlo
      const mcResponse = await fetch("/api/simulations/monte-carlo", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocation,
          initialValue: totalValue,
          annualWithdrawal,
          years,
          simulations: 5000,
          includeSamplePaths: true,
          numSamplePaths: 20,
        }),
      });

      if (!mcResponse.ok) {
        const errorData = await mcResponse.json().catch(() => ({}));
        throw new Error((errorData as { error?: string }).error || "Monte Carlo simulation failed");
      }

      const mcData = await mcResponse.json();
      setSuccessRate(mcData.successRate);

      if (mcData.percentiles?.p50) {
        setPercentiles(mcData.percentiles.p50.map((_: number, i: number) => ({
          year: i,
          p5: mcData.percentiles.p5[i],
          p25: mcData.percentiles.p25[i],
          p50: mcData.percentiles.p50[i],
          p75: mcData.percentiles.p75[i],
          p95: mcData.percentiles.p95[i],
        })));
      }

      setHistogram(mcData.histogram || []);
      setSamplePaths(mcData.samplePaths || []);
      if (mcData.warning) setWarning(mcData.warning);

      // Run Backtest
      const btResponse = await fetch("/api/simulations/backtest", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocation,
          initialValue: totalValue,
          annualWithdrawal,
          years,
        }),
      });

      if (btResponse.ok) {
        const btData = await btResponse.json();
        setBacktestPeriods(btData.periods || []);
        setBacktestSummary(btData.summary || null);
        if (btData.warning && !warning) setWarning(btData.warning);
      }
    } catch (err) {
      console.error("Simulation error:", err);
      setError(err instanceof Error ? err.message : "Failed to run simulations");
    } finally {
      setSimulating(false);
    }
  }, [retirementAge, lifeExpectancy, monthlySpend, allocation, totalValue, warning]);

  // Auto-run after initial data loads and when key parameters change
  useEffect(() => {
    if (!initialLoading && totalValue > 0) {
      runSimulations();
    }
  }, [initialLoading, retirementAge, lifeExpectancy, monthlySpend]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPreset = (preset: PortfolioPreset) => {
    setAllocation(preset.allocation);
    setActivePreset(preset.id);
  };

  const selectCurrentAllocation = () => {
    if (currentAllocationRef.current) {
      setAllocation(currentAllocationRef.current);
      setActivePreset("current");
    }
  };

  const updateAllocation = (key: keyof Allocation, value: number) => {
    setAllocation(prev => ({ ...prev, [key]: value }));
    setActivePreset("custom");
  };

  const fanData = percentiles.map((p) => ({
    year: p.year,
    p5: p.p5 || p.p10,
    p25: p.p25,
    p50: p.p50,
    p75: p.p75,
    p95: p.p95 || p.p90,
  }));

  const getStatus = (rate: number | null): 'success' | 'warning' | 'danger' | 'default' => {
    if (rate === null) return 'default';
    if (rate >= 80) return 'success';
    if (rate >= 60) return 'warning';
    return 'danger';
  };

  // Loading state
  if (initialLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-accent" />
          <p className="text-text-muted">Loading your financial data...</p>
        </div>
      </div>
    );
  }

  // Empty state - no accounts
  if (!hasAccounts) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center"
        >
          <Building2 className="w-16 h-16 text-text-muted mb-6" />
          <h2 className="font-display text-2xl md:text-3xl font-medium mb-3">
            No Accounts Linked
          </h2>
          <p className="text-text-muted max-w-md mb-8">
            Connect your bank and investment accounts to run retirement probability simulations based on your real portfolio.
          </p>
          <Button onClick={() => navigate("/accounts")}>
            <Plus className="w-4 h-4 mr-2" />
            Link Your First Account
          </Button>
        </motion.div>
      </div>
    );
  }

  const status = getStatus(successRate);
  const allocTotal = allocationTotal(allocation);
  const allocValid = Math.abs(allocTotal - 100) < 0.5;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-6 md:p-8 mb-6 md:mb-8"
      >
        {simulating ? (
          <div className="flex items-center gap-4 py-4">
            <RefreshCw className="w-8 h-8 animate-spin text-accent" />
            <div>
              <p className="text-text-muted text-sm">Running simulations...</p>
              <p className="text-xs text-text-muted mt-1">5,000 Monte Carlo + historical backtest</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center gap-4">
            <AlertTriangle className="w-10 h-10 text-danger flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-danger">Simulation Error</p>
              <p className="text-text-muted text-sm mt-1">{error}</p>
            </div>
            <Button variant="secondary" onClick={runSimulations}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : successRate !== null ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center",
                status === 'success' && "bg-success/10",
                status === 'warning' && "bg-warning/10",
                status === 'danger' && "bg-danger/10",
              )}>
                <Target className={cn(
                  "w-8 h-8 md:w-10 md:h-10",
                  status === 'success' && "text-success",
                  status === 'warning' && "text-warning",
                  status === 'danger' && "text-danger",
                )} />
              </div>
              <div>
                <p className="text-text-muted text-sm mb-1">Probability of Success</p>
                <div className={cn(
                  "font-display text-4xl md:text-5xl font-semibold tabular-nums",
                  status === 'success' && "text-success",
                  status === 'warning' && "text-warning",
                  status === 'danger' && "text-danger",
                )}>
                  {(successRate * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="text-text-muted text-sm md:text-right">
              Based on {lifeExpectancy - retirementAge} year projection
              <br />
              <span className="text-text-secondary">Starting balance: {formatMoney(totalValue)}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-text-muted">Adjust parameters below and run the simulation</p>
          </div>
        )}
      </motion.div>

      {/* Warning */}
      {warning && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4 mb-6 border-warning/30 bg-warning/5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
            <p className="text-text-muted text-sm">{warning}</p>
          </div>
        </motion.div>
      )}

      {/* Stats Row */}
      {successRate !== null && (
        <div className={cn("grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 md:mb-8", simulating && "opacity-50 pointer-events-none")}>
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-5 h-5 text-text-muted" />
              <span className="text-sm text-text-secondary font-medium">Retirement Age</span>
            </div>
            <input
              type="number"
              defaultValue={retirementAge}
              min={18}
              max={200}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 18 && v <= 200) setRetirementAge(v);
                else e.target.value = String(retirementAge);
              }}
              className="font-display text-2xl font-semibold tabular-nums bg-transparent border-b-2 border-accent focus:outline-none w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-5 h-5 text-text-muted" />
              <span className="text-sm text-text-secondary font-medium">Life Expectancy</span>
            </div>
            <input
              type="number"
              defaultValue={lifeExpectancy}
              min={18}
              max={200}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 18 && v <= 200) setLifeExpectancy(v);
                else e.target.value = String(lifeExpectancy);
              }}
              className="font-display text-2xl font-semibold tabular-nums bg-transparent border-b-2 border-accent focus:outline-none w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <StatCard
            icon={Clock}
            label="Duration"
            value={`${lifeExpectancy - retirementAge} years`}
            description="Life expectancy − retirement age"
            delay={0.15}
          />
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="w-5 h-5 text-text-muted" />
              <span className="text-sm text-text-secondary font-medium">Monthly Spend</span>
            </div>
            <input
              type="number"
              defaultValue={monthlySpend}
              min={500}
              max={50000}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 500 && v <= 50000) setMonthlySpend(v);
                else e.target.value = String(monthlySpend);
              }}
              className="font-display text-2xl font-semibold tabular-nums bg-transparent border-b-2 border-accent focus:outline-none w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
      )}

      {/* Parameters */}
      <Section title="Portfolio Allocation">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card rounded-2xl p-4 md:p-6"
        >
          {/* Portfolio Allocation Presets */}
          <div>
            <div className="flex flex-wrap gap-2 mb-4">
              {currentAllocationRef.current && (
                <button
                  onClick={selectCurrentAllocation}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                    activePreset === "current"
                      ? "bg-accent/10 text-accent border-accent/30"
                      : "border-border text-text-secondary hover:text-text hover:border-accent/20"
                  )}
                >
                  Current Portfolio
                </button>
              )}
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPreset(p)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                    activePreset === p.id
                      ? "bg-accent/10 text-accent border-accent/30"
                      : "border-border text-text-secondary hover:text-text hover:border-accent/20"
                  )}
                >
                  {p.label}
                </button>
              ))}
              {activePreset === "custom" && (
                <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface text-text-muted border border-border">
                  Custom
                </span>
              )}
            </div>

            {/* Allocation Sliders */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
              {([
                ["usStocks", "US Stocks"],
                ["intlStocks", "Int'l Stocks"],
                ["bonds", "Bonds"],
                ["reits", "REITs"],
                ["cash", "Cash"],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-text-muted">
                      {label}
                      <span className="ml-1.5 text-text-muted/60">({HISTORICAL_RETURNS[key]}% avg)</span>
                    </label>
                    <span className="text-xs font-semibold tabular-nums">{allocation[key]}%</span>
                  </div>
                  <input type="range" min="0" max="100" step="5"
                    value={allocation[key]}
                    onChange={(e) => updateAllocation(key, parseInt(e.target.value))}
                    className="w-full accent-accent h-1.5" />
                </div>
              ))}
            </div>

            {/* Expected Return & Validation */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-text-muted" />
                <span className="text-sm text-text-secondary">
                  Expected return: <span className="font-semibold text-text">{getExpectedReturn(allocation).toFixed(1)}%</span>
                </span>
              </div>
              {!allocValid && (
                <p className="text-xs text-warning">
                  Allocation totals {allocTotal}% — adjust to equal 100%
                </p>
              )}
            </div>
          </div>

          {/* Run Button */}
          <div className="border-t border-border pt-4">
            <Button onClick={runSimulations} disabled={simulating || !allocValid || totalValue <= 0}>
              {simulating ? (
                <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Running...</span>
              ) : (
                <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Run Simulation</span>
              )}
            </Button>
          </div>
        </motion.div>
      </Section>

      {/* Monte Carlo Chart */}
      {percentiles.length > 0 && !simulating && (
        <Section
          title="Monte Carlo Projection"
          actions={
            <div className="flex gap-2">
              <Button variant={mcView === "fan" ? "default" : "secondary"} size="sm" onClick={() => setMcView("fan")}>Fan Chart</Button>
              <Button variant={mcView === "spaghetti" ? "default" : "secondary"} size="sm" onClick={() => setMcView("spaghetti")}>Paths</Button>
            </div>
          }
        >
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card rounded-2xl p-4 md:p-6">
            {mcView === "fan" && fanData.length > 0 && <FanChart data={fanData} />}
            {mcView === "spaghetti" && samplePaths.length > 0 && (
              <SpaghettiChart paths={samplePaths} years={lifeExpectancy - retirementAge} />
            )}
          </motion.div>
        </Section>
      )}

      {/* Histogram */}
      {histogram.length > 0 && !simulating && (
        <Section title="Distribution of Final Portfolio Values">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card rounded-2xl p-4 md:p-6">
            <HistogramChart data={histogram} />
          </motion.div>
        </Section>
      )}

      {/* Historical Backtest */}
      {backtestPeriods.length > 0 && backtestSummary && !simulating && (
        <Section title="Historical Backtest Analysis">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-card rounded-2xl p-4 md:p-6">
            <RollingPeriodsChart data={backtestPeriods} initialBalance={totalValue} />
            <div className="grid grid-cols-3 gap-4 pt-6 mt-6 border-t border-border">
              <div className="text-center">
                <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Success Rate</div>
                <div className={cn(
                  "font-display text-2xl md:text-3xl font-semibold tabular-nums",
                  getStatus(backtestSummary.successRate * 100) === 'success' && "text-success",
                  getStatus(backtestSummary.successRate * 100) === 'warning' && "text-warning",
                  getStatus(backtestSummary.successRate * 100) === 'danger' && "text-danger",
                )}>
                  {(backtestSummary.successRate * 100).toFixed(1)}%
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Avg Final Value</div>
                <div className="font-display text-2xl md:text-3xl font-semibold tabular-nums">
                  {formatMoney(backtestSummary.avgFinalValue, true)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Periods Tested</div>
                <div className="font-display text-2xl md:text-3xl font-semibold tabular-nums">
                  {backtestSummary.totalPeriods}
                </div>
              </div>
            </div>
          </motion.div>
        </Section>
      )}
    </div>
  );
}
