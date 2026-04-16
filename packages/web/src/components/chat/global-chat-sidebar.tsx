import { useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { usePageContext } from '../../lib/page-context';
import { useChatStore } from '../../lib/chat-store';
import { getCategoryFromRoute } from '../../lib/route-categories';
import { ChatThreadList } from './chat-thread-list';
import { ChatThreadView } from './chat-thread-view';
import { api } from '../../lib/api';
import type { Message } from '../../lib/types';

export function GlobalChatSidebar() {
  const { currentPage } = usePageContext();
  const {
    threads, activeThreadIndex, setActiveThread, setThreads,
    loading, setLoading,
    chatOpen, pendingMessage, clearPendingMessage,
    sendMessage, incrementUnread,
  } = useChatStore();
  const [location] = useLocation();

  // Suggestions based on page context
  const suggestions = currentPage
    ? [
        `Summarize my ${currentPage.pageTitle.toLowerCase()}`,
        `What should I focus on?`,
        `Any concerns?`,
      ]
    : ['What is my net worth?', 'How are my investments doing?', 'Help me save more'];

  // Build context from current page — extracted so we can call it before sending
  const buildContext = useCallback(() => {
    if (!currentPage) return { contextString: '', contextMeta: null };
    const d = currentPage.data || {};
    const items: Array<{ label: string; value: string }> = [];
    let str = `[Context: User is viewing "${currentPage.pageTitle}". ${currentPage.description || ''}`;
    const entries = Object.entries(d).filter(([k]) => !['name', 'email', 'dateOfBirth', 'dob'].includes(k));

    if (entries.length > 0) {
      str += '\n\nFinancial data on this page:';
      for (const [key, val] of entries) {
        if (val === null || val === undefined) continue;
        if (Array.isArray(val)) {
          // Format arrays as human-readable items (e.g., debts list)
          str += `\n- ${key}: ${JSON.stringify(val)}`;
          for (const item of val) {
            if (typeof item === 'object' && item !== null) {
              const name = item.name || item.ticker || item.category || 'Item';
              const parts: string[] = [];
              if (item.balance !== undefined) parts.push(`$${Math.abs(item.balance).toLocaleString()}`);
              if (item.apr !== undefined) parts.push(`${item.apr}% APR`);
              if (item.interestRate !== undefined) parts.push(`${item.interestRate}% rate`);
              if (item.minPayment !== undefined) parts.push(`$${item.minPayment.toLocaleString()}/mo min`);
              if (item.value !== undefined) parts.push(`$${item.value.toLocaleString()}`);
              if (item.percentage !== undefined) parts.push(`${item.percentage.toFixed(1)}%`);
              items.push({ label: String(name), value: parts.join(' · ') });
            }
          }
        } else {
          const formatted = typeof val === 'number' && Math.abs(val as number) > 100
            ? `$${(val as number).toLocaleString()}` : String(val);
          str += `\n- ${key}: ${formatted}`;
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
          items.push({ label, value: formatted });
        }
      }
    }
    str += ']\n\n';
    return {
      contextString: str,
      contextMeta: items.length > 0 ? { page: currentPage.pageTitle, items } : null,
    };
  }, [currentPage]);

  const handleNewMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const ctx = buildContext();
    const tags = [getCategoryFromRoute(location)];

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      threadId: '',
      role: 'user',
      content: text.trim(),
      toolCalls: null,
      uiPayload: ctx.contextMeta ? { context: ctx.contextMeta } as unknown as Message['uiPayload'] : null,
      createdAt: new Date().toISOString(),
    };

    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const newThread = {
      thread: {
        id: `thread-${Date.now()}`,
        question: text.trim(),
        answerPreview: '',
        timestamp,
        tags,
      },
      messages: [userMsg],
      apiThreadId: null as string | null,
    };

    const newIndex = threads.length;
    setThreads(prev => [...prev, newThread]);
    setActiveThread(newIndex);
    setLoading(true);

    const { response, threadId } = await sendMessage(text.trim(), null, ctx.contextString, ctx.contextMeta, tags);

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

    if (!chatOpen) incrementUnread();
    setLoading(false);
  }, [threads, loading, sendMessage, buildContext, location, chatOpen, setThreads, setActiveThread, setLoading, incrementUnread]);

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
    const { response, threadId } = await sendMessage(text.trim(), currentThread?.apiThreadId || null, '', null);

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

    if (!chatOpen) incrementUnread();
    setLoading(false);
  }, [activeThreadIndex, threads, loading, sendMessage, chatOpen, setThreads, setLoading, incrementUnread]);

  // Handle pending message from "Walk me through this", peek bar, etc.
  const pendingHandled = useRef('');
  useEffect(() => {
    if (!pendingMessage || pendingMessage === pendingHandled.current) return;
    pendingHandled.current = pendingMessage;
    const msg = pendingMessage;
    clearPendingMessage();

    const doSend = async () => {
      const ctx = buildContext();
      const tags = [getCategoryFromRoute(location)];

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        threadId: '',
        role: 'user' as const,
        content: msg,
        toolCalls: null,
        uiPayload: ctx.contextMeta ? { context: ctx.contextMeta } as unknown as Message['uiPayload'] : null,
        createdAt: new Date().toISOString(),
      };
      const now = new Date();
      const timestamp = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const newThread = {
        thread: { id: `thread-${Date.now()}`, question: msg, answerPreview: '', timestamp, tags },
        messages: [userMsg],
        apiThreadId: null as string | null,
      };
      setThreads(prev => [...prev, newThread]);
      setActiveThread(threads.length);
      setLoading(true);

      const { response, threadId } = await sendMessage(msg, null, ctx.contextString, ctx.contextMeta, tags);

      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        threadId: threadId || '',
        role: 'assistant' as const,
        content: response,
        toolCalls: null,
        uiPayload: null,
        createdAt: new Date().toISOString(),
      };
      setThreads(prev => {
        const updated = [...prev];
        const idx = updated.length - 1;
        if (updated[idx]) {
          updated[idx] = {
            ...updated[idx],
            thread: { ...updated[idx].thread, answerPreview: response.slice(0, 120) },
            messages: [...updated[idx].messages, assistantMsg],
            apiThreadId: threadId,
          };
        }
        return updated;
      });

      if (!chatOpen) incrementUnread();
      setLoading(false);
    };

    setTimeout(doSend, 200);
  }, [pendingMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing threads from API on mount
  const threadsLoaded = useRef(false);
  useEffect(() => {
    if (threadsLoaded.current) return;
    threadsLoaded.current = true;
    api.getThreads()
      .then(({ threads: apiThreads }) => {
        const mapped = apiThreads.map((t) => ({
          thread: {
            id: t.id,
            question: t.title || 'Conversation',
            answerPreview: '',
            timestamp: new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            tags: (t.tags as string[]) || [],
          },
          messages: [] as Message[],
          apiThreadId: t.id,
        }));
        // Only set if we have no threads yet (don't overwrite in-session threads)
        setThreads((prev) => prev.length === 0 ? mapped : prev);
      })
      .catch(() => {});
  }, [setThreads]);

  // Load messages for a thread when selected (lazy)
  const handleSelectThread = useCallback(async (index: number) => {
    const t = threads[index];
    if (t && t.messages.length === 0 && t.apiThreadId) {
      try {
        const { messages: apiMessages } = await api.getThread(t.apiThreadId);
        setThreads((prev) => {
          const updated = [...prev];
          if (updated[index]) {
            updated[index] = { ...updated[index], messages: apiMessages };
          }
          return updated;
        });
      } catch { /* ignore */ }
    }
    setActiveThread(index);
  }, [threads, setThreads, setActiveThread]);

  const activeThread = activeThreadIndex !== null ? threads[activeThreadIndex] : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-bg">
      {activeThread ? (
        <ChatThreadView
          thread={activeThread.thread}
          messages={activeThread.messages}
          onBack={() => setActiveThread(null)}
          onFollowUp={handleFollowUp}
          loading={loading}
        />
      ) : (
        <ChatThreadList
          threads={threads.map(t => t.thread)}
          onSelectThread={handleSelectThread}
          onNewMessage={handleNewMessage}
          suggestions={suggestions}
        />
      )}
    </div>
  );
}
