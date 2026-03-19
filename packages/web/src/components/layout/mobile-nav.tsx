import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Menu,
  LayoutDashboard, Zap, Layers,
  TrendingUp, PieChart, CreditCard, AlertCircle, Receipt, Target,
  Building2, User, MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useChatStore } from '../../lib/chat-store';

interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { label: 'Dashboard',  icon: LayoutDashboard, path: '/' },
      { label: 'Actions',    icon: Zap,             path: '/insights' },
      { label: 'Financial Level', icon: Layers, path: '/financial-level' },
    ],
  },
  {
    section: 'Wealth',
    items: [
      { label: 'Retirement', icon: TrendingUp,  path: '/retirement' },
      { label: 'Portfolio',  icon: PieChart,    path: '/portfolio' },
      { label: 'Spending',   icon: CreditCard,  path: '/spending' },
      { label: 'Debt',       icon: AlertCircle, path: '/debt' },
      { label: 'Tax',        icon: Receipt,     path: '/tax' },
      { label: 'Goals',      icon: Target,      path: '/goals' },
    ],
  },
  {
    section: 'Setup',
    items: [
      { label: 'Accounts', icon: Building2,    path: '/accounts' },
      { label: 'Profile',  icon: User,         path: '/profile' },
    ],
  },
];

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileNav({ isOpen, onClose }: MobileNavProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout } = useAuth();
  const { openChat } = useChatStore();

  const isActive = (path: string) => path === '/' ? location === '/' : location.startsWith(path);

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, top: '-5%', height: '110%', background: 'rgba(31,26,22,0.5)', zIndex: 40 }}
            className="md:hidden"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, width: 280,
              zIndex: 50, display: 'flex', flexDirection: 'column',
              background: 'var(--lf-cream)', borderRight: '1px solid var(--lf-rule)',
            }}
            className="md:hidden"
          >
            {/* Header */}
            <div style={{
              padding: '20px 16px 16px',
              borderBottom: '1px solid var(--lf-rule)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              paddingTop: 'max(20px, env(safe-area-inset-top))',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="lf-mark"><span /><span /><span /></div>
                <span style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontSize: 18, color: 'var(--lf-ink)', letterSpacing: '-0.01em',
                }}>
                  Lasagna<em style={{ fontStyle: 'italic', color: 'var(--lf-sauce)' }}>Fi</em>
                </span>
              </div>
              <button
                onClick={onClose}
                style={{
                  width: 32, height: 32, borderRadius: 8, border: '1px solid var(--lf-rule)',
                  background: 'var(--lf-paper)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer',
                }}
              >
                <X size={16} style={{ color: 'var(--lf-muted)' }} />
              </button>
            </div>

            {/* Nav */}
            <nav style={{ flex: 1, overflowY: 'auto', padding: '12px' }} className="scrollbar-thin">
              {NAV_SECTIONS.map(({ section, items }) => (
                <div key={section} style={{ marginBottom: 8 }}>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase',
                    color: 'var(--lf-muted)', padding: '0 8px', margin: '16px 0 6px',
                  }}>
                    {section}
                  </div>
                  {items.map(({ label, icon: Icon, path }) => {
                    const active = isActive(path);
                    return (
                      <button
                        key={path}
                        onClick={() => handleNavigate(path)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          width: '100%', padding: '10px 12px', borderRadius: 8,
                          marginBottom: 2, border: 0, cursor: 'pointer', textAlign: 'left',
                          fontFamily: "'Geist', system-ui, sans-serif", fontSize: 14,
                          background: active ? 'var(--lf-ink)' : 'transparent',
                          color: active ? 'var(--lf-paper)' : 'var(--lf-ink-soft)',
                        }}
                      >
                        <Icon
                          size={16}
                          style={{
                            flexShrink: 0,
                            opacity: active ? 1 : 0.65,
                            color: active ? 'var(--lf-cheese)' : 'currentColor',
                          }}
                        />
                        {label}
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* AI Chat */}
              <div style={{ marginBottom: 8 }}>
                <button
                  onClick={() => { openChat(); onClose(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '10px 12px', borderRadius: 8,
                    marginBottom: 2, border: 0, cursor: 'pointer', textAlign: 'left',
                    fontFamily: "'Geist', system-ui, sans-serif", fontSize: 14,
                    background: 'transparent', color: 'var(--lf-ink-soft)',
                  }}
                >
                  <MessageSquare size={16} style={{ flexShrink: 0, opacity: 0.65 }} />
                  AI Chat
                </button>
              </div>
            </nav>

            {/* Account chip at bottom */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--lf-rule)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: 'var(--lf-sauce)', color: 'var(--lf-paper)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 14, flexShrink: 0,
                }}>
                  {initial}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 500, color: 'var(--lf-ink)', fontSize: 13,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontFamily: "'Geist', system-ui, sans-serif",
                  }}>
                    {firstName}
                  </div>
                  <div style={{ color: 'var(--lf-muted)', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                    {tenant?.plan === 'pro' ? 'pro plan' : 'self-hosted'}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      style={{
        position: 'fixed', top: 14, left: 16, zIndex: 30,
        width: 36, height: 36, borderRadius: 9,
        background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}
      className="md:hidden"
    >
      <Menu size={18} style={{ color: 'var(--lf-ink)' }} />
    </motion.button>
  );
}
