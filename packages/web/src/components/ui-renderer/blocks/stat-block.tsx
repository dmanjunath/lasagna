import { StatCard } from "../../common/stat-card.js";
import type { StatBlock as StatBlockType } from "../../../lib/types.js";

export function StatBlockRenderer({ block }: { block: StatBlockType }) {
  // Map trend to status for StatCard
  const status = block.trend === "up" ? "success" : block.trend === "down" ? "danger" : "default";

  // Append change to value if present
  const displayValue = block.change ? `${block.value} (${block.change})` : block.value;

  return (
    <StatCard
      label={block.label}
      value={displayValue}
      status={status}
    />
  );
}
