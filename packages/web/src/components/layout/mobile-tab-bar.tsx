import { useLocation } from 'wouter';
import { Home, Wallet, MessageSquare, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface TabItem {
  name: string;
  icon: LucideIcon;
  path: string;
}

const tabs: TabItem[] = [
  { name: 'Home',  icon: Home,          path: '/' },
  { name: 'Money', icon: Wallet,        path: '/money' },
  { name: 'Chat',  icon: MessageSquare, path: '/chat' },
  { name: 'Goals', icon: Target,        path: '/goals' },
];

export function MobileTabBar() {
  const [location, navigate] = useLocation();

  const isActive = (tab: TabItem) => {
    return tab.path === '/' ? location === '/' : location.startsWith(tab.path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-bg/95 backdrop-blur border-t border-rule/60 md:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab);
          return (
            <button
              key={tab.name}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 h-14 relative
                         transition-all duration-200 active:scale-95 min-w-[44px] min-h-[44px]
                         ${active ? 'text-accent' : 'text-text-muted'}`}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.5} />
              <span className="font-mono text-[10px] tracking-wide uppercase">
                {tab.name}
              </span>
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-b-sm bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
