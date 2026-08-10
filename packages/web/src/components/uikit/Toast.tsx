import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastTone = 'info' | 'positive' | 'caution' | 'negative';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: ReactNode;
  description?: ReactNode;
}

interface ToastInput {
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  duration?: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const icons: Record<ToastTone, ReactNode> = {
  info: <Info className="h-5 w-5 text-info" />,
  positive: <CheckCircle2 className="h-5 w-5 text-positive" />,
  caution: <AlertTriangle className="h-5 w-5 text-caution" />,
  negative: <XCircle className="h-5 w-5 text-negative" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, tone: input.tone ?? 'info', title: input.title, description: input.description }]);
      const duration = input.duration ?? 4000;
      window.setTimeout(() => remove(id), duration);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
            {toasts.map((t) => (
              <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-ui-md border border-line bg-panel-raised px-4 py-3 shadow-ui-lg',
        'transition-all duration-200 ease-ui',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icons[toast.tone]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-content">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-[13px] leading-relaxed text-content-muted">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="ui-focus -mr-1 -mt-0.5 rounded-ui-sm p-1 text-content-muted hover:text-content"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
