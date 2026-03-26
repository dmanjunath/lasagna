import { ArrowRight } from 'lucide-react';

interface ActionsFooterProps {
  actions: string[];
}

export function ActionsFooter({ actions }: ActionsFooterProps) {
  if (!actions.length) return null;

  return (
    <div data-testid="actions-footer" className="mt-8 p-6 rounded-2xl bg-gradient-to-b from-[#141416] to-[#0f0f11] border border-accent/10">
      <h3 className="text-sm font-semibold text-accent uppercase tracking-wider mb-4">
        Recommended Next Steps
      </h3>
      <ul className="space-y-3">
        {actions.map((action, i) => (
          <li key={i} className="flex items-start gap-3">
            <ArrowRight className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
            <span className="text-[#c5c5c5]">{action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
