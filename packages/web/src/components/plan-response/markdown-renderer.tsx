import ReactMarkdown from 'react-markdown';
import { parseDirectives } from '../../lib/directive-parser.js';
import { ChartDirective } from './directives/chart-directive.js';
import { CardDirective } from './directives/card-directive.js';
import { CollapseDirective } from './directives/collapse-directive.js';
import { cn } from '../../lib/utils.js';

interface MarkdownRendererProps {
  content: string;
  toolResults?: Map<string, unknown>;
}

export function MarkdownRenderer({ content, toolResults }: MarkdownRendererProps) {
  const segments = parseDirectives(content);

  return (
    <div className="space-y-4">
      {segments.map((segment, i) => {
        switch (segment.type) {
          case 'markdown':
            return (
              <div
                key={i}
                className={cn(
                  'prose prose-invert max-w-none',
                  'prose-p:text-[#c5c5c5] prose-p:text-[15px] prose-p:leading-[1.85]',
                  'prose-h2:text-[22px] prose-h2:font-semibold prose-h2:text-white prose-h2:mt-8 prose-h2:mb-4',
                  'prose-h3:text-[16px] prose-h3:font-semibold prose-h3:text-accent prose-h3:mt-6 prose-h3:mb-3',
                  'prose-strong:text-accent prose-strong:font-semibold',
                  'prose-li:text-[#c5c5c5]',
                  'prose-a:text-accent prose-a:no-underline hover:prose-a:underline'
                )}
              >
                <ReactMarkdown>{segment.content}</ReactMarkdown>
              </div>
            );
          case 'chart':
            return <ChartDirective key={i} config={segment.config as any} toolResults={toolResults} />;
          case 'card':
            return <CardDirective key={i} variant={segment.variant as any} content={segment.content} />;
          case 'collapse':
            return <CollapseDirective key={i} title={segment.title} content={segment.content} />;
          case 'unknown':
            return (
              <pre key={i} className="p-4 bg-surface rounded-xl text-xs text-text-muted overflow-x-auto">
                {segment.raw}
              </pre>
            );
        }
      })}
    </div>
  );
}
