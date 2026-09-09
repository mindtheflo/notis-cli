import * as React from 'react';
import { CaretDown } from '@phosphor-icons/react';

import { cn } from '@/lib/utils';

// Borderless native select: a tinted pill with a caret. Keeps the platform
// dropdown (no portal needed inside the app surface) and the portal focus ring.
const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <span className={cn('relative inline-flex', className)}>
      <select
        ref={ref}
        className="h-9 w-full appearance-none rounded-md bg-muted pl-3 pr-8 text-sm text-foreground outline-hidden transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        {...props}
      >
        {children}
      </select>
      <CaretDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  ),
);
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
