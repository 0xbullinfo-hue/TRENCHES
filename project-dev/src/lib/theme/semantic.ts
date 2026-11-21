/**
 * Semantic direction and color token helpers aligned to `tailwind.config.ts`.
 * Uses project tokens (`brand`, `danger`, `muted`, `border-default`, `surface-2`).
 */

export type Direction = 'up' | 'down' | 'flat';

/**
 * Maps a numeric or BigInt delta to `'up' | 'down' | 'flat'`.
 * Nullish and non-finite inputs safely resolve to `'flat'`.
 */
export function directionOf(value: number | bigint | null | undefined): Direction {
  if (value === null || value === undefined) return 'flat';
  if (typeof value === 'bigint') {
    if (value > 0n) return 'up';
    if (value < 0n) return 'down';
    return 'flat';
  }
  if (!Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

export const semantic = {
  text: {
    up: 'text-brand',
    down: 'text-danger',
    flat: 'text-muted',
  },
  bg: {
    up: 'bg-brand/15',
    down: 'bg-danger/15',
    flat: 'bg-surface-2',
  },
  solidBg: {
    up: 'bg-brand',
    down: 'bg-danger',
    flat: 'bg-muted',
  },
  border: {
    up: 'border-brand/40',
    down: 'border-danger/40',
    flat: 'border-border-default',
  },
  pnlClass(value: number | bigint | null | undefined): string {
    return this.text[directionOf(value)];
  },
  deltaBadgeClass(value: number | bigint | null | undefined): string {
    const dir = directionOf(value);
    return `${this.text[dir]} ${this.bg[dir]} ${this.border[dir]}`;
  },
} as const;
