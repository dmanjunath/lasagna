import { ArrowRight } from "lucide-react";
import type { ImprovementActionsBlock } from "../../../lib/types.js";
import { maskCurrencyInText } from "../../../lib/hide-amounts.js";

export function ImprovementActionsRenderer({ block }: { block: ImprovementActionsBlock }) {
  return (
    <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 col-span-full">
      {/* Every string here is model or server prose ("Save $4,200/yr"), so it
          never passes a number formatter. The text mask is the only thing that
          can reach it. */}
      {block.title && (
        <h3 className="text-base font-bold tracking-tight text-content mb-4">
          {maskCurrencyInText(block.title)}
        </h3>
      )}
      <div className="space-y-3">
        {block.actions.map((action, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between gap-3 p-4 bg-canvas-sunken rounded-ui-lg border border-line hover:border-line-strong hover:shadow-ui-sm transition-[border-color,box-shadow] cursor-pointer"
          >
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-content font-semibold">{maskCurrencyInText(action.description)}</span>
                <span className="px-2 py-0.5 bg-brand-soft text-[rgb(var(--ui-brand-ink))] text-xs rounded-full font-bold">
                  {maskCurrencyInText(action.impact)}
                </span>
              </div>
              {action.tradeoff && (
                <p className="text-xs text-content-muted mt-1">{maskCurrencyInText(action.tradeoff)}</p>
              )}
            </div>
            <button className="inline-flex items-center gap-1 px-3 h-9 min-h-touch bg-brand-soft text-[rgb(var(--ui-brand-ink))] rounded-ui-md text-sm font-bold hover:-translate-y-px hover:shadow-ui-sm transition-transform shrink-0">
              Apply <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
