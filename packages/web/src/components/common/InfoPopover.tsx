import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, type LucideIcon } from 'lucide-react';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { cn } from '../../lib/utils';

// Info popover for a label. A small tap/click toggle (not hover-only, so it
// works on touch) rendered into a portal to escape the hero's overflow, closing
// on outside-click or Escape. Label is a screen-reader question for the metric.
export function InfoPopover({ label, icon: Icon = Info, triggerClassName, iconClassName, children }: {
  label: string;
  /** The trigger glyph. Info by default; onboarding's "why we ask" uses a question mark. */
  icon?: LucideIcon;
  /** Size and colour overrides for the trigger and its glyph. */
  triggerClassName?: string;
  iconClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useBodyScrollLock(open);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Links the portalled panel back to its trigger. Without it a screen reader
  // heard "expanded" from aria-expanded and then found nothing: the panel is a
  // role="tooltip" rendered into <body>, not a disclosure region inside the
  // button, so aria-expanded was describing a relationship that did not exist.
  const panelId = useId();
  const PANEL_W = 260;
  const GAP = 6;
  // Matches the page gutter on phones, so the panel lines up with the content.
  const EDGE = 16;

  // Placed in two passes: the panel first renders hidden so its height can be
  // measured, then opens below the trigger, or above it when below would run
  // past the trigger's scroll area (on onboarding that ends at the pinned
  // footer) or off the screen.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;
    const trigger = triggerRef.current;
    const r = trigger.getBoundingClientRect();
    let box: HTMLElement | null = trigger.parentElement;
    while (box && box !== document.body) {
      const oy = getComputedStyle(box).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight) break;
      box = box.parentElement;
    }
    const area = box && box !== document.body
      ? box.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    const h = panelRef.current.offsetHeight;
    const below = r.bottom + GAP;
    const fitsBelow = below + h <= Math.min(area.bottom, window.innerHeight) - EDGE / 2;
    const top = fitsBelow ? below : Math.max(area.top + EDGE / 2, r.top - GAP - h);
    const minLeft = Math.max(area.left, 0) + EDGE;
    const maxLeft = Math.min(area.right, window.innerWidth) - PANEL_W - EDGE;
    setPos({ top, left: Math.max(minLeft, Math.min(r.left, maxLeft)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    const onReflow = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={label}
        aria-describedby={open ? panelId : undefined}
        /* 20x20 is under the 44px touch minimum, and one of these is now the
           hero's primary explainer. The pseudo-element widens the hit area on
           phones only, leaving the rendered icon exactly where it was — same
           idiom as the transactions filter triggers. */
        className={cn("ui-focus relative inline-flex items-center justify-center h-5 w-5 rounded-ui-sm text-content-muted hover:text-content hover:bg-canvas-sunken transition-colors max-sm:before:absolute max-sm:before:-inset-3 max-sm:before:content-['']", triggerClassName)}
      >
        <Icon className={cn("h-[13px] w-[13px]", iconClassName)} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="tooltip"
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, width: PANEL_W, visibility: pos ? undefined : 'hidden' }}
          className="ui-root z-[110] rounded-ui-md border border-line bg-panel-raised px-3 py-2.5 text-[12px] leading-[1.5] font-medium text-content-secondary shadow-ui-lg"
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
