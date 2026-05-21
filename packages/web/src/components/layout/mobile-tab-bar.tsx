import { useLocation } from 'wouter';
import { LayoutDashboard, Zap, MessageSquare, Layers, User } from 'lucide-react';
import { useChatStore } from '../../lib/chat-store';
import type { LucideIcon } from 'lucide-react';

interface TabItem {
  name: string;
  icon: LucideIcon;
  path?: string;
  action?: 'chat';
}

const tabs: TabItem[] = [
  { name: 'Home',    icon: LayoutDashboard, path: '/' },
  { name: 'Actions', icon: Zap,             path: '/insights' },
  { name: 'Chat',    icon: MessageSquare,   action: 'chat' },
  { name: 'My Level', icon: Layers,         path: '/financial-level' },
  { name: 'Profile', icon: User,            path: '/profile' },
];

export function MobileTabBar() {
  const [location, navigate] = useLocation();
  const { openChat, unreadCount } = useChatStore();

  const isActive = (tab: TabItem) => {
    if (!tab.path) return false;
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
              onClick={() => {
                if (tab.action === 'chat') openChat();
                else if (tab.path) navigate(tab.path);
              }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 h-14 relative
                         transition-all duration-200 active:scale-95 min-w-[44px] min-h-[44px]
                         ${active ? 'text-accent' : 'text-text-muted'}`}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.5} />
              <span className="font-mono text-[10px] tracking-wide uppercase">
                {tab.name}
              </span>
              {tab.action === 'chat' && unreadCount > 0 && (
                <span className="absolute top-2 right-1/2 translate-x-2 w-2.5 h-2.5 rounded-full bg-accent border-2 border-bg" />
              )}
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
