'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { TelegramConnectButton } from './TelegramConnectButton';

const DISMISS_STORAGE_KEY = 'trench_tg_banner_dismissed';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface VerificationStatus {
  tier: 'free' | 'member' | 'pro';
  telegram: {
    connected: boolean;
  };
}

export function TelegramStatusBanner() {
  const pathname = usePathname();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = sessionStorage.getItem(DISMISS_STORAGE_KEY);
      if (stored) {
        const timestamp = Number(stored);
        if (Date.now() - timestamp < DISMISS_TTL_MS) {
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  });

  // Do not render on /dashboard/stake per §7.2
  const isStakeRoute = pathname === '/dashboard/stake';

  useEffect(() => {
    if (isStakeRoute || dismissed) return;
    let active = true;

    fetch('/api/verification/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json) setStatus(json);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isStakeRoute, dismissed]);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  if (isStakeRoute || dismissed || !status) return null;

  // Hidden when connected=true OR when tier=free
  if (status.telegram.connected || status.tier === 'free') {
    return null;
  }

  const bannerText =
    status.tier === 'pro'
      ? '📱 Connect to Telegram — your Pro signals are waiting.'
      : '📱 Connect to Telegram — join the Member community.';

  return (
    <div className="w-full bg-[#0d161d] border-b border-toxic-border/60 px-4 py-3 sm:px-6">
      <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        {/* Left Copy */}
        <div className="flex items-center gap-2">
          <span className="font-sans text-sm font-semibold text-white tracking-tight">
            {bannerText}
          </span>
        </div>

        {/* Right CTA + Dismiss */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <TelegramConnectButton compact onConnected={() => setStatus((prev) => prev ? { ...prev, telegram: { connected: true } } : null)} />
          <button
            onClick={handleDismiss}
            className="text-muted hover:text-white p-1 rounded-md transition-colors"
            aria-label="Dismiss Telegram banner"
            title="Dismiss banner for this session"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
