export interface MetricV2 {
  label: string;
  value: string;
  context?: string;
}

export interface ResponseV2 {
  chat: string; // Brief conversational response for chat sidebar
  metrics?: MetricV2[];
  content: string; // Full structured content for main page
  actions?: string[];
}

export interface ToolResult {
  toolName: string;
  result: unknown;
}

export function isResponseV2(obj: unknown): obj is ResponseV2 {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'content' in obj &&
    typeof (obj as any).content === 'string' &&
    !('blocks' in obj)
  );
}
