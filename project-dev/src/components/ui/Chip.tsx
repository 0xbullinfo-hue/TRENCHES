import React from 'react';
import { cn } from './cn';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export const Chip: React.FC<ChipProps> = ({
  active = false,
  className,
  children,
  type = 'button',
  ...props
}) => {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-2xs font-semibold uppercase tracking-[0.06em] transition-colors duration-150 select-none shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        active
          ? 'border-brand bg-brand-bg text-brand hover:text-brand-hover'
          : 'border-border-default bg-surface-card text-muted hover:text-ink',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};
