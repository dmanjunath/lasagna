import { useState, useEffect, useCallback, useRef } from 'react';
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

  // Handle pending message from "Walk me through this", peek bar, etc.
  // This component mounts AFTER pendingMessage is set (sidebar was closed).
  const pendingHandled = useRef('');
  useEffect(() => {
    if (!pendingMessage || pendingMessage === pendingHandled.current) return;
    pendingHandled.current = pendingMessage;
    const msg = pendingMessage;
    clearPendingMessage();

    const doSend = async () => {
      const ctx = buildContext();
      const userMsg = {
        id: `user-${Date.now()}`, threadId: '', role: 'user' as const,
        content: msg, toolCalls: null,
        uiPayload: ctx.contextMeta ? { context: ctx.contextMeta } as unknown as Message['uiPayload'] : null,
        createdAt: new Date().toISOString(),
      };
      const now = new Date();
      const timestamp = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const newThread = {
        thread: { id: `thread-${Date.now()}`, question: msg, answerPreview: '', timestamp },
        messages: [userMsg], apiThreadId: null as string | null,
      };
      setThreads(prev => [...prev, newThread]);
      setActiveThreadIndex(threads.length);
      setLoading(true);
      const { response, threadId } = await sendToApi(msg, null, ctx);
      const assistantMsg = {
        id: `assistant-${Date.now()}`, threadId: threadId || '', role: 'assistant' as const,
        content: response, toolCalls: null, uiPayload: null, createdAt: new Date().toISOString(),
      };
      setThreads(prev => {
        const updated = [...prev];
        const idx = updated.length - 1;
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], thread: { ...updated[idx].thread, answerPreview: response.slice(0, 120) }, messages: [...updated[idx].messages, assistantMsg], apiThreadId: threadId };
        }
        return updated;
      });
      setLoading(false);
    };

    setTimeout(doSend, 200);
  }, [pendingMessage]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const sendToApi = useCallback(async (content: string, existingThreadId: string | null, prebuiltContext?: { contextString: string; contextMeta: unknown }): Promise<{ response: string; threadId: string; contextMeta: unknown }> => {
    try {
      let threadId = existingThreadId;
      if (!threadId) {
        const { thread } = await api.createThread();
        threadId = thread.id;
      }

      const { contextString, contextMeta } = prebuiltContext || buildContext();
      const contextMessage = contextString + content;

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ threadId, message: contextMessage }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();

      // Build full response from uiPayload blocks (rich content) rather than truncated chat summary
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
      // Fall back to chat summary if no blocks
      if (!response.trim()) {
        response = data.response?.chat || data.response?.content || 'I apologize, but I could not process your request.';
      }

      return { response: response.trim(), threadId, contextMeta };
    } catch {
      return { response: 'Sorry, I encountered an error. Please try again.', threadId: existingThreadId || '', contextMeta: null };
    }
  }, [buildContext]);

  const handleNewMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    // Build context NOW so it's available for the user message immediately
    const ctx = buildContext();

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

    const { response, threadId } = await sendToApi(text.trim(), null, ctx);

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
  }, [threads, loading, sendToApi, buildContext]);

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
