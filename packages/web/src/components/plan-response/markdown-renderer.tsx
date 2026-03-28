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
                    'prose prose-invert max-w-none',
                    // Paragraphs - editorial quality with proper spacing
                    'prose-p:text-[#c5c5c5] prose-p:text-[15px] prose-p:leading-[1.85] prose-p:mb-4',
                    // H2 - Section headers with accent underline
                    'prose-h2:text-[22px] prose-h2:font-semibold prose-h2:text-white prose-h2:mt-8 prose-h2:mb-4 prose-h2:tracking-tight',
                    '[&_h2]:after:content-[""] [&_h2]:after:block [&_h2]:after:w-10 [&_h2]:after:h-[3px] [&_h2]:after:bg-accent [&_h2]:after:mt-3 [&_h2]:after:rounded-sm',
                    // H3 - Subsection headers
                    'prose-h3:text-[16px] prose-h3:font-semibold prose-h3:text-accent prose-h3:mt-6 prose-h3:mb-3',
                    // Strong text - accent color for emphasis
                    'prose-strong:text-accent prose-strong:font-semibold',
                    // Lists - proper spacing
                    'prose-ul:my-4 prose-ul:space-y-2 prose-ol:my-4 prose-ol:space-y-2',
                    'prose-li:text-[#c5c5c5] prose-li:leading-relaxed prose-li:mb-1',
                    // Links
                    'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
                    // Code
                    'prose-code:text-accent prose-code:bg-black/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm',
                    // HR - subtle divider
                    'prose-hr:border-accent/20 prose-hr:my-6'
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
              <pre key={i} className="p-4 bg-surface rounded-xl text-xs text-text-muted overflow-x-auto">
                {segment.raw}
              </pre>
            );
        }
      })}
    </div>
  );
}
