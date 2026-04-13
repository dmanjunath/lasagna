import { useLocation } from 'wouter';
import {
  LayoutDashboard,
  MessageSquare,
  Lightbulb,
  User,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useChatStore } from '../../lib/chat-store';
import type { LucideIcon } from 'lucide-react';

interface TabItem {
  name: string;
  icon: LucideIcon;
  path?: string;
  action?: 'chat';
}

const tabs: TabItem[] = [
  { name: 'Home', icon: LayoutDashboard, path: '/' },
  { name: 'Chat', icon: MessageSquare, action: 'chat' },
  { name: 'Insights', icon: Lightbulb, path: '/insights' },
  { name: 'Profile', icon: User, path: '/profile' },
];

export function MobileTabBar() {
  const [location, navigate] = useLocation();
  const { openChat, unreadCount } = useChatStore();

  const isActive = (tab: TabItem) => tab.path ? location === tab.path : false;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-bg-elevated border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab);
          return (
            <button
              key={tab.name}
              onClick={() => {
                if (tab.action === 'chat') {
                  openChat();
                } else if (tab.path) {
                  navigate(tab.path);
                }
              }}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors relative',
                active ? 'text-accent' : 'text-text-muted'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.name}</span>
              {tab.action === 'chat' && unreadCount > 0 && (
                <span className="absolute top-2 right-1/2 translate-x-3 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
