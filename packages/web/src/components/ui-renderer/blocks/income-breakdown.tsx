import type { IncomeBreakdownBlock } from "../../../lib/types.js";
import { HIDDEN_AMOUNT, isAmountsHidden, maskCurrencyInText } from "../../../lib/hide-amounts.js";

function formatCurrency(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return `$${value.toLocaleString()}`;
}

export function IncomeBreakdownRenderer({ block }: { block: IncomeBreakdownBlock }) {
  return (
    <div className="glass-card p-6">
      {block.title && (
        <h3 className="text-base font-semibold tracking-tight text-content mb-4">
          {maskCurrencyInText(block.title)}
        </h3>
      )}
      <div className="space-y-3">
        {block.sources.map((source, idx) => (
          <div key={idx} className="flex items-center justify-between py-2 border-b border-line last:border-0">
            <div>
              <span className="text-content">{maskCurrencyInText(source.name)}</span>
              {source.startAge && (
                <span className="text-xs text-content-secondary ml-2">(from age {source.startAge})</span>
              )}
            </div>
            <span className="font-medium text-content tabular-nums">
              {formatCurrency(source.annualAmount)}/yr
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-4 border-t border-line">
        <div className="flex justify-between text-lg font-semibold">
          <span className="text-content">Total</span>
          <div className="text-right">
            <div className="text-[rgb(var(--ui-brand-ink))]">{formatCurrency(block.totalAnnual)}/yr</div>
            <div className="text-sm text-content-secondary">{formatCurrency(block.totalMonthly)}/mo</div>
          </div>
        </div>
      </div>
    </div>
  );
}
