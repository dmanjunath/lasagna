import { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}

/**
 * Page-level header. Every page should start with one. Provides the
 * h1 + optional lede + actions row in a consistent layout
 * with a bottom hairline rule.
 */
export function PageHeader({ title, lede, actions }: PageHeaderProps) {
  return (
    <header className="ds-page-header">
      <div className="ds-page-header__title-block">
        <h1 className="ds-h1">{title}</h1>
        {lede && <p className="ds-page-header__lede">{lede}</p>}
      </div>
      {actions && <div className="ds-page-header__actions">{actions}</div>}
    </header>
  );
}
