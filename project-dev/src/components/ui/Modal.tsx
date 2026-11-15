import React, { useEffect, useRef } from 'react';
import { cn } from './cn';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  titleId?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const candidates = container.querySelectorAll(
    'button, a, input, select, textarea, [tabindex]'
  );
  return Array.from(candidates).filter((el) => {
    const disabled = el.getAttribute('disabled') !== null || (el as unknown as { disabled?: boolean }).disabled;
    const tabIndex = el.getAttribute('tabindex');
    const isHidden = el.getAttribute('aria-hidden') === 'true';
    if (disabled || isHidden || tabIndex === '-1') return false;
    return true;
  }) as HTMLElement[];
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  titleId,
  ariaLabel,
  children,
  className,
  containerClassName,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (typeof document !== 'undefined' && document.activeElement) {
        previouslyFocusedElement.current = document.activeElement as HTMLElement;
      }

      // Move focus into modal
      const timer = setTimeout(() => {
        if (modalRef.current) {
          const focusable = getFocusableElements(modalRef.current);
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            modalRef.current.focus();
          }
        }
      }, 0);

      return () => {
        clearTimeout(timer);
        if (previouslyFocusedElement.current && typeof previouslyFocusedElement.current.focus === 'function') {
          previouslyFocusedElement.current.focus();
        }
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusables = getFocusableElements(modalRef.current);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === modalRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label="Close modal overlay"
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-sm',
        containerClassName
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-lg rounded-xl border border-border-default bg-surface p-6 shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
};
