import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { SequenceRiskChartBlock } from "../../../lib/types.js";
import { colors } from "../../../styles/theme.js";
import { HIDDEN_AMOUNT, isAmountsHidden, maskCurrencyInText } from "../../../lib/hide-amounts.js";

function formatCurrency(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function SequenceRiskChartRenderer({ block }: { block: SequenceRiskChartBlock }) {
  const hideAmounts = isAmountsHidden();
  const data = block.goodSequence.map((good, idx) => ({
    year: block.labels?.[idx] || `Year ${idx + 1}`,
    good,
    bad: block.badSequence[idx] || 0,
  }));

  return (
    <div className="glass-card p-6">
      {block.title && (
        <h3 className="text-base font-semibold tracking-tight text-text mb-4">
          {maskCurrencyInText(block.title)}
        </h3>
      )}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="year" stroke={colors.text.muted} fontSize={12} tickLine={false} />
            {/* Money tick labels are removed while amounts are hidden, and the
                width they reserved with them. Both lines are unchanged: the
                domain is fit to the data. The legend names the two sequences,
                so the tooltip rows (a name plus a dollar figure each) drop. */}
            <YAxis stroke={colors.text.muted} fontSize={12} tickLine={false} tickFormatter={formatCurrency} hide={hideAmounts} />
            <Tooltip
              itemStyle={hideAmounts ? { display: "none" } : undefined}
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
        Same average returns, different order. The first 5 years matter most.
      </p>
    </div>
  );
}
