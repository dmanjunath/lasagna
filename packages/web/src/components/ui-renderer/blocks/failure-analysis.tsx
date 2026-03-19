import { AlertTriangle } from "lucide-react";
import type { FailureAnalysisBlock } from "../../../lib/types.js";

export function FailureAnalysisRenderer({ block }: { block: FailureAnalysisBlock }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-warning" />
          {block.title}
        </h3>
      )}

      <div className="space-y-4">
        {block.failedPeriods.map((period, idx) => (
          <div key={idx} className="p-4 bg-danger/10 rounded-xl border border-danger/20">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-text">Started {period.startYear}</span>
              <span className="text-xs text-text-secondary">{period.pattern}</span>
            </div>
            <div className="flex gap-2">
              {period.earlyReturns.map((ret, i) => (
                <span
                  key={i}
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    ret < 0 ? "bg-danger/20 text-danger" : "bg-success/20 text-success"
                  }`}
                >
                  {ret >= 0 ? "+" : ""}{(ret * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 p-4 bg-accent/10 rounded-xl border border-accent/20">
        <p className="text-sm text-text">💡 {block.insight}</p>
      </div>
    </div>
  );
}
