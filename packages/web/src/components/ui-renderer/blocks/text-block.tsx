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

  // Research Report style (McKinsey-inspired) - elegant typography with accent underlines
  return (
    <div className="col-span-full">
      <div className="relative p-6 rounded-2xl bg-gradient-to-b from-[#141416] to-[#0f0f11] border border-accent/10">
        <div className={cn(
          "prose prose-invert max-w-none",
          // Base typography - editorial quality
          "prose-p:text-text-secondary prose-p:text-[15px] prose-p:leading-[1.85] prose-p:mb-4 prose-p:text-justify",
          // H2 - Large with accent underline
          "prose-h2:text-[22px] prose-h2:font-semibold prose-h2:text-white prose-h2:tracking-[-0.03em] prose-h2:mb-4 prose-h2:mt-0",
          "[&_h2]:after:content-[''] [&_h2]:after:block [&_h2]:after:w-10 [&_h2]:after:h-[3px] [&_h2]:after:bg-accent [&_h2]:after:mt-3 [&_h2]:after:mb-4 [&_h2]:after:rounded-sm",
          // H3 - Uppercase accent labels
          "prose-h3:text-[13px] prose-h3:font-semibold prose-h3:text-accent prose-h3:uppercase prose-h3:tracking-[0.08em] prose-h3:mt-7 prose-h3:mb-3",
          // Strong - accent highlight for key numbers
          "prose-strong:text-accent prose-strong:font-semibold",
          // Emphasis - white text, not italic
          "prose-em:text-white prose-em:not-italic prose-em:font-medium",
          // Lists - clean spacing
          "prose-li:text-text-secondary prose-li:leading-relaxed prose-li:mb-1.5",
          "prose-ul:my-4 prose-ol:my-4",
          "prose-ul:pl-5 prose-ol:pl-5",
          // Links
          "prose-a:text-accent prose-a:no-underline hover:prose-a:underline",
          // Blockquotes - accent border
          "prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:my-5 prose-blockquote:bg-accent/5 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-text-secondary",
          // Code
          "prose-code:text-accent prose-code:bg-black/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none",
          // HR - subtle divider
          "prose-hr:border-accent/20 prose-hr:my-8"
        )}>
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
