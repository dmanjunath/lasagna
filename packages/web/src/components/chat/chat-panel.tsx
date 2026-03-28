import { useState, useCallback, useEffect, useRef } from "react";
import { Send, Loader2 } from "lucide-react";
import { MessageList } from "./message-list.js";
import { ToolStatus } from "./tool-status.js";
import { Button } from "../ui/button.js";
import type { Message } from "../../lib/types.js";
import type { ResponseV2, ToolResult } from "../../lib/types-v2.js";

type ChatPanelProps = {
  threadId: string;
  initialMessages?: Message[];
  initialMessage?: string | null;
  onMessageSent?: () => void;
  onChatResponse?: (response: ResponseV2 | null, toolResults: ToolResult[]) => void;
  planId?: string;
};

export function ChatPanel({
  threadId,
  initialMessages = [],
  initialMessage = null,
  onMessageSent,
  onChatResponse,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);

  // Track if we've synced with initialMessages
  const lastSyncedLength = useRef(initialMessages.length);

  // Sync messages when initialMessages changes (e.g., page reload, new data from parent)
  useEffect(() => {
    // Only sync if initialMessages actually has new data
    if (initialMessages.length !== lastSyncedLength.current) {
      lastSyncedLength.current = initialMessages.length;

      // Keep only optimistic messages (temp-*) that aren't in DB yet
      setMessages(prev => {
        const dbMessageIds = new Set(initialMessages.map(m => m.id));
        const optimisticOnly = prev.filter(
          m => m.id.startsWith('temp-') && !dbMessageIds.has(m.id)
        );
        return [...initialMessages, ...optimisticOnly];
      });
    }
  }, [initialMessages]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    // Add user message optimistically
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      threadId,
      role: "user",
      content,
      toolCalls: null,
      uiPayload: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setCurrentTool(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ threadId, message: content }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      // V2 returns JSON with response and toolResults
      const data = await res.json();
      const { response, toolResults } = data as {
        response: ResponseV2 | null;
        toolResults: ToolResult[];
      };

      // Add assistant message with the chat response (not full content)
      const assistantContent = response?.chat || "No response generated";
      const assistantMessage: Message = {
        id: `temp-${Date.now()}-assistant`,
        threadId,
        role: "assistant",
        content: assistantContent,
        toolCalls: null,
        uiPayload: null, // V2 response handled separately via callback
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Note: Plan auto-naming is now handled by the backend using AI
      // The backend will generate a descriptive title if the plan is still "Untitled"

      // Notify parent with response and tool results
      onChatResponse?.(response, toolResults || []);
    } catch (error) {
      console.error("Chat error:", error);
      // Remove the user message on error
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsLoading(false);
      setCurrentTool(null);
    }
  }, [threadId, isLoading, onChatResponse]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  // Track if we've already sent the initial message
  const initialMessageSent = useRef(false);

  // Auto-send initial message from starter prompts
  useEffect(() => {
    if (initialMessage && !isLoading && !initialMessageSent.current) {
      initialMessageSent.current = true;
      sendMessage(initialMessage);
      onMessageSent?.();
    }
  }, [initialMessage, isLoading, sendMessage, onMessageSent]);

  return (
    <div className="flex flex-col h-full bg-bg-elevated rounded-2xl border border-border">
      <div className="p-4 border-b border-border">
        <h3 className="font-medium text-text">Chat</h3>
      </div>

      <MessageList messages={messages} />

      {isLoading && <ToolStatus toolName={currentTool || "thinking"} />}

      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-border flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your finances..."
          className="flex-1 px-4 py-2 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
          disabled={isLoading}
        />
        <Button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
