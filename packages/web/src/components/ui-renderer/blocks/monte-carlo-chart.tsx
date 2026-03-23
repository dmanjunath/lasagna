import { useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { MonteCarloChartBlock } from "../../../lib/types.js";
import { colors } from "../../../styles/theme.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function FanChart({ data, title }: { data: MonteCarloChartBlock["data"]; title?: string }) {
  const chartData = useMemo(() => {
    if (!data.percentiles) return [];

    return data.percentiles.p50.map((_, idx) => ({
      year: idx,
      p5: data.percentiles!.p5[idx],
      p25: data.percentiles!.p25[idx],
      p50: data.percentiles!.p50[idx],
      p75: data.percentiles!.p75[idx],
      p95: data.percentiles!.p95[idx],
    }));
  }, [data.percentiles]);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        {title && (
          <h3 className="text-lg font-display font-semibold text-text">{title}</h3>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Success Rate:</span>
          <span className={`text-lg font-semibold ${
            data.successRate >= 0.9 ? "text-success" :
            data.successRate >= 0.8 ? "text-warning" : "text-danger"
          }`}>
            {(data.successRate * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="p95" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.accent.DEFAULT} stopOpacity={0.1} />
                <stop offset="95%" stopColor={colors.accent.DEFAULT} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="p75" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.accent.DEFAULT} stopOpacity={0.2} />
                <stop offset="95%" stopColor={colors.accent.DEFAULT} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="p50" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.accent.DEFAULT} stopOpacity={0.4} />
                <stop offset="95%" stopColor={colors.accent.DEFAULT} stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="year"
              stroke={colors.text.muted}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              label={{ value: "Years", position: "bottom", fill: colors.text.muted }}
            />
            <YAxis
              stroke={colors.text.muted}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCurrency}
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
                padding: "12px",
              }}
              labelFormatter={(label) => `Year ${label}`}
            />
            <Area
              type="monotone"
              dataKey="p95"
              stroke="none"
              fill="url(#p95)"
              name="95th percentile"
            />
            <Area
              type="monotone"
              dataKey="p75"
              stroke="none"
              fill="url(#p75)"
              name="75th percentile"
            />
            <Area
              type="monotone"
              dataKey="p50"
              stroke={colors.accent.DEFAULT}
              strokeWidth={2}
              fill="url(#p50)"
              name="Median"
            />
            <Area
              type="monotone"
              dataKey="p25"
              stroke="none"
              fill="url(#p75)"
              name="25th percentile"
            />
            <Area
              type="monotone"
              dataKey="p5"
              stroke="none"
              fill="url(#p95)"
              name="5th percentile"
            />
            <ReferenceLine y={0} stroke={colors.danger} strokeDasharray="3 3" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-center gap-6 mt-4 text-xs text-text-muted">
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: colors.accent.DEFAULT, opacity: 0.4 }} />
          Median
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: colors.accent.DEFAULT, opacity: 0.2 }} />
          25th-75th
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: colors.accent.DEFAULT, opacity: 0.1 }} />
          5th-95th
        </span>
      </div>
    </div>
  );
}

function Histogram({ data, title }: { data: MonteCarloChartBlock["data"]; title?: string }) {
  const chartData = useMemo(() => {
    if (!data.distribution) return [];

    const labels = ["$0", "$250K", "$500K", "$1M", "$2M", "$3M+"];
    const statusColors = [
      colors.danger,
      colors.warning,
      colors.success,
      colors.success,
      colors.success,
      colors.success,
    ];

    return data.distribution.buckets.map((_, idx) => ({
      label: labels[idx] || `$${data.distribution!.buckets[idx]}`,
      count: data.distribution!.counts[idx],
      fill: statusColors[idx],
    }));
  }, [data.distribution]);

  const total = chartData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        {title && (
          <h3 className="text-lg font-display font-semibold text-text">{title}</h3>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Success Rate:</span>
          <span className={`text-lg font-semibold ${
            data.successRate >= 0.9 ? "text-success" :
            data.successRate >= 0.8 ? "text-warning" : "text-danger"
          }`}>
            {(data.successRate * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <XAxis
              dataKey="label"
              stroke={colors.text.muted}
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke={colors.text.muted}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${((v / total) * 100).toFixed(0)}%`}
            />
            <Tooltip
              formatter={(value: number) => [`${((value / total) * 100).toFixed(1)}%`, "Probability"]}
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
              }}
            />
            <Bar
              dataKey="count"
              radius={[4, 4, 0, 0]}
              fill={colors.accent.DEFAULT}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-center gap-4 mt-4 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-danger" />
          <span className="text-text-muted">Depleted</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-warning" />
          <span className="text-text-muted">Struggling</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-success" />
          <span className="text-text-muted">Comfortable</span>
        </span>
      </div>
    </div>
  );
}

export function MonteCarloChartRenderer({ block }: { block: MonteCarloChartBlock }) {
  if (block.variant === "histogram") {
    return <Histogram data={block.data} title={block.title} />;
  }
  return <FanChart data={block.data} title={block.title} />;
}
