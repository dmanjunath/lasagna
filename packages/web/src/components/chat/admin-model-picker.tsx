import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { getPreferredModel, setPreferredModel, type ChatModelOverride } from '../../lib/chat-store';
import { cn } from '../../lib/utils';

type Provider = { id: string; label: string; models: { id: string; label: string }[] };

/**
 * Admin-only control to pin the exact inference provider + model the chat uses,
 * overriding the default provider/tier. The choice is persisted in localStorage;
 * the server re-validates it and gates it to admins on every request. Renders
 * nothing for non-admins (or if no provider catalog is available).
 *
 * A custom dropdown (not a native <select>) so the open menu matches the design
 * system: it's portaled + fixed-positioned so the composer can't clip it, flips
 * upward near the viewport bottom, and closes on Escape / outside click / scroll.
 *
 * `variant="composer"` docks the trigger as a quiet footer control inside the
 * message composer (the default chat placement); `standalone` renders just it.
 */
export function AdminModelPicker({
  className,
  variant = 'standalone',
}: {
  className?: string;
  variant?: 'standalone' | 'composer';
}) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [catalog, setCatalog] = useState<Provider[]>([]);
  const [override, setOverride] = useState<ChatModelOverride | null>(() => getPreferredModel());
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!isAdmin) return;
    api.getChatModels().then(r => setCatalog(r.providers)).catch(() => { /* picker just won't show */ });
  }, [isAdmin]);

  useEffect(() => {
    if (!open) return;
    // Focus (and scroll to) the currently-selected option so opening with a
    // bottom-of-list pin lands on it, not on "Auto" at the top.
    const sel = menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    (sel ?? menuRef.current?.querySelector<HTMLElement>('button'))?.focus();
    sel?.scrollIntoView({ block: 'nearest' });
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) close();
    };
    // Close when the PAGE scrolls (the menu is fixed-positioned and would drift),
    // but not when the user scrolls the menu's OWN overflow — the capture-phase
    // listener sees that internal scroll too, and closing it would break scrolling.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!isAdmin || catalog.length === 0) return null;

  const pinned = !!override;
  const currentLabel = (() => {
    if (!override) return 'Auto (default)';
    const m = catalog.find(p => p.id === override.provider)?.models.find(m => m.id === override.model);
    return m ? m.label : override.model;
  })();

  const toggle = () => {
    if (open) { setPos(null); return; }
    const r = wrapRef.current!.getBoundingClientRect();
    const rows = 1 + catalog.reduce((n, p) => n + p.models.length, 0);
    const est = Math.min(320, rows * 34 + catalog.length * 26 + 10);
    const up = r.bottom + est + 8 > window.innerHeight;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, up });
  };

  const choose = (next: ChatModelOverride | null) => {
    setOverride(next);
    setPreferredModel(next);
    setPos(null);
  };

  const row = (label: string, selected: boolean, onSelect: () => void, key: string) => (
    <button
      key={key}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-4 rounded-ui-sm px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
        selected
          ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))] font-semibold'
          : 'text-content-secondary hover:bg-canvas-sunken',
      )}
    >
      <span className="truncate">{label}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
    </button>
  );

  const trigger = (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Chat model"
        title="Admin: pin an exact provider + model for the chat (overrides the default). Sail models have no web search."
        onClick={toggle}
        className={cn(
          'ui-focus flex h-6 max-sm:min-h-[44px] max-w-[220px] items-center gap-1 rounded-ui-sm px-1.5 text-[11px] font-medium transition-colors duration-150 ease-ui',
          pinned ? 'text-[rgb(var(--ui-brand-ink))]' : 'text-content-muted hover:text-content-secondary',
        )}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 transition-transform duration-150', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Chat model"
          style={{ top: pos.top, left: pos.left, transform: pos.up ? 'translateY(-100%)' : 'none' }}
          className="ui-root fixed z-[80] max-h-[320px] min-w-[208px] overflow-y-auto rounded-ui-md border border-line bg-panel-raised p-1 shadow-ui-xl"
        >
          {row('Auto (default)', !override, () => choose(null), 'auto')}
          {catalog.map(p => (
            <div key={p.id} className="mt-1 first:mt-0">
              <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-content-muted">
                {p.label}
              </div>
              {p.models.map(m => row(
                m.label,
                override?.provider === p.id && override?.model === m.id,
                () => choose({ provider: p.id, model: m.id }),
                `${p.id}::${m.id}`,
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );

  if (variant === 'composer') {
    return (
      <div className={cn('flex items-center border-t border-line px-2.5 py-1', className)}>
        {trigger}
      </div>
    );
  }

  return <div className={cn('w-fit', className)}>{trigger}</div>;
}
