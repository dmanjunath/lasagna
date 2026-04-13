import { useState } from 'react';
import { GlobalChatSidebar } from './global-chat-sidebar';
import { HistoryTab } from './history-tab';
import { useChatStore } from '../../lib/chat-store';
import { api } from '../../lib/api';
import type { Message } from '../../lib/types';

export function ChatTabs() {
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const { setThreads, setActiveThread } = useChatStore();

  const handleSelectHistoricalThread = async (threadId: string) => {
    const { thread, messages } = await api.getThread(threadId);
    const firstUserMsg = messages.find((m: Message) => m.role === 'user');
    setThreads(prev => {
      const existing = prev.findIndex(t => t.apiThreadId === threadId);
      if (existing >= 0) {
        setActiveThread(existing);
        return prev;
      }
      const newThread = {
        thread: {
          id: thread.id,
          question: firstUserMsg?.content || thread.title || 'Thread',
          answerPreview: '',
          timestamp: new Date(thread.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          tags: thread.tags || [],
        },
        messages: messages as Message[],
        apiThreadId: thread.id,
      };
      setActiveThread(prev.length);
      return [...prev, newThread];
    });
    setTab('chat');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="chat-tabs">
      {/* Tab bar */}
      <div className="flex border-b border-border flex-shrink-0">
        <button
          onClick={() => setTab('chat')}
          className={`flex-1 text-center py-2 text-xs font-semibold transition-colors ${
            tab === 'chat' ? 'text-text border-b-2 border-accent' : 'text-text-muted'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setTab('history')}
          className={`flex-1 text-center py-2 text-xs font-semibold transition-colors ${
            tab === 'history' ? 'text-text border-b-2 border-accent' : 'text-text-muted'
          }`}
          data-testid="history-tab-button"
        >
          History
        </button>
      </div>

      {/* Tab content */}
      {tab === 'chat' ? (
        <GlobalChatSidebar />
      ) : (
        <HistoryTab onSelectThread={handleSelectHistoricalThread} />
      )}
    </div>
  );
}
