import { ReactNode } from 'react';

interface SectionProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Major section of a page. Renders an h2 + actions row, then content.
 * Use inside <Page>. For sub-cards within a section, use <Card> directly.
 */
export function Section({ title, actions, children, className }: SectionProps) {
  const hasHeader = Boolean(title || actions);
  return (
    <section className={`ds-section ${className ?? ''}`}>
      {hasHeader && (
        <div className="ds-section__header">
          <div className="ds-section__title-block">
            {title && <h2 className="ds-h2">{title}</h2>}
          </div>
          {actions && <div className="ds-section__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
