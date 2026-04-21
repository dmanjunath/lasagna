import { useLocation } from 'wouter';
import { LayoutDashboard, Zap, Layers, MessageSquare, User } from 'lucide-react';
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
  { name: 'Layers',  icon: Layers,          path: '/priorities' },
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
    <nav
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
        background: 'var(--lf-paper)', borderTop: '1px solid var(--lf-rule)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex', alignItems: 'stretch',
      }}
      className="md:hidden"
    >
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
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 3, height: 56, border: 0, cursor: 'pointer',
              background: 'transparent', position: 'relative',
              color: active ? 'var(--lf-sauce)' : 'var(--lf-muted)',
              transition: 'color 0.15s',
            }}
          >
            <Icon size={20} strokeWidth={active ? 2 : 1.5} />
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13, letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'inherit',
            }}>
              {tab.name}
            </span>
            {tab.action === 'chat' && unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 8, right: '50%',
                transform: 'translateX(8px)',
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--lf-sauce)',
              }} />
            )}
            {active && (
              <span style={{
                position: 'absolute', top: 0, left: '50%',
                transform: 'translateX(-50%)',
                width: 20, height: 2, borderRadius: '0 0 2px 2px',
                background: 'var(--lf-sauce)',
              }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}
