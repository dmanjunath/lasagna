import { ArrowRight } from 'lucide-react';

interface ActionsFooterProps {
  actions: string[];
}

export function ActionsFooter({ actions }: ActionsFooterProps) {
  if (!actions.length) return null;

  return (
    <div
      data-testid="actions-footer"
      className="relative overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7"
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--ui-accent))]" aria-hidden />
      <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--ui-accent-ink))]">
        Recommended next steps
      </h3>
      <ul className="space-y-3">
        {actions.map((action, i) => (
          <li key={i} className="flex items-start gap-3">
            <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-[rgb(var(--ui-accent-ink))]" />
            <span className="text-[14.5px] leading-relaxed text-content-secondary">{action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
