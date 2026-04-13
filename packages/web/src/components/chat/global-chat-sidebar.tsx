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

    // Directly execute message send (don't go through handleNewMessage which has stale closure)
    const doSend = async () => {
      const userMsg = {
        id: `user-${Date.now()}`, threadId: '', role: 'user' as const,
        content: msg, toolCalls: null, uiPayload: null, createdAt: new Date().toISOString(),
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
      const { response, threadId, contextMeta: cm } = await sendToApi(msg, null);
      // Attach context to user message retroactively
      if (cm) {
        setThreads(prev => {
          const updated = [...prev];
          const t = updated[updated.length - 1];
          if (t && t.messages[0]) t.messages[0] = { ...t.messages[0], uiPayload: { context: cm } as unknown as Message['uiPayload'] };
          return updated;
        });
      }
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

  const sendToApi = useCallback(async (content: string, existingThreadId: string | null): Promise<{ response: string; threadId: string }> => {
    try {
      let threadId = existingThreadId;
      if (!threadId) {
        const { thread } = await api.createThread();
        threadId = thread.id;
      }

      // Build rich context from current page data — include financial details but never personal info
      let context = '';
      const contextItems: Array<{ label: string; value: string }> = [];
      let contextPage = '';
      if (currentPage) {
        contextPage = currentPage.pageTitle;
        const d = currentPage.data || {};
        context = `[Context: User is viewing "${currentPage.pageTitle}". ${currentPage.description || ''}`;
        const entries = Object.entries(d).filter(([k]) => !['name', 'email', 'dateOfBirth', 'dob'].includes(k));
        if (entries.length > 0) {
          context += '\n\nFinancial data on this page:';
          for (const [key, val] of entries) {
            if (val === null || val === undefined) continue;
            const formatted = Array.isArray(val) ? JSON.stringify(val) :
              (typeof val === 'number' && Math.abs(val as number) > 100 ? `$${(val as number).toLocaleString()}` : String(val));
            context += `\n- ${key}: ${formatted}`;
            // Build human-readable context items for display (skip large arrays)
            if (!Array.isArray(val)) {
              const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
              contextItems.push({ label, value: formatted });
            }
          }
        }
        context += ']\n\n';
      }
      const contextMessage = context + content;
      // Store context metadata for display in the message bubble
      const contextMeta = contextItems.length > 0 ? { page: contextPage, items: contextItems } : null;

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

    const { response, threadId, contextMeta: ctxMeta } = await sendToApi(text.trim(), null);

    // Retroactively attach context to user message for display
    if (ctxMeta) {
      setThreads(prev => {
        const updated = [...prev];
        const target = updated[newIndex];
        if (target && target.messages[0]) {
          target.messages[0] = { ...target.messages[0], uiPayload: { context: ctxMeta } as unknown as Message['uiPayload'] };
        }
        return updated;
      });
    }

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
