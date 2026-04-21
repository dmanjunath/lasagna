import { MessageSquare } from 'lucide-react';
import { useChatStore } from '../../lib/chat-store';

export function FloatingChatPill() {
  const { openChat, unreadCount } = useChatStore();

  return (
    <button
      onClick={() => openChat()}
      className="fixed right-0 top-1/2 -translate-y-1/2 z-30 md:hidden bg-gradient-to-b from-accent to-accent-dim p-2 pl-2.5 rounded-l-full shadow-lg shadow-accent/30 transition-transform active:scale-95"
      aria-label="Open chat"
      data-testid="chat-pill"
    >
      <MessageSquare className="w-3.5 h-3.5 text-white" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-1 -left-1 w-3 h-3 bg-red-500 rounded-full border-2 border-bg"
          data-testid="unread-badge"
        />
      )}
    </button>
  );
}
