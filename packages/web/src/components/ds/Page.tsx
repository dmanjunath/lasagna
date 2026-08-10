import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface PageProps {
  children: ReactNode;
  width?: 'default' | 'narrow' | 'wide';
  className?: string;
}

export function Page({ children, width = 'default', className }: PageProps) {
  return (
    <div
      className={cn(
        'ds-page',
        width === 'narrow' && 'ds-page--narrow',
        width === 'wide' && 'ds-page--wide',
        className,
      )}
    >
      {children}
    </div>
  );
}
