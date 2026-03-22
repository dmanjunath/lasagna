import { cn } from "../../lib/utils.js";
import type { UIPayload, UIBlock } from "../../lib/types.js";
import {
  StatBlockRenderer,
  ChartBlockRenderer,
  TableBlockRenderer,
  TextBlockRenderer,
} from "./blocks/index.js";

const layoutClasses = {
  single: "flex flex-col gap-6",
  split: "grid grid-cols-1 md:grid-cols-2 gap-6",
  grid: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4",
};

function BlockRenderer({ block }: { block: UIBlock }) {
  switch (block.type) {
    case "stat":
      return <StatBlockRenderer block={block} />;
    case "chart":
      return <ChartBlockRenderer block={block} />;
    case "table":
      return <TableBlockRenderer block={block} />;
    case "text":
      return <TextBlockRenderer block={block} />;
    case "projection":
      // TODO: Implement projection renderer
      return (
        <div className="p-4 border border-border rounded-xl">
          <p className="text-text-muted">Projection: {block.scenarios.length} scenarios</p>
        </div>
      );
    case "action":
      return (
        <button className="px-4 py-2 bg-accent text-bg rounded-lg font-medium hover:bg-accent-dim transition-colors">
          {block.label}
        </button>
      );
    default:
      return null;
  }
}

export function UIRenderer({ payload }: { payload: UIPayload }) {
  if (!payload || !payload.blocks) {
    return null;
  }

  return (
    <div className={cn(layoutClasses[payload.layout])}>
      {payload.blocks.map((block, index) => (
        <BlockRenderer key={index} block={block} />
      ))}
    </div>
  );
}
