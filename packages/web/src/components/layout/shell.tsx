import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X } from 'lucide-react';
import { Sidebar } from './sidebar';
import { MobileNav, MobileMenuButton } from './mobile-nav';
import { MobileTabBar } from './mobile-tab-bar';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { useAuth } from '../../lib/auth';
import { usePageContext } from '../../lib/page-context';
import { FloatingChatInput } from '../chat/floating-chat-input';
import { GlobalChatSidebar } from '../chat/global-chat-sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopChatOpen, setDesktopChatOpen] = useState(false);
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { chatOpen, closeChat } = usePageContext();

  // Sync context chatOpen → desktop sidebar
  useEffect(() => {
    if (chatOpen && !isMobile) {
      setDesktopChatOpen(true);
    }
  }, [chatOpen, isMobile]);

  const isAdmin = user?.role === 'owner';

  const handleNewPlan = () => {
    setLocation('/plans/new');
  };

  const isPlanPage = location.startsWith('/plans/') && location !== '/plans/new';

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
        <main
          className={`flex-1 flex flex-col overflow-hidden ${
            isMobile ? 'pt-14 pb-28' : ''
          }`}
        >
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </main>

        {/* Desktop chat sidebar — admin only, closable */}
        {!isMobile && isAdmin && desktopChatOpen && (
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
        {/* Collapsed chat toggle — admin only */}
        {!isMobile && isAdmin && !desktopChatOpen && (
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

      {/* Mobile bottom area */}
      {isMobile && (
        <div className="flex-shrink-0">
          {/* Peek bar — admin only */}
          {!isPlanPage && isAdmin && <FloatingChatInput />}
          {/* Tab bar */}
          <MobileTabBar />
        </div>
      )}

      {/* Mobile chat drawer — admin only */}
      <AnimatePresence>
        {isMobile && isAdmin && chatOpen && (
          <motion.div
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/50"
              onClick={closeChat}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="absolute bottom-0 left-0 right-0 bg-bg rounded-t-xl flex flex-col shadow-[0_-4px_24px_rgba(0,0,0,0.5)]"
              style={{ maxHeight: '88vh' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            >
              <div className="flex justify-center py-2 flex-shrink-0">
                <div className="w-9 h-1 rounded-full bg-white/20" />
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">
                <GlobalChatSidebar />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
