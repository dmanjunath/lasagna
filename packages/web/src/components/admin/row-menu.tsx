import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * ⋯ overflow menu for admin table rows. Rendered through a portal with fixed
 * positioning so the table's overflow container can't clip it; flips upward
 * near the bottom of the viewport. Closes on Escape, outside click, scroll,
 * or selection.
 */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  const toggle = () => {
    if (open) {
      setPos(null);
      return;
    }
    const r = wrapRef.current!.getBoundingClientRect();
    // Rough menu height: 36px per item, ~16px extra for two-line disabled items.
    const estHeight = items.length * 36 + items.filter((i) => i.disabled && i.disabledReason).length * 16 + 12;
    const up = r.bottom + estHeight + 8 > window.innerHeight;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left: r.right, up });
  };

  useEffect(() => {
    if (!open) return;
    // Move focus into the portaled menu (it lives at the end of <body>, so Tab
    // from the trigger would otherwise never reach it) and restore on close.
    const trigger = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector('button')?.focus();
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    // The menu is fixed-positioned — close rather than drift on any scroll.
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      trigger?.focus?.();
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="ui-focus touch-target grid place-items-center w-8 h-8 rounded-ui-sm text-content-muted hover:bg-canvas-sunken hover:text-content transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            // Portal events still bubble through the React tree to the wrapper's
            // stopPropagation, so row-click navigation stays shielded.
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, left: pos.left, transform: `translateX(-100%)${pos.up ? ' translateY(-100%)' : ''}` }}
            className="ui-root fixed z-[80] min-w-[190px] rounded-ui-md border border-line bg-panel-raised shadow-ui-xl py-1"
          >
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                type="button"
                // aria-disabled keeps the item focusable so keyboard/SR users can
                // still discover it (native `disabled` removes it from tab order).
                aria-disabled={it.disabled || undefined}
                onClick={() => { if (it.disabled) return; setPos(null); it.onSelect(); }}
                className={cn(
                  'w-full text-left px-3.5 py-2 text-[13px] font-medium transition-colors',
                  it.tone === 'danger' ? 'text-negative' : 'text-content',
                  it.disabled ? 'opacity-45 cursor-not-allowed' : 'hover:bg-canvas-sunken',
                )}
              >
                {it.label}
                {it.disabled && it.disabledReason && (
                  <span className="block text-[11px] font-normal text-content-muted mt-0.5">{it.disabledReason}</span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
