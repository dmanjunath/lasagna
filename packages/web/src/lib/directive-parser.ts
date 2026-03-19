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
  | { type: 'wealth-projection'; config: Record<string, unknown> }
  | { type: 'unknown'; raw: string };

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Handle both single and double quotes
  const regex = /(\w+)=["']([^"']*)["']/g;
  let match;
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

export function parseDirectives(content: string): ParsedSegment[] {
  // Handle null/undefined content
  if (!content) {
    return [];
  }

  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  // More flexible regex: handles newlines or spaces, and optional closing ::
  // Pattern 1: ::directive{attrs}\n...\n:: (standard)
  // Pattern 2: ::directive{attrs}\n...\n:: or just until next :: or end
  const regex = /::(\w+[-\w]*)(?:\{([^}]*)\})?[\s\n]+([\s\S]*?)(?:\n::|::(?=\s|$)|$)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add markdown before this directive
    if (match.index > lastIndex) {
      const markdown = content.slice(lastIndex, match.index).trim();
      if (markdown) {
        segments.push({ type: 'markdown', content: markdown });
      }
    }

    const [fullMatch, directiveName, attrStr, innerContent] = match;
    const attrs = attrStr ? parseAttributes(attrStr) : {};
    const trimmedContent = innerContent?.trim() || '';

    switch (directiveName) {
      case 'chart':
        try {
          const config = YAML.parse(trimmedContent);
          segments.push({ type: 'chart', config });
        } catch {
          segments.push({ type: 'unknown', raw: fullMatch });
        }
        break;
      case 'card':
        segments.push({
          type: 'card',
          variant: attrs.variant || 'default',
          content: trimmedContent,
        });
        break;
      case 'collapse':
        segments.push({
          type: 'collapse',
          title: attrs.title || 'Details',
          content: trimmedContent,
        });
        break;
      case 'insight': {
        const parts = trimmedContent.split('---').map(p => p.trim());
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
          const config = YAML.parse(trimmedContent);
          segments.push({
            type: 'comparison',
            options: Array.isArray(config) ? config : [config]
          });
        } catch {
          segments.push({ type: 'unknown', raw: fullMatch });
        }
        break;
      case 'action': {
        const parts = trimmedContent.split('---').map(p => p.trim());
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
          // Try YAML first, then try parsing inline format
          let config: Record<string, unknown>;
          try {
            config = YAML.parse(trimmedContent);
          } catch {
            // Parse inline scenario format: name: "..." outcome: "..." ...
            config = parseInlineScenarios(trimmedContent);
          }
          segments.push({ type: 'scenario-explorer', config });
        } catch {
          segments.push({ type: 'unknown', raw: fullMatch });
        }
        break;
      case 'wealth-projection':
        try {
          const config = YAML.parse(trimmedContent);
          segments.push({ type: 'wealth-projection', config });
        } catch {
          segments.push({ type: 'unknown', raw: fullMatch });
        }
        break;
      default:
        segments.push({ type: 'unknown', raw: fullMatch });
    }

    lastIndex = match.index + fullMatch.length;
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

// Parse inline scenario format like: name: "Start at 30" outcome: "$8,300/month" source: "calc"
function parseInlineScenarios(content: string): Record<string, unknown> {
  const scenarios: Array<Record<string, string>> = [];

  // Split by "name:" to find each scenario
  const parts = content.split(/(?=name:)/);

  for (const part of parts) {
    if (!part.trim()) continue;

    const scenario: Record<string, string> = {};
    // Match key: "value" or key: 'value' patterns
    const kvRegex = /(\w+):\s*["']([^"']+)["']/g;
    let kvMatch;
    while ((kvMatch = kvRegex.exec(part)) !== null) {
      scenario[kvMatch[1]] = kvMatch[2];
    }

    if (Object.keys(scenario).length > 0) {
      scenarios.push(scenario);
    }
  }

  return { scenarios };
}
