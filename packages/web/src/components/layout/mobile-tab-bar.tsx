import { useLocation } from 'wouter';
import { Home, Wallet, MessageSquare, Zap, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface TabItem {
  name: string;
  icon: LucideIcon;
  path: string;
}

const tabs: TabItem[] = [
  { name: 'Home',    icon: Home,          path: '/' },
  { name: 'Money',   icon: Wallet,        path: '/money' },
  { name: 'Chat',    icon: MessageSquare, path: '/chat' },
  { name: 'Actions', icon: Zap,           path: '/insights' },
  { name: 'Goals',   icon: Target,        path: '/goals' },
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
          // Active state = ONE signal: icon + label in ink, a single 4px
          // sauce dot under the label as the "you are here" marker. Sauce
          // gives the warm accent moment without three competing signals.
          return (
            <button
              key={tab.name}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 h-14 relative
                         transition-all duration-200 active:scale-95 min-w-[44px] min-h-[44px]
                         ${active ? 'text-text' : 'text-text-muted'}`}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.5} />
              <span className="font-mono text-[10px] tracking-wide uppercase">
                {tab.name}
              </span>
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-accent"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
