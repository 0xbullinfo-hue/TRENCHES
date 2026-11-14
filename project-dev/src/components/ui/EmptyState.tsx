import React from 'react';
import { cn } from './cn';
import { Button } from './Button';

export interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  actionLabel,
  onAction,
  className,
  icon,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-8 text-center rounded-xl border border-border-default bg-surface',
        className
      )}
    >
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-sans text-sm text-muted mb-4">{message}</p>
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
