import React, { forwardRef } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function getButtonClass({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  const base =
    'inline-flex items-center justify-center font-semibold rounded-lg transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

  const sizes: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-xs gap-2',
    lg: 'h-12 px-6 text-sm gap-2.5',
  };

  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand text-canvas hover:bg-brand-hover',
    secondary: 'border border-border-default bg-surface-card text-ink hover:border-brand hover:bg-surface-3',
    ghost: 'text-muted hover:bg-surface-card hover:text-ink',
    danger: 'bg-danger text-ink hover:bg-danger/85',
  };

  return cn(base, sizes[size], variants[variant], className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading ? true : undefined}
        className={getButtonClass({ variant, size, className })}
        {...props}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="animate-spin h-3.5 w-3.5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>{children}</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
