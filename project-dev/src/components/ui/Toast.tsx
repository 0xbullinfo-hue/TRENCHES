import React from 'react';
import { cn } from './cn';

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export const Toast: React.FC<ToastProps> = ({ className, children, ...props }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
