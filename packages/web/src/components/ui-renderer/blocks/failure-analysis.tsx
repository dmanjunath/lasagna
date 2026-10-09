import { AlertTriangle } from "lucide-react";
import type { FailureAnalysisBlock } from "../../../lib/types.js";
import { maskCurrencyInText } from "../../../lib/hide-amounts.js";

export function FailureAnalysisRenderer({ block }: { block: FailureAnalysisBlock }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-base font-semibold tracking-tight text-content mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-caution" />
          {maskCurrencyInText(block.title)}
        </h3>
      )}

      <div className="space-y-4">
        {block.failedPeriods.map((period, idx) => (
          <div key={idx} className="p-4 bg-negative-soft rounded-xl border border-negative/20">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-content">Started {period.startYear}</span>
              <span className="text-xs text-content-secondary">{maskCurrencyInText(period.pattern)}</span>
            </div>
            <div className="flex gap-2">
              {period.earlyReturns.map((ret, i) => (
                <span
                  key={i}
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    ret < 0 ? "bg-negative-soft text-negative" : "bg-positive-soft text-positive"
                  }`}
                >
                  {ret >= 0 ? "+" : "\u2212"}{Math.abs(ret * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 p-4 bg-brand-soft rounded-xl border border-brand/20">
        <p className="text-sm text-content">💡 {maskCurrencyInText(block.insight)}</p>
      </div>
    </div>
  );
}
