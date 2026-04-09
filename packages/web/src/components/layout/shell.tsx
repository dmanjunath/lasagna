import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './sidebar';
import { MobileNav, MobileMenuButton } from './mobile-nav';
import { MobileTabBar } from './mobile-tab-bar';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { usePageContext } from '../../lib/page-context';
import { FloatingChatInput } from '../chat/floating-chat-input';
import { GlobalChatSidebar } from '../chat/global-chat-sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const { chatOpen, closeChat } = usePageContext();

  const handleNewPlan = () => {
    setLocation('/plans/new');
  };

  // Don't show floating chat on plan pages (they have their own chat)
  const isPlanPage = location.startsWith('/plans/') && location !== '/plans/new';

  return (
    <div className="flex h-screen bg-bg">
      {/* Mobile menu button */}
      {isMobile && <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />}

      {/* Mobile drawer nav */}
      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onNewPlan={handleNewPlan}
      />

      {/* Desktop: 3-column grid layout */}
      <div className="flex-1 flex md:grid md:grid-cols-[200px_1fr_340px]">
        {/* Left: Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar onNewPlan={handleNewPlan} />
        </div>

        {/* Center: Main content */}
        <main className="flex-1 flex flex-col overflow-hidden pt-14 md:pt-0 pb-16 md:pb-0">
          {children}
        </main>

        {/* Right: Chat sidebar (desktop only) */}
        <div className="hidden md:flex">
          <GlobalChatSidebar />
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      {isMobile && <MobileTabBar />}

      {/* Mobile peek bar (not on plan pages) */}
      {!isPlanPage && <FloatingChatInput />}

      {/* Mobile chat drawer */}
      <AnimatePresence>
        {isMobile && chatOpen && (
          <motion.div
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/50"
              onClick={closeChat}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            {/* Drawer */}
            <motion.div
              className="absolute bottom-0 left-0 right-0 max-h-[92vh] bg-bg rounded-t-2xl flex flex-col shadow-[0_-4px_24px_rgba(0,0,0,0.5)]"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            >
              {/* Drag handle */}
              <div className="flex justify-center py-2.5 flex-shrink-0">
                <div className="w-9 h-1 rounded-full bg-white/20" />
              </div>
              {/* Chat content */}
              <div className="flex-1 min-h-0 overflow-hidden" style={{ height: '80vh' }}>
                <GlobalChatSidebar />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
