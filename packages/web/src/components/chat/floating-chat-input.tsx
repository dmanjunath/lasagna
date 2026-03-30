import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Send, X } from 'lucide-react';
import { usePageContext } from '../../lib/page-context';

export function FloatingChatInput() {
  const { currentPage, openChat } = usePageContext();
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    // Open the chat sidebar with the message
    openChat(message.trim());
    setMessage('');
    setExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setExpanded(false);
      setMessage('');
    }
  };

  // Don't render if no page context is set
  if (!currentPage) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 md:left-auto md:right-8 md:translate-x-0">
      <AnimatePresence mode="wait">
        {expanded ? (
          <motion.form
            key="input"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            onSubmit={handleSubmit}
            className="flex items-center gap-2 bg-surface-elevated border border-border rounded-2xl shadow-xl px-4 py-3 w-[90vw] max-w-xl"
          >
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${currentPage.pageTitle.toLowerCase()}...`}
              className="flex-1 bg-transparent text-text placeholder:text-text-muted focus:outline-none text-sm"
            />
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setMessage('');
              }}
              className="p-1.5 text-text-muted hover:text-text transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              type="submit"
              disabled={!message.trim()}
              className="p-2 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </motion.form>
        ) : (
          <motion.button
            key="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2 bg-accent text-white rounded-full px-5 py-3 shadow-lg hover:bg-accent/90 transition-colors"
          >
            <MessageCircle className="w-5 h-5" />
            <span className="text-sm font-medium">Ask a question</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
