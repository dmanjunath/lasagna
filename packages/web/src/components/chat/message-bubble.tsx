import { useState } from "react";
import Markdown from "react-markdown";
import { ChevronDown, Database } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type { Message } from "../../lib/types.js";

interface ContextMeta {
  page: string;
  items: Array<{ label: string; value: string }>;
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const [contextOpen, setContextOpen] = useState(false);

  // Extract context metadata from uiPayload on user messages
  const contextMeta: ContextMeta | null = isUser && message.uiPayload
    ? (message.uiPayload as unknown as { context: ContextMeta })?.context || null
    : null;

  if (!isUser && !message.content?.trim()) return null;

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      {/* Context badge — shown above user message */}
      {contextMeta && contextMeta.items.length > 0 && (
        <div className="max-w-[85%] mb-1.5">
          <button
            onClick={() => setContextOpen(!contextOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/8 border border-accent/15 text-[11px] text-accent/70 hover:text-accent hover:border-accent/25 transition-colors"
          >
            <Database className="w-3 h-3" />
            <span>{contextMeta.page} data included</span>
            <ChevronDown className={cn("w-3 h-3 transition-transform", contextOpen && "rotate-180")} />
          </button>
          {contextOpen && (
            <div className="mt-1 px-3 py-2 rounded-lg bg-bg-elevated/80 border border-border text-[11px] space-y-1">
              {contextMeta.items.map((item, i) => (
                <div key={i} className="flex justify-between gap-4">
                  <span className="text-text-muted">{item.label}</span>
                  <span className="text-text-secondary font-medium tabular-nums">{item.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message bubble */}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-accent text-bg"
            : "bg-surface border border-border/60 text-text"
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="text-sm space-y-3">
          <Markdown
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
                <p className="text-text-muted leading-relaxed">{children}</p>
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
                <li className="flex gap-2 text-text-muted">
                  <span className="text-accent mt-1.5 text-[6px]">●</span>
                  <span>{children}</span>
                </li>
              ),
              hr: () => <hr className="border-border my-4" />,
            }}
          >
            {message.content}
          </Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
