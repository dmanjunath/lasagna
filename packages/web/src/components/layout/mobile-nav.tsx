import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { useLocation } from 'wouter';
import { motion, AnimatePresence, useTransform, useMotionValue, type MotionValue } from 'framer-motion';
import {
  X, Wallet, LogOut,
  LayoutDashboard, Zap, Layers,
  TrendingUp, PieChart, CreditCard, AlertCircle, Receipt, Target,
  MessageSquare, ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { BrandMark } from '../common/BrandMark';

interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  adminOnly?: boolean;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

// Same sections as the desktop sidebar (sidebar.tsx), but all expanded: this
// drawer is dismissed after one tap, so there is nothing to collapse for.
// Kept lean so the whole menu fits one phone screen without scrolling. Profile
// lives in the profile card above, and Accounts is reachable via Profile &
// Settings.
const NAV_SECTIONS: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { label: 'Home',    icon: LayoutDashboard, path: '/' },
      { label: 'Money',   icon: Wallet,          path: '/money' },
      { label: 'Goals',   icon: Target,          path: '/goals' },
      { label: 'AI Chat', icon: MessageSquare,   path: '/chat' },
    ],
  },
  {
    section: 'Financial insights',
    items: [
      { label: 'Actions',         icon: Zap,    path: '/insights' },
      { label: 'Financial Journey', icon: Layers, path: '/financial-level' },
    ],
  },
  {
    section: 'Income & expenses',
    items: [
      { label: 'Spending',     icon: CreditCard,     path: '/spending' },
      { label: 'Transactions', icon: ArrowLeftRight, path: '/transactions' },
    ],
  },
  {
    section: 'Advanced',
    items: [
      { label: 'Retirement Planning', icon: TrendingUp,  path: '/retirement' },
      { label: 'Portfolio',           icon: PieChart,    path: '/portfolio' },
      { label: 'Tax',                 icon: Receipt,     path: '/tax' },
      { label: 'Debt',                icon: AlertCircle, path: '/debt' },
    ],
  },
];

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Live edge-swipe offset in px, 0 at the closed edge and the panel width when
   * fully pulled open. A MotionValue rather than state, so a 60Hz drag writes
   * the transform without re-rendering anything.
   */
  dragX?: MotionValue<number>;
  /** True while an edge drag is in flight, which is what mounts the panel. */
  dragging?: boolean;
}

/** Mirrors w-[88%] max-w-[360px] below, for the drag maths. */
export function drawerWidth(): number {
  if (typeof window === 'undefined') return 360;
  return Math.min(window.innerWidth * 0.88, 360);
}

export function MobileNav({ isOpen, onClose, dragX, dragging = false }: MobileNavProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout, user } = useAuth();

  const width = drawerWidth();
  const fallback = useMotionValue(0);
  const offset = dragX ?? fallback;
  const panelX = useTransform(offset, (v) => v - width);
  const scrimOpacity = useTransform(offset, (v) => Math.min(1, v / width));

  useBodyScrollLock(isOpen || dragging);

  const isActive = (path: string) => path === '/' ? location === '/' : (location === path || location.startsWith(path + '/'));

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';

  return (
    <AnimatePresence>
      {(isOpen || dragging) && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={dragging ? undefined : { opacity: 1 }}
            style={dragging ? { opacity: scrimOpacity } : undefined}
            exit={{ opacity: 0 }}
            transition={dragging ? { duration: 0 } : undefined}
            onClick={onClose}
            className="fixed inset-0 top-[-5%] h-[110%] bg-black/50 z-40 md:hidden"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={dragging ? undefined : { x: 0 }}
            style={dragging ? { x: panelX } : undefined}
            exit={{ x: '-100%' }}
            transition={dragging ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 320 }}
            drag={dragging ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.9, right: 0 }}
            onDragEnd={(_e, info) => {
              if (info.offset.x < -64 || info.velocity.x < -400) onClose();
            }}
            className="fixed top-0 left-0 bottom-0 w-[88%] max-w-[360px] z-50 overflow-y-auto overscroll-contain
                       bg-canvas border-r border-line shadow-2xl md:hidden scrollbar-thin"
          >
            <nav
              className="px-3 space-y-0.5"
              style={{
                paddingTop: 'max(10px, env(safe-area-inset-top))',
                paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
              }}
            >
              {/* Header — brand + close */}
              <div className="flex items-center justify-between px-2 pt-1">
                <div className="flex items-center gap-2.5">
                  <BrandMark size={30} />
                  <span className="font-editorial text-[18px] font-semibold tracking-[-0.01em] text-content">LasagnaFi</span>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close menu"
                  className="grid place-items-center w-11 h-11 -mr-1 rounded-ui-md text-content-muted hover:bg-canvas-sunken hover:text-content transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Profile card */}
              <button
                onClick={() => handleNavigate('/profile')}
                className="flex items-center gap-3 p-2 w-full bg-panel rounded-ui-lg border border-line hover:border-brand/40 hover:shadow-ui-sm transition text-left"
              >
                <div className="w-9 h-9 rounded-full bg-brand grid place-items-center text-lg font-editorial font-bold text-[rgb(var(--ui-brand-fg))] shrink-0 shadow-ui-sm">
                  {initial}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-[15px] font-bold leading-tight tracking-tight text-content">{firstName}</div>
                  <div className="text-[12px] text-content-muted mt-0.5">View profile &amp; settings</div>
                </div>
                <div className="text-content-faint text-sm">›</div>
              </button>

              {NAV_SECTIONS.map(({ section, items }, sectionIndex) => (
                <div key={section}>
                  {sectionIndex > 0 && <div className="h-px bg-line mx-3 mt-2.5" />}
                  <div className="text-[12px] font-semibold text-content-muted px-3 pt-3 pb-1">
                    {section}
                  </div>
                  <div className="ml-4 pl-2 border-l border-line">
                    {items.filter((e) => !e.adminOnly || user?.isAdmin).map(({ label, icon: Icon, path }) => {
                      const active = isActive(path);
                      return (
                        <button
                          key={path}
                          onClick={() => handleNavigate(path)}
                          className="relative flex items-center gap-3 w-full px-2.5 py-1 rounded-ui-md
                                     cursor-pointer text-left text-[15px] transition-colors active:scale-[0.98]
                                     min-h-[40px]"
                        >
                          {active && (
                            <span
                              aria-hidden="true"
                              className="absolute -left-[10px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-brand"
                            />
                          )}
                          <div className={`w-7 h-7 rounded-ui-md grid place-items-center shrink-0 ${active ? 'bg-brand text-[rgb(var(--ui-brand-fg))]' : 'bg-canvas-sunken text-content-muted'}`}>
                            <Icon size={14} />
                          </div>
                          <span className={active ? 'font-bold text-[rgb(var(--ui-brand-ink))]' : 'font-semibold text-content'}>{label}</span>
                          <div className="text-content-faint text-sm ml-auto">›</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Sign out */}
              <button
                onClick={() => { onClose(); logout(); }}
                className="flex items-center gap-3 w-full px-2.5 py-1 mt-2 rounded-ui-md hover:bg-canvas-sunken text-left min-h-[40px]"
              >
                <div className="w-7 h-7 rounded-ui-md bg-canvas-sunken grid place-items-center shrink-0 text-content-muted">
                  <LogOut size={14} />
                </div>
                <span className="text-[15px] font-semibold text-content-secondary">Sign out</span>
              </button>
            </nav>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
