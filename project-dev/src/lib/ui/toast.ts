'use client';

import { toast as sonnerToast, type ExternalToast } from 'sonner';
import { SOLSCAN } from '@/lib/config';

/**
 * Project-wide toast notification wrapper backed by `sonner`.
 */
export const toast = {
  success(message: string, options?: ExternalToast): string | number {
    return sonnerToast.success(message, options);
  },

  error(message: string, options?: ExternalToast): string | number {
    return sonnerToast.error(message, options);
  },

  info(message: string, options?: ExternalToast): string | number {
    return sonnerToast.info(message, options);
  },

  loading(message: string, options?: ExternalToast): string | number {
    return sonnerToast.loading(message, options);
  },

  dismiss(toastId?: string | number): string | number {
    return sonnerToast.dismiss(toastId);
  },

  promise: sonnerToast.promise,

  /**
   * Displays a transaction confirmation toast with an external Solscan explorer link.
   */
  txSuccess(title: string, signature: string, description?: string): string | number {
    const txUrl = SOLSCAN.tx(signature);
    return sonnerToast.success(title, {
      description,
      action: {
        label: 'Solscan',
        onClick: () => {
          if (typeof window !== 'undefined') {
            window.open(txUrl, '_blank', 'noopener,noreferrer');
          }
        },
      },
    });
  },
};
