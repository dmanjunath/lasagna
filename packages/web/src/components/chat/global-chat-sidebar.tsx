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

  // Handle pending message from peek bar / floating input / "Walk me through this"
  useEffect(() => {
    if (pendingMessage && chatOpen) {
      // Clear first to prevent double-send on re-mount
      const msg = pendingMessage;
      clearPendingMessage();
      // Small delay to ensure component is fully mounted
      const timer = setTimeout(() => handleNewMessage(msg), 100);
      return () => clearTimeout(timer);
    }
  }, [pendingMessage, chatOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendToApi = useCallback(async (content: string, existingThreadId: string | null): Promise<{ response: string; threadId: string }> => {
    try {
      let threadId = existingThreadId;
      if (!threadId) {
        const { thread } = await api.createThread();
        threadId = thread.id;
      }

      // Build rich context from current page data — include financial details but never personal info
      let context = '';
      if (currentPage) {
        const d = currentPage.data || {};
        context = `[Context: User is viewing "${currentPage.pageTitle}". ${currentPage.description || ''}`;
        // Format financial data readably instead of raw JSON
        const entries = Object.entries(d).filter(([k]) => !['name', 'email', 'dateOfBirth', 'dob'].includes(k));
        if (entries.length > 0) {
          context += '\n\nFinancial data on this page:';
          for (const [key, val] of entries) {
            if (val === null || val === undefined) continue;
            if (Array.isArray(val)) {
              // Format arrays (e.g., debts list) as readable items
              context += `\n- ${key}: ${JSON.stringify(val)}`;
            } else {
              context += `\n- ${key}: ${typeof val === 'number' && Math.abs(val as number) > 100 ? `$${(val as number).toLocaleString()}` : val}`;
            }
          }
        }
        context += ']\n\n';
      }
      const contextMessage = context + content;

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
    <div className="flex flex-col flex-1 min-h-0 bg-bg">
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
