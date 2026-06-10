import { ChatThreadList } from './chat-thread-list';
import { ChatThreadView } from './chat-thread-view';
import { useGlobalChat } from './use-global-chat';

export function GlobalChatSidebar() {
  const {
    threadSummaries, activeThread, setActiveThread, suggestions, loadingThreads,
    handleNewMessage, handleFollowUp, handleRetry, handleSelectThread, handleDeleteThread,
  } = useGlobalChat();

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-bg">
      {activeThread ? (
        <ChatThreadView
          thread={activeThread.thread}
          messages={activeThread.messages}
          onBack={() => setActiveThread(null)}
          onFollowUp={handleFollowUp}
          onRetry={() => handleRetry(activeThread.thread.id)}
          onDelete={() => handleDeleteThread()}
          onNewChat={() => setActiveThread(null)}
          loading={loadingThreads.has(activeThread.thread.id)}
        />
      ) : (
        <ChatThreadList
          threads={threadSummaries}
          onSelectThread={handleSelectThread}
          onDeleteThread={handleDeleteThread}
          onNewMessage={handleNewMessage}
          suggestions={suggestions}
        />
      )}
    </div>
  );
}
