'use client';

import React, { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface StakeSuccessToastProps {
  message?: string;
  onClose: () => void;
}

export function StakeSuccessToast({
  message = 'Stake confirmed. Pro access unlocked.',
  onClose,
}: StakeSuccessToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg bg-surface border border-brand text-white shadow-none animate-in slide-in-from-bottom-5 duration-150">
      <CheckCircle2 className="w-5 h-5 text-brand shrink-0" />
      <span className="font-sans text-sm font-semibold">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 text-muted hover:text-white transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

