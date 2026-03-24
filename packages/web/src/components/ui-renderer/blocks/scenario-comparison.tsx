import { CheckCircle } from "lucide-react";
import type { ScenarioComparisonBlock } from "../../../lib/types.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function ScenarioComparisonRenderer({ block }: { block: ScenarioComparisonBlock }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4">
          {block.title}
        </h3>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {block.scenarios.map((scenario, idx) => (
          <div
            key={idx}
            className={`p-4 rounded-xl border ${
              scenario.isRecommended
                ? "border-accent bg-accent/5"
                : "border-border bg-surface"
            }`}
          >
            <div className="flex items-start justify-between">
              <h4 className="font-medium text-text">{scenario.name}</h4>
              {scenario.isRecommended && (
                <CheckCircle className="w-5 h-5 text-accent" />
              )}
            </div>
            {scenario.description && (
              <p className="text-sm text-text-muted mt-1">{scenario.description}</p>
            )}
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Success Rate</span>
                <span className={`font-medium ${
                  scenario.successRate >= 0.9 ? "text-success" :
                  scenario.successRate >= 0.8 ? "text-warning" : "text-danger"
                }`}>
                  {(scenario.successRate * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">End Balance</span>
                <span className="font-medium text-text">
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
