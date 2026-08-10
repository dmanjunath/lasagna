const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/** Effective-plan chip, shared by the user list and the detail page so the two can't disagree. */
export function PlanChip({ planSource, compedUntil }: { planSource: 'paid' | 'comped' | 'demo' | 'free'; compedUntil: string | null }) {
  if (planSource === 'paid')
    return <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-bold bg-brand-soft text-[rgb(var(--ui-brand-ink))]">Paid</span>;
  if (planSource === 'comped')
    return (
      <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-bold ui-tnum bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]">
        Comped until {fmtDate(compedUntil)}
      </span>
    );
  if (planSource === 'demo')
    return <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-bold bg-canvas-sunken text-content-secondary">Demo</span>;
  return <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-bold bg-canvas-sunken text-content-muted">Free</span>;
}
