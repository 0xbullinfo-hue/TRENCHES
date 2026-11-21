/**
 * Semantic Tailwind role classes aligned with `tailwind.config.ts` design tokens.
 */
export const roles = {
  pageBackground: 'bg-canvas',
  cardBackground: 'bg-surface-card',
  cardBorder: 'border-line',
  divider: 'border-line',
  primaryText: 'text-ink',
  secondaryText: 'text-muted',
  tertiaryText: 'text-dim',
  primaryAction: 'bg-brand text-canvas hover:bg-brand/90',
  signalAccent: 'text-alpha',
  communityAccent: 'text-raid',
  success: 'text-brand',
  danger: 'text-danger',
  warning: 'text-amber',
  focusRing:
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
} as const;

export type RoleKey = keyof typeof roles;
