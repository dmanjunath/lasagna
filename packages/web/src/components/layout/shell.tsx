import { useState } from 'react';
import { useLocation } from 'wouter';
import { Sidebar } from './sidebar';
import { MobileNav, MobileMenuButton } from './mobile-nav';
import { useIsMobile } from '../../lib/hooks/use-mobile';
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

  const handleNewPlan = () => {
    setLocation('/plans/new');
  };

  // Don't show floating chat on plan pages (they have their own chat)
  const isPlanPage = location.startsWith('/plans/') && location !== '/plans/new';

  return (
    <div className="flex h-screen bg-bg">
      {/* Mobile menu button */}
      {isMobile && <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />}

      {/* Mobile drawer */}
      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onNewPlan={handleNewPlan}
      />

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar onNewPlan={handleNewPlan} />
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden pt-14 md:pt-0">
        {children}
      </main>

      {/* Floating chat input (not on plan pages) */}
      {!isPlanPage && <FloatingChatInput />}

      {/* Global chat sidebar */}
      <GlobalChatSidebar />
    </div>
  );
}
