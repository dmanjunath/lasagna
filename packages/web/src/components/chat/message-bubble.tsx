import { cn } from "../../lib/utils.js";
import { UIRenderer } from "../ui-renderer/index.js";
import type { Message } from "../../lib/types.js";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

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

        {message.uiPayload && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <UIRenderer payload={message.uiPayload} />
          </div>
        )}
      </div>
    </div>
  );
}
