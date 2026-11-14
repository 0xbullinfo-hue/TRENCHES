import React from 'react';
import { cn } from './cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'alpha' | 'raid' | 'neutral' | 'danger';
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'default',
  children,
  ...props
}) => {
  const variants = {
    default: 'bg-surface-card border border-border-default text-ink',
    alpha: 'bg-surface-card border border-border-default text-ink',
    raid: 'bg-surface-card border border-border-default text-ink',
    neutral: 'bg-surface-card border border-border-default text-muted',
    danger: 'bg-surface-card border border-border-default text-danger',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold tracking-wide',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};
