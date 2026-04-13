import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X } from 'lucide-react';
import { Sidebar } from './sidebar';
import { MobileNav, MobileMenuButton } from './mobile-nav';
import { MobileTabBar } from './mobile-tab-bar';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { useChatStore } from '../../lib/chat-store';
import { FloatingChatPill } from '../chat/floating-chat-pill';
import { MobileChatPanel } from '../chat/chat-panel.mobile';
import { GlobalChatSidebar } from '../chat/global-chat-sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopChatOpen, setDesktopChatOpen] = useState(false);
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { chatOpen } = useChatStore();

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
      {/* Mobile: hamburger */}
      {isMobile && (
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
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop sidebar */}
        {!isMobile && (
          <aside className="w-[220px] flex-shrink-0 border-r border-border overflow-y-auto">
            <Sidebar onNewPlan={handleNewPlan} />
          </aside>
        )}

        {/* Main content area */}
        <motion.main
          className={`flex-1 flex flex-col overflow-hidden ${isMobile ? 'pt-14 pb-28' : ''}`}
          animate={isMobile && chatOpen ? {
            x: '-15vw',
            scale: 0.95,
            opacity: 0.6,
          } : {
            x: 0,
            scale: 1,
            opacity: 1,
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        >
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </motion.main>

        {/* Desktop chat sidebar — closable */}
        {!isMobile && desktopChatOpen && (
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
        {!isMobile && !desktopChatOpen && (
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

      {/* Mobile bottom area — just tab bar */}
      {isMobile && (
        <div className="flex-shrink-0">
          <MobileTabBar />
        </div>
      )}

      {/* Floating pill — only when chat is closed on mobile */}
      {isMobile && !chatOpen && <FloatingChatPill />}

      {/* Mobile chat panel with AnimatePresence */}
      <AnimatePresence>
        {isMobile && chatOpen && <MobileChatPanel />}
      </AnimatePresence>
    </div>
  );
}
