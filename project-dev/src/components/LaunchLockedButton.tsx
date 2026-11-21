import React from 'react';

/** Disabled stand-in for CTAs that are locked until launch. Pass sizing/layout classes only (no bg-/text-/hover: colours). */
export function LaunchLockedButton({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title="Available soon"
      className={`${className} bg-surface border border-border-default text-muted cursor-not-allowed opacity-75 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2`}
    >
      {children}
      <span className="sr-only">(available soon)</span>
    </button>
  );
}
