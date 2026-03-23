import ReactMarkdown from "react-markdown";
import type { TextBlock as TextBlockType } from "../../../lib/types.js";

export function TextBlockRenderer({ block }: { block: TextBlockType }) {
  if (block.variant === "callout") {
    return (
      <div className="bg-accent/10 border border-accent/20 rounded-xl p-4 text-text prose prose-invert prose-sm max-w-none">
        <ReactMarkdown>{block.content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="prose prose-invert prose-sm max-w-none prose-headings:text-text prose-headings:font-display prose-p:text-text-secondary prose-strong:text-text prose-li:text-text-secondary prose-ul:text-text-secondary col-span-full">
      <ReactMarkdown>{block.content}</ReactMarkdown>
    </div>
  );
}
