import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Zap, Layers, TrendingUp, PieChart,
  CreditCard, AlertCircle, Receipt, Target, Building2,
  User, MessageSquare, type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { useChatStore } from '../../lib/chat-store';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

interface NavSection {
  section: string;
}

type NavEntry = NavItem | NavSection;

const NAV: NavEntry[] = [
  { section: 'OVERVIEW' },
  { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard, path: '/' },
  { id: 'actions',    label: 'Actions',    icon: Zap,             path: '/insights' },
  { id: 'priorities', label: 'Layers',     icon: Layers,          path: '/priorities' },
  { section: 'WEALTH' },
  { id: 'retirement', label: 'Retirement', icon: TrendingUp,      path: '/retirement' },
  { id: 'portfolio',  label: 'Portfolio',  icon: PieChart,        path: '/portfolio' },
  { id: 'spending',   label: 'Spending',   icon: CreditCard,      path: '/spending' },
  { id: 'debt',       label: 'Debt',       icon: AlertCircle,     path: '/debt' },
  { id: 'tax',        label: 'Tax',        icon: Receipt,         path: '/tax' },
  { id: 'goals',      label: 'Goals',      icon: Target,          path: '/goals' },
  { section: 'SETUP' },
  { id: 'accounts',   label: 'Accounts',   icon: Building2,       path: '/accounts' },
  { id: 'profile',    label: 'Profile',    icon: User,            path: '/profile' },
];

function isSection(entry: NavEntry): entry is NavSection {
  return 'section' in entry;
}

interface SidebarProps {
  onNewPlan?: () => void;
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout } = useAuth();
  const { openChat } = useChatStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [userMenuOpen]);

  const isActive = (path: string) => {
    if (path === '/') return location === '/';
    return location.startsWith(path);
  };

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';

  return (
    <aside
      className={cn('w-full h-full flex flex-col', className)}
      style={{ background: 'var(--lf-cream)', borderRight: '1px solid var(--lf-rule)' }}
    >
      {/* Brand */}
      <div style={{ padding: '24px 16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px' }}>
          <div className="lf-mark">
            <span /><span /><span />
          </div>
          <span style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 20, color: 'var(--lf-ink)', letterSpacing: '-0.01em',
          }}>
            Lasagna<em style={{ fontStyle: 'italic', color: 'var(--lf-sauce)' }}>Fi</em>
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '0 12px', overflowY: 'auto' }} className="scrollbar-thin">
        {NAV.map((entry, i) => {
          if (isSection(entry)) {
            return (
              <div key={i} style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: 'var(--lf-muted)',
                padding: '0 8px', margin: '20px 0 8px',
              }}>
                {entry.section}
              </div>
            );
          }

          const active = isActive(entry.path);
          return (
            <NavButton
              key={entry.id}
              active={active}
              icon={entry.icon}
              label={entry.label}
              onClick={() => navigate(entry.path)}
            />
          );
        })}

        {/* AI Chat button */}
        <NavButton
          active={false}
          icon={MessageSquare}
          label="AI Chat"
          onClick={() => openChat()}
        />
      </nav>

      {/* Account chip */}
      <div style={{ padding: '12px 16px', position: 'relative' }} ref={userMenuRef}>
        <AnimatePresence>
          {userMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'absolute', bottom: '100%', left: 16, right: 16,
                marginBottom: 6,
                background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)',
                borderRadius: 10, overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(31,26,22,0.12)',
                zIndex: 50,
              }}
            >
              {[
                { label: 'Accounts', path: '/accounts' },
                { label: 'Profile', path: '/profile' },
              ].map(({ label, path }, i) => (
                <MenuButton
                  key={path}
                  label={label}
                  borderTop={i > 0}
                  onClick={() => { setUserMenuOpen(false); navigate(path); }}
                />
              ))}
              <MenuButton
                label="Sign out"
                borderTop
                danger
                onClick={() => { setUserMenuOpen(false); logout(); }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          aria-haspopup="menu"
          aria-expanded={userMenuOpen}
          style={{
            width: '100%', background: 'var(--lf-paper)',
            border: '1px solid var(--lf-rule)', borderRadius: 10,
            padding: 14, display: 'flex', alignItems: 'center',
            gap: 10, cursor: 'pointer',
          }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--lf-sauce)', color: 'var(--lf-paper)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 14, flexShrink: 0,
          }}>
            {initial}
          </div>
          <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
            <div style={{
              fontWeight: 500, color: 'var(--lf-ink)', fontSize: 13,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: "'Geist', system-ui, sans-serif",
            }}>
              {firstName}
            </div>
            <div style={{ color: 'var(--lf-muted)', fontSize: 13, marginTop: 1, fontFamily: "'JetBrains Mono', monospace" }}>
              {tenant?.plan === 'pro' ? 'pro plan' : 'self-hosted'} · sync ✓
            </div>
          </div>
          <span style={{
            color: 'var(--lf-muted)', fontSize: 13,
            transform: userMenuOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
            display: 'inline-block',
          }}>▾</span>
        </button>
      </div>
    </aside>
  );
}

function NavButton({ active, icon: Icon, label, onClick }: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', textAlign: 'left',
        padding: '9px 12px', borderRadius: 8,
        marginBottom: 2, border: 0, cursor: 'pointer',
        fontSize: 14, fontFamily: "'Geist', system-ui, sans-serif",
        background: active ? 'var(--lf-ink)' : hovered ? 'var(--lf-cream-deep)' : 'transparent',
        color: active ? 'var(--lf-paper)' : 'var(--lf-ink-soft)',
        transition: 'background 0.1s',
      }}
    >
      <Icon
        size={15}
        style={{
          flexShrink: 0,
          opacity: active ? 1 : 0.65,
          color: active ? 'var(--lf-cheese)' : 'currentColor',
        }}
      />
      <span style={{ flex: 1 }}>{label}</span>
    </motion.button>
  );
}

function MenuButton({ label, onClick, borderTop, danger }: {
  label: string;
  onClick: () => void;
  borderTop?: boolean;
  danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', textAlign: 'left', padding: '10px 14px',
        fontSize: 13, border: 0,
        borderTop: borderTop ? '1px solid var(--lf-rule)' : 'none',
        background: hovered ? 'var(--lf-cream)' : 'transparent',
        cursor: 'pointer',
        color: danger ? 'var(--lf-sauce)' : 'var(--lf-ink-soft)',
        fontFamily: "'Geist', system-ui, sans-serif",
        transition: 'background 0.1s',
      }}
    >
      {label}
    </button>
  );
}
