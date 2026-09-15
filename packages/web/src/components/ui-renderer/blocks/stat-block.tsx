import { cn } from "../../../lib/utils.js";
import type { StatBlock as StatBlockType } from "../../../lib/types.js";
import { isMasked, maskCurrencyInText } from "../../../lib/hide-amounts.js";
import { MaskedText } from "../../uikit/MaskedText.js";

// On-skin stat card (--ui-* tokens) so plan metrics read correctly in light and
// dark. A periwinkle accent rail ties it to the Bright system; trend colours the
// value.
export function StatBlockRenderer({ block }: { block: StatBlockType }) {
  // The model hands us `value` already formatted, so the mask has to happen on
  // the string. `trend` colours it green or red, and that tone is a fact about
  // the hidden figure, so it drops with the digits.
  const value = maskCurrencyInText(block.value);
  const change = block.change ? maskCurrencyInText(block.change) : null;
  const displayValue = change ? `${value} (${change})` : value;

  const valueColor =
    isMasked(displayValue)
      ? "text-content"
      : block.trend === "up"
      ? "text-[rgb(var(--ui-positive))]"
      : block.trend === "down"
      ? "text-[rgb(var(--ui-negative))]"
      : "text-content";

  return (
    <div className="relative overflow-hidden rounded-ui-lg border border-line bg-panel shadow-ui-sm p-5">
      <span className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--ui-accent))]" aria-hidden />
      <p className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-content-muted">
        {maskCurrencyInText(block.label)}
      </p>
      <div
        className={cn(
          "mt-1.5 font-editorial text-[24px] font-extrabold leading-none tracking-[-0.02em] ui-tnum",
          valueColor,
        )}
      >
        <MaskedText text={displayValue} />
      </div>
      {block.description && (
        <p className="mt-2 text-[12px] font-semibold text-content-muted">{maskCurrencyInText(block.description)}</p>
      )}
    </div>
  );
}
