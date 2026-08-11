import ReactMarkdown from 'react-markdown';
import { parseDirectives } from '../../lib/directive-parser.js';
import { ChartDirective } from './directives/chart-directive.js';
import { CardDirective } from './directives/card-directive.js';
import { CollapseDirective } from './directives/collapse-directive.js';
import { InsightCard } from './cards/insight-card.js';
import { ActionCard } from './cards/action-card.js';
import { ComparisonCard } from './cards/comparison-card.js';
import { ScenarioExplorer } from './charts/scenario-explorer.js';
import { WealthProjection } from './charts/wealth-projection.js';
import { cn } from '../../lib/utils.js';

interface MarkdownRendererProps {
  content: string;
  toolResults?: Map<string, unknown>;
}

export function MarkdownRenderer({ content, toolResults }: MarkdownRendererProps) {
  // Handle null/empty content
  if (!content) {
    return null;
  }

  const segments = parseDirectives(content);

  return (
    <div className="space-y-4">
      {segments.map((segment, i) => {
        switch (segment.type) {
          case 'markdown':
            return (
              <div key={i} className="response-text">
                <div
                  className={cn(
                    'max-w-none',
                    // Paragraphs - editorial quality, on-skin secondary text
                    '[&_p]:text-content-secondary [&_p]:text-[15px] [&_p]:leading-[1.85] [&_p]:mb-4',
                    // H2 - Section headers with periwinkle accent underline
                    '[&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:text-content [&_h2]:mt-8 [&_h2]:mb-4 [&_h2]:tracking-tight',
                    '[&_h2]:after:content-[""] [&_h2]:after:block [&_h2]:after:w-10 [&_h2]:after:h-[3px] [&_h2]:after:bg-[rgb(var(--ui-accent))] [&_h2]:after:mt-3 [&_h2]:after:rounded-sm',
                    // H3 - Subsection headers
                    '[&_h3]:text-[16px] [&_h3]:font-semibold [&_h3]:text-[rgb(var(--ui-accent-ink))] [&_h3]:mt-6 [&_h3]:mb-3',
                    // Strong text - emphasis
                    '[&_strong]:text-content [&_strong]:font-bold',
                    // Lists - proper spacing
                    '[&_ul]:my-4 [&_ul]:space-y-2 [&_ol]:my-4 [&_ol]:space-y-2',
                    '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
                    '[&_li]:text-content-secondary [&_li]:leading-relaxed [&_li]:mb-1 [&_li>p]:my-0',
                    'marker:text-content-faint',
                    // Links
                    '[&_a]:text-[rgb(var(--ui-accent-ink))] [&_a]:no-underline [&_a:hover]:underline',
                    // Code
                    '[&_code]:text-content [&_code]:bg-canvas-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-semibold',
                    // HR - subtle divider
                    '[&_hr]:border-line [&_hr]:my-6',
                    // Trim segment edges (the plugin's own first/last-child trimming)
                    '[&>:first-child]:mt-0 [&>:last-child]:mb-0'
                  )}
                >
                  <ReactMarkdown>{segment.content}</ReactMarkdown>
                </div>
              </div>
            );
          case 'chart':
            return <ChartDirective key={i} config={segment.config as any} toolResults={toolResults} />;
          case 'card':
            return <CardDirective key={i} variant={segment.variant as any} content={segment.content} />;
          case 'collapse':
            return <CollapseDirective key={i} title={segment.title} content={segment.content} />;
          case 'insight':
            return (
              <InsightCard
                key={i}
                headline={segment.headline}
                details={segment.details}
                variant={segment.variant as 'default' | 'warning' | 'success'}
              />
            );
          case 'comparison':
            return <ComparisonCard key={i} options={segment.options as any} />;
          case 'action':
            return (
              <ActionCard
                key={i}
                action={segment.action}
                context={segment.context}
                priority={segment.priority as 'high' | 'medium' | 'low'}
              />
            );
          case 'scenario-explorer': {
            const config = segment.config as any;
            const data = config.source && toolResults
              ? (toolResults.get(config.source) as any)
              : config.data;
            return (
              <ScenarioExplorer
                key={i}
                title={config.title || 'Scenario Explorer'}
                data={data || []}
                scenarios={config.scenarios || []}
                sliders={config.sliders}
              />
            );
          }
          case 'wealth-projection': {
            const config = segment.config as any;
            const data = config.source && toolResults
              ? (toolResults.get(config.source) as any)
              : config.data;
            return (
              <WealthProjection
                key={i}
                title={config.title || 'Wealth Projection'}
                data={data || []}
                categories={config.categories || []}
                scenarios={config.scenarios}
                currentAge={config.currentAge}
                retirementAge={config.retirementAge}
              />
            );
          }
          case 'unknown':
            return (
              <pre key={i} className="p-4 bg-canvas-sunken rounded-ui-md text-xs text-content-secondary overflow-x-auto">
                {segment.raw}
              </pre>
            );
        }
      })}
    </div>
  );
}
