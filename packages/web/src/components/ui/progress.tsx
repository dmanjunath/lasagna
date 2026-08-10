import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../../lib/utils';

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { glow?: boolean }
>(({ className, value, glow, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-solid', className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        'h-full bg-gradient-to-r from-accent to-accent-dim rounded-full transition-all duration-700',
        glow && 'progress-glow'
      )}
      style={{ width: `${value || 0}%` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = 'Progress';

export { Progress };
