import { useState, useEffect, useCallback } from 'react';
import { usePageContext } from '../../lib/page-context';
import { api, API_BASE } from '../../lib/api';
import { ChatThreadList } from './chat-thread-list';
import { ChatThreadView } from './chat-thread-view';
import type { Thread } from './chat-thread-list';
import type { Message } from '../../lib/types';

interface ThreadData {
  thread: Thread;
  messages: Message[];
  apiThreadId: string | null;
}

export function GlobalChatSidebar() {
  const { currentPage, pendingMessage, clearPendingMessage, chatOpen } = usePageContext();
  const [threads, setThreads] = useState<ThreadData[]>([]);
  const [activeThreadIndex, setActiveThreadIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Suggestions based on page context
  const suggestions = currentPage
    ? [
        `Summarize my ${currentPage.pageTitle.toLowerCase()}`,
        `What should I focus on?`,
        `Any concerns?`,
      ]
    : ['What is my net worth?', 'How are my investments doing?', 'Help me save more'];

  // Handle pending message from peek bar / floating input
  useEffect(() => {
    if (pendingMessage && chatOpen) {
      handleNewMessage(pendingMessage);
      clearPendingMessage();
    }
  }, [pendingMessage, chatOpen]);

  const sendToApi = useCallback(async (content: string, existingThreadId: string | null): Promise<{ response: string; threadId: string }> => {
    try {
      let threadId = existingThreadId;
      if (!threadId) {
        const { thread } = await api.createThread();
        threadId = thread.id;
      }

      const contextMessage = currentPage
        ? `[Context: User is on the "${currentPage.pageTitle}" page. ${currentPage.description || ''} Page data: ${JSON.stringify(currentPage.data || {})}]\n\nUser question: ${content}`
        : content;

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ threadId, message: contextMessage }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();
      const response = data.response?.chat || data.response?.content || 'I apologize, but I could not process your request.';
      return { response, threadId };
    } catch {
      return { response: 'Sorry, I encountered an error. Please try again.', threadId: existingThreadId || '' };
    }
  }, [currentPage]);

  const handleNewMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      threadId: '',
      role: 'user',
      content: text.trim(),
      toolCalls: null,
      uiPayload: null,
      createdAt: new Date().toISOString(),
    };

    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const newThread: ThreadData = {
      thread: {
        id: `thread-${Date.now()}`,
        question: text.trim(),
        answerPreview: '',
        timestamp,
      },
      messages: [userMsg],
      apiThreadId: null,
    };

    const newIndex = threads.length;
    setThreads(prev => [...prev, newThread]);
    setActiveThreadIndex(newIndex);
    setLoading(true);

    const { response, threadId } = await sendToApi(text.trim(), null);

    const assistantMsg: Message = {
      id: `assistant-${Date.now()}`,
      threadId: threadId || '',
      role: 'assistant',
      content: response,
      toolCalls: null,
      uiPayload: null,
      createdAt: new Date().toISOString(),
    };

    setThreads(prev => {
      const updated = [...prev];
      const target = updated[newIndex];
      if (target) {
        updated[newIndex] = {
          ...target,
          thread: {
            ...target.thread,
            answerPreview: response.slice(0, 120),
          },
          messages: [...target.messages, assistantMsg],
          apiThreadId: threadId,
        };
      }
      return updated;
    });
    setLoading(false);
  }, [threads, loading, sendToApi]);

  const handleFollowUp = useCallback(async (text: string) => {
    if (!text.trim() || loading || activeThreadIndex === null) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      threadId: '',
      role: 'user',
      content: text.trim(),
      toolCalls: null,
      uiPayload: null,
      createdAt: new Date().toISOString(),
    };

    setThreads(prev => {
      const updated = [...prev];
      const target = updated[activeThreadIndex];
      if (target) {
        updated[activeThreadIndex] = {
          ...target,
          messages: [...target.messages, userMsg],
        };
      }
      return updated;
    });
    setLoading(true);

    const currentThread = threads[activeThreadIndex];
    const { response, threadId } = await sendToApi(text.trim(), currentThread?.apiThreadId || null);

    const assistantMsg: Message = {
      id: `assistant-${Date.now()}`,
      threadId: threadId || '',
      role: 'assistant',
      content: response,
      toolCalls: null,
      uiPayload: null,
      createdAt: new Date().toISOString(),
    };

    setThreads(prev => {
      const updated = [...prev];
      const target = updated[activeThreadIndex];
      if (target) {
        updated[activeThreadIndex] = {
          ...target,
          messages: [...target.messages, assistantMsg],
          apiThreadId: threadId,
        };
      }
      return updated;
    });
    setLoading(false);
  }, [activeThreadIndex, threads, loading, sendToApi]);

  const activeThread = activeThreadIndex !== null ? threads[activeThreadIndex] : null;

  return (
    <div className="flex flex-col h-full bg-bg border-l border-border">
      {activeThread ? (
        <ChatThreadView
          thread={activeThread.thread}
          messages={activeThread.messages}
          onBack={() => setActiveThreadIndex(null)}
          onFollowUp={handleFollowUp}
          loading={loading}
        />
      ) : (
        <ChatThreadList
          threads={threads.map(t => t.thread)}
          onSelectThread={(index) => setActiveThreadIndex(index)}
          onNewMessage={handleNewMessage}
          suggestions={suggestions}
        />
      )}
    </div>
  );
}
