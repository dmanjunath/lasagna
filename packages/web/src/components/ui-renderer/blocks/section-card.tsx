import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { SectionCardBlock } from "../../../lib/types.js";

const variantStyles = {
  default: {
    border: "border-line",
    bg: "bg-panel",
    labelBg: "bg-canvas-sunken",
    label: "text-content-muted",
  },
  highlight: {
    border: "border-[rgb(var(--ui-accent))]/40",
    bg: "bg-[var(--ui-accent-soft)]",
    labelBg: "bg-[var(--ui-accent-soft)]",
    label: "text-[rgb(var(--ui-accent-ink))]",
  },
  warning: {
    border: "border-[rgb(var(--ui-caution))]/40",
    bg: "bg-[var(--ui-caution-soft)]",
    labelBg: "bg-[var(--ui-caution-soft)]",
    label: "text-[rgb(var(--ui-caution))]",
  },
} as const;

export function SectionCardRenderer({ block }: { block: SectionCardBlock }) {
  const variant = block.variant || "default";
  const styles = variantStyles[variant];

  return (
    <div className={cn(
      "rounded-ui-lg border shadow-ui-sm overflow-hidden",
      styles.bg,
      styles.border
    )}>
      {/* Label header */}
      <div className={cn(
        "px-4 py-2.5 border-b",
        styles.border,
        styles.labelBg
      )}>
        <span className={cn("text-[13px] font-semibold", styles.label)}>
          {block.label}
        </span>
      </div>

      {/* Content - with better overflow handling */}
      <div className="p-5 max-h-[400px] overflow-y-auto scrollbar-thin">
        <div className={cn(
          "max-w-none text-sm",
          "[&_p]:text-content-secondary [&_p]:leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0",
          "[&_strong]:text-content [&_strong]:font-bold",
          "[&_li]:text-content-secondary [&_li]:leading-relaxed [&_li>p]:my-0 marker:text-content-faint",
          "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5",
          "[&_ul]:my-2 [&_ol]:my-2 [&_ul]:space-y-1.5 [&_ol]:space-y-1.5",
          "[&_:is(h1,h2,h3,h4)]:text-content [&_:is(h1,h2,h3,h4)]:font-semibold [&_:is(h1,h2,h3,h4)]:mb-2"
        )}>
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
