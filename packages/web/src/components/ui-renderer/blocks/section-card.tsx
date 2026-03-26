import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { SectionCardBlock } from "../../../lib/types.js";

const variantStyles = {
  default: {
    border: "border-border/50",
    bg: "bg-surface/30",
    labelBg: "bg-text-muted/10",
    label: "text-text-muted",
    icon: "◆",
  },
  highlight: {
    border: "border-accent/40",
    bg: "bg-accent/5",
    labelBg: "bg-accent/15",
    label: "text-accent",
    icon: "★",
  },
  warning: {
    border: "border-warning/40",
    bg: "bg-warning/5",
    labelBg: "bg-warning/15",
    label: "text-warning",
    icon: "⚠",
  },
} as const;

export function SectionCardRenderer({ block }: { block: SectionCardBlock }) {
  const variant = block.variant || "default";
  const styles = variantStyles[variant];

  return (
    <div className={cn(
      "glass-card overflow-hidden",
      styles.bg,
      "border",
      styles.border
    )}>
      {/* Label header - more prominent */}
      <div className={cn(
        "px-4 py-2.5 border-b flex items-center gap-2",
        styles.border,
        styles.labelBg
      )}>
        <span className={cn("text-[10px] opacity-60", styles.label)}>
          {styles.icon}
        </span>
        <span className={cn(
          "text-[11px] font-semibold uppercase tracking-widest",
          styles.label
        )}>
          {block.label}
        </span>
      </div>

      {/* Content - with better overflow handling */}
      <div className="p-5 max-h-[400px] overflow-y-auto scrollbar-thin">
        <div className={cn(
          "prose prose-sm prose-invert max-w-none",
          "prose-p:text-text-secondary prose-p:leading-relaxed prose-p:mb-3 last:prose-p:mb-0",
          "prose-strong:text-text prose-strong:font-semibold",
          "prose-li:text-text-secondary prose-li:leading-relaxed",
          "prose-ul:space-y-1.5 prose-ol:space-y-1.5",
          "prose-headings:text-text prose-headings:font-medium prose-headings:mb-2"
        )}>
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
