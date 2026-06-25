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
    <div className="w-7 h-7 rounded-full bg-accent/10 ring-1 ring-accent/15 grid place-items-center flex-shrink-0 mt-0.5">
      <Sparkles className="w-3.5 h-3.5 text-accent" />
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
        <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-danger/[0.06] border border-danger/25 text-text min-w-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
            <p className="text-sm text-text-secondary leading-relaxed">{message.content}</p>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface border border-border text-[12px] font-medium text-text-secondary hover:text-text hover:border-danger/40 transition-colors"
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

  // ── User turn — right-aligned warm bubble with an optional context chip. ──
  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1.5 animate-fade-in">
        {contextMeta && contextMeta.items.length > 0 && (
          <div className="max-w-[85%]">
            <button
              onClick={() => setContextOpen(!contextOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/[0.07] border border-accent/15 text-[11px] text-accent/80 hover:text-accent hover:border-accent/25 transition-colors"
            >
              <Database className="w-3 h-3" />
              <span>{contextMeta.page} data included</span>
              <ChevronDown className={cn("w-3 h-3 transition-transform", contextOpen && "rotate-180")} />
            </button>
            {contextOpen && (
              <div className="mt-1 px-3 py-2 rounded-lg bg-bg-elevated/80 border border-border text-[11px] space-y-1">
                {contextMeta.items.map((item, i) => (
                  <div key={i} className="flex justify-between gap-4">
                    <span className="text-text-secondary">{item.label}</span>
                    <span className="text-text-secondary font-medium tabular-nums">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 bg-accent text-white shadow-sm shadow-accent/15 break-words">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // ── Assistant turn — left avatar + open prose (no heavy bubble). ──
  return (
    <div className="flex gap-3 items-start animate-fade-in">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-2">
        {/* Tool calls badge — shown above the reply */}
        {uniqueTools.length > 0 && (
          <div>
            <button
              onClick={() => setToolsOpen(!toolsOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-border text-[11px] text-text-secondary hover:text-text hover:border-accent/25 transition-colors"
            >
              <Wrench className="w-3 h-3" />
              <span>Used {uniqueTools.length} tool{uniqueTools.length > 1 ? 's' : ''}</span>
              <ChevronDown className={cn("w-3 h-3 transition-transform", toolsOpen && "rotate-180")} />
            </button>
            {toolsOpen && (
              <div className="mt-1 px-3 py-2 rounded-lg bg-bg-elevated/80 border border-border text-[11px] space-y-1">
                {uniqueTools.map((name, i) => (
                  <div key={i} className="flex items-center gap-2 text-text-secondary">
                    <span className="w-1 h-1 rounded-full bg-accent/50 flex-shrink-0" />
                    <span>{formatToolName(name)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="text-sm space-y-3 break-words">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-base font-semibold text-text mb-2">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-sm font-semibold text-text mt-4 mb-2 first:mt-0">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-medium text-text mt-3 mb-1">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="text-text-secondary leading-relaxed">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-text">{children}</strong>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-accent/40 pl-3 py-1 my-2 text-text-secondary italic">
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
                <li className="flex gap-2 text-text-secondary">
                  <span className="text-accent mt-1.5 text-[6px] flex-shrink-0">●</span>
                  <span className="min-w-0 flex-1 break-words">{children}</span>
                </li>
              ),
              hr: () => <hr className="border-border my-4" />,
              table: ({ children }) => (
                <div className="my-2 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-bg-elevated">{children}</thead>,
              th: ({ children }) => (
                <th className="text-left font-semibold text-text px-3 py-2 border-b border-border whitespace-nowrap">{children}</th>
              ),
              td: ({ children }) => (
                <td className="text-text-secondary px-3 py-2 border-b border-border/60 tabular-nums">{children}</td>
              ),
              code: ({ children, className }) => {
                const isBlock = className?.startsWith('language-');
                return isBlock ? (
                  <pre className="bg-bg-elevated border border-border rounded-lg px-3 py-2 my-2 overflow-x-auto text-xs font-mono">
                    <code>{children}</code>
                  </pre>
                ) : (
                  <code className="bg-bg-elevated border border-border rounded px-1 py-0.5 text-xs font-mono">{children}</code>
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
