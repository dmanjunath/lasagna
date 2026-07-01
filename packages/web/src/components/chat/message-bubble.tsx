import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, Database, Wrench, AlertTriangle, RotateCw, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type { ChatMessage } from "../../lib/chat-store.js";

// Small assistant identity mark — anchors every reply to the left so the
// conversation reads as a dialogue (user bubble right, assistant prose left).
function AssistantAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-brand-soft grid place-items-center flex-shrink-0 mt-0.5">
      <Sparkles className="w-3.5 h-3.5 text-[rgb(var(--ui-brand-ink))]" />
    </div>
  );
}

interface ContextMeta {
  page: string;
  items: Array<{ label: string; value: string }>;
}

const TOOL_DISPLAY: Record<string, string> = {
  get_accounts: "Checked accounts",
  get_net_worth: "Calculated net worth",
  get_transactions: "Fetched transactions",
  get_monthly_summary: "Analyzed monthly data",
  get_spending_summary: "Reviewed spending",
  get_portfolio_composition: "Reviewed portfolio",
  get_debts: "Checked debts",
  get_goals: "Checked goals",
  get_priority_steps: "Checked priority steps",
  update_plan_content: "Updated plan",
  get_plan: "Loaded plan",
  generate_insights: "Generated insights",
  get_insights: "Fetched insights",
};

function formatToolName(name: string): string {
  return TOOL_DISPLAY[name] || name.replace(/_/g, ' ').replace(/\bget\b/i, 'Fetched');
}

export function MessageBubble({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  const isUser = message.role === "user";
  const [contextOpen, setContextOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  // Failed assistant turn — render a distinct error bubble with a retry action
  // instead of a normal-looking reply.
  if (message.isError) {
    return (
      <div className="flex gap-3 items-start animate-fade-in">
        <AssistantAvatar />
        <div className="rounded-ui-lg rounded-tl-md px-4 py-3 bg-negative-soft border border-negative/25 text-content min-w-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-negative flex-shrink-0 mt-0.5" />
            <p className="text-sm text-content-secondary leading-relaxed">{message.content}</p>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-ui-sm bg-panel border border-line-strong text-[12px] font-medium text-content-secondary hover:text-content hover:border-negative/40 transition-colors"
            >
              <RotateCw className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Extract context metadata from uiPayload on user messages
  const contextMeta: ContextMeta | null = isUser && message.uiPayload
    ? (message.uiPayload as unknown as { context: ContextMeta })?.context || null
    : null;

  // Extract tool calls for assistant messages
  const toolCalls: Array<{ toolName: string }> = !isUser && Array.isArray(message.toolCalls)
    ? (message.toolCalls as Array<{ toolName: string }>)
    : [];
  const uniqueTools = [...new Set(toolCalls.map(t => t.toolName))];

  if (!isUser && !message.content?.trim()) return null;

  // ── User turn — right-aligned warm brand-tinted bubble with an optional context chip. ──
  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1.5 animate-fade-in">
        {contextMeta && contextMeta.items.length > 0 && (
          <div className="max-w-[85%]">
            <button
              onClick={() => setContextOpen(!contextOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-soft border border-transparent text-[11px] font-medium text-[rgb(var(--ui-brand-ink))] hover:bg-brand-soft/80 transition-colors"
            >
              <Database className="w-3 h-3" />
              <span>{contextMeta.page} data included</span>
              <ChevronDown className={cn("w-3 h-3 transition-transform", contextOpen && "rotate-180")} />
            </button>
            {contextOpen && (
              <div className="mt-1 px-3 py-2 rounded-ui-sm bg-canvas-sunken border border-line text-[11px] space-y-1">
                {contextMeta.items.map((item, i) => (
                  <div key={i} className="flex justify-between gap-4">
                    <span className="text-content-secondary">{item.label}</span>
                    <span className="text-content-secondary font-medium tabular-nums">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="max-w-[80%] rounded-ui-lg rounded-br-md px-4 py-2.5 bg-brand-soft border border-brand-soft text-content break-words">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // ── Assistant turn — left avatar + reply on a calm soft panel. ──
  return (
    <div className="flex gap-3 items-start animate-fade-in">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-2">
        {/* Tool calls badge — shown above the reply */}
        {uniqueTools.length > 0 && (
          <div>
            <button
              onClick={() => setToolsOpen(!toolsOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-panel border border-line-strong text-[11px] text-content-secondary hover:text-content hover:border-brand/30 transition-colors"
            >
              <Wrench className="w-3 h-3" />
              <span>Used {uniqueTools.length} tool{uniqueTools.length > 1 ? 's' : ''}</span>
              <ChevronDown className={cn("w-3 h-3 transition-transform", toolsOpen && "rotate-180")} />
            </button>
            {toolsOpen && (
              <div className="mt-1 px-3 py-2 rounded-ui-sm bg-canvas-sunken border border-line text-[11px] space-y-1">
                {uniqueTools.map((name, i) => (
                  <div key={i} className="flex items-center gap-2 text-content-secondary">
                    <span className="w-1 h-1 rounded-full bg-brand/50 flex-shrink-0" />
                    <span>{formatToolName(name)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-ui-lg rounded-tl-md bg-panel border border-line shadow-ui-sm px-4 py-3 sm:px-[18px] sm:py-3.5 text-sm space-y-3 break-words">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="font-editorial text-lg font-bold text-content mb-2 tracking-[-0.01em]">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-base font-semibold text-content mt-4 mb-2 first:mt-0 tracking-[-0.01em]">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-[15px] font-semibold text-content mt-3 mb-1">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="text-content-secondary leading-relaxed">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-content">{children}</strong>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-brand/40 pl-3 py-1 my-2 text-content-secondary italic">
                  {children}
                </blockquote>
              ),
              ul: ({ children }) => (
                <ul className="space-y-1.5 my-2">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="space-y-1.5 my-2 list-decimal list-inside">{children}</ol>
              ),
              li: ({ children }) => (
                <li className="flex gap-2 text-content-secondary">
                  <span className="text-[rgb(var(--ui-brand-ink))] mt-1.5 text-[6px] flex-shrink-0">●</span>
                  <span className="min-w-0 flex-1 break-words">{children}</span>
                </li>
              ),
              hr: () => <hr className="border-line my-4" />,
              table: ({ children }) => (
                <div className="my-2 overflow-x-auto rounded-ui-sm border border-line">
                  <table className="w-full text-xs border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-canvas-sunken">{children}</thead>,
              th: ({ children }) => (
                <th className="text-left font-semibold text-content px-3 py-2 border-b border-line whitespace-nowrap">{children}</th>
              ),
              td: ({ children }) => (
                <td className="text-content-secondary px-3 py-2 border-b border-line tabular-nums">{children}</td>
              ),
              code: ({ children, className }) => {
                const isBlock = className?.startsWith('language-');
                return isBlock ? (
                  <pre className="bg-canvas-sunken border border-line rounded-ui-sm px-3 py-2 my-2 overflow-x-auto text-xs font-mono">
                    <code>{children}</code>
                  </pre>
                ) : (
                  <code className="bg-canvas-sunken border border-line rounded px-1 py-0.5 text-xs font-mono">{children}</code>
                );
              },
            }}
          >
            {message.content}
          </Markdown>
        </div>
      </div>
    </div>
  );
}
