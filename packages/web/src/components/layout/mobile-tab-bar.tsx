import { useLocation } from 'wouter';
import { motion, type MotionStyle } from 'framer-motion';
import { LayoutDashboard, Wallet, CreditCard, Target, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';

interface TabItem {
  name: string;
  icon: LucideIcon;
  path: string;
  /** Extra routes this tab owns — see the same field in sidebar.tsx. */
  match?: string[];
}

const tabs: TabItem[] = [
  { name: 'Home', icon: LayoutDashboard, path: '/' },
  { name: 'Money',     icon: Wallet,          path: '/money', match: ['/accounts'] },
  { name: 'Spending',  icon: CreditCard,      path: '/spending' },
  { name: 'Goals',     icon: Target,          path: '/goals' },
  { name: 'Chat',      icon: MessageSquare,   path: '/chat' },
];

/** `style` carries the drawer's push offset. */
export function MobileTabBar({ style }: { style?: MotionStyle }) {
  const [location, navigate] = useLocation();

  const isActive = (tab: TabItem) => {
    if (tab.path === '/') return location === '/';
    return [tab.path, ...(tab.match ?? [])].some((p) => location.startsWith(p));
  };

  return (
    <motion.nav
      className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md border-t border-line md:hidden pb-[max(env(safe-area-inset-bottom),0.5rem)]"
      style={{ background: 'rgb(var(--ui-canvas) / 0.86)', ...style }}
    >
      <div className="flex items-stretch px-1.5 pt-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab);
          return (
            <button
              key={tab.name}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (!active) hapticLight();
                // Re-tapping the current tab pops it to its root, as iOS does.
                else window.dispatchEvent(new CustomEvent('tab:reselect', { detail: tab.path }));
                navigate(tab.path);
              }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-1 rounded-ui-md
                         transition-colors duration-200 active:scale-95 min-w-[44px] min-h-[44px]
                         ${active ? 'text-[rgb(var(--ui-brand-ink))]' : 'text-content-muted'}`}
            >
              {/* Active pill behind the icon — matches the brand-soft active
                  treatment used by the sidebar + drawer nav. */}
              <span
                className={`grid place-items-center h-7 w-[52px] rounded-full transition-colors ${active ? 'bg-brand-soft' : 'bg-transparent'}`}
              >
                <Icon size={21} strokeWidth={active ? 2.1 : 1.75} />
              </span>
              <span className="text-[10.5px] font-semibold tracking-wide">
                {tab.name}
              </span>
            </button>
          );
        })}
      </div>
    </motion.nav>
  );
}
