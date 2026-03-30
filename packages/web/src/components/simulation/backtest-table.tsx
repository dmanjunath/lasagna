import { Fragment, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { formatMoney } from "../../lib/utils";
import { YearDetail } from "./year-detail";

interface YearDetail {
  year: number;
  portfolioValue: number;
  portfolioValueReal: number;
  marketReturn: number;
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
  yearByYear: YearDetail[];
}

interface BacktestTableProps {
  periods: BacktestPeriod[];
  useRealDollars: boolean;
  showWithdrawalSource: boolean;
}

type SortKey =
  | "startYear"
  | "yearsLasted"
  | "endBalance"
  | "status"
  | "worstDrawdown";

const statusOrder: Record<string, number> = {
  success: 0,
  close: 1,
  failed: 2,
};

export type { BacktestPeriod };

export function BacktestTable({
  periods,
  useRealDollars,
  showWithdrawalSource,
}: BacktestTableProps) {
  const [filter, setFilter] = useState<
    "success" | "close" | "failed" | null
  >(null);
  const [sortKey, setSortKey] = useState<SortKey>("startYear");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const successCount = periods.filter((p) => p.status === "success").length;
  const closeCount = periods.filter((p) => p.status === "close").length;
  const failedCount = periods.filter((p) => p.status === "failed").length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filteredAndSorted = useMemo(() => {
    let result = filter
      ? periods.filter((p) => p.status === filter)
      : [...periods];

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "startYear":
          cmp = a.startYear - b.startYear;
          break;
        case "yearsLasted":
          cmp = a.yearsLasted - b.yearsLasted;
          break;
        case "endBalance":
          cmp = a.endBalance - b.endBalance;
          break;
        case "status":
          cmp = (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0);
          break;
        case "worstDrawdown":
          cmp = a.worstDrawdown - b.worstDrawdown;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [periods, filter, sortKey, sortDir]);

  const toggleFilter = (status: "success" | "close" | "failed") => {
    setFilter((prev) => (prev === status ? null : status));
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortDir === "asc" ? (
      <ArrowUp className="inline w-3 h-3 ml-1" />
    ) : (
      <ArrowDown className="inline w-3 h-3 ml-1" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => toggleFilter("success")}
          className={cn(
            "glass-card rounded-xl p-4 cursor-pointer transition-colors text-left",
            filter === "success" && "border-success/50 bg-success/5"
          )}
        >
          <div className="text-xs uppercase tracking-wider text-text-muted font-semibold">
            Succeeded
          </div>
          <div className="text-2xl font-bold text-success">{successCount}</div>
        </button>

        <button
          onClick={() => toggleFilter("close")}
          className={cn(
            "glass-card rounded-xl p-4 cursor-pointer transition-colors text-left",
            filter === "close" && "border-warning/50 bg-warning/5"
          )}
        >
          <div className="text-xs uppercase tracking-wider text-text-muted font-semibold">
            Close Call
          </div>
          <div className="text-2xl font-bold text-warning">{closeCount}</div>
        </button>

        <button
          onClick={() => toggleFilter("failed")}
          className={cn(
            "glass-card rounded-xl p-4 cursor-pointer transition-colors text-left",
            filter === "failed" && "border-danger/50 bg-danger/5"
          )}
        >
          <div className="text-xs uppercase tracking-wider text-text-muted font-semibold">
            Ran Out
          </div>
          <div className="text-2xl font-bold text-danger">{failedCount}</div>
        </button>
      </div>

      {/* Sortable Table */}
      <div className="overflow-auto">
        <table className="w-full">
          <thead>
            <tr>
              {(
                [
                  ["startYear", "Start Year"],
                  ["yearsLasted", "Years Lasted"],
                  ["endBalance", "End Balance"],
                  ["status", "Status"],
                  ["worstDrawdown", "Worst Drawdown"],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2 text-left cursor-pointer select-none hover:text-text-primary"
                >
                  {label}
                  <SortIcon column={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((period) => (
              <Fragment key={period.startYear}>
                <tr
                  onClick={() =>
                    setExpandedRow((prev) =>
                      prev === period.startYear ? null : period.startYear
                    )
                  }
                  className="cursor-pointer hover:bg-bg-secondary/50 transition-colors"
                >
                  <td className="text-sm tabular-nums px-3 py-2">
                    {period.startYear}
                  </td>
                  <td className="text-sm tabular-nums px-3 py-2">
                    {period.yearsLasted}
                  </td>
                  <td className="text-sm tabular-nums px-3 py-2">
                    {formatMoney(period.endBalance)}
                  </td>
                  <td className="text-sm px-3 py-2">
                    <span
                      className={cn(
                        "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                        period.status === "success" &&
                          "bg-success/10 text-success",
                        period.status === "close" &&
                          "bg-warning/10 text-warning",
                        period.status === "failed" && "bg-danger/10 text-danger"
                      )}
                    >
                      {period.status === "success"
                        ? "Success"
                        : period.status === "close"
                          ? "Close"
                          : "Failed"}
                    </span>
                  </td>
                  <td className="text-sm tabular-nums px-3 py-2">
                    {(-period.worstDrawdown * 100).toFixed(1)}%
                  </td>
                </tr>
                <AnimatePresence>
                  {expandedRow === period.startYear && (
                    <motion.tr key={`${period.startYear}-detail`}>
                      <td colSpan={5}>
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <YearDetail
                            yearByYear={period.yearByYear}
                            useRealDollars={useRealDollars}
                            showWithdrawalSource={showWithdrawalSource}
                          />
                        </motion.div>
                      </td>
                    </motion.tr>
                  )}
                </AnimatePresence>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
