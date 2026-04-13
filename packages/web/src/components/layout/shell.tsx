import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowLeft, MessageSquare, X } from 'lucide-react';
import { Sidebar } from './sidebar';
import { MobileNav, MobileMenuButton } from './mobile-nav';
import { MobileTabBar } from './mobile-tab-bar';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { useChatStore } from '../../lib/chat-store';
import { FloatingChatPill } from '../chat/floating-chat-pill';
import { ChatTabs } from '../chat/chat-tabs';
import { GlobalChatSidebar } from '../chat/global-chat-sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopChatOpen, setDesktopChatOpen] = useState(false);
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { chatOpen, closeChat } = useChatStore();

  // Sync context chatOpen → desktop sidebar
  useEffect(() => {
    if (chatOpen && !isMobile) {
      setDesktopChatOpen(true);
    }
  }, [chatOpen, isMobile]);

  const handleNewPlan = () => {
    setLocation('/plans/new');
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-bg flex flex-col">
      {/* Mobile: hamburger (hidden when chat is open) */}
      {isMobile && !chatOpen && (
        <>
          <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />
          <MobileNav
            isOpen={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            onNewPlan={handleNewPlan}
          />
        </>
      )}

      {/* Main layout */}
      {isMobile ? (
        /* Mobile: horizontal sliding container for push-style chat */
        <div className="flex-1 flex overflow-hidden relative">
          <motion.div
            className="flex w-full h-full"
            style={{ touchAction: 'pan-y' }}
            animate={{ x: chatOpen ? '-100vw' : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          >
            {/* Main content — full width */}
            <main className="w-screen flex-shrink-0 flex flex-col overflow-hidden pt-14 pb-28">
              <div className="flex-1 overflow-y-auto">
                {children}
              </div>
            </main>

            {/* Chat panel — full screen, sits to the right of main content */}
            <div
              className="w-screen h-full flex-shrink-0 flex flex-col bg-bg overflow-hidden"
              data-testid="chat-panel"
            >
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0"
                   style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
                <button
                  onClick={() => closeChat()}
                  className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
                  aria-label="Close chat"
                >
                  <ArrowLeft className="w-4 h-4 text-text-muted" />
                </button>
                <span className="text-sm font-semibold text-text">Chat</span>
              </div>

              {/* Content */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <ChatTabs />
              </div>
            </div>
          </motion.div>
        </div>
      ) : (
        /* Desktop: standard flex layout */
        <div className="flex-1 flex overflow-hidden">
          {/* Desktop sidebar */}
          <aside className="w-[220px] flex-shrink-0 border-r border-border overflow-y-auto">
            <Sidebar onNewPlan={handleNewPlan} />
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
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Chat</span>
                <button
                  onClick={() => setDesktopChatOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-text-muted hover:text-text"
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
                className="p-2.5 rounded-lg bg-surface hover:bg-surface-hover border border-border transition-colors text-text-muted hover:text-accent"
                title="Open chat"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mobile bottom area — just tab bar */}
      {isMobile && (
        <div className="flex-shrink-0">
          <MobileTabBar />
        </div>
      )}

      {/* Floating pill — only when chat is closed on mobile */}
      {isMobile && !chatOpen && <FloatingChatPill />}
    </div>
  );
}
