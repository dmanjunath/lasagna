import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { api, API_BASE } from './api';
import type { Message } from './types';

export interface ThreadData {
  thread: {
    id: string;
    question: string;
    answerPreview: string;
    timestamp: string;
    tags: string[];
  };
  messages: Message[];
  apiThreadId: string | null;
}

interface ChatStoreState {
  chatOpen: boolean;
  openChat: (initialMessage?: string) => void;
  closeChat: () => void;
  threads: ThreadData[];
  activeThreadIndex: number | null;
  setActiveThread: (index: number | null) => void;
  setThreads: React.Dispatch<React.SetStateAction<ThreadData[]>>;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  unreadCount: number;
  clearUnread: () => void;
  incrementUnread: () => void;
  pendingMessage: string | null;
  setPendingMessage: (msg: string | null) => void;
  clearPendingMessage: () => void;
  sendMessage: (text: string, existingThreadId: string | null, contextString: string, contextMeta: unknown, tags?: string[]) => Promise<{ response: string; threadId: string; contextMeta: unknown }>;
}

const ChatStoreContext = createContext<ChatStoreState | null>(null);

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadData[]>([]);
  const [activeThreadIndex, setActiveThread] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const openChat = useCallback((initialMessage?: string) => {
    if (initialMessage) {
      setPendingMessage(initialMessage);
    }
    setChatOpen(true);
    setUnreadCount(0);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
  }, []);

  const clearUnread = useCallback(() => setUnreadCount(0), []);
  const incrementUnread = useCallback(() => setUnreadCount(prev => prev + 1), []);
  const clearPendingMessage = useCallback(() => setPendingMessage(null), []);

  const sendMessage = useCallback(async (
    content: string,
    existingThreadId: string | null,
    contextString: string,
    contextMeta: unknown,
    tags?: string[],
  ) => {
    try {
      let threadId = existingThreadId;
      if (!threadId) {
        const { thread } = await api.createThread(undefined, undefined, tags);
        threadId = thread.id;
      }

      const contextMessage = contextString + content;

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ threadId, message: contextMessage }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();

      let response = '';
      const blocks = data.uiPayload?.blocks || [];
      if (blocks.length > 0) {
        for (const block of blocks) {
          if (block.type === 'text' && block.content) {
            response += block.content + '\n\n';
          } else if (block.type === 'stat') {
            response += `**${block.label}:** ${block.value}${block.description ? ` — ${block.description}` : ''}\n\n`;
          } else if (block.type === 'section_card') {
            const prefix = block.variant === 'highlight' ? '> **' : '> ';
            const suffix = block.variant === 'highlight' ? '**' : '';
            if (block.label) response += `**${block.label}**\n\n`;
            response += `${prefix}${block.content}${suffix}\n\n`;
          } else if (block.type === 'action' && block.actions) {
            response += `### ${block.title || 'Next Steps'}\n\n`;
            for (const action of block.actions) {
              response += `- ${action}\n`;
            }
            response += '\n';
          } else if (block.type === 'collapsible_details') {
            response += `### ${block.summary || 'Details'}\n\n${block.content}\n\n`;
          }
        }
      }
      if (!response.trim()) {
        response = data.response?.chat || data.response?.content || 'I apologize, but I could not process your request.';
      }

      return { response: response.trim(), threadId, contextMeta };
    } catch {
      return { response: 'Sorry, I encountered an error. Please try again.', threadId: existingThreadId || '', contextMeta: null };
    }
  }, []);

  return (
    <ChatStoreContext.Provider
      value={{
        chatOpen, openChat, closeChat,
        threads, activeThreadIndex, setActiveThread, setThreads,
        loading, setLoading,
        unreadCount, clearUnread, incrementUnread,
        pendingMessage, setPendingMessage, clearPendingMessage,
        sendMessage,
      }}
    >
      {children}
    </ChatStoreContext.Provider>
  );
}

export function useChatStore() {
  const ctx = useContext(ChatStoreContext);
  if (!ctx) throw new Error('useChatStore must be used within ChatStoreProvider');
  return ctx;
}
