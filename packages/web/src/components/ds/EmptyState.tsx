import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  cta?: ReactNode;
}

export function EmptyState({ icon, title, body, cta }: EmptyStateProps) {
  return (
    <div className="ds-empty">
      {icon && <div className="ds-empty__icon">{icon}</div>}
      <h3 className="ds-empty__title">{title}</h3>
      {body && <p className="ds-empty__body">{body}</p>}
      {cta}
    </div>
  );
}
