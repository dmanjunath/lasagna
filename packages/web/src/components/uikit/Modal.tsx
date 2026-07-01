import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

/**
 * Modal / Sheet — a focused overlay surface. `variant="center"` is a classic
 * dialog; `variant="sheet"` slides in from the right on desktop and up from the
 * bottom on mobile. Escape and overlay-click close it; body scroll is locked.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'center',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: 'center' | 'sheet';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const panel =
    variant === 'sheet'
      ? 'fixed inset-y-0 right-0 w-full max-w-md rounded-none border-l sm:rounded-l-ui-xl [animation:ui-slide-right_220ms_cubic-bezier(0.22,1,0.36,1)] max-sm:inset-x-0 max-sm:inset-y-auto max-sm:bottom-0 max-sm:max-w-none max-sm:rounded-t-ui-xl max-sm:border-l-0 max-sm:border-t max-sm:[animation:ui-slide-up_220ms_cubic-bezier(0.22,1,0.36,1)]'
      : 'fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-ui-lg border [animation:ui-scale-in_180ms_cubic-bezier(0.22,1,0.36,1)]';

  return createPortal(
    <div className="ui-root fixed inset-0 z-[90]">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] [animation:ui-fade-in_160ms_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn('flex flex-col border-line bg-panel-raised shadow-ui-xl', panel)}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
            <div className="min-w-0">
              {title && <h2 className="text-[18px] font-semibold text-content">{title}</h2>}
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
      </div>
    </div>,
    document.body,
  );
}
