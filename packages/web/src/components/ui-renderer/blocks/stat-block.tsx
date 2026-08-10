import { cn } from "../../../lib/utils.js";
import type { StatBlock as StatBlockType } from "../../../lib/types.js";

// On-skin stat card (--ui-* tokens) so plan metrics read correctly in light and
// dark. A periwinkle accent rail ties it to the Bright system; trend colours the
// value.
export function StatBlockRenderer({ block }: { block: StatBlockType }) {
  const valueColor =
    block.trend === "up"
      ? "text-[rgb(var(--ui-positive))]"
      : block.trend === "down"
      ? "text-[rgb(var(--ui-negative))]"
      : "text-content";

  const displayValue = block.change ? `${block.value} (${block.change})` : block.value;

  return (
    <div className="relative overflow-hidden rounded-ui-lg border border-line bg-panel shadow-ui-sm p-5">
      <span className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--ui-accent))]" aria-hidden />
      <p className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-content-muted">
        {block.label}
      </p>
      <div
        className={cn(
          "mt-1.5 font-editorial text-[24px] font-extrabold leading-none tracking-[-0.02em] ui-tnum",
          valueColor,
        )}
      >
        {displayValue}
      </div>
      {block.description && (
        <p className="mt-2 text-[12px] font-semibold text-content-muted">{block.description}</p>
      )}
    </div>
  );
}
