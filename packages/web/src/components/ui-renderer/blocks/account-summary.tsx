import type { AccountSummaryBlock } from "../../../lib/types.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function AccountSummaryRenderer({ block }: { block: AccountSummaryBlock }) {
  const allocationData = [
    { label: "Stocks", value: block.allocation.stocks, color: "#22c55e" },
    { label: "Bonds", value: block.allocation.bonds, color: "#3b82f6" },
    { label: "Cash", value: block.allocation.cash, color: "#a855f7" },
  ].filter((d) => d.value > 0);

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-6">
        <div className="text-sm text-text-muted">Total Portfolio</div>
        <div className="text-3xl font-display font-bold text-text">
          {formatCurrency(block.totalBalance)}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-sm text-text-muted mb-2">Asset Allocation</div>
        <div className="flex h-3 rounded-full overflow-hidden">
          {allocationData.map((d, idx) => (
            <div
              key={idx}
              style={{ width: `${d.value * 100}%`, background: d.color }}
              title={`${d.label}: ${(d.value * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs">
          {allocationData.map((d, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
              {d.label} {(d.value * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {block.byType.map((account, idx) => (
          <div key={idx} className="flex justify-between text-sm py-1">
            <span className="text-text-muted capitalize">{account.type}</span>
            <span className="text-text tabular-nums">{formatCurrency(account.balance)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
