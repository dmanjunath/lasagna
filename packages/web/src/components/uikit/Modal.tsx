import { useEffect, useRef, type ReactNode } from 'react';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { createPortal } from 'react-dom';
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import { ChevronLeft, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

/**
 * Modal / Sheet — a focused overlay surface. On phones (≤639px) BOTH variants
 * render as a full-height slide-up tray docked to the bottom edge, so the panel
 * uses the whole width, gives inputs room above the keyboard, and can be
 * swiped down to dismiss — modals are a poor use of a small screen. On desktop,
 * `variant="center"` is a classic centered dialog and `variant="sheet"` slides
 * in from the right. Escape and overlay-click close it; body scroll is locked.
 */
export function Modal({
  open,
  onClose,
  onBack,
  title,
  description,
  children,
  footer,
  variant = 'center',
  stableTop = false,
  stableTopOnPhone = false,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Multi-step dialogs only: renders Back in the header, left of the title.
   * Pass `null` on the first step to hold the slot open, so the title doesn't
   * shift sideways the moment Back appears.
   */
  onBack?: (() => void) | null;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: 'center' | 'sheet';
  /**
   * Opt in when the content changes height while it's open (a form that appends
   * fields as you answer). The panel's top edge stays put and the new fields
   * append downward, instead of a centred panel sliding everything already
   * filled in upwards. Ignored by `variant="sheet"`, which is already anchored.
   */
  stableTop?: boolean;
  /**
   * The phone half of `stableTop`, opt in separately because it costs more: a
   * bottom-docked tray can only hold its top edge by taking a fixed height up
   * front, which on content that can't grow leaves an empty sheet above the
   * footer. Pass it only while the step on screen is the one that grows.
   */
  stableTopOnPhone?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Swipe-to-dismiss for the mobile bottom sheet: drag starts only from the
  // grab handle / header (not the scrollable body) via dragControls.
  const dragControls = useDragControls();
  const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
  // On a phone every variant is a bottom tray, so all are swipe-to-dismiss.
  const swipeable = isPhone;

  useBodyScrollLock(open);

  // Close, Escape, the overlay, the swipe and the footer's own Cancel all stay
  // live while a submit is in flight. Holding some of them shut and not the rest
  // is worse than holding none, and holding all of them would strand the user
  // behind a request that never answers.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Focus management: move focus into the dialog on open (unless a child's
  // autoFocus already did), trap Tab inside it, and restore focus on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [...(panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((el) => !el.hasAttribute('disabled'));
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
      // Prefer the first control after the header's own buttons — Back (when
      // present) then Close — so focus lands in the dialog's content, never on
      // the control that leaves it.
      const els = focusables();
      (els[onBack ? 2 : 1] ?? els[0])?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open, onBack]);

  if (!open || typeof document === 'undefined') return null;

  // Shared phone treatment: a bottom-docked tray spanning the full width, up to
  // ~92% of the viewport tall (its content scrolls internally), rounded only at
  // the top, sliding up from the bottom edge.
  // `stableTopOnPhone` takes that full height up front instead of growing into
  // it, since a bottom-docked panel that grows moves its own top edge (and
  // everything already answered) up the screen. It's per-step, not per-dialog:
  // content that can't grow would just get an empty sheet above its footer.
  const phoneTray =
    'max-sm:inset-x-0 max-sm:inset-y-auto max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-ui-xl max-sm:border-x-0 max-sm:border-b-0 max-sm:border-t max-sm:max-h-[92dvh] max-sm:[animation:ui-slide-up_220ms_cubic-bezier(0.22,1,0.36,1)]' +
    (stableTopOnPhone ? ' max-sm:h-[92dvh]' : '');
  // `stableTop`: on desktop, pin the top edge with a fixed offset instead of
  // centring, so growing content can only push downward. Each placement needs
  // its own entrance, since the keyframes carry the centring transform the panel
  // is holding.
  const placement = stableTop
    ? 'top-[max(2rem,7vh)] max-h-[calc(100dvh-max(4rem,14vh))] [animation:ui-scale-in-top_180ms_cubic-bezier(0.22,1,0.36,1)]'
    : 'top-1/2 -translate-y-1/2 max-h-[calc(100dvh-2rem)] [animation:ui-scale-in_180ms_cubic-bezier(0.22,1,0.36,1)]';
  const panel =
    variant === 'sheet'
      ? `fixed inset-y-0 right-0 w-full max-w-md rounded-none border-l sm:rounded-l-ui-xl [animation:ui-slide-right_220ms_cubic-bezier(0.22,1,0.36,1)] ${phoneTray}`
      : `fixed left-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-ui-lg border ${placement} ${phoneTray}`;

  return createPortal(
    // ui-root lives on the PANEL, not this wrapper: .ui-root paints an opaque
    // canvas background, which on a fixed inset-0 wrapper covers the entire
    // page and makes it "disappear" behind the backdrop.
    <div className="fixed inset-0 z-[90]">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] [animation:ui-fade-in_160ms_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        drag={swipeable ? 'y' : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.9 }}
        onDragEnd={(_e, info: PanInfo) => {
          if (info.offset.y > 96 || info.velocity.y > 600) onClose();
        }}
        className={cn('ui-root flex flex-col border-line bg-panel-raised shadow-ui-xl', panel)}
        // .ui-root's canvas background out-specifies bg-panel-raised in the
        // compiled CSS order; the inline style keeps the panel raised-white.
        style={{ backgroundColor: 'rgb(var(--ui-panel-raised))' }}
      >
        {swipeable && (
          <div
            className="flex justify-center pt-2.5 pb-1 touch-none cursor-grab"
            onPointerDown={(e) => dragControls.start(e)}
          >
            <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
          </div>
        )}
        {(title || description) && (
          <div
            className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6"
            onPointerDown={swipeable ? (e) => dragControls.start(e) : undefined}
          >
            {onBack !== undefined && (
              // Icon-only, sized to mirror Close: the slot is reserved on every
              // step, so the title keeps its x, and an empty 36px gutter reads as
              // the pair of Close rather than as a title indented by nothing.
              // `null` renders it invisible and disabled, so it can't be tabbed to.
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack ?? undefined}
                disabled={!onBack}
                aria-label="Back"
                aria-hidden={!onBack || undefined}
                className={cn('-ml-2 -mt-2 h-9 w-9 min-h-0 min-w-0 shrink-0', !onBack && 'invisible')}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="min-w-0 flex-1">
              {title && <h2 className="truncate text-[18px] font-semibold text-content">{title}</h2>}
              {description && (
                <p className="mt-1 text-[13px] leading-relaxed text-content-muted">{description}</p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2 -mt-2 h-9 w-9 min-h-0 min-w-0">
              <X className="h-5 w-5" />
            </Button>
          </div>
        )}
        {children && <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line p-4 sm:px-6">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
