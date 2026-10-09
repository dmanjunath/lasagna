import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { OptionMenu } from "../../common/OptionMenu.js";
import type { BacktestTableBlock } from "../../../lib/types.js";
import { HIDDEN_AMOUNT, isAmountsHidden, maskCurrencyInText } from "../../../lib/hide-amounts.js";

type SortField = "startYear" | "endBalance" | "status" | "worstDrawdown";
type FilterStatus = "all" | "failed" | "close" | "success";

function formatCurrency(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`.replace(/^-/, "\u2212");
}

const statusColors = {
  success: "text-positive",
  failed: "text-negative",
  close: "text-caution",
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
        <h3 className="text-base font-semibold tracking-tight text-content mb-2">
          {maskCurrencyInText(block.title)}
        </h3>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-content-secondary">
          {block.data.successfulPeriods} of {block.data.totalPeriods} periods successful ({formatPercent(block.data.successRate)})
        </div>

        <OptionMenu
          ariaLabel="Show periods"
          prefix="Show"
          toolbar={{ count: filter === "all" ? 0 : 1, badge: false }}
          value={filter}
          options={[
            { value: "all", label: "All" },
            { value: "failed", label: "Failed Only" },
            { value: "close", label: "Close Calls" },
            { value: "success", label: "Successes" },
          ]}
          onChange={setFilter}
          panelClassName="left-auto right-0"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th
                className="text-left py-3 px-2 text-sm text-content-secondary font-medium cursor-pointer hover:text-content"
                onClick={() => handleSort("startYear")}
              >
                <span className="flex items-center gap-1">
                  Start Year <SortIcon field="startYear" />
                </span>
              </th>
              <th
                className="text-right py-3 px-2 text-sm text-content-secondary font-medium cursor-pointer hover:text-content"
                onClick={() => handleSort("endBalance")}
              >
                <span className="flex items-center justify-end gap-1">
                  End Balance <SortIcon field="endBalance" />
                </span>
              </th>
              <th
                className="text-right py-3 px-2 text-sm text-content-secondary font-medium cursor-pointer hover:text-content"
                onClick={() => handleSort("worstDrawdown")}
              >
                <span className="flex items-center justify-end gap-1">
                  Worst Drawdown <SortIcon field="worstDrawdown" />
                </span>
              </th>
              <th className="text-right py-3 px-2 text-sm text-content-secondary font-medium">
                Best Year
              </th>
              <th
                className="text-center py-3 px-2 text-sm text-content-secondary font-medium cursor-pointer hover:text-content"
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
              <tr key={period.startYear} className="border-b border-line hover:bg-canvas-sunken">
                <td className="py-3 px-2 text-content font-medium">{period.startYear}</td>
                <td className="py-3 px-2 text-right text-content tabular-nums">
                  {formatCurrency(period.endBalance)}
                </td>
                <td className="py-3 px-2 text-right text-negative tabular-nums">
                  {formatPercent(period.worstDrawdown.percent)} ({period.worstDrawdown.year})
                </td>
                <td className="py-3 px-2 text-right text-positive tabular-nums">
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
          className="mt-4 w-full py-2 text-sm text-[rgb(var(--ui-brand-ink))] hover:opacity-80"
        >
          Show more ({filteredAndSorted.length - showCount} remaining)
        </button>
      )}
    </div>
  );
}
