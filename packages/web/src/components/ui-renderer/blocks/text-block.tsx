import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { TextBlock as TextBlockType } from "../../../lib/types.js";

export function TextBlockRenderer({ block }: { block: TextBlockType }) {
  if (block.variant === "callout") {
    return (
      <div className="bg-[var(--ui-accent-soft)] border-l-2 border-[rgb(var(--ui-accent))] rounded-r-ui-lg p-5 col-span-full">
        <div className="max-w-none text-sm [&_p]:text-content [&_p]:leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:text-[rgb(var(--ui-accent-ink))] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:text-content [&_li]:mb-1 [&_li>p]:my-0 marker:text-content-faint">
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
          "max-w-none",
          // Base typography - editorial quality
          "[&_p]:text-content-secondary [&_p]:text-[15px] [&_p]:leading-[1.85] [&_p]:mb-4",
          // H2 - Large with periwinkle accent underline
          "[&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:text-content [&_h2]:tracking-[-0.02em] [&_h2]:mb-4 [&_h2]:mt-0",
          "[&_h2]:after:content-[''] [&_h2]:after:block [&_h2]:after:w-10 [&_h2]:after:h-[3px] [&_h2]:after:bg-[rgb(var(--ui-accent))] [&_h2]:after:mt-3 [&_h2]:after:mb-4 [&_h2]:after:rounded-sm",
          // H3 - sentence-case sub-headings
          "[&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-content [&_h3]:mt-7 [&_h3]:mb-3",
          // Strong - emphasis for key numbers
          "[&_strong]:text-content [&_strong]:font-bold",
          // Emphasis - solid content text, not italic
          "[&_em]:text-content [&_em]:not-italic [&_em]:font-semibold",
          // Lists - clean spacing
          "[&_li]:text-content-secondary [&_li]:leading-relaxed [&_li]:mb-1.5 [&_li>p]:my-0 marker:text-content-faint",
          "[&_ul]:my-4 [&_ol]:my-4",
          "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5",
          // Links
          "[&_a]:text-[rgb(var(--ui-accent-ink))] [&_a]:no-underline [&_a:hover]:underline",
          // Blockquotes - accent border
          "[&_blockquote]:border-l-2 [&_blockquote]:border-[rgb(var(--ui-accent))] [&_blockquote]:pl-4 [&_blockquote]:py-1 [&_blockquote]:my-5 [&_blockquote]:bg-[var(--ui-accent-soft)] [&_blockquote]:rounded-r-lg [&_blockquote]:not-italic [&_blockquote]:text-content-secondary",
          // Code
          "[&_code]:text-content [&_code]:bg-canvas-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-semibold",
          // HR - subtle divider
          "[&_hr]:border-line [&_hr]:my-8",
          // Trim card edges (the plugin's own first/last-child trimming)
          "[&>:first-child]:mt-0 [&>:last-child]:mb-0"
        )}>
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
