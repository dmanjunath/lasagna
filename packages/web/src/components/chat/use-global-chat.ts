import { useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { usePageContext } from '../../lib/page-context';
import { useChatStore, getPreferredModelLevel } from '../../lib/chat-store';
import type { ChatMessage, ThreadData } from '../../lib/chat-store';
import { getCategoryFromRoute } from '../../lib/route-categories';
import { useConfirm } from '../ds/Confirm';
import { api } from '../../lib/api';
import { formatInstant } from '../../lib/utils';

// Shown in place of an assistant reply when the request fails. The catch that
// produces it cannot tell a dropped connection from a server error, so the copy
// states only what is observable: this client did not get the reply. The server
// finishes and stores the turn either way, which is why checking is worthwhile.
const ERROR_TEXT = 'This device did not get a reply. It may already be saved.';

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

// A pending turn is ours to finish only while the user message we added
// optimistically is still last. Once a refetch has pulled the server's copy of
// that turn, appending our own result would show the answer twice.
function turnAlreadyResolved(t: ThreadData): boolean {
  return t.messages[t.messages.length - 1]?.role === 'assistant';
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

  // Pull the server's copy of a thread. A request the client lost (the app was
  // backgrounded, the connection dropped) still runs to completion server-side,
  // so the real answer is usually already stored. Returns true when it was.
  const refreshThread = useCallback(async (t: ThreadData) => {
    if (!t.apiThreadId) return false;
    try {
      const { messages: apiMessages } = await api.getThread(t.apiThreadId);
      // The stored copy is a recovery only if it answers the turn this client is
      // waiting on. A request that never reached the server leaves the thread
      // ending in the PREVIOUS answer, and adopting that would silently delete
      // the question the user just asked. Count user turns to tell them apart.
      const askedHere = t.messages.filter((m) => m.role === 'user').length;
      const askedOnServer = apiMessages.filter((m) => m.role === 'user').length;
      if (askedOnServer < askedHere) return false;
      // Mid-flight there is no assistant turn yet. Leave the local thread alone
      // rather than replacing a pending question with a half-written one.
      if (apiMessages[apiMessages.length - 1]?.role !== 'assistant') return false;

      const firstUser = apiMessages.find((m) => m.role === 'user');
      const firstAssistant = apiMessages.find((m) => m.role === 'assistant');
      setThreads(prev => prev.map(row =>
        row.thread.id === t.thread.id
          ? {
              ...row,
              messages: apiMessages,
              thread: {
                ...row.thread,
                question: firstUser?.content || row.thread.question,
                answerPreview: firstAssistant ? stripMarkdown(firstAssistant.content).slice(0, 200) : row.thread.answerPreview,
              },
            }
          : row
      ));
      setThreadLoading(t.thread.id, false);
      return true;
    } catch {
      return false;
    }
  }, [setThreads, setThreadLoading]);

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
    const timestamp = formatInstant(now, { hour: 'numeric', minute: '2-digit' });

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
      t.thread.id === localId && !turnAlreadyResolved(t)
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
      const updatedTarget = turnAlreadyResolved(target) ? target : {
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

  // Recover the last user turn for a thread after a failed assistant response.
  // Look for the stored answer first, because the server completes the turn even
  // when the client loses it, and re-asking would pay for a second copy. Only a
  // thread with nothing stored falls back to re-sending the question.
  const handleRetry = useCallback(async (threadLocalId: string) => {
    if (loadingThreads.has(threadLocalId)) return;
    const target = threads.find(t => t.thread.id === threadLocalId);
    if (!target) return;
    const lastUser = [...target.messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;

    setThreadLoading(threadLocalId, true);
    if (await refreshThread(target)) return;

    // Remove a trailing error assistant message before re-sending.
    setThreads(prev => prev.map(t => {
      if (t.thread.id !== threadLocalId) return t;
      const msgs = t.messages.length && t.messages[t.messages.length - 1].isError
        ? t.messages.slice(0, -1)
        : t.messages;
      return { ...t, messages: msgs };
    }));

    const { response, threadId, error } = await sendMessage(lastUser.content, target.apiThreadId || null, '', null, undefined, target.modelLevel);

    const assistantMsg = makeAssistantMessage(threadId, response, error);
    const isViewing = (chatOpen || onChatPage) && activeThreadIdRef.current === threadLocalId;
    setThreads(prev => prev.map(t =>
      t.thread.id === threadLocalId && !turnAlreadyResolved(t)
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
  }, [threads, loadingThreads, sendMessage, chatOpen, setThreads, setThreadLoading, incrementUnread, refreshThread]);

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
      const timestamp = formatInstant(now, { hour: 'numeric', minute: '2-digit' });
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
        t.thread.id === localId && !turnAlreadyResolved(t)
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
  }, [pendingMessage]);

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
            timestamp: formatInstant(t.createdAt, { month: 'short', day: 'numeric' }),
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

  // Load messages for a thread when selected (lazy). A thread whose last turn
  // errored refetches too, because the answer the client missed is on the server.
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
    const lastFailed = t?.messages[t.messages.length - 1]?.isError;
    if (t && (t.messages.length === 0 || lastFailed)) {
      await refreshThread(t);
    }
    setActiveThread(index);
  }, [threads, setThreads, setActiveThread, refreshThread]);

  // iOS suspends the WebView when the app goes to the background, so an in-flight
  // chat request dies while the server finishes the turn anyway. On resume, pull
  // the answer the client missed instead of leaving an error or a spinner up.
  useEffect(() => {
    const onResume = () => {
      const t = activeThreadIndex !== null ? threads[activeThreadIndex] : null;
      if (!t) return;
      const stalled = loadingThreads.has(t.thread.id) || t.messages[t.messages.length - 1]?.isError;
      if (stalled) void refreshThread(t);
    };
    window.addEventListener('native:resume', onResume);
    return () => window.removeEventListener('native:resume', onResume);
  }, [threads, activeThreadIndex, loadingThreads, refreshThread]);

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
