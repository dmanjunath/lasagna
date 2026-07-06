import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { MessageSquare, X, Menu, Maximize2, Sparkles, ChevronLeft } from 'lucide-react';
import { Sidebar } from './sidebar';
import { MobileNav } from './mobile-nav';
import { MobileTabBar } from './mobile-tab-bar';
import { AppHeader } from './app-header';
import { PullToRefresh } from './pull-to-refresh';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { useChatStore, getChatExpanded, setChatExpanded } from '../../lib/chat-store';
import { GlobalChatSidebar } from '../chat/global-chat-sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopChatOpen, setDesktopChatOpen] = useState(false);
  // Bumped by pull-to-refresh to remount (and so refetch) the current page.
  const [refreshKey, setRefreshKey] = useState(0);
  const isMobile = useIsMobile();
  const [location, setLocation] = useLocation();
  const { chatOpen, closeChat, unreadCount, setChatReturnPath, activeThreadIndex } = useChatStore();

  // On mobile, an open chat thread on /chat owns the bottom of the screen with
  // its own composer. Hide the global tab bar (and drop the content's bottom
  // offset) so there's one clear bottom zone instead of doubled chrome.
  // The empty/list state keeps the tab bar so navigation stays reachable.
  const hideTabBarForThread = isMobile && location === '/chat' && activeThreadIndex !== null;

  // On mobile the DOCUMENT owns vertical scroll (so iOS Safari's toolbars
  // collapse away and status-bar tap-to-top works) — except /chat, whose
  // composer layout needs the height-constrained shell.
  const mobileDocScroll = isMobile && location !== '/chat';

  // Top-level destinations keep the hamburger; everything deeper (account
  // detail, plan detail/new, quick import, admin) swaps it for a back button —
  // pages don't render their own Back on mobile.
  const MAIN_PAGES = new Set([
    '/', '/money', '/insights', '/goals', '/chat', '/retirement', '/portfolio',
    '/spending', '/debt', '/tax', '/financial-level', '/accounts', '/profile', '/plans',
  ]);
  const isSubPage = !MAIN_PAGES.has(location);
  const handleBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation('/');
  };

  // On main pages a swipe in from the left edge opens the drawer (instead of
  // the browser's back gesture — preventDefault suppresses it while the
  // hamburger is the leading control).
  useEffect(() => {
    if (!isMobile || isSubPage) return;
    let startX: number | null = null;
    let startY = 0;
    let engaged = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX <= 24 ? t.clientX : null;
      startY = t.clientY;
      engaged = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startX === null) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (!engaged && dx > 20 && dx > dy * 1.5) {
        engaged = true;
        setMobileMenuOpen(true);
      }
      if (engaged) e.preventDefault();
    };
    const onEnd = () => { startX = null; engaged = false; };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [isMobile, isSubPage]);

  // The document scroller persists across routes, so reset it per navigation.
  useEffect(() => {
    if (mobileDocScroll) window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Expand the sidebar chat into the full-page /chat route, remembering where to
  // return when the user collapses it back. Persist the preference so chat
  // reopens expanded next time (until they collapse back to the sidebar).
  const handleExpandChat = () => {
    setChatExpanded(true);
    setChatReturnPath(location);
    setDesktopChatOpen(false);
    closeChat();
    setLocation('/chat');
  };

  // Sync context chatOpen → desktop view. Chat opens in the sidebar by default;
  // if the user last expanded it, honor that and open the full /chat page.
  useEffect(() => {
    if (!chatOpen || isMobile) return;
    if (getChatExpanded() && location !== '/chat') {
      setChatReturnPath(location);
      closeChat();
      setLocation('/chat');
    } else {
      setDesktopChatOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen, isMobile]);

  // Mobile has no chat overlay — the canonical chat is the full /chat page (the
  // same target as the bottom-tab and hamburger). Any openChat() call routes
  // there; if it carried a prompt, openChat set pendingMessage, which the /chat
  // page's hook consumes to start the conversation.
  useEffect(() => {
    if (!chatOpen || !isMobile) return;
    closeChat();
    if (location !== '/chat') setLocation('/chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen, isMobile]);

  return (
    <div className={`w-full max-w-full bg-canvas app-wash flex flex-col ${mobileDocScroll ? 'min-h-dvh' : 'h-dvh overflow-hidden'}`}>
      {/* Shared top bar — same component the Simple shell uses, so the
          Simple/Advanced toggle and overall chrome are consistent across
          modes. Hidden when the mobile chat overlay is up. */}
      {isMobile && !chatOpen && (
        <>
          <AppHeader
            variant="advanced"
            leadingSlot={
              isSubPage ? (
                <button
                  onClick={handleBack}
                  aria-label="Back"
                  className="w-11 h-11 grid place-items-center rounded-[10px] text-content-secondary hover:bg-canvas-sunken hover:text-content transition-colors"
                >
                  <ChevronLeft size={20} />
                </button>
              ) : (
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  aria-label="Open menu"
                  className="w-11 h-11 grid place-items-center rounded-[10px] text-content-secondary hover:bg-canvas-sunken hover:text-content transition-colors"
                >
                  <Menu size={18} />
                </button>
              )
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
        mobileDocScroll ? (
          /* Mobile pages: document scroll — fixed header/tab-bar space is
             reserved with padding; no nested scroll container. */
          <PullToRefresh
            topOffset="calc(env(safe-area-inset-top) + 48px)"
            onRefresh={() => setRefreshKey((k) => k + 1)}
          >
            {/* key remounts just the routed page — every page refetches its
                data on mount, while the shell (header/tab bar) stays put. */}
            <main
              key={refreshKey}
              className="w-full max-w-full pt-[calc(env(safe-area-inset-top)+48px)] pb-[calc(env(safe-area-inset-bottom)+68px)]"
            >
              {children}
            </main>
          </PullToRefresh>
        ) : (
          /* Mobile /chat: height-constrained shell so the thread + composer
             own the viewport. pt offset = notch + 44px header. */
          <div className="flex-1 flex overflow-hidden relative">
            <main className={`w-full max-w-full flex flex-col overflow-hidden pt-[calc(env(safe-area-inset-top)+48px)] ${hideTabBarForThread ? 'pb-safe-bottom' : 'pb-[calc(env(safe-area-inset-bottom)+68px)]'}`}>
              <div className="flex-1 overflow-y-auto">
                {children}
              </div>
            </main>

            {/* Mobile has no chat overlay — openChat routes to /chat (see effect above). */}
          </div>
        )
      ) : (
        /* Desktop: standard flex layout */
        <div className="flex-1 flex overflow-hidden">
          {/* Desktop sidebar */}
          <aside className="w-[268px] flex-shrink-0 border-r border-line overflow-y-auto">
            <Sidebar />
          </aside>

          {/* Main content area */}
          <main className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </main>

          {/* Desktop chat sidebar — closable. Hidden on the full-page /chat
              route, which already shows the conversation + history rail. */}
          {location !== '/chat' && desktopChatOpen && (
            <aside className="w-[340px] flex-shrink-0 border-l border-line flex flex-col overflow-hidden bg-canvas">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-line flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[var(--ui-accent-soft)] grid place-items-center">
                    <Sparkles className="w-3.5 h-3.5 text-[rgb(var(--ui-accent-ink))]" />
                  </div>
                  <span className="text-sm font-semibold text-content">Assistant</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={handleExpandChat}
                    className="p-1.5 rounded-ui-md text-content-secondary hover:bg-canvas-sunken hover:text-content transition-colors"
                    title="Expand to full page"
                    aria-label="Expand chat"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setDesktopChatOpen(false); closeChat(); }}
                    className="p-1.5 rounded-ui-md text-content-secondary hover:bg-canvas-sunken hover:text-content transition-colors"
                    aria-label="Close chat"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <GlobalChatSidebar />
              </div>
            </aside>
          )}
          {/* Collapsed chat toggle — also hidden on /chat (full page is open). */}
          {location !== '/chat' && !desktopChatOpen && (
            <div className="flex-shrink-0 border-l border-line flex flex-col items-center pt-3 px-1.5 bg-canvas">
              <button
                onClick={() => setDesktopChatOpen(true)}
                className="relative p-2.5 rounded-ui-md bg-panel hover:bg-canvas-sunken border border-line transition-colors text-content-secondary hover:text-brand"
                title="Open chat"
              >
                <MessageSquare className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brand border-2 border-canvas" />
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mobile tab bar — hidden when the sidebar chat overlay is open, or when
          a chat thread owns the bottom of the screen on /chat. */}
      {isMobile && !chatOpen && !hideTabBarForThread && <MobileTabBar />}

    </div>
  );
}
