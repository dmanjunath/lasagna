import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { TextBlock as TextBlockType } from "../../../lib/types.js";

export function TextBlockRenderer({ block }: { block: TextBlockType }) {
  if (block.variant === "callout") {
    return (
      <div className="bg-accent/10 border-l-2 border-accent rounded-r-xl p-5 col-span-full">
        <div className="prose prose-invert prose-sm max-w-none prose-p:text-text prose-p:leading-relaxed prose-strong:text-accent">
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    );
  }

  // Research report style prose - elegant, readable, polished
  return (
    <div className="col-span-full">
      <div className="glass-card p-6 rounded-2xl">
        <div className={cn(
          "prose prose-invert max-w-none",
          // Base typography - slightly larger, more readable
          "prose-p:text-text-secondary prose-p:text-[15px] prose-p:leading-[1.85] prose-p:mb-4",
          // Headings - more prominent with accent touches
          "prose-headings:text-text prose-headings:font-display prose-headings:font-semibold prose-headings:tracking-tight",
          "prose-h1:text-2xl prose-h1:mb-4 prose-h1:text-text",
          "prose-h2:text-xl prose-h2:mt-6 prose-h2:mb-3 prose-h2:flex prose-h2:items-center prose-h2:gap-2",
          "prose-h3:text-base prose-h3:mt-5 prose-h3:mb-2 prose-h3:text-text prose-h3:uppercase prose-h3:tracking-wider prose-h3:text-[13px]",
          // Strong/emphasis - accent color for key numbers
          "prose-strong:text-accent prose-strong:font-semibold",
          "prose-em:text-text prose-em:not-italic prose-em:font-medium",
          // Lists - better spacing
          "prose-li:text-text-secondary prose-li:leading-relaxed prose-li:mb-1",
          "prose-ul:space-y-1 prose-ul:my-3 prose-ol:space-y-1 prose-ol:my-3",
          "prose-ul:pl-4 prose-ol:pl-4",
          // Links
          "prose-a:text-accent prose-a:no-underline hover:prose-a:underline",
          // Blockquotes - more visual
          "prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:my-4 prose-blockquote:bg-accent/5 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-text-secondary",
          // Code
          "prose-code:text-accent prose-code:bg-surface prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none",
          // HR for section breaks
          "prose-hr:border-border/30 prose-hr:my-6"
        )}>
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
