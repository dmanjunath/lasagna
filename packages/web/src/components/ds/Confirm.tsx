import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';

interface ConfirmOptions {
  title: string;
  /** Body copy. Should explicitly name what's destroyed and what's kept. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in sauce — for delete / disconnect actions. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface DialogState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * App-level confirmation dialog. Replaces `window.confirm()` with a styled
 * editorial modal so destructive actions match the rest of the UI and can
 * (a) name what's being destroyed and (b) name what's kept. Wrap the app
 * once with <ConfirmProvider>; consume via const confirm = useConfirm().
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const handleClose = useCallback((ok: boolean) => {
    if (!state) return;
    state.resolve(ok);
    setState(null);
  }, [state]);

  // On open, focus Cancel for destructive actions so a reflexive Enter/Space
  // doesn't confirm a delete; non-destructive dialogs still focus the primary
  // action. Escape cancels; that's the universal mental model. Tab cycles
  // between the two buttons instead of escaping into the page behind the
  // overlay, and focus returns to whatever opened the dialog on close.
  useEffect(() => {
    if (!state) return;
    const opener = document.activeElement as HTMLElement | null;
    if (state.destructive) cancelBtnRef.current?.focus();
    else confirmBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const stops = [cancelBtnRef.current, confirmBtnRef.current].filter(
        (b): b is HTMLButtonElement => b !== null,
      );
      if (stops.length === 0) return;
      const i = stops.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey
        ? stops[(i <= 0 ? stops.length : i) - 1]
        : stops[(i + 1) % stops.length];
      e.preventDefault();
      next.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) {
        opener.focus();
        return;
      }
      // A confirmed delete unmounts its own opener, which drops focus to
      // <body> and restarts keyboard users at the top of the page. Land on the
      // main region instead so the next Tab continues from the content.
      const main = document.querySelector('main');
      if (!main) return;
      const hadTabIndex = main.hasAttribute('tabindex');
      if (!hadTabIndex) main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
      if (!hadTabIndex) main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
    };
  }, [state, handleClose]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="ds-confirm__backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ds-confirm-title"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(false); }}
        >
          <div className="ds-confirm">
            <h3 id="ds-confirm-title" className="ds-confirm__title">{state.title}</h3>
            {state.body && <div className="ds-confirm__body">{state.body}</div>}
            <div className="ds-confirm__actions">
              <button
                ref={cancelBtnRef}
                type="button"
                onClick={() => handleClose(false)}
                className="ds-btn ds-btn--ghost"
              >
                {state.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => handleClose(true)}
                className={state.destructive ? 'ds-btn ds-btn--danger' : 'ds-btn ds-btn--primary'}
              >
                {state.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}
