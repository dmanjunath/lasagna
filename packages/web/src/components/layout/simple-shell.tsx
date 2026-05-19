import { type ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../../lib/auth';
import { AppHeader } from './app-header';

export type SimpleTab = 'home' | 'money' | 'chat' | 'goals';

interface SimpleShellProps {
  children: ReactNode;
  title: string;
  /** Highlight a tab in the bottom nav. Bottom nav renders on every Simple
   *  page regardless — pass `undefined` and no pill will be highlighted
   *  (e.g. /profile, /accounts, /s/action, which aren't themselves tabs). */
  activeTab?: SimpleTab;
  /** When true, replace hamburger with back arrow (history.back). The bottom
   *  nav still renders — back nav and tab nav coexist. */
  showBack?: boolean;
  /** Extra content docked above the bottom nav (e.g., chat composer,
   *  detail-page sticky CTA). Stacks ABOVE the nav. */
  bottomDock?: ReactNode;
  /** Suppress the bottom nav entirely. Reserved for full-bleed flows; not
   *  used by any current page. */
  hideNav?: boolean;
}

export function SimpleShell({ children, title, activeTab, showBack, bottomDock, hideNav }: SimpleShellProps) {
  const [location, setLocation] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user, tenant, logout } = useAuth();

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [location]);

  const displayName = user?.name || tenant?.name || user?.email?.split('@')[0] || 'there';
  const avatarLetter = (displayName[0] || '?').toUpperCase();

  return (
    <div className="min-h-screen bg-bg text-text">
      <AppHeader
        variant="simple"
        title={title}
        leadingSlot={
          showBack ? (
            <button
              onClick={() => window.history.back()}
              className="w-11 h-11 grid place-items-center rounded-full hover:bg-bg-elevated text-lg"
              aria-label="Back"
            >
              ←
            </button>
          ) : (
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-11 h-11 grid place-items-center rounded-full hover:bg-bg-elevated text-lg"
              aria-label="Open menu"
            >
              ☰
            </button>
          )
        }
      />

      {/* Page content. pt offset = notch + 44px header + 16px breathing room.
          pb-28 leaves room for the bottom nav + safe area. The previous
          double-wrapper (pt-12 outside, pt-5 inside) was hard to reason about
          and produced inconsistent vertical rhythm across pages. */}
      <div className="max-w-md mx-auto px-4 pb-28 min-h-screen pt-[calc(env(safe-area-inset-top)+72px)]">
        {children}
      </div>

      {/* Fixed bottom dock — composer / sticky CTA (if any) sits ABOVE the
          nav. Bottom nav renders on every Simple page so the user always has
          a way out, even from non-tab pages like /profile and /s/action. */}
      {(!hideNav || bottomDock) && (
        <div className="fixed bottom-0 inset-x-0 z-30 max-w-md mx-auto">
          {bottomDock}
          {!hideNav && (
            <nav className="bg-bg/95 backdrop-blur border-t border-rule/60 pb-[env(safe-area-inset-bottom)]">
              <div className="grid grid-cols-4">
                <NavTab href="/s" icon="🏠" label="Home" active={activeTab === 'home'} />
                <NavTab href="/s/money" icon="💰" label="Money" active={activeTab === 'money'} />
                <NavTab href="/s/chat" icon="💬" label="Chat" active={activeTab === 'chat'} />
                <NavTab href="/s/goals" icon="🎯" label="Goals" active={activeTab === 'goals'} />
              </div>
            </nav>
          )}
        </div>
      )}

      {/* Drawer + dim overlay. Stacks ABOVE header (z-30) and bottom nav
          (z-30) so the user can't interact with chrome while it's open. */}
      {drawerOpen && (
        <>
          <button
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-black/50 z-40 animate-overlay-in"
            aria-label="Close menu"
          />
          {/* Single scrolling column — no fixed header/footer chrome inside
              the drawer. The page's top-bar X handles dismiss; bottom-anchored
              sign-out is just the last item in the list. Tap-outside or the
              top-bar hamburger toggles the drawer. */}
          <aside className="fixed top-0 left-0 bottom-0 w-[88%] max-w-[360px] bg-bg shadow-2xl overflow-y-auto z-50 animate-drawer-in">
            <div className="px-3 pt-[calc(env(safe-area-inset-top)+12px)] pb-[calc(env(safe-area-inset-bottom)+12px)] space-y-1">
              {/* Profile card */}
              <Link
                href="/profile"
                className="flex items-center gap-3 p-4 mb-5 bg-bg-elevated rounded-2xl border border-rule hover:border-accent/30 transition"
              >
                <div className="w-14 h-14 rounded-full bg-accent grid place-items-center text-xl font-serif font-medium text-white shrink-0 shadow-sm">
                  {avatarLetter}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-base font-serif font-medium leading-tight">{displayName}</div>
                  <div className="text-xs text-text-muted mt-1">View profile & settings</div>
                </div>
                <div className="text-text-muted">›</div>
              </Link>

              <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted px-3 pt-1 pb-2">
                Tabs
              </div>
              <DrawerLink href="/s" icon="🏠" label="Home" active={activeTab === 'home'} />
              <DrawerLink href="/s/money" icon="💰" label="Money" active={activeTab === 'money'} />
              <DrawerLink href="/s/chat" icon="💬" label="Chat" active={activeTab === 'chat'} />
              <DrawerLink href="/s/goals" icon="🎯" label="Goals" active={activeTab === 'goals'} />

              <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted px-3 pt-4 pb-2">
                Account
              </div>
              <DrawerLink href="/profile" icon="👤" label="Profile &amp; settings" />

              <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted px-3 pt-4 pb-2">
                Help
              </div>
              <a
                href="https://lasagnafi.com/help"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 p-3 hover:bg-bg-elevated rounded-xl text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-bg-elevated grid place-items-center text-base">❓</div>
                <div className="flex-1">
                  <div className="text-sm font-medium">Help &amp; FAQ</div>
                </div>
                <div className="text-text-muted">›</div>
              </a>

              <button
                onClick={async () => {
                  await logout();
                  setLocation('/');
                }}
                className="w-full flex items-center gap-3 p-3 mt-4 hover:bg-bg-elevated rounded-xl text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-bg-elevated grid place-items-center text-base">👋</div>
                <div className="text-sm font-medium text-text-secondary">Sign out</div>
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function DrawerLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`w-full flex items-center gap-3 p-3 rounded-xl hover:bg-bg-elevated text-left ${
        active ? 'bg-bg-elevated' : ''
      }`}
    >
      <div className="w-9 h-9 rounded-xl bg-bg-elevated grid place-items-center text-base">{icon}</div>
      <div className="flex-1">
        <div className={`text-sm ${active ? 'font-semibold text-accent' : 'font-medium'}`}>
          <span dangerouslySetInnerHTML={{ __html: label }} />
        </div>
      </div>
      <div className="text-text-muted">›</div>
    </Link>
  );
}

function NavTab({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`pt-2.5 pb-2 flex flex-col items-center gap-1 min-h-[56px] ${
        active ? 'text-accent font-medium' : 'text-text-muted'
      }`}
    >
      <span className="text-[17px] leading-none">{icon}</span>
      <span className="text-[10px] leading-none tracking-wide">{label}</span>
    </Link>
  );
}
