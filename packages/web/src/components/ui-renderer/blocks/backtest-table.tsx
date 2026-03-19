import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import type { BacktestTableBlock } from "../../../lib/types.js";

type SortField = "startYear" | "endBalance" | "status" | "worstDrawdown";
type FilterStatus = "all" | "failed" | "close" | "success";

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

const statusColors = {
  success: "text-success",
  failed: "text-danger",
  close: "text-warning",
};

const statusIcons = {
  success: "✅",
  failed: "❌",
  close: "⚠️",
};

export function BacktestTableRenderer({ block }: { block: BacktestTableBlock }) {
  const [sortField, setSortField] = useState<SortField>(block.defaultSort || "startYear");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>(block.defaultFilter || "all");
  const [showCount, setShowCount] = useState(block.showCount || 10);

  const filteredAndSorted = useMemo(() => {
    let periods = [...block.data.periods];

    // Filter
    if (filter !== "all") {
      periods = periods.filter((p) => p.status === filter);
    }

    // Sort
    periods.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "startYear":
          comparison = a.startYear - b.startYear;
          break;
        case "endBalance":
          comparison = a.endBalance - b.endBalance;
          break;
        case "status": {
          const order = { failed: 0, close: 1, success: 2 };
          comparison = order[a.status] - order[b.status];
          break;
        }
        case "worstDrawdown":
          comparison = a.worstDrawdown.percent - b.worstDrawdown.percent;
          break;
      }
      return sortAsc ? comparison : -comparison;
    });

    return periods;
  }, [block.data.periods, sortField, sortAsc, filter]);

  const visiblePeriods = filteredAndSorted.slice(0, showCount);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortAsc ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
  };

  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-2">
          {block.title}
        </h3>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-text-secondary">
          {block.data.successfulPeriods} of {block.data.totalPeriods} periods successful ({formatPercent(block.data.successRate)})
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-text-secondary" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterStatus)}
            className="bg-surface border border-border rounded-lg px-3 py-1 text-sm text-text"
          >
            <option value="all">All</option>
            <option value="failed">Failed Only</option>
            <option value="close">Close Calls</option>
            <option value="success">Successes</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th
                className="text-left py-3 px-2 text-sm text-text-secondary font-medium cursor-pointer hover:text-text"
                onClick={() => handleSort("startYear")}
              >
                <span className="flex items-center gap-1">
                  Start Year <SortIcon field="startYear" />
                </span>
              </th>
              <th
                className="text-right py-3 px-2 text-sm text-text-secondary font-medium cursor-pointer hover:text-text"
                onClick={() => handleSort("endBalance")}
              >
                <span className="flex items-center justify-end gap-1">
                  End Balance <SortIcon field="endBalance" />
                </span>
              </th>
              <th
                className="text-right py-3 px-2 text-sm text-text-secondary font-medium cursor-pointer hover:text-text"
                onClick={() => handleSort("worstDrawdown")}
              >
                <span className="flex items-center justify-end gap-1">
                  Worst Drawdown <SortIcon field="worstDrawdown" />
                </span>
              </th>
              <th className="text-right py-3 px-2 text-sm text-text-secondary font-medium">
                Best Year
              </th>
              <th
                className="text-center py-3 px-2 text-sm text-text-secondary font-medium cursor-pointer hover:text-text"
                onClick={() => handleSort("status")}
              >
                <span className="flex items-center justify-center gap-1">
                  Status <SortIcon field="status" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visiblePeriods.map((period) => (
              <tr key={period.startYear} className="border-b border-border/50 hover:bg-surface/50">
                <td className="py-3 px-2 text-text font-medium">{period.startYear}</td>
                <td className="py-3 px-2 text-right text-text tabular-nums">
                  {formatCurrency(period.endBalance)}
                </td>
                <td className="py-3 px-2 text-right text-danger tabular-nums">
                  {formatPercent(period.worstDrawdown.percent)} ({period.worstDrawdown.year})
                </td>
                <td className="py-3 px-2 text-right text-success tabular-nums">
                  +{formatPercent(period.bestYear.percent)} ({period.bestYear.year})
                </td>
                <td className={`py-3 px-2 text-center ${statusColors[period.status]}`}>
                  {statusIcons[period.status]} {period.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCount < filteredAndSorted.length && (
        <button
          onClick={() => setShowCount((prev) => prev + 10)}
          className="mt-4 w-full py-2 text-sm text-accent hover:opacity-80"
        >
          Show more ({filteredAndSorted.length - showCount} remaining)
        </button>
      )}
    </div>
  );
}
