import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

type AlertTone = 'info' | 'positive' | 'caution' | 'negative';

const toneMap: Record<AlertTone, { wrap: string; icon: ReactNode }> = {
  info: { wrap: 'bg-info-soft text-content border-info/30', icon: <Info className="h-5 w-5 text-info" /> },
  positive: {
    wrap: 'bg-positive-soft text-content border-positive/30',
    icon: <CheckCircle2 className="h-5 w-5 text-positive" />,
  },
  caution: {
    wrap: 'bg-caution-soft text-content border-caution/30',
    icon: <AlertTriangle className="h-5 w-5 text-caution" />,
  },
  negative: {
    wrap: 'bg-negative-soft text-content border-negative/30',
    icon: <XCircle className="h-5 w-5 text-negative" />,
  },
};

/**
 * Alert — an inline, persistent message. Pairs a tinted background with an icon
 * so meaning never rides on color alone.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = toneMap[tone];
  return (
    <div
      role="status"
      className={cn('flex items-start gap-3 rounded-ui-md border px-4 py-3', t.wrap, className)}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {t.icon}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-[14px] font-semibold text-content">{title}</p>}
        {children && (
          <div className={cn('text-[13px] leading-relaxed text-content-secondary', title && 'mt-0.5')}>
            {children}
          </div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
