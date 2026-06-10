import { useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { usePageContext } from '../../lib/page-context';
import { useChatStore, getPreferredModelLevel } from '../../lib/chat-store';
import type { ChatMessage } from '../../lib/chat-store';
import { getCategoryFromRoute } from '../../lib/route-categories';
import { useConfirm } from '../ds/Confirm';
import { api } from '../../lib/api';

// Shown in place of an assistant reply when the request fails.
const ERROR_TEXT = "Couldn't reach Lasagna. Check your connection and retry.";

// Module-level guards so the one-shot effects (initial thread load, pending
// message) run exactly once even if both the sidebar and the full page mount
// the hook simultaneously — refs are per-instance and would otherwise double-run.
let threadsLoadedOnce = false;
let pendingHandledNonce = 0;

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    // GFM table separator rows (|---|:--:|) → drop entirely
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ')
    // remaining table pipes → spaces so previews don't read as "pipe soup"
    .replace(/\|/g, ' ')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s*/gm, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function makeAssistantMessage(threadId: string, response: string, error?: boolean): ChatMessage {
  return {
    id: `assistant-${Date.now()}`,
    threadId: threadId || '',
    role: 'assistant',
    content: error ? ERROR_TEXT : response,
    toolCalls: null,
    uiPayload: null,
    createdAt: new Date().toISOString(),
    isError: error || undefined,
  };
}

export function useGlobalChat() {
  const { currentPage } = usePageContext();
  const {
    threads, activeThreadIndex, setActiveThread, setThreads,
    loadingThreads, setThreadLoading,
    chatOpen, pendingMessage, clearPendingMessage,
    sendMessage, incrementUnread,
  } = useChatStore();
  const [location] = useLocation();
  const confirm = useConfirm();
  // On the full-page /chat route the active thread is always on screen, but
  // `chatOpen` is only set for the sidebar — so a reply is "being viewed" when
  // the sidebar is open OR we're on the full page. Without this, replies the
  // user is actively reading get flagged unread and bump the global badge.
  const onChatPage = location === '/chat';

  // Track active thread ID in a ref so async callbacks always see the latest value
  const activeThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadIndex !== null ? (threads[activeThreadIndex]?.thread.id ?? null) : null;
  }, [activeThreadIndex, threads]);

  // Suggestions tailored to the current page
  const pageSuggestions: Record<string, string[]> = {
    dashboard: [
      'How is my financial health overall?',
      'What should I prioritize right now?',
      'Summarize my net worth and spending trends',
    ],
    accounts: [
      'How are my accounts allocated?',
      'Am I too concentrated in any asset class?',
      'Which accounts have changed the most recently?',
    ],
    'portfolio-composition': [
      'Is my portfolio well diversified?',
      'How does my allocation compare to my risk tolerance?',
      'What rebalancing moves should I consider?',
    ],
    spending: [
      'Where am I spending the most?',
      'How does this month compare to last month?',
      'Where can I cut back?',
    ],
    debt: [
      'What is the fastest way to pay off my debt?',
      'Should I use avalanche or snowball strategy?',
      'How much interest am I paying each month?',
    ],
    retirement: [
      'Am I on track to retire on time?',
      'How much more should I be saving?',
      'What happens if I retire 5 years earlier?',
    ],
    'probability-of-success': [
      'What is my probability of not running out of money?',
      'How would a market downturn affect my plan?',
      'What withdrawal rate is safe for me?',
    ],
    tax: [
      'What tax optimization opportunities do I have?',
      'Analyze my uploaded tax documents',
      'Am I withholding the right amount?',
    ],
  };
  const suggestions = pageSuggestions[currentPage?.pageId ?? '']
    ?? ['What is my net worth?', 'How are my investments doing?', 'Help me save more'];

  // Build context from current page — just the page name and description
  // so the LLM knows what the user is looking at. It can use tools to fetch data.
  const buildContext = useCallback(() => {
    if (!currentPage) return { contextString: '', contextMeta: null };
    const str = `[User is viewing the ${currentPage.pageTitle} page. ${currentPage.description || ''}]\n\n`;
    return {
      contextString: str,
      contextMeta: null,
    };
  }, [currentPage]);

  const handleNewMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const ctx = buildContext();
    const tags = [getCategoryFromRoute(location)];

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      threadId: '',
      role: 'user',
      content: text.trim(),
      toolCalls: null,
      uiPayload: ctx.contextMeta ? { context: ctx.contextMeta } as unknown as ChatMessage['uiPayload'] : null,
      createdAt: new Date().toISOString(),
    };

    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const localId = `thread-${Date.now()}`;
    const preferredLevel = getPreferredModelLevel();
    const newThread = {
      thread: {
        id: localId,
        question: text.trim(),
        answerPreview: '',
        timestamp,
        tags,
      },
      messages: [userMsg],
      apiThreadId: null as string | null,
      modelLevel: preferredLevel,
      originalModelLevel: preferredLevel,
    };

    setThreads(prev => [newThread, ...prev]);
    setActiveThread(0);
    setThreadLoading(localId, true);

    const { response, threadId, threadTitle, error } = await sendMessage(text.trim(), null, ctx.contextString, ctx.contextMeta, tags, preferredLevel);

    const assistantMsg = makeAssistantMessage(threadId, response, error);

    const isViewing = (chatOpen || onChatPage) && activeThreadIdRef.current === localId;
    setThreads(prev => prev.map(t =>
      t.thread.id === localId
        ? {
            ...t,
            thread: {
              ...t.thread,
              question: threadTitle || t.thread.question,
              answerPreview: error ? t.thread.answerPreview : stripMarkdown(response).slice(0, 200),
            },
            messages: [...t.messages, assistantMsg],
            apiThreadId: threadId || t.apiThreadId,
            unread: !isViewing,
          }
        : t
    ));

    if (!isViewing) incrementUnread();
    setThreadLoading(localId, false);
  }, [sendMessage, buildContext, location, chatOpen, setThreads, setActiveThread, setThreadLoading, incrementUnread]);

  const handleFollowUp = useCallback(async (text: string) => {
    if (!text.trim() || activeThreadIndex === null) return;

    const currentThread = threads[activeThreadIndex];
    const threadLocalId = currentThread?.thread.id;
    if (!threadLocalId || loadingThreads.has(threadLocalId)) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      threadId: '',
      role: 'user',
      content: text.trim(),
      toolCalls: null,
      uiPayload: null,
      createdAt: new Date().toISOString(),
    };

    setThreads(prev => prev.map(t =>
      t.thread.id === threadLocalId
        ? { ...t, messages: [...t.messages, userMsg] }
        : t
    ));
    setThreadLoading(threadLocalId, true);

    const { response, threadId, error } = await sendMessage(text.trim(), currentThread?.apiThreadId || null, '', null, undefined, currentThread?.modelLevel);

    const assistantMsg = makeAssistantMessage(threadId, response, error);

    const isViewing = (chatOpen || onChatPage) && activeThreadIdRef.current === threadLocalId;
    setThreads(prev => {
      const idx = prev.findIndex(t => t.thread.id === threadLocalId);
      if (idx === -1) return prev;
      const target = prev[idx];
      const updatedTarget = {
        ...target,
        messages: [...target.messages, assistantMsg],
        apiThreadId: threadId || target.apiThreadId,
        unread: !isViewing,
      };
      // Move thread to front
      const rest = prev.filter((_, i) => i !== idx);
      return [updatedTarget, ...rest];
    });
    setActiveThread(0);

    if (!isViewing) incrementUnread();
    setThreadLoading(threadLocalId, false);
  }, [activeThreadIndex, threads, loadingThreads, sendMessage, chatOpen, setThreads, setActiveThread, setThreadLoading, incrementUnread]);

  // Retry the last user turn for a thread after a failed assistant response:
  // drop the trailing error message and re-send without adding a new user bubble.
  const handleRetry = useCallback(async (threadLocalId: string) => {
    if (loadingThreads.has(threadLocalId)) return;
    const target = threads.find(t => t.thread.id === threadLocalId);
    if (!target) return;
    const lastUser = [...target.messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;

    // Remove a trailing error assistant message before retrying.
    setThreads(prev => prev.map(t => {
      if (t.thread.id !== threadLocalId) return t;
      const msgs = t.messages.length && t.messages[t.messages.length - 1].isError
        ? t.messages.slice(0, -1)
        : t.messages;
      return { ...t, messages: msgs };
    }));
    setThreadLoading(threadLocalId, true);

    const { response, threadId, error } = await sendMessage(lastUser.content, target.apiThreadId || null, '', null, undefined, target.modelLevel);

    const assistantMsg = makeAssistantMessage(threadId, response, error);
    const isViewing = (chatOpen || onChatPage) && activeThreadIdRef.current === threadLocalId;
    setThreads(prev => prev.map(t =>
      t.thread.id === threadLocalId
        ? {
            ...t,
            messages: [...t.messages, assistantMsg],
            apiThreadId: threadId || t.apiThreadId,
            unread: !isViewing,
          }
        : t
    ));
    if (!isViewing) incrementUnread();
    setThreadLoading(threadLocalId, false);
  }, [threads, loadingThreads, sendMessage, chatOpen, setThreads, setThreadLoading, incrementUnread]);

  // Handle pending message from "Walk me through this", peek bar, etc.
  useEffect(() => {
    if (!pendingMessage || pendingMessage.nonce === pendingHandledNonce) return;
    pendingHandledNonce = pendingMessage.nonce;
    const msg = pendingMessage.text;
    clearPendingMessage();

    const doSend = async () => {
      const ctx = buildContext();
      const tags = [getCategoryFromRoute(location)];

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        threadId: '',
        role: 'user' as const,
        content: msg,
        toolCalls: null,
        uiPayload: ctx.contextMeta ? { context: ctx.contextMeta } as unknown as ChatMessage['uiPayload'] : null,
        createdAt: new Date().toISOString(),
      };
      const now = new Date();
      const timestamp = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const localId = `thread-${Date.now()}`;
      const preferredLevel = getPreferredModelLevel();
      const newThread = {
        thread: { id: localId, question: msg, answerPreview: '', timestamp, tags },
        messages: [userMsg],
        apiThreadId: null as string | null,
        modelLevel: preferredLevel,
        originalModelLevel: preferredLevel,
      };
      setThreads(prev => [newThread, ...prev]);
      setActiveThread(0);
      setThreadLoading(localId, true);

      const { response, threadId, threadTitle, error } = await sendMessage(msg, null, ctx.contextString, ctx.contextMeta, tags, preferredLevel);

      const assistantMsg = makeAssistantMessage(threadId, response, error);
      const isViewing = (chatOpen || onChatPage) && activeThreadIdRef.current === localId;
      setThreads(prev => prev.map(t =>
        t.thread.id === localId
          ? {
              ...t,
              thread: {
                ...t.thread,
                question: threadTitle || t.thread.question,
                answerPreview: error ? t.thread.answerPreview : stripMarkdown(response).slice(0, 200),
              },
              messages: [...t.messages, assistantMsg],
              apiThreadId: threadId || t.apiThreadId,
              unread: !isViewing,
            }
          : t
      ));

      if (!isViewing) incrementUnread();
      setThreadLoading(localId, false);
    };

    setTimeout(doSend, 200);
  }, [pendingMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing threads from API on mount
  useEffect(() => {
    if (threadsLoadedOnce) return;
    threadsLoadedOnce = true;
    api.getThreads()
      .then(({ threads: apiThreads }) => {
        const mapped = apiThreads.map((t) => ({
          thread: {
            id: t.id,
            question: t.title || t.firstMessage || 'Conversation',
            answerPreview: t.firstAssistantSnippet ? stripMarkdown(t.firstAssistantSnippet).slice(0, 200) : '',
            timestamp: new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            tags: (t.tags as string[]) || [],
          },
          messages: [] as ChatMessage[],
          apiThreadId: t.id,
        }));
        // Only set if we have no threads yet (don't overwrite in-session threads)
        setThreads((prev) => prev.length === 0 ? mapped : prev);
      })
      .catch(() => {});
  }, [setThreads]);

  // Load messages for a thread when selected (lazy)
  const handleSelectThread = useCallback(async (index: number) => {
    // Clear unread flag on selected thread
    setThreads(prev => {
      if (prev[index]?.unread) {
        const updated = [...prev];
        updated[index] = { ...updated[index], unread: false };
        return updated;
      }
      return prev;
    });

    const t = threads[index];
    if (t && t.messages.length === 0 && t.apiThreadId) {
      try {
        const { messages: apiMessages } = await api.getThread(t.apiThreadId);
        const firstUser = apiMessages.find((m) => m.role === 'user');
        const firstAssistant = apiMessages.find((m) => m.role === 'assistant');
        setThreads((prev) => {
          const updated = [...prev];
          if (updated[index]) {
            updated[index] = {
              ...updated[index],
              messages: apiMessages,
              thread: {
                ...updated[index].thread,
                question: firstUser?.content || updated[index].thread.question,
                answerPreview: firstAssistant ? stripMarkdown(firstAssistant.content).slice(0, 200) : updated[index].thread.answerPreview,
              },
            };
          }
          return updated;
        });
      } catch { /* ignore */ }
    }
    setActiveThread(index);
  }, [threads, setThreads, setActiveThread]);

  const handleDeleteThread = useCallback(async (indexOverride?: number) => {
    const idx = indexOverride ?? activeThreadIndex;
    if (idx === null || idx === undefined) return;
    const t = threads[idx];
    const ok = await confirm({
      title: 'Delete this conversation?',
      body: 'This conversation and all its messages will be permanently removed. This can’t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    if (t?.apiThreadId) {
      try { await api.deleteThread(t.apiThreadId); } catch { /* ignore */ }
    }
    setThreads(prev => prev.filter((_, i) => i !== idx));
    if (activeThreadIndex === null) { /* no-op */ }
    else if (activeThreadIndex === idx) setActiveThread(null);
    else if (activeThreadIndex > idx) setActiveThread(activeThreadIndex - 1);
  }, [activeThreadIndex, threads, setThreads, setActiveThread, confirm]);

  const activeThread = activeThreadIndex !== null ? threads[activeThreadIndex] : null;

  return {
    threads,
    threadSummaries: threads.map(t => ({ ...t.thread, unread: t.unread })),
    activeThread,
    activeThreadIndex,
    setActiveThread,
    suggestions,
    loadingThreads,
    handleNewMessage,
    handleFollowUp,
    handleRetry,
    handleSelectThread,
    handleDeleteThread,
  };
}
