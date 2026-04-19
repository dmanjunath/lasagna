import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { SequenceRiskChartBlock } from "../../../lib/types.js";
import { colors } from "../../../styles/theme.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function SequenceRiskChartRenderer({ block }: { block: SequenceRiskChartBlock }) {
  const data = block.goodSequence.map((good, idx) => ({
    year: block.labels?.[idx] || `Year ${idx + 1}`,
    good,
    bad: block.badSequence[idx] || 0,
  }));

  return (
    <div className="glass-card p-6">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4">
          {block.title}
        </h3>
      )}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="year" stroke={colors.text.muted} fontSize={12} tickLine={false} />
            <YAxis stroke={colors.text.muted} fontSize={12} tickLine={false} tickFormatter={formatCurrency} />
            <Tooltip
              formatter={(value) => formatCurrency(value as number)}
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="good" name="Good Sequence" stroke={colors.success} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="bad" name="Bad Sequence" stroke={colors.danger} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-text-secondary mt-3 text-center">
        Same average returns, different order — the first 5 years matter most
      </p>
    </div>
  );
}
