import { ArrowRight } from "lucide-react";
import type { ImprovementActionsBlock } from "../../../lib/types.js";

export function ImprovementActionsRenderer({ block }: { block: ImprovementActionsBlock }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4">
          {block.title}
        </h3>
      )}
      <div className="space-y-3">
        {block.actions.map((action, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between p-4 bg-surface rounded-xl border border-border hover:border-accent/50 transition-colors cursor-pointer"
          >
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="text-text">{action.description}</span>
                <span className="px-2 py-0.5 bg-success/20 text-success text-xs rounded-full font-medium">
                  {action.impact}
                </span>
              </div>
              {action.tradeoff && (
                <p className="text-xs text-text-secondary mt-1">{action.tradeoff}</p>
              )}
            </div>
            <button className="flex items-center gap-1 px-3 py-1.5 bg-accent text-bg rounded-lg text-sm font-medium hover:bg-accent-dim transition-colors">
              Apply <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
