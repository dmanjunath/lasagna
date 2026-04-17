import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { motion, useAnimation, type PanInfo } from 'framer-motion';
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

const SWIPE_THRESHOLD = 60;
const VELOCITY_THRESHOLD = 400;

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopChatOpen, setDesktopChatOpen] = useState(false);
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { chatOpen, openChat, closeChat } = useChatStore();
  const controls = useAnimation();

  // Sync animation state with chatOpen
  useEffect(() => {
    controls.start({ x: chatOpen ? '-100vw' : 0 });
  }, [chatOpen, controls]);

  // Sync context chatOpen → desktop sidebar
  useEffect(() => {
    if (chatOpen && !isMobile) {
      setDesktopChatOpen(true);
    }
  }, [chatOpen, isMobile]);

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (!chatOpen) {
      // Swiping left to open chat
      if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
        openChat();
      } else {
        controls.start({ x: 0 });
      }
    } else {
      // Swiping right to close chat
      if (offset.x > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
        closeChat();
      } else {
        controls.start({ x: '-100vw' });
      }
    }
  }, [chatOpen, openChat, closeChat, controls]);

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
        /* Mobile: horizontal sliding container for push-style chat */
        <div className="flex-1 flex overflow-hidden relative">
          <motion.div
            className="flex w-full h-full"
            animate={controls}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.15}
            onDragEnd={handleDragEnd}
            style={{ touchAction: 'pan-y' }}
          >
            {/* Main content — full width */}
            <main className="w-screen flex-shrink-0 flex flex-col overflow-hidden pt-14 pb-16">
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

              {/* Content — takes full remaining height, no bottom padding needed */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0"
                   style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
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

      {/* Mobile tab bar — hidden when chat is open */}
      {isMobile && !chatOpen && <MobileTabBar />}

    </div>
  );
}
