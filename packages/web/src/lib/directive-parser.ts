// packages/web/src/lib/directive-parser.ts
import YAML from 'yaml';

export type ParsedSegment =
  | { type: 'markdown'; content: string }
  | { type: 'chart'; config: Record<string, unknown> }
  | { type: 'card'; variant: string; content: string }
  | { type: 'collapse'; title: string; content: string }
  | { type: 'insight'; headline: string; details?: string; variant?: string }
  | { type: 'comparison'; options: Array<Record<string, unknown>> }
  | { type: 'action'; action: string; context?: string; priority?: string }
  | { type: 'scenario-explorer'; config: Record<string, unknown> }
  | { type: 'unknown'; raw: string };

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

export function parseDirectives(content: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  const regex = /::(\w+)(?:\{([^}]+)\})?\n([\s\S]*?)\n::/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add markdown before this directive
    if (match.index > lastIndex) {
      const markdown = content.slice(lastIndex, match.index).trim();
      if (markdown) {
        segments.push({ type: 'markdown', content: markdown });
      }
    }

    const [, directiveName, attrStr, innerContent] = match;
    const attrs = attrStr ? parseAttributes(attrStr) : {};

    switch (directiveName) {
      case 'chart':
        try {
          const config = YAML.parse(innerContent.trim());
          segments.push({ type: 'chart', config });
        } catch {
          segments.push({ type: 'unknown', raw: match[0] });
        }
        break;
      case 'card':
        segments.push({
          type: 'card',
          variant: attrs.variant || 'default',
          content: innerContent.trim(),
        });
        break;
      case 'collapse':
        segments.push({
          type: 'collapse',
          title: attrs.title || 'Details',
          content: innerContent.trim(),
        });
        break;
      case 'insight': {
        const parts = innerContent.split('---').map(p => p.trim());
        segments.push({
          type: 'insight',
          headline: parts[0],
          details: parts[1],
          variant: attrs.variant,
        });
        break;
      }
      case 'comparison':
        try {
          const config = YAML.parse(innerContent.trim());
          segments.push({
            type: 'comparison',
            options: Array.isArray(config) ? config : [config]
          });
        } catch {
          segments.push({ type: 'unknown', raw: match[0] });
        }
        break;
      case 'action': {
        const parts = innerContent.split('---').map(p => p.trim());
        segments.push({
          type: 'action',
          action: parts[0],
          context: parts[1],
          priority: attrs.priority,
        });
        break;
      }
      case 'scenario-explorer':
        try {
          const config = YAML.parse(innerContent.trim());
          segments.push({ type: 'scenario-explorer', config });
        } catch {
          segments.push({ type: 'unknown', raw: match[0] });
        }
        break;
      default:
        segments.push({ type: 'unknown', raw: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining markdown
  if (lastIndex < content.length) {
    const markdown = content.slice(lastIndex).trim();
    if (markdown) {
      segments.push({ type: 'markdown', content: markdown });
    }
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', content }];
}
