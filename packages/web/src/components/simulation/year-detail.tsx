import { cn } from "../../lib/utils";
import { formatMoney } from "../../lib/utils";

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

interface YearDetailProps {
  yearByYear: YearDetail[];
  useRealDollars: boolean;
  showWithdrawalSource: boolean;
}

export function YearDetail({
  yearByYear,
  useRealDollars,
  showWithdrawalSource,
}: YearDetailProps) {
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-bg-primary">
          <tr>
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2 text-left">
              Year
            </th>
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2 text-right">
              Portfolio Value
            </th>
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2 text-right">
              Return %
            </th>
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2 text-right">
              Withdrawal
            </th>
            {showWithdrawalSource && (
              <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2 text-left">
                Source
              </th>
            )}
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2 text-left">
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {yearByYear.map((row) => (
            <tr
              key={row.year}
              className={cn(
                row.marketReturn >= 0 ? "bg-success/5" : "bg-danger/5"
              )}
            >
              <td className="text-sm tabular-nums px-3 py-2">{row.year}</td>
              <td className="text-sm tabular-nums px-3 py-2 text-right">
                {formatMoney(
                  useRealDollars ? row.portfolioValueReal : row.portfolioValue
                )}
              </td>
              <td
                className={cn(
                  "text-sm tabular-nums px-3 py-2 text-right",
                  row.marketReturn >= 0 ? "text-success" : "text-danger"
                )}
              >
                {(row.marketReturn * 100).toFixed(1)}%
              </td>
              <td className="text-sm tabular-nums px-3 py-2 text-right">
                {formatMoney(
                  useRealDollars
                    ? row.withdrawalAmountReal
                    : row.withdrawalAmount
                )}
              </td>
              {showWithdrawalSource && (
                <td className="text-sm tabular-nums px-3 py-2">
                  {row.withdrawalSource ?? ""}
                </td>
              )}
              <td className="text-sm tabular-nums px-3 py-2 text-text-muted">
                {row.notes.join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
