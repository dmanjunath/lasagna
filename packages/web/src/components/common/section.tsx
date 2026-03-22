import { cn } from '../../lib/utils';

interface SectionProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Section({ title, actions, children, className }: SectionProps) {
  return (
    <div className={cn('mb-8', className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm uppercase tracking-wider text-text-secondary font-semibold">{title}</h3>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
