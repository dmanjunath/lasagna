import { useEffect, useId, useRef, useState } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** When set, user must type this exact string to enable the confirm button.
   *  Use for high-stakes actions like delete-account. */
  typeToConfirm?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** Single styled confirm dialog used wherever Profile/Accounts needs to gate
 *  a destructive action. Replaces window.confirm so the styling, focus, and
 *  Escape handling are consistent. Typed-confirmation is opt-in via the
 *  `typeToConfirm` prop. */
export function ConfirmDialog({
  open,
  title,
  message,
  typeToConfirm,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const messageId = useId();

  // Reset typed text whenever the dialog opens
  useEffect(() => {
    if (open) {
      setTyped('');
      previouslyFocused.current = document.activeElement as HTMLElement;
      // Focus the cancel button by default for destructive flows (safer).
      requestAnimationFrame(() => {
        (destructive ? cancelRef.current : confirmRef.current)?.focus();
      });
    } else if (previouslyFocused.current) {
      // Return focus to the element that opened the dialog
      previouslyFocused.current.focus?.();
    }
  }, [open, destructive]);

  // Escape closes; Tab is trapped inside the dialog
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmDisabled =
    busy || (typeToConfirm !== undefined && typed.trim() !== typeToConfirm);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      role="presentation"
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/45 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${messageId}-title`}
        aria-describedby={messageId}
        className="w-full max-w-sm bg-bg-elevated border border-rule rounded-t-2xl sm:rounded-2xl shadow-xl p-5 flex flex-col gap-3"
      >
        <h2 id={`${messageId}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p id={messageId} className="text-sm text-text-secondary leading-relaxed">
          {message}
        </p>
        {typeToConfirm !== undefined && (
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted font-medium">
              Type <span className="font-mono normal-case tracking-normal">{typeToConfirm}</span> to confirm
            </label>
            <input
              type="text"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-lg bg-bg border border-rule px-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 min-h-[44px]"
            />
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl bg-bg border border-rule text-text-secondary py-3 text-sm font-medium min-h-[44px] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={() => void onConfirm()}
            disabled={confirmDisabled}
            className={`flex-1 rounded-xl py-3 text-sm font-medium min-h-[44px] disabled:opacity-50 ${
              destructive ? 'bg-accent text-white' : 'bg-text text-white'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
