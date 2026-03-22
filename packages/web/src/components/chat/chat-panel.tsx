import { useState, useCallback } from "react";
import { Send, Loader2 } from "lucide-react";
import { MessageList } from "./message-list.js";
import { Button } from "../ui/button.js";
import type { Message } from "../../lib/types.js";

type ChatPanelProps = {
  threadId: string;
  initialMessages?: Message[];
};

export function ChatPanel({ threadId, initialMessages = [] }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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

      // Handle streaming response
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      let assistantContent = "";
      const assistantMessage: Message = {
        id: `temp-${Date.now()}-assistant`,
        threadId,
        role: "assistant",
        content: "",
        toolCalls: null,
        uiPayload: null,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        assistantContent += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: assistantContent }
              : m
          )
        );
      }
    } catch (error) {
      console.error("Chat error:", error);
      // Remove the user message on error
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsLoading(false);
    }
  }, [threadId, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="flex flex-col h-full bg-bg-elevated rounded-2xl border border-border">
      <div className="p-4 border-b border-border">
        <h3 className="font-medium text-text">Chat</h3>
      </div>

      <MessageList messages={messages} />

      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-border flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your finances..."
          className="flex-1 px-4 py-2 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50"
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
