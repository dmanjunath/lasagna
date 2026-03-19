import { motion, type PanInfo } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { ChatTabs } from './chat-tabs';
import { useChatStore } from '../../lib/chat-store';

const PANEL_WIDTH_PERCENT = 85;
const SWIPE_THRESHOLD = 80;

export function MobileChatPanel() {
  const { closeChat } = useChatStore();

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > SWIPE_THRESHOLD || info.velocity.x > 500) {
      closeChat();
    }
  };

  return (
    <>
      {/* Tap the peeking main content to close */}
      <motion.div
        className="fixed inset-0 z-40 md:hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={closeChat}
        data-testid="chat-backdrop"
      />

      {/* Chat panel */}
      <motion.div
        className="fixed top-0 bottom-0 right-0 z-50 md:hidden bg-bg border-l border-border flex flex-col"
        style={{ width: `${PANEL_WIDTH_PERCENT}vw` }}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.3 }}
        onDragEnd={handleDragEnd}
        data-testid="chat-panel"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0"
             style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
          <button
            onClick={closeChat}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label="Close chat"
          >
            <ArrowLeft className="w-4 h-4 text-text-secondary" />
          </button>
          <span className="text-sm font-semibold text-text">Chat</span>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <ChatTabs />
        </div>
      </motion.div>
    </>
  );
}
