import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn, formatMoney } from '../../lib/utils';

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

interface YearDetailProps {
  yearByYear: YearDetailData[];
  useRealDollars: boolean;
  showWithdrawalSource: boolean;
}

const ASSET_LABELS: Record<string, string> = {
  usStocks: 'US Stocks',
  intlStocks: "Int'l Stocks",
  bonds: 'Bonds',
  reits: 'REITs',
  cash: 'Cash',
};

function ReturnTooltipContent({ year }: { year: YearDetailData }) {
  if (!year.assetReturns || !year.assetWeights) return null;

  const entries = Object.entries(year.assetReturns)
    .filter(([key]) => (year.assetWeights?.[key] ?? 0) > 0.001);

  return (
    <>
      <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Return Breakdown</div>
      <div className="space-y-1.5">
        {entries.map(([key, ret]) => {
          const weight = year.assetWeights?.[key] ?? 0;
          return (
            <div key={key} className="flex items-center justify-between text-xs gap-4">
              <span className="text-text-secondary">{ASSET_LABELS[key] ?? key}</span>
              <div className="flex items-center gap-2 tabular-nums">
                <span className="text-text-muted">{(weight * 100).toFixed(0)}%</span>
                <span className={cn('font-medium', ret >= 0 ? 'text-success' : 'text-danger')}>
                  {ret >= 0 ? '+' : ''}{(ret * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border mt-2 pt-2 flex items-center justify-between text-xs">
        <span className="text-text-secondary font-medium">Portfolio</span>
        <span className={cn('font-semibold tabular-nums', year.marketReturn >= 0 ? 'text-success' : 'text-danger')}>
          {year.marketReturn >= 0 ? '+' : ''}{(year.marketReturn * 100).toFixed(1)}%
        </span>
      </div>
    </>
  );
}

export function YearDetail({ yearByYear, useRealDollars, showWithdrawalSource }: YearDetailProps) {
  const [tooltip, setTooltip] = useState<{ year: YearDetailData; x: number; y: number } | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showTooltip = useCallback((e: React.MouseEvent, year: YearDetailData) => {
    clearTimeout(hideTimeout.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ year, x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const hideTooltip = useCallback(() => {
    hideTimeout.current = setTimeout(() => setTooltip(null), 100);
  }, []);

  const keepTooltip = useCallback(() => {
    clearTimeout(hideTimeout.current);
  }, []);

  return (
    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-bg z-10">
          <tr className="border-b border-border">
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2">Year</th>
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2">Portfolio Value</th>
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2">Return</th>
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2">Withdrawal</th>
            {showWithdrawalSource && (
              <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2">Source</th>
            )}
            <th className="text-xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {yearByYear.map((y) => (
            <tr
              key={y.year}
              className={cn(
                'border-b border-border/50 transition-colors',
                y.marketReturn > 0 ? 'bg-success/5' : y.marketReturn < 0 ? 'bg-danger/5' : ''
              )}
            >
              <td className="text-sm tabular-nums px-3 py-2">{y.year}</td>
              <td className="text-sm tabular-nums px-3 py-2">
                {formatMoney(useRealDollars ? y.portfolioValueReal : y.portfolioValue)}
              </td>
              <td className="text-sm tabular-nums px-3 py-2">
                <span
                  className={cn(
                    'underline decoration-dotted',
                    y.marketReturn >= 0 ? 'text-success' : 'text-danger'
                  )}
                  onMouseEnter={(e) => showTooltip(e, y)}
                  onMouseLeave={hideTooltip}
                >
                  {y.marketReturn >= 0 ? '+' : ''}{(y.marketReturn * 100).toFixed(1)}%
                </span>
              </td>
              <td className="text-sm tabular-nums px-3 py-2">
                {formatMoney(useRealDollars ? y.withdrawalAmountReal : y.withdrawalAmount)}
              </td>
              {showWithdrawalSource && (
                <td className="text-sm text-text-muted px-3 py-2 max-w-[200px] truncate">
                  {y.withdrawalSource || '—'}
                </td>
              )}
              <td className="text-sm text-text-muted px-3 py-2 max-w-[250px]">
                {y.notes.length > 0 ? y.notes.join(', ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Portal tooltip — renders outside the scroll container */}
      {tooltip && createPortal(
        <div
          className="fixed z-[9999] w-52 bg-surface-solid border border-border rounded-xl shadow-lg p-3"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%) translateY(-8px)' }}
          onMouseEnter={keepTooltip}
          onMouseLeave={hideTooltip}
        >
          <ReturnTooltipContent year={tooltip.year} />
        </div>,
        document.body
      )}
    </div>
  );
}
