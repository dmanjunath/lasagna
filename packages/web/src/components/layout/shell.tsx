import { useState } from 'react';
import { Sidebar } from './sidebar';
import { MobileNav, MobileMenuButton } from './mobile-nav';
import { useIsMobile } from '../../lib/hooks/use-mobile';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleNewPlan = () => {
    // TODO: Open new plan modal
    console.log('New plan clicked');
  };

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
    </div>
  );
}
