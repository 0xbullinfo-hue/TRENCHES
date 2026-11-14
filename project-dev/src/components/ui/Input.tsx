import React, { forwardRef } from 'react';
import { cn } from './cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'h-10 w-full rounded-lg border border-border-default bg-surface-card px-3 font-mono text-xs text-ink placeholder:text-dim focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand shadow-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
