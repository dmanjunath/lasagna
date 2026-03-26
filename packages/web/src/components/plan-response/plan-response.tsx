import { MetricsBar } from './metrics-bar.js';
import { MarkdownRenderer } from './markdown-renderer.js';
import { ActionsFooter } from './actions-footer.js';
import type { ResponseV2, ToolResult } from '../../lib/types-v2.js';

interface PlanResponseProps {
  response: ResponseV2;
  toolResults?: ToolResult[];
}

export function PlanResponse({ response, toolResults }: PlanResponseProps) {
  // Convert tool results array to map for easy lookup
  const toolResultsMap = new Map(
    toolResults?.map((tr) => [tr.toolName, tr.result]) ?? []
  );

  return (
    <div className="space-y-6">
      {response.metrics && response.metrics.length > 0 && (
        <MetricsBar metrics={response.metrics} />
      )}

      <div className="p-6 rounded-2xl bg-gradient-to-b from-[#141416] to-[#0f0f11] border border-accent/10">
        <MarkdownRenderer content={response.content} toolResults={toolResultsMap} />
      </div>

      {response.actions && response.actions.length > 0 && (
        <ActionsFooter actions={response.actions} />
      )}
    </div>
  );
}
