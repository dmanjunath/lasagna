import type { FireCalculatorBlock } from "../../../lib/types.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function FireCalculatorRenderer({ block }: { block: FireCalculatorBlock }) {
  const progressColor = block.percentComplete >= 80 ? "bg-success" :
                        block.percentComplete >= 50 ? "bg-warning" : "bg-accent";

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-6">
        <div className="text-sm text-text-muted">FIRE Number</div>
        <div className="text-3xl font-display font-bold text-accent">
          {formatCurrency(block.targetNumber)}
        </div>
        <div className="text-xs text-text-muted mt-1">
          at {(block.withdrawalRate * 100).toFixed(1)}% SWR
          {block.targetAge && ` • Target age ${block.targetAge}`}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-text-muted">Progress</span>
          <span className="font-medium text-text">{block.percentComplete.toFixed(1)}%</span>
        </div>
        <div className="h-4 bg-surface rounded-full overflow-hidden">
          <div
            className={`h-full ${progressColor} rounded-full transition-all duration-500`}
            style={{ width: `${Math.min(100, block.percentComplete)}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-center">
        <div className="p-3 bg-surface rounded-xl">
          <div className="text-xs text-text-muted">Current</div>
          <div className="text-lg font-semibold text-text">
            {formatCurrency(block.currentBalance)}
          </div>
        </div>
        <div className="p-3 bg-surface rounded-xl">
          <div className="text-xs text-text-muted">Gap</div>
          <div className={`text-lg font-semibold ${block.gap <= 0 ? "text-success" : "text-text"}`}>
            {block.gap <= 0 ? "🎉 Done!" : formatCurrency(block.gap)}
          </div>
        </div>
      </div>
    </div>
  );
}
