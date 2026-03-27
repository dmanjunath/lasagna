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
          "max-w-[80%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-accent text-bg"
            : "bg-surface border border-border text-text"
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}
