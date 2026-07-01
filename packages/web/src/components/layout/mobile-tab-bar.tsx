import { useLocation } from 'wouter';
import { LayoutDashboard, Wallet, Zap, Target, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface TabItem {
  name: string;
  icon: LucideIcon;
  path: string;
}

const tabs: TabItem[] = [
  { name: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { name: 'Money',     icon: Wallet,          path: '/money' },
  { name: 'Actions',   icon: Zap,             path: '/insights' },
  { name: 'Goals',     icon: Target,          path: '/goals' },
  { name: 'Chat',      icon: MessageSquare,   path: '/chat' },
];

export function MobileTabBar() {
  const [location, navigate] = useLocation();

  const isActive = (tab: TabItem) => {
    return tab.path === '/' ? location === '/' : location.startsWith(tab.path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md border-t border-line md:hidden pb-[env(safe-area-inset-bottom)]"
      style={{ background: 'rgb(var(--ui-canvas) / 0.92)' }}
    >
      <div className="flex items-stretch px-1.5 pt-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab);
          return (
            <button
              key={tab.name}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center justify-center gap-[3px] py-1.5 rounded-xl
                         transition-colors duration-200 active:scale-95 min-w-[44px] min-h-[44px]
                         ${active ? 'text-brand' : 'text-content-muted'}`}
            >
              <Icon size={22} strokeWidth={active ? 2.1 : 1.75} />
              <span className="text-[10.5px] font-semibold tracking-wide">
                {tab.name}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
