'use client';

import { useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

/**
 * Pure transition predicate so wallet session guard never clears an existing cookie
 * on initial mount before auto-connect completes.
 */
export function shouldClearSessionOnWalletTransition(
  wasConnected: boolean,
  connected: boolean,
  connecting: boolean
): boolean {
  return wasConnected && !connected && !connecting;
}

/**
 * Clears the HTTP-only `trench_session` cookie only on a live `connected -> disconnected`
 * transition (never during initial mount or active connection handshakes).
 */
export function useWalletGuard(): void {
  const { connected, connecting } = useWallet();
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    if (shouldClearSessionOnWalletTransition(wasConnectedRef.current, connected, connecting)) {
      wasConnectedRef.current = false;
      void fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {});
      return;
    }

    if (connected) {
      wasConnectedRef.current = true;
    }
  }, [connected, connecting]);
}
