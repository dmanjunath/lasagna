import Markdown from "react-markdown";
import { cn } from "../../lib/utils.js";
import type { Message } from "../../lib/types.js";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  // Don't show empty assistant messages
  if (!isUser && !message.content?.trim()) {
    return null;
  }

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-5 py-4",
          isUser
            ? "bg-accent text-bg"
            : "bg-surface border border-border text-text"
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
              ul: ({ children }) => (
                <ul className="space-y-1.5 my-2">{children}</ul>
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
