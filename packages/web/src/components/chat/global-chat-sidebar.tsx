import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2 } from 'lucide-react';
import { usePageContext } from '../../lib/page-context';
import { api, API_BASE } from '../../lib/api';
import { MessageList } from './message-list';
import type { Message } from '../../lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function GlobalChatSidebar() {
  const { chatOpen, closeChat, currentPage, pendingMessage, clearPendingMessage } = usePageContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Reset messages when page changes
  useEffect(() => {
    setMessages([]);
    setThreadId(null);
  }, [currentPage?.pageId]);

  // Handle pending message from floating input
  useEffect(() => {
    if (pendingMessage && chatOpen) {
      sendMessage(pendingMessage);
      clearPendingMessage();
    }
  }, [pendingMessage, chatOpen]);

  // Focus input when opened
  useEffect(() => {
    if (chatOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [chatOpen]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || loading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Create thread if needed
      let currentThreadId = threadId;
      if (!currentThreadId) {
        const { thread } = await api.createThread();
        currentThreadId = thread.id;
        setThreadId(currentThreadId);
      }

      // Build context-aware message
      const contextMessage = currentPage
        ? `[Context: User is on the "${currentPage.pageTitle}" page. ${currentPage.description || ''} Page data: ${JSON.stringify(currentPage.data || {})}]\n\nUser question: ${content.trim()}`
        : content.trim();

      // Send to chat API
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          threadId: currentThreadId,
          message: contextMessage,
        }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();
      const assistantContent = data.response?.chat || data.response?.content || 'I apologize, but I could not process your request.';

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: assistantContent,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <AnimatePresence>
      {chatOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeChat}
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
          />

          {/* Sidebar */}
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-bg border-l border-border z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h2 className="font-display text-lg font-semibold">Ask a question</h2>
                {currentPage && (
                  <p className="text-sm text-text-muted">About: {currentPage.pageTitle}</p>
                )}
              </div>
              <button
                onClick={closeChat}
                className="p-2 hover:bg-surface-hover rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="text-center text-text-muted py-8">
                  <p className="text-sm">Ask me anything about this page.</p>
                  {currentPage && (
                    <p className="text-xs mt-2 opacity-70">
                      I have context about your {currentPage.pageTitle.toLowerCase()} data.
                    </p>
                  )}
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                        msg.role === 'user'
                          ? 'bg-accent text-white'
                          : 'bg-surface-elevated border border-border'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-surface-elevated border border-border rounded-2xl px-4 py-2.5">
                    <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-border">
              <div className="flex items-center gap-2 bg-surface-elevated rounded-xl px-4 py-2 border border-border focus-within:border-accent/50 transition-colors">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your question..."
                  disabled={loading}
                  className="flex-1 bg-transparent text-text placeholder:text-text-muted focus:outline-none text-sm"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="p-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
