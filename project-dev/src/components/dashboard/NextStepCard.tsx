'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { roles } from '@/lib/theme/roles';
import type {
  StateMeta,
  UserState,
  UserStateActionKey,
} from '@/lib/state/resolveUserState';

type Props = {
  state: UserState;
  meta: StateMeta;
  signalCount?: number;
  telegramExpiresAt?: number | null;
  onRegenerateInvite?: () => void;
  onAction?: (action: UserStateActionKey) => void;
};

/**
 * Live expiry countdown shared across onboarding cards and Telegram verification.
 */
export function TelegramCountdown({
  expiresAt,
  onRegenerate,
  className = '',
}: {
  expiresAt: number;
  onRegenerate?: () => void;
  className?: string;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, expiresAt - Date.now()));
    const initId = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(initId);
      clearInterval(id);
    };
  }, [expiresAt]);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const urgent = remaining < 5 * 60 * 1000;
  const expired = remaining === 0;

  if (expired) {
    return onRegenerate ? (
      <button
        type="button"
        onClick={onRegenerate}
        className={`mt-2 text-xs text-danger underline ${roles.focusRing} ${className}`}
      >
        Invite expired — click to regenerate
      </button>
    ) : (
      <p className={`mt-2 text-xs font-mono text-danger ${className}`}>
        Verification link expired — request a new link.
      </p>
    );
  }

  return (
    <p
      data-testid="telegram-expiry-countdown"
      className={`mt-2 text-xs font-mono tabular-nums ${
        urgent ? 'text-danger' : 'text-muted'
      } ${className}`}
    >
      ⏱ Invite expires in {mins}:{secs.toString().padStart(2, '0')}
    </p>
  );
}

function renderActionControl(
  cta: NonNullable<StateMeta['primaryCTA']>,
  variant: 'primary' | 'secondary',
  onAction?: (action: UserStateActionKey) => void
) {
  const cls =
    variant === 'primary'
      ? `rounded-md bg-brand px-4 py-2 text-sm font-medium text-canvas hover:bg-brand/90 ${roles.focusRing}`
      : `rounded-md border border-line px-4 py-2 text-sm text-ink hover:bg-surface-card ${roles.focusRing}`;

  if (onAction && cta.href === null) {
    return (
      <button type="button" onClick={() => onAction(cta.action)} className={cls}>
        {cta.label}
      </button>
    );
  }

  if (cta.href && cta.external) {
    return (
      <a href={cta.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {cta.label}
      </a>
    );
  }

  if (cta.href) {
    return (
      <Link
        href={cta.href}
        onClick={onAction ? () => onAction(cta.action) : undefined}
        className={cls}
      >
        {cta.label}
      </Link>
    );
  }

  return null;
}

export function NextStepCard({
  state,
  meta,
  signalCount,
  telegramExpiresAt,
  onRegenerateInvite,
  onAction,
}: Props) {
  if (state === 'pro_active') {
    return (
      <div className="rounded-lg border border-line bg-surface-card px-4 py-3">
        <p className="text-sm text-ink">
          {signalCount !== undefined && signalCount > 0
            ? `You're receiving Pro signals in Telegram. ${signalCount} delivered this month.`
            : "You're receiving Pro signals in Telegram."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface-card p-4">
      <h2 className="text-base font-semibold text-ink">{meta.title}</h2>
      {meta.subtitle && <p className="mt-1 text-sm text-muted">{meta.subtitle}</p>}

      {meta.checklist.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {meta.checklist.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className={item.done ? 'text-brand' : 'text-dim'} aria-hidden>
                {item.done ? '✓' : '○'}
              </span>
              <span className={item.done ? 'text-muted' : 'text-ink'}>{item.label}</span>
            </li>
          ))}
        </ul>
      )}

      {meta.showTelegramCountdown && telegramExpiresAt ? (
        <TelegramCountdown expiresAt={telegramExpiresAt} onRegenerate={onRegenerateInvite} />
      ) : null}

      {(meta.primaryCTA || meta.secondaryCTA) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {meta.primaryCTA && renderActionControl(meta.primaryCTA, 'primary', onAction)}
          {meta.secondaryCTA && renderActionControl(meta.secondaryCTA, 'secondary', onAction)}
        </div>
      )}
    </div>
  );
}
