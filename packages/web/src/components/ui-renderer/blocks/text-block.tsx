import type { TextBlock as TextBlockType } from "../../../lib/types.js";

export function TextBlockRenderer({ block }: { block: TextBlockType }) {
  if (block.variant === "callout") {
    return (
      <div className="bg-accent/10 border border-accent/20 rounded-xl p-4">
        <p className="text-text">{block.content}</p>
      </div>
    );
  }

  return (
    <div className="prose prose-invert max-w-none">
      <p className="text-text-secondary leading-relaxed">{block.content}</p>
    </div>
  );
}
