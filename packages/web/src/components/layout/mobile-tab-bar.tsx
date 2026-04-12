import { useLocation } from 'wouter';
import {
  LayoutDashboard,
  Compass,
  PieChart,
  Target,
  Building2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';

interface TabItem {
  name: string;
  icon: LucideIcon;
  path: string;
}

const tabs: TabItem[] = [
  { name: 'Home', icon: LayoutDashboard, path: '/' },
  { name: 'Next Steps', icon: Compass, path: '/priorities' },
  { name: 'Portfolio', icon: PieChart, path: '/invest' },
  { name: 'Retire', icon: Target, path: '/retirement' },
  { name: 'Accounts', icon: Building2, path: '/accounts' },
];

export function MobileTabBar() {
  const [location, navigate] = useLocation();

  const isActive = (path: string) => location === path;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-bg-elevated border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.path);
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors',
                active ? 'text-accent' : 'text-text-muted'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
