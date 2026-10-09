import { ArrowRight } from "lucide-react";
import type { ImprovementActionsBlock } from "../../../lib/types.js";
import { maskCurrencyInText } from "../../../lib/hide-amounts.js";
import { Badge, Button } from "../../uikit";

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
                <Badge tone="brand" size="sm">
                  {maskCurrencyInText(action.impact)}
                </Badge>
              </div>
              {action.tradeoff && (
                <p className="text-xs text-content-muted mt-1">{maskCurrencyInText(action.tradeoff)}</p>
              )}
            </div>
            <Button size="sm" className="shrink-0" trailingIcon={<ArrowRight className="w-4 h-4" />}>
              Apply
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
