'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type HotkeyRoute = { key: string; href: string };

const SEQUENTIAL_ROUTES: HotkeyRoute[] = [
  { key: 'd', href: '/dashboard' },
  { key: 'l', href: '/ledger' },
  { key: 's', href: '/dashboard/stake' },
];

export const HOTKEY_WINDOW_MS = 1000;

/**
 * Resolves two-key `g -> <target>` sequential navigation routes when within the timing window.
 */
export function resolveSequenceRoute(
  last: { key: string; at: number } | null,
  key: string,
  now: number
): string | null {
  if (!last || now - last.at >= HOTKEY_WINDOW_MS || last.key !== 'g') {
    return null;
  }
  const match = SEQUENTIAL_ROUTES.find((m) => m.key === key.toLowerCase());
  return match?.href ?? null;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
}

/**
 * Registers vim-style `g d` / `g l` / `g s` navigation shortcuts outside text inputs.
 */
export function useHotkeys() {
  const router = useRouter();
  const lastKeyRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      const now = Date.now();
      const key = e.key.toLowerCase();
      const matchedHref = resolveSequenceRoute(lastKeyRef.current, key, now);

      if (matchedHref) {
        e.preventDefault();
        lastKeyRef.current = null;
        router.push(matchedHref);
        return;
      }

      lastKeyRef.current = key === 'g' ? { key, at: now } : null;
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);
}
