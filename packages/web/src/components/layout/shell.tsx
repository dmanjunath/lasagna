import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MessageSquare, X } from 'lucide-react';
import { Sidebar } from './sidebar';
import { MobileNav, MobileMenuButton } from './mobile-nav';
import { MobileTabBar } from './mobile-tab-bar';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { useChatStore } from '../../lib/chat-store';
import { ChatTabs } from '../chat/chat-tabs';
import { GlobalChatSidebar } from '../chat/global-chat-sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopChatOpen, setDesktopChatOpen] = useState(false);
  const isMobile = useIsMobile();
  const { chatOpen, closeChat, unreadCount } = useChatStore();

  // Sync context chatOpen → desktop sidebar
  useEffect(() => {
    if (chatOpen && !isMobile) {
      setDesktopChatOpen(true);
    }
  }, [chatOpen, isMobile]);

  return (
    <div className="h-dvh w-screen overflow-hidden bg-bg flex flex-col">
      {/* Mobile: hamburger (hidden when chat is open) */}
      {isMobile && !chatOpen && (
        <>
          <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />
          <MobileNav
            isOpen={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
          />
        </>
      )}

      {/* Main layout */}
      {isMobile ? (
        /* Mobile: main content + chat overlay */
        <div className="flex-1 flex overflow-hidden relative">
          {/* Main content — always rendered */}
          <main className="w-full flex flex-col overflow-hidden pt-[56px] pb-[56px]
                          safe-top-safe-bottom">
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </main>

          {/* Chat overlay — fades in/out like any other view */}
          <AnimatePresence>
            {chatOpen && (
              <motion.div
                key="chat-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 flex flex-col bg-bg overflow-hidden z-20"
                data-testid="chat-panel"
              >
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0
                               safe-top-safe-top">
                  <button
                    onClick={() => closeChat()}
                    className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors
                             active:scale-95 min-w-[44px] min-h-[44px]"
                    aria-label="Close chat"
                  >
                    <ArrowLeft className="w-4 h-4 text-text-secondary" />
                  </button>
                  <span className="text-sm font-semibold text-text">Chat</span>
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col overflow-hidden min-h-0
                                safe-bottom-safe-bottom">
                  <ChatTabs />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        /* Desktop: standard flex layout */
        <div className="flex-1 flex overflow-hidden">
          {/* Desktop sidebar */}
          <aside className="w-[220px] flex-shrink-0 border-r border-border overflow-y-auto">
            <Sidebar />
          </aside>

          {/* Main content area */}
          <main className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </main>

          {/* Desktop chat sidebar — closable */}
          {desktopChatOpen && (
            <aside className="w-[340px] flex-shrink-0 border-l border-border flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Chat</span>
                <button
                  onClick={() => { setDesktopChatOpen(false); closeChat(); }}
                  className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-text-secondary hover:text-text"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <GlobalChatSidebar />
              </div>
            </aside>
          )}
          {/* Collapsed chat toggle */}
          {!desktopChatOpen && (
            <div className="flex-shrink-0 border-l border-border flex flex-col items-center pt-3 px-1.5">
              <button
                onClick={() => setDesktopChatOpen(true)}
                className="relative p-2.5 rounded-lg bg-surface hover:bg-surface-hover border border-border transition-colors text-text-secondary hover:text-accent"
                title="Open chat"
              >
                <MessageSquare className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-accent border-2 border-bg" />
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mobile tab bar — hidden when chat is open */}
      {isMobile && !chatOpen && <MobileTabBar />}

    </div>
  );
}
