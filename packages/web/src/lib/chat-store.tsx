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
  unread?: boolean;
}

interface ChatStoreState {
  chatOpen: boolean;
  openChat: (initialMessage?: string) => void;
  closeChat: () => void;
  threads: ThreadData[];
  activeThreadIndex: number | null;
  setActiveThread: (index: number | null) => void;
  setThreads: React.Dispatch<React.SetStateAction<ThreadData[]>>;
  loadingThreads: Set<string>;
  setThreadLoading: (threadId: string, loading: boolean) => void;
  unreadCount: number;
  clearUnread: () => void;
  incrementUnread: () => void;
  pendingMessage: { text: string; nonce: number } | null;
  setPendingMessage: (msg: { text: string; nonce: number } | null) => void;
  clearPendingMessage: () => void;
  sendMessage: (text: string, existingThreadId: string | null, contextString: string, contextMeta: unknown, tags?: string[]) => Promise<{ response: string; threadId: string; contextMeta: unknown; threadTitle: string | null }>;
}

const ChatStoreContext = createContext<ChatStoreState | null>(null);

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadData[]>([]);
  const [activeThreadIndex, setActiveThread] = useState<number | null>(null);
  const [loadingThreads, setLoadingThreads] = useState<Set<string>>(new Set());
  const setThreadLoading = useCallback((threadId: string, isLoading: boolean) => {
    setLoadingThreads(prev => {
      const next = new Set(prev);
      if (isLoading) next.add(threadId);
      else next.delete(threadId);
      return next;
    });
  }, []);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingMessage, setPendingMessage] = useState<{ text: string; nonce: number } | null>(null);

  const openChat = useCallback((initialMessage?: string) => {
    if (initialMessage) {
      setPendingMessage({ text: initialMessage, nonce: Date.now() });
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

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          threadId,
          message: content,
          context: contextString || undefined,
          uiPayload: contextMeta ? { context: contextMeta } : undefined,
        }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();

      const response = (data.response?.chat || data.response?.content || '').trim()
        || 'I apologize, but I could not process your request.';

      return { response, threadId, contextMeta, threadTitle: data.threadTitle ?? null };
    } catch {
      return { response: 'Sorry, I encountered an error. Please try again.', threadId: existingThreadId || '', contextMeta: null, threadTitle: null };
    }
  }, []);

  return (
    <ChatStoreContext.Provider
      value={{
        chatOpen, openChat, closeChat,
        threads, activeThreadIndex, setActiveThread, setThreads,
        loadingThreads, setThreadLoading,
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
