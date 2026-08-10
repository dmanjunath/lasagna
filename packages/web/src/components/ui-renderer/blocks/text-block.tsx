import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { TextBlock as TextBlockType } from "../../../lib/types.js";

export function TextBlockRenderer({ block }: { block: TextBlockType }) {
  if (block.variant === "callout") {
    return (
      <div className="bg-[var(--ui-accent-soft)] border-l-2 border-[rgb(var(--ui-accent))] rounded-r-ui-lg p-5 col-span-full">
        <div className="prose prose-sm max-w-none prose-p:text-content prose-p:leading-relaxed prose-strong:text-[rgb(var(--ui-accent-ink))] prose-li:text-content marker:text-content-faint">
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    );
  }

  // Research Report style (McKinsey-inspired) - elegant typography with accent underlines
  return (
    <div className="col-span-full">
      <div className="relative rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
        <div className={cn(
          "prose max-w-none",
          // Base typography - editorial quality
          "prose-p:text-content-secondary prose-p:text-[15px] prose-p:leading-[1.85] prose-p:mb-4",
          // H2 - Large with periwinkle accent underline
          "prose-h2:text-[22px] prose-h2:font-bold prose-h2:text-content prose-h2:tracking-[-0.02em] prose-h2:mb-4 prose-h2:mt-0",
          "[&_h2]:after:content-[''] [&_h2]:after:block [&_h2]:after:w-10 [&_h2]:after:h-[3px] [&_h2]:after:bg-[rgb(var(--ui-accent))] [&_h2]:after:mt-3 [&_h2]:after:mb-4 [&_h2]:after:rounded-sm",
          // H3 - Uppercase accent labels
          "prose-h3:text-[13px] prose-h3:font-bold prose-h3:text-[rgb(var(--ui-accent-ink))] prose-h3:uppercase prose-h3:tracking-[0.08em] prose-h3:mt-7 prose-h3:mb-3",
          // Strong - emphasis for key numbers
          "prose-strong:text-content prose-strong:font-bold",
          // Emphasis - solid content text, not italic
          "prose-em:text-content prose-em:not-italic prose-em:font-semibold",
          // Lists - clean spacing
          "prose-li:text-content-secondary prose-li:leading-relaxed prose-li:mb-1.5 marker:text-content-faint",
          "prose-ul:my-4 prose-ol:my-4",
          "prose-ul:pl-5 prose-ol:pl-5",
          // Links
          "prose-a:text-[rgb(var(--ui-accent-ink))] prose-a:no-underline hover:prose-a:underline",
          // Blockquotes - accent border
          "prose-blockquote:border-l-2 prose-blockquote:border-[rgb(var(--ui-accent))] prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:my-5 prose-blockquote:bg-[var(--ui-accent-soft)] prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-content-secondary",
          // Code
          "prose-code:text-content prose-code:bg-canvas-sunken prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-semibold prose-code:before:content-none prose-code:after:content-none",
          // HR - subtle divider
          "prose-hr:border-line prose-hr:my-8"
        )}>
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
