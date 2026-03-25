import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { SectionCardBlock } from "../../../lib/types.js";

const variantStyles = {
  default: {
    border: "border-border",
    bg: "",
    label: "text-text-muted",
  },
  highlight: {
    border: "border-accent/30",
    bg: "bg-accent/5",
    label: "text-accent",
  },
  warning: {
    border: "border-warning/30",
    bg: "bg-warning/5",
    label: "text-warning",
  },
} as const;

export function SectionCardRenderer({ block }: { block: SectionCardBlock }) {
  const variant = block.variant || "default";
  const styles = variantStyles[variant];

  return (
    <div className={cn("glass-card overflow-hidden", styles.bg, "border", styles.border)}>
      {/* Label header */}
      <div className={cn(
        "px-4 py-2 border-b",
        styles.border,
        variant === "default" ? "bg-surface/50" : ""
      )}>
        <span className={cn("text-xs font-medium uppercase tracking-wide", styles.label)}>
          {block.label}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
