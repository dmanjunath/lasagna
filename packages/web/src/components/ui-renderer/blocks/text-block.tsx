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
      <div className={cn(
        "prose prose-invert max-w-none",
        // Typography
        "prose-p:text-text-secondary prose-p:text-[15px] prose-p:leading-[1.8] prose-p:tracking-wide",
        // Headings
        "prose-headings:text-text prose-headings:font-display prose-headings:font-medium",
        "prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4 prose-h2:pb-2 prose-h2:border-b prose-h2:border-border/50",
        "prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-3 prose-h3:text-text-secondary",
        // Strong/emphasis
        "prose-strong:text-text prose-strong:font-semibold",
        "prose-em:text-accent prose-em:not-italic prose-em:font-medium",
        // Lists
        "prose-li:text-text-secondary prose-li:leading-relaxed",
        "prose-ul:space-y-2 prose-ol:space-y-2",
        // Links
        "prose-a:text-accent prose-a:no-underline hover:prose-a:underline",
        // Blockquotes
        "prose-blockquote:border-l-2 prose-blockquote:border-accent/50 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-text-muted",
        // Code
        "prose-code:text-accent prose-code:bg-surface prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none"
      )}>
        <ReactMarkdown>{block.content}</ReactMarkdown>
      </div>
    </div>
  );
}
