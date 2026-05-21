import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MessageSquare, X, Menu } from 'lucide-react';
import { Sidebar } from './sidebar';
import { MobileNav } from './mobile-nav';
import { MobileTabBar } from './mobile-tab-bar';
import { AppHeader } from './app-header';
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
      {/* Shared top bar — same component the Simple shell uses, so the
          Simple/Advanced toggle and overall chrome are consistent across
          modes. Hidden when the mobile chat overlay is up. */}
      {isMobile && !chatOpen && (
        <>
          <AppHeader
            variant="advanced"
            leadingSlot={
              <button
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu"
                className="w-11 h-11 grid place-items-center rounded-full hover:bg-bg-elevated"
              >
                <Menu size={18} className="text-text-secondary" />
              </button>
            }
          />
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
          {/* Main content — always rendered. pt offset = notch + 44px header. */}
          <main className="w-full flex flex-col overflow-hidden pt-[calc(env(safe-area-inset-top)+56px)] pb-[56px]">
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
                <span className="text-[11px] font-medium font-mono text-text-muted uppercase tracking-[0.14em]">Chat</span>
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
