import { CheckCircle } from "lucide-react";
import type { ScenarioComparisonBlock } from "../../../lib/types.js";
import { HIDDEN_AMOUNT, isAmountsHidden, maskCurrencyInText } from "../../../lib/hide-amounts.js";

function formatCurrency(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function ScenarioComparisonRenderer({ block }: { block: ScenarioComparisonBlock }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-base font-semibold tracking-tight text-content mb-4">
          {maskCurrencyInText(block.title)}
        </h3>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {block.scenarios.map((scenario, idx) => (
          <div
            key={idx}
            className={`p-4 rounded-xl border ${
              scenario.isRecommended
                ? "border-brand bg-brand-softer"
                : "border-line bg-panel"
            }`}
          >
            <div className="flex items-start justify-between">
              <h4 className="font-medium text-content">{maskCurrencyInText(scenario.name)}</h4>
              {scenario.isRecommended && (
                <CheckCircle className="w-5 h-5 text-[rgb(var(--ui-brand-ink))]" />
              )}
            </div>
            {scenario.description && (
              <p className="text-sm text-content-secondary mt-1">{maskCurrencyInText(scenario.description)}</p>
            )}
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-content-secondary">Success Rate</span>
                <span className={`font-medium ${
                  scenario.successRate >= 0.9 ? "text-positive" :
                  scenario.successRate >= 0.8 ? "text-caution" : "text-negative"
                }`}>
                  {(scenario.successRate * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-content-secondary">End Balance</span>
                <span className="font-medium text-content">
                  {formatCurrency(scenario.endBalance)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
