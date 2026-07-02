import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { SectionCardBlock } from "../../../lib/types.js";

const variantStyles = {
  default: {
    border: "border-line",
    bg: "bg-panel",
    labelBg: "bg-canvas-sunken",
    label: "text-content-muted",
    icon: "◆",
  },
  highlight: {
    border: "border-[rgb(var(--ui-accent))]/40",
    bg: "bg-[var(--ui-accent-soft)]",
    labelBg: "bg-[var(--ui-accent-soft)]",
    label: "text-[rgb(var(--ui-accent-ink))]",
    icon: "★",
  },
  warning: {
    border: "border-[rgb(var(--ui-caution))]/40",
    bg: "bg-[var(--ui-caution-soft)]",
    labelBg: "bg-[var(--ui-caution-soft)]",
    label: "text-[rgb(var(--ui-caution))]",
    icon: "⚠",
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
      {/* Label header - more prominent */}
      <div className={cn(
        "px-4 py-2.5 border-b flex items-center gap-2",
        styles.border,
        styles.labelBg
      )}>
        <span className={cn("text-[10px]", styles.label)}>
          {styles.icon}
        </span>
        <span className={cn(
          "text-[11px] font-bold uppercase tracking-[0.12em]",
          styles.label
        )}>
          {block.label}
        </span>
      </div>

      {/* Content - with better overflow handling */}
      <div className="p-5 max-h-[400px] overflow-y-auto scrollbar-thin">
        <div className={cn(
          "prose prose-sm max-w-none",
          "prose-p:text-content-secondary prose-p:leading-relaxed prose-p:mb-3 last:prose-p:mb-0",
          "prose-strong:text-content prose-strong:font-bold",
          "prose-li:text-content-secondary prose-li:leading-relaxed marker:text-content-faint",
          "prose-ul:space-y-1.5 prose-ol:space-y-1.5",
          "prose-headings:text-content prose-headings:font-semibold prose-headings:mb-2"
        )}>
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
