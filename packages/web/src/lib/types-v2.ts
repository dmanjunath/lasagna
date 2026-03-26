export interface MetricV2 {
  label: string;
  value: string;
  context?: string;
}

export interface ResponseV2 {
  metrics?: MetricV2[];
  content: string;
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
