import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Target, Building2, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import { FanChart } from "../components/charts/fan-chart";
import { SpaghettiChart } from "../components/charts/spaghetti-chart";
import { HistogramChart } from "../components/charts/histogram-chart";
import { RollingPeriodsChart } from "../components/charts/rolling-periods-chart";
import { Button } from "../components/ui/button";
import { useLocation } from "wouter";

type MonteCarloView = "fan" | "spaghetti";

interface SimulationParams {
  retirementAge: number;
  monthlySpend: number;
  stockAllocation: number;
  bondAllocation: number;
}

export function ProbabilityOfSuccess() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [mcView, setMcView] = useState<MonteCarloView>("fan");
  const [params, setParams] = useState<SimulationParams>({
    retirementAge: 65,
    monthlySpend: 5000,
    stockAllocation: 70,
    bondAllocation: 30,
  });
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [percentiles, setPercentiles] = useState<any[]>([]);
  const [histogram, setHistogram] = useState<any[]>([]);
  const [samplePaths, setSamplePaths] = useState<any[]>([]);
  const [backtestPeriods, setBacktestPeriods] = useState<any[]>([]);
  const [backtestSummary, setBacktestSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const runSimulations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setWarning(null);

      // Get portfolio allocation
      const allocation = await api.getPortfolioAllocation();
      setTotalValue(allocation.totalValue);

      // Run Monte Carlo simulation
      const mcResponse = await fetch("/api/simulations/monte-carlo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initialBalance: allocation.totalValue,
          retirementAge: params.retirementAge,
          monthlySpend: params.monthlySpend,
          stockAllocation: params.stockAllocation / 100,
          bondAllocation: params.bondAllocation / 100,
        }),
      });

      if (!mcResponse.ok) {
        const errorData = await mcResponse.json();
        throw new Error(errorData.error || "Monte Carlo simulation failed");
      }

      const mcData = await mcResponse.json();
      setSuccessRate(mcData.successRate);
      setPercentiles(mcData.percentiles || []);
      setHistogram(mcData.histogram || []);
      setSamplePaths(mcData.samplePaths || []);

      if (mcData.warning) {
        setWarning(mcData.warning);
      }

      // Run Backtest simulation
      const backtestResponse = await fetch("/api/simulations/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initialBalance: allocation.totalValue,
          retirementAge: params.retirementAge,
          monthlySpend: params.monthlySpend,
          stockAllocation: params.stockAllocation / 100,
          bondAllocation: params.bondAllocation / 100,
        }),
      });

      if (!backtestResponse.ok) {
        const errorData = await backtestResponse.json();
        throw new Error(errorData.error || "Backtest simulation failed");
      }

      const backtestData = await backtestResponse.json();
      setBacktestPeriods(backtestData.periods || []);
      setBacktestSummary(backtestData.summary || null);

      if (backtestData.warning && !warning) {
        setWarning(backtestData.warning);
      }
    } catch (err) {
      console.error("Simulation error:", err);
      setError(err instanceof Error ? err.message : "Failed to run simulations");
    } finally {
      setLoading(false);
    }
  }, [params, warning]);

  useEffect(() => {
    runSimulations();
  }, []);

  const fanData = percentiles.map((p) => ({
    year: p.year,
    p5: p.p5 || p.p10, // fallback to p10 if p5 not available
    p25: p.p25,
    p50: p.p50,
    p75: p.p75,
    p95: p.p95 || p.p90, // fallback to p90 if p95 not available
  }));

  const getSuccessRateColor = (rate: number | null) => {
    if (rate === null) return "text-gray-500";
    if (rate >= 80) return "text-green-600";
    if (rate >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getSuccessRateBackground = (rate: number | null) => {
    if (rate === null) return "bg-gray-50";
    if (rate >= 80) return "bg-green-50";
    if (rate >= 60) return "bg-yellow-50";
    return "bg-red-50";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">Running simulations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-600" />
            <h2 className="text-lg font-semibold text-red-900">Simulation Error</h2>
          </div>
          <p className="text-red-800 mb-4">{error}</p>
          <Button onClick={() => runSimulations()} variant="outline">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (successRate === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Target className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">No simulation data available</p>
          <Button onClick={() => runSimulations()} className="mt-4">
            Run Simulations
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      {/* Hero Success Rate Card */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "rounded-lg border p-8 text-center",
          getSuccessRateBackground(successRate)
        )}
      >
        <div className="flex items-center justify-center gap-3 mb-4">
          <Target className={cn("w-8 h-8", getSuccessRateColor(successRate))} />
          <h1 className="text-2xl font-bold text-gray-900">
            Probability of Success
          </h1>
        </div>
        <div className={cn("text-6xl font-bold mb-2", getSuccessRateColor(successRate))}>
          {successRate.toFixed(1)}%
        </div>
        <p className="text-gray-700">
          Based on Monte Carlo simulation of {percentiles.length > 0 ? percentiles[percentiles.length - 1].year : 0} years
        </p>
      </motion.div>

      {/* Warning Banner */}
      {warning && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div>
            <h3 className="font-semibold text-yellow-900 mb-1">Partial Results</h3>
            <p className="text-yellow-800 text-sm">{warning}</p>
          </div>
        </motion.div>
      )}

      {/* Parameter Sliders */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-lg border p-6 space-y-6"
      >
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Simulation Parameters
        </h2>

        {/* Retirement Age */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Retirement Age
            </label>
            <span className="text-sm font-semibold text-gray-900">
              {params.retirementAge} years
            </span>
          </div>
          <input
            type="range"
            min="55"
            max="75"
            step="1"
            value={params.retirementAge}
            onChange={(e) => setParams({ ...params, retirementAge: parseInt(e.target.value) })}
            className="w-full"
          />
        </div>

        {/* Monthly Spend */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Monthly Spend
            </label>
            <span className="text-sm font-semibold text-gray-900">
              ${params.monthlySpend.toLocaleString()}
            </span>
          </div>
          <input
            type="range"
            min="2000"
            max="15000"
            step="500"
            value={params.monthlySpend}
            onChange={(e) => setParams({ ...params, monthlySpend: parseInt(e.target.value) })}
            className="w-full"
          />
        </div>

        {/* Stock/Bond Allocation Display */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            Asset Allocation
          </label>
          <div className="flex gap-4">
            <div className="flex-1 bg-blue-50 rounded p-3 text-center">
              <div className="text-sm text-gray-600 mb-1">Stocks</div>
              <div className="text-lg font-semibold text-blue-700">
                {params.stockAllocation}%
              </div>
            </div>
            <div className="flex-1 bg-green-50 rounded p-3 text-center">
              <div className="text-sm text-gray-600 mb-1">Bonds</div>
              <div className="text-lg font-semibold text-green-700">
                {params.bondAllocation}%
              </div>
            </div>
          </div>
        </div>

        <Button onClick={() => runSimulations()} className="w-full">
          <RefreshCw className="w-4 h-4 mr-2" />
          Update Simulations
        </Button>
      </motion.div>

      {/* Fan/Spaghetti Chart Toggle */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white rounded-lg border p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Monte Carlo Projection
          </h2>
          <div className="flex gap-2">
            <Button
              variant={mcView === "fan" ? "default" : "outline"}
              size="sm"
              onClick={() => setMcView("fan")}
            >
              Fan Chart
            </Button>
            <Button
              variant={mcView === "spaghetti" ? "default" : "outline"}
              size="sm"
              onClick={() => setMcView("spaghetti")}
            >
              Spaghetti Chart
            </Button>
          </div>
        </div>

        {mcView === "fan" && fanData.length > 0 && (
          <FanChart data={fanData} />
        )}

        {mcView === "spaghetti" && samplePaths.length > 0 && (
          <SpaghettiChart
            paths={samplePaths}
            years={percentiles.length > 0 ? percentiles[percentiles.length - 1].year : 30}
          />
        )}
      </motion.div>

      {/* Histogram Chart */}
      {histogram.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-lg border p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            Distribution of Final Portfolio Values
          </h2>
          <HistogramChart data={histogram} />
        </motion.div>
      )}

      {/* Backtest Rolling Periods Chart */}
      {backtestPeriods.length > 0 && backtestSummary && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white rounded-lg border p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            Historical Backtest Analysis
          </h2>
          <RollingPeriodsChart data={backtestPeriods} initialBalance={totalValue} />

          {/* Backtest Summary */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-sm text-gray-600 mb-1">Success Rate</div>
              <div className={cn(
                "text-2xl font-bold",
                getSuccessRateColor(backtestSummary.successRate * 100)
              )}>
                {(backtestSummary.successRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-600 mb-1">Avg Final Value</div>
              <div className="text-2xl font-bold text-gray-900">
                ${(backtestSummary.avgFinalValue / 1000).toFixed(0)}K
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-600 mb-1">Periods Tested</div>
              <div className="text-2xl font-bold text-gray-900">
                {backtestSummary.totalPeriods}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
