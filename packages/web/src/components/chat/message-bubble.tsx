import { cn } from "../../lib/utils.js";
import type { Message } from "../../lib/types.js";

// Strip JSON UIPayload from message content for display
function getDisplayContent(content: string): string {
  // Remove JSON object at the end that starts with { and contains "layout"
  const layoutIdx = content.lastIndexOf('"layout"');
  if (layoutIdx !== -1) {
    const braceIdx = content.lastIndexOf('{', layoutIdx);
    if (braceIdx !== -1) {
      // Get content before the JSON
      const beforeJson = content.slice(0, braceIdx).trim();
      // Remove trailing colon or "Here's..." type intros
      return beforeJson.replace(/:\s*$/, '').trim();
    }
  }
  return content;
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const displayContent = isUser ? message.content : getDisplayContent(message.content);

  // Don't show empty assistant messages (can happen if only JSON was returned)
  if (!isUser && !displayContent) {
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
        <p className="text-sm whitespace-pre-wrap">{displayContent}</p>
      </div>
    </div>
  );
}
