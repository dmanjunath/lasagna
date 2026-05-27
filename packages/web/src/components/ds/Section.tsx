import { ReactNode } from 'react';

interface SectionProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Major section of a page. Renders an h2 + eyebrow + actions row, then content.
 * Use inside <Page>. For sub-cards within a section, use <Card> directly.
 */
export function Section({ title, eyebrow, actions, children, className }: SectionProps) {
  const hasHeader = Boolean(title || eyebrow || actions);
  return (
    <section className={`ds-section ${className ?? ''}`}>
      {hasHeader && (
        <div className="ds-section__header">
          <div className="ds-section__title-block">
            {eyebrow && <div className="ds-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
            {title && <h2 className="ds-h2">{title}</h2>}
          </div>
          {actions && <div className="ds-section__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
