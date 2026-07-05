import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Target, TrendingUp, AlertTriangle, RefreshCw, Calendar, Wallet,
  Building2, Plus, ArrowUp, ArrowDown,
} from "lucide-react";
import {
  ComposedChart, Area, Line, LineChart, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { cn, formatMoney } from "../lib/utils";
import { api, API_BASE } from "../lib/api";
import { usePageContext } from "../lib/page-context";
import { Button, EmptyState, Skeleton } from "../components/uikit";

// ── Chart palette (resolves via CSS vars, so light/dark swap automatically) ──
const VIZ = "var(--ui-viz-2)"; // periwinkle — the MC value channel
const C_GOOD = "rgb(var(--ui-brand))";
const C_WARN = "rgb(var(--ui-caution))";
const C_RISK = "rgb(var(--ui-negative))";
const C_GRID = "var(--ui-line)";
const C_AXIS = "rgb(var(--ui-content-muted))";
const C_PANEL = "rgb(var(--ui-panel))";

const tooltipStyle = {
  background: "rgb(var(--ui-panel-raised))",
  border: "1px solid var(--ui-line)",
  borderRadius: 12,
  boxShadow: "var(--ui-shadow-md)",
  fontSize: 12,
  color: "rgb(var(--ui-content))",
  fontVariantNumeric: "tabular-nums" as const,
};

function fmtShort(value: number): string {
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${sign}$${(v / 1_000).toFixed(0)}K`;
  return `${sign}$${v.toFixed(0)}`;
}

// Track the `.dark` class on <html> so chart fills can be strengthened in dark mode.
function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Types (formerly imported from the shared simulation components) ──────────
type StrategyType = "constant_dollar" | "percent_of_portfolio" | "guardrails";
interface StrategyParams {
  inflationAdjusted?: boolean;
  withdrawalRate?: number;
  floor?: number | null;
  ceiling?: number | null;
  initialRate?: number;
  capitalPreservationThreshold?: number;
  prosperityThreshold?: number;
  increaseAmount?: number;
  decreaseAmount?: number;
}
interface YearDetailData {
  year: number;
  portfolioValue: number;
  portfolioValueReal: number;
  marketReturn: number;
  assetReturns?: Record<string, number>;
  assetWeights?: Record<string, number>;
  withdrawalAmount: number;
  withdrawalAmountReal: number;
  cumulativeInflation: number;
  withdrawalSource?: string;
  notes: string[];
}
interface BacktestPeriod {
  startYear: number;
  endBalance: number;
  yearsLasted: number;
  status: "success" | "close" | "failed";
  worstDrawdown: number;
  worstYear: number;
  yearByYear: YearDetailData[];
}

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

const ALLOC_VIZ: Record<keyof Allocation, string> = {
  usStocks: "var(--ui-viz-2)",
  intlStocks: "var(--ui-viz-5)",
  bonds: "var(--ui-viz-1)",
  reits: "var(--ui-viz-3)",
  cash: "var(--ui-viz-7)",
};

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

// ─────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted", className)}>
      {children}
    </div>
  );
}

function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6", className)} style={style}>
      {children}
    </div>
  );
}

function Section({ title, action, children, className }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mt-8", className)}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stat cards
// ─────────────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-4 sm:p-5">
      <div className="flex items-center gap-2 text-content-muted">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <div className="mt-2 font-editorial text-[24px] font-extrabold leading-none tracking-[-0.02em] text-content ui-tnum">
        {value}
      </div>
    </div>
  );
}

function EditableStatCard({
  icon: Icon, label, value, min, max, onChange,
}: {
  icon: React.ElementType; label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-4 sm:p-5">
      <div className="flex items-center gap-2 text-content-muted">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <input
        type="number"
        inputMode="numeric"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => {
          const v = parseInt(draft, 10);
          const clamped = isNaN(v) ? min : Math.max(min, Math.min(max, v));
          onChange(clamped);
          setDraft(String(clamped));
        }}
        className="ui-focus mt-2 w-full rounded-ui-sm border border-transparent bg-transparent font-editorial text-[24px] font-extrabold leading-none tracking-[-0.02em] text-[rgb(var(--ui-brand-ink))] ui-tnum outline-none focus:border-line hover:bg-canvas-sunken [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Charts — recharts, recolored onto the --ui-viz palette (legible in dark)
// ─────────────────────────────────────────────────────────────────────────

interface FanDatum { year: number; p5: number; p25: number; p50: number; p75: number; p95: number; }

// Fixed-order tooltip (5th → 25th → median → 75th → 95th), so the percentile
// list never appears jumbled by recharts' series-declaration order.
const FAN_ROWS: { key: keyof FanDatum; label: string }[] = [
  { key: "p95", label: "95th pct" },
  { key: "p75", label: "75th pct" },
  { key: "p50", label: "Median" },
  { key: "p25", label: "25th pct" },
  { key: "p5", label: "5th pct" },
];
function FanTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const d: FanDatum = payload[0].payload;
  return (
    <div style={tooltipStyle} className="px-3 py-2">
      <div className="mb-1 font-semibold text-content">Year {label}</div>
      {FAN_ROWS.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-6 text-[12px]">
          <span className="text-content-muted">{r.label}</span>
          <span className="font-semibold text-content">{fmtShort(d[r.key])}</span>
        </div>
      ))}
    </div>
  );
}

function FanChart({ data, height = 300 }: { data: FanDatum[]; height?: number }) {
  const isDark = useIsDark();
  if (!data || data.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center text-content-muted">No data available</div>;
  }
  // Right-skewed outcomes: the 95th-percentile tail is orders of magnitude above
  // the median, which flattens the typical band. Clip the y-axis to a headroom
  // above the 75th-percentile band so the median / middle-50% stay legible; the
  // upper tail simply extends past the top edge.
  const p5Min = Math.min(...data.map((d) => d.p5));
  const p75Max = Math.max(...data.map((d) => d.p75));
  const p95Max = Math.max(...data.map((d) => d.p95));
  const yMin = Math.max(0, p5Min);
  const yMax = Math.min(p95Max, Math.max(p75Max * 1.35, yMin + 1));
  // Fills need more presence on the near-black dark card.
  const outerFrom = isDark ? 0.3 : 0.16;
  const outerTo = isDark ? 0.12 : 0.05;
  const innerFrom = isDark ? 0.52 : 0.36;
  const innerTo = isDark ? 0.28 : 0.16;
  return (
    <div style={{ height, width: "100%" }} className="ui-tnum">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="pos-outer" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIZ} stopOpacity={outerFrom} />
              <stop offset="100%" stopColor={VIZ} stopOpacity={outerTo} />
            </linearGradient>
            <linearGradient id="pos-inner" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIZ} stopOpacity={innerFrom} />
              <stop offset="100%" stopColor={VIZ} stopOpacity={innerTo} />
            </linearGradient>
          </defs>
          <XAxis dataKey="year" tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `Yr ${v}`} />
          <YAxis tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={fmtShort} domain={[yMin, yMax]} allowDataOverflow />
          <Tooltip content={<FanTooltip />} />
          <ReferenceLine y={0} stroke={C_GRID} strokeDasharray="3 3" />
          <Area type="monotone" dataKey="p95" stroke="none" fill="url(#pos-outer)" fillOpacity={1} isAnimationActive={false} />
          <Area type="monotone" dataKey="p5" stroke="none" fill={C_PANEL} fillOpacity={1} isAnimationActive={false} />
          <Area type="monotone" dataKey="p75" stroke="none" fill="url(#pos-inner)" fillOpacity={1} isAnimationActive={false} />
          <Area type="monotone" dataKey="p25" stroke="none" fill={C_PANEL} fillOpacity={1} isAnimationActive={false} />
          <Line type="monotone" dataKey="p50" stroke={VIZ} strokeWidth={2.5} dot={false} name="p50" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Static legend so the band meanings aren't hover-only.
function FanLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[12px] text-content-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-[3px]" style={{ background: VIZ, opacity: 0.5 }} />
        Middle 50% (25th–75th)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-[3px]" style={{ background: VIZ, opacity: 0.22 }} />
        90% range (5th–95th)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-[3px] w-4 rounded-full" style={{ background: VIZ }} />
        Median
      </span>
    </div>
  );
}

function SpaghettiChart({ paths, years, height = 300 }: { paths: number[][]; years?: number; height?: number }) {
  if (!paths || paths.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center text-content-muted">No simulation paths available</div>;
  }
  const maxLen = Math.max(...paths.map((p) => p.length));
  const numYears = years ?? maxLen;
  const chartData = Array.from({ length: numYears }, (_, i) => {
    const row: Record<string, number | undefined> = { year: i };
    paths.forEach((path, pi) => { if (i < path.length) row[`p${pi}`] = path[i]; });
    return row;
  });
  const pathColors = paths.map((p) => (p[p.length - 1] > 0 ? C_GOOD : C_RISK));
  const allValues = paths.flat();
  const maxVal = Math.max(...allValues);
  // A single lucky path can be an order of magnitude above the rest, flattening
  // everything else. Clip the top to ~90th percentile of the ending values so
  // the bulk of the paths stay readable; the outlier simply runs off the top.
  const finals = paths.map((p) => p[p.length - 1]).sort((a, b) => a - b);
  const capIdx = Math.min(finals.length - 1, Math.floor(finals.length * 0.9));
  const yMax = Math.min(maxVal, Math.max(finals[capIdx] * 1.1, 1));
  return (
    <div style={{ height, width: "100%" }} className="ui-tnum">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <XAxis dataKey="year" tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `Yr ${v}`} />
          <YAxis tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={fmtShort} domain={[0, yMax]} allowDataOverflow />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `Year ${l}`} formatter={(value) => [fmtShort(typeof value === "number" ? value : 0), "Portfolio"]} />
          <ReferenceLine y={0} stroke={C_GRID} strokeDasharray="3 3" />
          {paths.map((_, i) => (
            <Line key={i} type="monotone" dataKey={`p${i}`} stroke={pathColors[i]} strokeWidth={1.5} strokeOpacity={0.55} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Histogram binning (math preserved from the former shared component)
interface HistogramBucket { bucket: string | number; count: number; status: "success" | "close" | "failure"; }
function getNiceStep(range: number, targetBins: number): number {
  const rough = range / targetBins;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / mag;
  let nice: number;
  if (n <= 1) nice = 1; else if (n <= 2) nice = 2; else if (n <= 2.5) nice = 2.5; else if (n <= 5) nice = 5; else nice = 10;
  return nice * mag;
}
function rebucket(data: HistogramBucket[]): { buckets: HistogramBucket[]; step: number } {
  if (data.length === 0) return { buckets: data, step: 0 };
  const values = data.map((d) => (typeof d.bucket === "string" ? parseFloat(d.bucket) : d.bucket));
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal;
  if (range === 0) return { buckets: data, step: 0 };
  const step = getNiceStep(range, 12);
  const niceMin = Math.floor(minVal / step) * step;
  const niceMax = Math.ceil(maxVal / step) * step;
  const bins = new Map<number, { count: number; statusCounts: Record<string, number> }>();
  for (let b = niceMin; b <= niceMax; b += step) bins.set(b, { count: 0, statusCounts: { success: 0, close: 0, failure: 0 } });
  for (const d of data) {
    const val = typeof d.bucket === "string" ? parseFloat(d.bucket) : d.bucket;
    const key = Math.floor(val / step) * step;
    const bin = bins.get(key);
    if (bin) { bin.count += d.count; bin.statusCounts[d.status] += d.count; }
  }
  const result: HistogramBucket[] = [];
  for (const [boundary, bin] of bins) {
    if (bin.count === 0) continue;
    const { statusCounts } = bin;
    let status: "success" | "close" | "failure";
    if (statusCounts.failure >= statusCounts.success && statusCounts.failure >= statusCounts.close) status = "failure";
    else if (statusCounts.close >= statusCounts.success) status = "close";
    else status = "success";
    result.push({ bucket: boundary, count: bin.count, status });
  }
  result.sort((a, b) => (typeof a.bucket === "number" ? a.bucket : parseFloat(a.bucket)) - (typeof b.bucket === "number" ? b.bucket : parseFloat(b.bucket)));
  return { buckets: result, step };
}
const HIST_COLOR: Record<string, string> = { success: C_GOOD, close: C_WARN, failure: C_RISK };

function HistogramChart({ data, height = 250 }: { data: HistogramBucket[]; height?: number }) {
  const { buckets, step } = rebucket(data);
  const total = buckets.reduce((s, d) => s + d.count, 0);
  const displayData = buckets.map((d) => {
    const v = typeof d.bucket === "string" ? parseFloat(d.bucket) : d.bucket;
    const label = step > 0 ? `${fmtShort(v)}–${fmtShort(v + step)}` : fmtShort(v);
    return { ...d, label };
  });
  return (
    <div className="ui-tnum">
      <div style={{ height, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={displayData} barCategoryGap="8%">
            <XAxis dataKey="label" tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: "var(--ui-brand-softer)" }}
              formatter={(value: any, _n: any, props: any) => {
                const v = typeof value === "number" ? value : 0;
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0.0";
                return [`${props?.payload?.label ?? ""}  —  ${v} runs (${pct}%)`, ""];
              }}
              labelFormatter={() => ""}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={40}>
              {displayData.map((entry, i) => (
                <Cell key={i} fill={HIST_COLOR[entry.status]} fillOpacity={0.9} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center justify-center gap-6 text-[12px] text-content-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C_GOOD }} />Succeeded</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C_WARN }} />Close call</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C_RISK }} />Ran out</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Withdrawal strategy config
// ─────────────────────────────────────────────────────────────────────────

const STRATEGY_TABS: { value: StrategyType; label: string }[] = [
  { value: "constant_dollar", label: "Constant Dollar" },
  { value: "percent_of_portfolio", label: "% of Portfolio" },
  { value: "guardrails", label: "Guardrails" },
];

function SliderField({ label, value, min, max, step, format, minLabel, maxLabel, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; minLabel: string; maxLabel: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[13px] font-medium text-content-secondary">{label}</label>
        <span className="text-[13px] font-bold text-content ui-tnum">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full h-1.5" style={{ accentColor: "rgb(var(--ui-brand))" }} />
      <div className="flex justify-between text-[12px] text-content-muted ui-tnum">
        <span>{minLabel}</span><span>{maxLabel}</span>
      </div>
    </div>
  );
}

function StrategyConfig({ strategy, params, monthlySpend, onMonthlySpendChange, onStrategyChange, onParamsChange }: {
  strategy: StrategyType; params: StrategyParams; monthlySpend: number;
  onMonthlySpendChange: (v: number) => void; onStrategyChange: (s: StrategyType) => void; onParamsChange: (p: StrategyParams) => void;
}) {
  const inflationAdjusted = params.inflationAdjusted ?? true;
  const rate = params.withdrawalRate ?? 4;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {STRATEGY_TABS.map((tab) => {
          const active = strategy === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => onStrategyChange(tab.value)}
              className={cn(
                "inline-flex min-h-[44px] items-center justify-center rounded-ui-md border px-3.5 text-[13px] font-bold transition-colors sm:min-h-0 sm:py-2",
                active
                  ? "border-transparent bg-brand-soft text-[rgb(var(--ui-brand-ink))]"
                  : "border-line text-content-secondary hover:text-content hover:border-line-strong",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {strategy === "constant_dollar" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-content-secondary">Monthly spending</label>
            <div className="relative max-w-[220px]">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-content-muted">$</span>
              <input
                type="number"
                value={monthlySpend}
                min={0}
                max={100000}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) onMonthlySpendChange(v); }}
                className="ui-focus h-11 w-full rounded-ui-md border border-line-strong bg-panel pl-7 pr-3.5 text-content ui-tnum shadow-ui-sm outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <p className="text-[12px] text-content-muted ui-tnum">
              {formatMoney(monthlySpend * 12, true)}/yr{inflationAdjusted ? ", adjusted for inflation each year" : ""}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={inflationAdjusted} onChange={(e) => onParamsChange({ ...params, inflationAdjusted: e.target.checked })} className="h-4 w-4 rounded" style={{ accentColor: "rgb(var(--ui-brand))" }} />
            <span className="text-[13px] font-medium text-content-secondary">Adjust for inflation</span>
          </label>
        </div>
      )}

      {strategy === "percent_of_portfolio" && (
        <div className="space-y-5">
          <SliderField label="Withdrawal rate" value={rate} min={1} max={10} step={0.5} format={(v) => `${v}%`} minLabel="1%" maxLabel="10%" onChange={(v) => onParamsChange({ ...params, withdrawalRate: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-content-secondary">Floor (optional)</label>
              <input type="number" placeholder="Min annual withdrawal" value={params.floor ?? ""} onChange={(e) => onParamsChange({ ...params, floor: e.target.value ? parseFloat(e.target.value) : null })} className="ui-focus h-11 w-full rounded-ui-md border border-line-strong bg-panel px-3.5 text-content shadow-ui-sm outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]" />
            </div>
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-content-secondary">Ceiling (optional)</label>
              <input type="number" placeholder="Max annual withdrawal" value={params.ceiling ?? ""} onChange={(e) => onParamsChange({ ...params, ceiling: e.target.value ? parseFloat(e.target.value) : null })} className="ui-focus h-11 w-full rounded-ui-md border border-line-strong bg-panel px-3.5 text-content shadow-ui-sm outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]" />
            </div>
          </div>
          <p className="text-[12px] text-content-muted ui-tnum">Withdraw {rate}% of your portfolio each year.</p>
        </div>
      )}

      {strategy === "guardrails" && (
        <div className="grid gap-5 sm:grid-cols-2">
          <SliderField label="Initial withdrawal rate" value={params.initialRate ?? 5} min={3} max={8} step={0.5} format={(v) => `${v}%`} minLabel="3%" maxLabel="8%" onChange={(v) => onParamsChange({ ...params, initialRate: v })} />
          <SliderField label="Capital preservation threshold" value={params.capitalPreservationThreshold ?? 20} min={10} max={50} step={5} format={(v) => `${v}%`} minLabel="10%" maxLabel="50%" onChange={(v) => onParamsChange({ ...params, capitalPreservationThreshold: v })} />
          <SliderField label="Prosperity threshold" value={params.prosperityThreshold ?? 20} min={10} max={50} step={5} format={(v) => `${v}%`} minLabel="10%" maxLabel="50%" onChange={(v) => onParamsChange({ ...params, prosperityThreshold: v })} />
          <SliderField label="Decrease amount" value={params.decreaseAmount ?? 10} min={5} max={25} step={5} format={(v) => `${v}%`} minLabel="5%" maxLabel="25%" onChange={(v) => onParamsChange({ ...params, decreaseAmount: v })} />
          <SliderField label="Increase amount" value={params.increaseAmount ?? 10} min={5} max={25} step={5} format={(v) => `${v}%`} minLabel="5%" maxLabel="25%" onChange={(v) => onParamsChange({ ...params, increaseAmount: v })} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Historical backtest table
// ─────────────────────────────────────────────────────────────────────────

type SortKey = "startYear" | "yearsLasted" | "endBalance" | "status" | "worstDrawdown";
const statusOrder: Record<string, number> = { success: 0, close: 1, failed: 2 };
const STATUS_META: Record<string, { label: string; tone: "brand" | "caution" | "negative" }> = {
  success: { label: "Success", tone: "brand" },
  close: { label: "Close", tone: "caution" },
  failed: { label: "Failed", tone: "negative" },
};

function StatusPill({ status }: { status: "success" | "close" | "failed" }) {
  const m = STATUS_META[status];
  const cls =
    m.tone === "brand" ? "bg-brand-soft text-[rgb(var(--ui-brand-ink))]"
    : m.tone === "caution" ? "bg-caution-soft text-caution"
    : "bg-negative-soft text-negative";
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-[11px] font-bold", cls)}>{m.label}</span>;
}

function YearDetail({ yearByYear, useRealDollars }: { yearByYear: YearDetailData[]; useRealDollars: boolean }) {
  return (
    <div className="max-h-[400px] overflow-auto rounded-ui-md border border-line">
      <table className="w-full text-left ui-tnum">
        <thead className="sticky top-0 z-10 bg-canvas-sunken">
          <tr className="border-b border-line">
            {["Year", "Portfolio value", "Return", "Withdrawal", "Notes"].map((h) => (
              <th key={h} className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yearByYear.map((y) => (
            <tr key={y.year} className="border-t border-line" style={{ background: y.marketReturn > 0 ? "var(--ui-brand-softer)" : y.marketReturn < 0 ? "var(--ui-negative-soft)" : undefined }}>
              <td className="px-3 py-2 text-[13px] font-semibold text-content">{y.year}</td>
              <td className="px-3 py-2 text-[13px] text-content">{formatMoney(useRealDollars ? y.portfolioValueReal : y.portfolioValue)}</td>
              <td className={cn("px-3 py-2 text-[13px] font-semibold", y.marketReturn >= 0 ? "text-[rgb(var(--ui-brand-ink))]" : "text-negative")}>
                {y.marketReturn >= 0 ? "+" : ""}{(y.marketReturn * 100).toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-[13px] text-content-secondary">{formatMoney(useRealDollars ? y.withdrawalAmountReal : y.withdrawalAmount)}</td>
              <td className="max-w-[250px] px-3 py-2 text-[13px] text-content-muted">{y.notes.length > 0 ? y.notes.join(", ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BacktestTable({ periods, useRealDollars }: { periods: BacktestPeriod[]; useRealDollars: boolean }) {
  const [filter, setFilter] = useState<"success" | "close" | "failed" | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("startYear");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const VISIBLE_ROWS = 12;

  const successCount = periods.filter((p) => p.status === "success").length;
  const closeCount = periods.filter((p) => p.status === "close").length;
  const failedCount = periods.filter((p) => p.status === "failed").length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const rows = (filter ? periods.filter((p) => p.status === filter) : [...periods]).sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "startYear": cmp = a.startYear - b.startYear; break;
      case "yearsLasted": cmp = a.yearsLasted - b.yearsLasted; break;
      case "endBalance": cmp = a.endBalance - b.endBalance; break;
      case "status": cmp = (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0); break;
      case "worstDrawdown": cmp = a.worstDrawdown - b.worstDrawdown; break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const visibleRows = showAll ? rows : rows.slice(0, VISIBLE_ROWS);
  const hiddenCount = rows.length - visibleRows.length;

  const toggleFilter = (status: "success" | "close" | "failed") => setFilter((prev) => (prev === status ? null : status));

  const summary: Array<{ key: "success" | "close" | "failed"; label: string; count: number; cls: string }> = [
    { key: "success", label: "Succeeded", count: successCount, cls: "text-[rgb(var(--ui-brand-ink))]" },
    { key: "close", label: "Close call", count: closeCount, cls: "text-caution" },
    { key: "failed", label: "Ran out", count: failedCount, cls: "text-negative" },
  ];

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortDir === "asc" ? <ArrowUp className="ml-1 inline h-3 w-3" /> : <ArrowDown className="ml-1 inline h-3 w-3" />;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {summary.map((s) => (
          <button
            key={s.key}
            onClick={() => toggleFilter(s.key)}
            className={cn(
              "rounded-ui-lg border bg-panel p-4 text-left shadow-ui-sm transition-colors",
              filter === s.key ? "border-line-strong bg-canvas-sunken" : "border-line hover:border-line-strong",
            )}
          >
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">{s.label}</div>
            <div className={cn("mt-1 font-editorial text-[24px] font-extrabold ui-tnum", s.cls)}>{s.count}</div>
          </button>
        ))}
      </div>

      <p className="text-[12px] text-content-muted sm:hidden">Swipe the table sideways to see every column →</p>

      <div className="relative">
        {/* Right edge fade — a scroll affordance hinting at clipped columns on narrow screens */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 rounded-r-ui-md bg-gradient-to-l from-panel to-transparent sm:hidden" />
        <div className="overflow-auto rounded-ui-md border border-line">
        <table className="w-full ui-tnum">
          <thead>
            <tr className="border-b border-line bg-canvas-sunken">
              {([
                ["startYear", "Period"],
                ["yearsLasted", "Years lasted"],
                ["endBalance", "End balance"],
                ["status", "Status"],
                ["worstDrawdown", "Worst drawdown"],
              ] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  className="cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted hover:text-content"
                >
                  {label}
                  <SortIcon column={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((period) => (
              <Fragment key={period.startYear}>
                <tr
                  onClick={() => setExpandedRow((prev) => (prev === period.startYear ? null : period.startYear))}
                  className="cursor-pointer border-t border-line transition-colors hover:bg-brand-softer"
                >
                  <td className="px-3 py-2.5 text-[13px] font-semibold text-content">{period.startYear}–{period.startYear + period.yearsLasted}</td>
                  <td className="px-3 py-2.5 text-[13px] text-content-secondary">{period.yearsLasted}</td>
                  <td className="px-3 py-2.5 text-[13px] text-content">
                    {formatMoney(useRealDollars && period.yearByYear.length > 0 ? period.yearByYear[period.yearByYear.length - 1].portfolioValueReal : period.endBalance)}
                  </td>
                  <td className="px-3 py-2.5"><StatusPill status={period.status} /></td>
                  <td className="px-3 py-2.5 text-[13px] text-content-secondary">{(-period.worstDrawdown * 100).toFixed(1)}%</td>
                </tr>
                {expandedRow === period.startYear && (
                  <tr>
                    <td colSpan={5} className="border-t border-line bg-canvas-sunken p-3">
                      <YearDetail yearByYear={period.yearByYear} useRealDollars={useRealDollars} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {rows.length > VISIBLE_ROWS && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="ui-focus inline-flex min-h-[44px] w-full items-center justify-center rounded-ui-md border border-line px-4 text-[13px] font-bold text-content-secondary transition-colors hover:border-line-strong hover:text-content sm:min-h-0 sm:py-2.5"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length} periods`}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

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

  // Strategy
  const [strategy, setStrategy] = useState<StrategyType>("constant_dollar");
  const [strategyParams, setStrategyParams] = useState<StrategyParams>({ inflationAdjusted: true });
  const [useRealDollars, setUseRealDollars] = useState(true);

  // Fees & cash rate (match ficalc defaults)
  const [fees, setFees] = useState({ equities: 0.04, bonds: 0.05, reits: 0.04, cash: 0 }); // in percentage, e.g., 0.04 = 0.04%
  const [cashGrowthRate, setCashGrowthRate] = useState(1.5); // percentage, e.g., 1.5 = 1.5%

  // Results
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [percentiles, setPercentiles] = useState<any[]>([]);
  const [histogram, setHistogram] = useState<any[]>([]);
  const [samplePaths, setSamplePaths] = useState<any[]>([]);
  const [backtestPeriods, setBacktestPeriods] = useState<BacktestPeriod[]>([]);
  const [, setBacktestSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Load real data from user's accounts
  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] })),
      api.getPortfolioAllocation().catch(() => ({ allocation: null, totalValue: 0 })),
    ]).then(([balanceData, portfolioData]) => {
      const balances = balanceData.balances;

      let assets = 0;
      let liabilities = 0;
      let creditSpend = 0;

      for (const b of balances) {
        const val = parseFloat(b.balance || "0");
        if (b.type === "credit" || b.type === "loan") {
          liabilities += Math.abs(val);
          if (b.type === "credit") creditSpend += Math.abs(val);
        } else {
          assets += val;
        }
      }

      const netWorth = assets - liabilities;
      setHasAccounts(balances.length > 0);

      if (netWorth > 0) {
        setTotalValue(netWorth);
      }

      if (creditSpend > 0) {
        setMonthlySpend(Math.round(creditSpend / 100) * 100);
      }

      if (portfolioData.allocation) {
        const real = portfolioData.allocation;
        const realTotal = real.usStocks + real.intlStocks + real.bonds + real.reits + real.cash;
        if (realTotal > 0) {
          const scale = realTotal <= 1 ? 100 : 1;
          const realAlloc: Allocation = {
            usStocks: Math.round(real.usStocks * scale),
            intlStocks: Math.round(real.intlStocks * scale),
            bonds: Math.round(real.bonds * scale),
            reits: Math.round(real.reits * scale),
            cash: Math.round(real.cash * scale),
          };
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
      });
    }
  }, [initialLoading, hasAccounts, setPageContext]);

  const runSimulations = useCallback(async () => {
    if (totalValue <= 0) return;
    try {
      setSimulating(true);
      setError(null);
      setWarning(null);

      const years = lifeExpectancy - retirementAge;
      const annualWithdrawal = monthlySpend * 12;

      const mcResponse = await fetch(`${API_BASE}/api/simulations/monte-carlo`, {
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
          strategy,
          strategyParams,
          fees: { equities: fees.equities / 100, bonds: fees.bonds / 100, reits: fees.reits / 100, cash: fees.cash / 100 },
          cashGrowthRate: cashGrowthRate / 100,
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

      const btResponse = await fetch(`${API_BASE}/api/simulations/backtest`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocation,
          initialValue: totalValue,
          annualWithdrawal,
          years,
          strategy,
          strategyParams,
          fees: { equities: fees.equities / 100, bonds: fees.bonds / 100, reits: fees.reits / 100, cash: fees.cash / 100 },
          cashGrowthRate: cashGrowthRate / 100,
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
  }, [retirementAge, lifeExpectancy, monthlySpend, allocation, totalValue, strategy, strategyParams, warning]);

  // Auto-run on any input change with debounce
  useEffect(() => {
    if (initialLoading || totalValue <= 0) return;
    const timer = setTimeout(() => {
      runSimulations();
    }, 600);
    return () => clearTimeout(timer);
  }, [initialLoading, retirementAge, lifeExpectancy, monthlySpend, allocation, strategy, strategyParams, totalValue, fees, cashGrowthRate]);

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

  const fanData: FanDatum[] = percentiles.map((p) => ({
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
  if (initialLoading) return null;

  // Empty state - no accounts
  if (!hasAccounts) {
    return (
      <div className="mx-auto max-w-[1120px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
        <header className="mb-8">
          <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">Probability of success</h1>
          <p className="mt-1.5 text-[14px] font-medium text-content-muted">Link accounts to model your retirement odds</p>
        </header>
        <EmptyState
          icon={<Building2 size={24} />}
          title="No accounts linked"
          description="Connect your bank and investment accounts to run retirement probability simulations based on your real portfolio."
          action={<Button variant="primary" onClick={() => navigate("/accounts")} leadingIcon={<Plus className="h-4 w-4" />}>Link your first account</Button>}
        />
      </div>
    );
  }

  const status = getStatus(successRate === null ? null : successRate * 100);
  const statusInk = status === 'success' ? 'text-[rgb(var(--ui-brand-ink))]' : status === 'warning' ? 'text-caution' : 'text-negative';
  const statusSoft = status === 'success' ? 'bg-brand-soft' : status === 'warning' ? 'bg-caution-soft' : 'bg-negative-soft';
  const statusLabel = status === 'success' ? 'On track' : status === 'warning' ? 'Borderline' : 'At risk';
  const allocTotal = allocationTotal(allocation);
  const allocValid = Math.abs(allocTotal - 100) < 0.5;
  const projectionYears = lifeExpectancy - retirementAge;

  return (
    <div className="mx-auto max-w-[1120px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            Probability of success
          </h1>
          <p className="mt-1.5 text-[14px] font-medium text-content-muted ui-tnum">
            {projectionYears}-year projection · Monte Carlo + historical backtest
          </p>
        </div>
      </header>

      {/* ════════ Hero — confident probability ════════ */}
      {(successRate !== null || simulating || error) && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative mt-6 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-8"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                status === 'success'
                  ? 'radial-gradient(90% 80% at 0% 0%, var(--ui-brand-soft), transparent 60%)'
                  : status === 'warning'
                    ? 'radial-gradient(90% 80% at 0% 0%, var(--ui-caution-soft), transparent 60%)'
                    : 'radial-gradient(90% 80% at 0% 0%, var(--ui-negative-soft), transparent 60%)',
            }}
          />
          {simulating && successRate === null ? (
            <div className="relative flex items-center gap-4 py-2">
              <RefreshCw className="h-7 w-7 animate-spin text-brand" />
              <div>
                <p className="text-[15px] font-semibold text-content">Running simulations…</p>
                <p className="mt-0.5 text-[13px] text-content-muted">5,000 Monte Carlo paths + historical backtest</p>
              </div>
            </div>
          ) : error ? (
            <div className="relative flex flex-wrap items-center gap-4">
              <AlertTriangle className="h-9 w-9 shrink-0 text-negative" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-negative">Simulation error</p>
                <p className="mt-1 text-[13px] text-content-muted">{error}</p>
              </div>
              <Button variant="secondary" onClick={runSimulations} leadingIcon={<RefreshCw className="h-4 w-4" />}>Retry</Button>
            </div>
          ) : successRate !== null ? (
            <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-5">
                <div className={cn("grid h-16 w-16 shrink-0 place-items-center rounded-ui-lg sm:h-20 sm:w-20", statusSoft)}>
                  <Target className={cn("h-8 w-8 sm:h-10 sm:w-10", statusInk)} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Probability of success</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", statusSoft, statusInk)}>{statusLabel}</span>
                  </div>
                  <div className={cn("mt-1.5 font-editorial text-[44px] font-extrabold leading-none tracking-[-0.03em] ui-tnum sm:text-[56px]", statusInk)}>
                    {(successRate * 100).toFixed(1)}%
                    {simulating && <RefreshCw className="ml-3 inline h-5 w-5 animate-spin align-middle text-content-faint" />}
                  </div>
                </div>
              </div>
              <div className="text-[13px] text-content-muted ui-tnum md:text-right">
                Based on a {projectionYears}-year projection
                <br />
                <span>Starting balance: {formatMoney(totalValue)}</span>
              </div>
            </div>
          ) : null}
        </motion.section>
      )}

      {/* ════════ Warning ════════ */}
      {warning && (
        <div className="mt-4 flex items-start gap-3 rounded-ui-md border border-caution/40 bg-caution-soft px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-caution" />
          <p className="text-[13px] text-content-secondary">{warning}</p>
        </div>
      )}

      {/* ════════ Stat cards ════════ */}
      <div className={cn("mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3", simulating && "opacity-60")}>
        <StatCard icon={Wallet} label="Portfolio value" value={formatMoney(Math.round(totalValue), true)} />
        <EditableStatCard icon={Calendar} label="Retirement age" value={retirementAge} min={18} max={200} onChange={setRetirementAge} />
        <EditableStatCard icon={Target} label="Life expectancy" value={lifeExpectancy} min={18} max={200} onChange={setLifeExpectancy} />
      </div>

      {/* ════════ Withdrawal strategy ════════ */}
      <Section title="Withdrawal strategy">
        <Card>
          <StrategyConfig
            strategy={strategy}
            params={strategyParams}
            monthlySpend={monthlySpend}
            onMonthlySpendChange={setMonthlySpend}
            onStrategyChange={setStrategy}
            onParamsChange={setStrategyParams}
          />
        </Card>
      </Section>

      {/* ════════ Portfolio allocation ════════ */}
      <Section title="Portfolio allocation">
        <Card>
          <div className="mb-4 flex flex-wrap gap-2">
            {currentAllocationRef.current && (
              <button
                onClick={selectCurrentAllocation}
                className={cn(
                  "inline-flex min-h-[44px] items-center justify-center rounded-ui-md border px-3.5 text-[13px] font-bold transition-colors sm:min-h-0 sm:py-1.5",
                  activePreset === "current" ? "border-transparent bg-brand-soft text-[rgb(var(--ui-brand-ink))]" : "border-line text-content-secondary hover:text-content hover:border-line-strong",
                )}
              >
                Current portfolio
              </button>
            )}
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPreset(p)}
                className={cn(
                  "inline-flex min-h-[44px] items-center justify-center rounded-ui-md border px-3.5 text-[13px] font-bold transition-colors sm:min-h-0 sm:py-1.5",
                  activePreset === p.id ? "border-transparent bg-brand-soft text-[rgb(var(--ui-brand-ink))]" : "border-line text-content-secondary hover:text-content hover:border-line-strong",
                )}
              >
                {p.label}
              </button>
            ))}
            {activePreset === "custom" && (
              <span className="rounded-ui-md border border-line bg-canvas-sunken px-3.5 py-1.5 text-[13px] font-semibold text-content-muted">Custom</span>
            )}
          </div>

          {/* Allocation sliders with fees */}
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["usStocks", "US Stocks", "equities"],
              ["intlStocks", "Int'l Stocks", "equities"],
              ["bonds", "Bonds", "bonds"],
              ["reits", "REITs", "reits"],
              ["cash", "Cash", "cash"],
            ] as const).map(([key, label, feeKey]) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center gap-1.5 text-[13px] text-content-secondary">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: ALLOC_VIZ[key] }} aria-hidden />
                    {label}
                    <span className="text-content-muted">({key === "cash" ? `${cashGrowthRate}% growth` : `${HISTORICAL_RETURNS[key]}% avg`})</span>
                  </label>
                  <span className="text-[13px] font-bold text-content ui-tnum">{allocation[key]}%</span>
                </div>
                <input
                  type="range" min="0" max="100" step="5" value={allocation[key]}
                  onChange={(e) => updateAllocation(key, parseInt(e.target.value))}
                  className="w-full h-1.5"
                  style={{ accentColor: ALLOC_VIZ[key] }}
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-content-muted">Fee:</span>
                  {key === "cash" ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number" value={cashGrowthRate} step="0.1" min="0" max="10"
                        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 10) setCashGrowthRate(v); }}
                        className="w-14 rounded-ui-sm border border-line bg-canvas-sunken px-1.5 py-0.5 text-[11px] text-content-secondary ui-tnum [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-[11px] text-content-muted">% growth</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="number" value={fees[feeKey as keyof typeof fees]} step="0.01" min="0" max="5"
                        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 5) setFees((prev) => ({ ...prev, [feeKey]: v })); }}
                        className="w-14 rounded-ui-sm border border-line bg-canvas-sunken px-1.5 py-0.5 text-[11px] text-content-secondary ui-tnum [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-[11px] text-content-muted">%/yr</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Expected return & validation */}
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-content-muted" />
              <span className="text-[13px] text-content-secondary">
                Expected return: <span className="font-bold text-content ui-tnum">{getExpectedReturn(allocation).toFixed(1)}%</span>
              </span>
            </div>
            {!allocValid && (
              <p className="text-[12px] font-semibold text-caution ui-tnum">Allocation totals {allocTotal}% — adjust to equal 100%</p>
            )}
          </div>

          {simulating && (
            <div className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-[13px] text-content-muted">
              <RefreshCw className="h-4 w-4 animate-spin text-brand" />
              Recalculating…
            </div>
          )}
        </Card>
      </Section>

      {/* ════════ Dollar toggle ════════ */}
      {(backtestPeriods.length > 0 || percentiles.length > 0) && !simulating && (
        <div className="mt-6 flex items-center gap-2.5">
          <span className="text-[13px] text-content-secondary">Values in:</span>
          <div className="inline-flex items-center gap-0.5 rounded-ui-md border border-line bg-canvas-sunken p-0.5">
            {([["real", "Real $"], ["nominal", "Nominal $"]] as const).map(([v, label]) => {
              const active = (v === "real") === useRealDollars;
              return (
                <button
                  key={v}
                  onClick={() => setUseRealDollars(v === "real")}
                  className={cn(
                    "inline-flex min-h-[44px] items-center justify-center rounded-[calc(var(--ui-r-md)-3px)] px-3 text-[12.5px] font-semibold transition-all sm:min-h-0 sm:py-1",
                    active ? "bg-panel text-[rgb(var(--ui-brand-ink))] shadow-ui-sm" : "text-content-muted hover:text-content",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span className="text-[12px] text-content-muted">(backtest only)</span>
        </div>
      )}

      {/* ════════ Monte Carlo chart ════════ */}
      {percentiles.length > 0 && !simulating && (
        <Section
          title="Monte Carlo projection"
          action={
            <div className="inline-flex items-center gap-0.5 rounded-ui-md border border-line bg-canvas-sunken p-0.5">
              {([["fan", "Fan chart"], ["spaghetti", "Paths"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setMcView(v)}
                  className={cn(
                    "inline-flex min-h-[44px] items-center justify-center rounded-[calc(var(--ui-r-md)-3px)] px-3 text-[12.5px] font-semibold transition-all sm:min-h-0 sm:py-1",
                    mcView === v ? "bg-panel text-[rgb(var(--ui-brand-ink))] shadow-ui-sm" : "text-content-muted hover:text-content",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <Card>
            {mcView === "fan" && (
              <>
                <FanChart data={fanData} />
                <FanLegend />
              </>
            )}
            {mcView === "spaghetti" && <SpaghettiChart paths={samplePaths} years={projectionYears} />}
          </Card>
        </Section>
      )}

      {/* ════════ Histogram ════════ */}
      {histogram.length > 0 && !simulating && (
        <Section title="Distribution of final portfolio values">
          <Card>
            <HistogramChart data={histogram} />
          </Card>
        </Section>
      )}

      {/* ════════ Historical backtest ════════ */}
      {backtestPeriods.length > 0 && !simulating && (
        <Section title="Historical backtest">
          <Card>
            <p className="mb-4 text-[12.5px] leading-relaxed text-content-muted">
              Tests your plan against every historical period since 1928. Results may differ from Monte Carlo because MC generates random scenarios including ones that never actually occurred.
            </p>
            <BacktestTable periods={backtestPeriods} useRealDollars={useRealDollars} />
          </Card>
        </Section>
      )}
    </div>
  );
}
