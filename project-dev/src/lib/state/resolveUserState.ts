import { BUY_LINKS, BUY_LOCK } from '@/lib/config';

export type UserState =
  | 'disconnected'
  | 'wallet_unsigned'
  | 'session_unavailable'
  | 'no_tokens'
  | 'member_no_telegram'
  | 'member_no_stake'
  | 'member_partial_stake'
  | 'pro_no_telegram'
  | 'pro_active'
  | 'pro_expired';

export type StateInput = {
  connected: boolean;
  needsSignature: boolean;
  hasActiveSession: boolean;
  tier: 'free' | 'member' | 'pro' | 'unknown';
  telegramConnected: boolean;
  stakeUsd: number;
};

export type UserStateActionKey =
  | 'connect'
  | 'sign'
  | 'retry'
  | 'buy'
  | 'telegram'
  | 'stake';

export type StateMeta = {
  title: string;
  subtitle: string;
  checklist: Array<{ done: boolean; label: string }>;
  primaryCTA: {
    label: string;
    href: string | null;
    action: UserStateActionKey;
    external?: boolean;
  } | null;
  secondaryCTA?: {
    label: string;
    href: string | null;
    action: UserStateActionKey;
  };
  showTelegramCountdown: boolean;
};

/**
 * Resolves the user's current onboarding/access state with fail-closed session
 * and oracle precedence.
 */
export function resolveUserState(i: StateInput): UserState {
  if (!i.connected) return 'disconnected';
  if (i.needsSignature) return 'wallet_unsigned';
  if (i.tier === 'unknown') return 'session_unavailable';
  if (!i.hasActiveSession) return 'wallet_unsigned';
  if (i.tier === 'pro' && !i.telegramConnected) return 'pro_no_telegram';
  if (i.tier === 'pro' && i.telegramConnected) return 'pro_active';
  if (i.tier === 'member' && !i.telegramConnected) return 'member_no_telegram';
  if (i.tier === 'member' && i.stakeUsd === 0) return 'member_no_stake';
  if (i.tier === 'member' && i.stakeUsd > 0 && i.stakeUsd < 250) {
    return 'member_partial_stake';
  }
  if (i.tier === 'free' && i.stakeUsd > 0) return 'pro_expired';
  return 'no_tokens';
}

export const stateMeta: Record<UserState, StateMeta> = {
  disconnected: {
    title: 'Connect your wallet',
    subtitle: 'Your wallet is your account. No signup required.',
    checklist: [],
    primaryCTA: { label: 'Connect Wallet', href: null, action: 'connect' },
    showTelegramCountdown: false,
  },
  wallet_unsigned: {
    title: 'Sign to verify your wallet',
    subtitle: 'One signature proves ownership. No transaction, no gas.',
    checklist: [{ done: true, label: 'Wallet connected' }],
    primaryCTA: { label: 'Sign Message', href: null, action: 'sign' },
    showTelegramCountdown: false,
  },
  session_unavailable: {
    title: 'Verifying your tier',
    subtitle: 'We cannot read on-chain price data right now. Try again in a moment.',
    checklist: [],
    primaryCTA: { label: 'Retry', href: null, action: 'retry' },
    showTelegramCountdown: false,
  },
  no_tokens: {
    title: 'Hold $20 of $H42 to enter',
    subtitle: 'No staking required — just hold in your wallet.',
    checklist: [
      { done: true, label: 'Wallet verified' },
      { done: false, label: 'Hold $20 of $H42' },
    ],
    primaryCTA: {
      label: BUY_LOCK ? 'Pre-Launch Token ($H42)' : 'Buy $H42',
      href: BUY_LOCK ? '/#choose-your-access' : BUY_LINKS.pump,
      action: 'buy',
      external: !BUY_LOCK,
    },
    showTelegramCountdown: false,
  },
  member_no_telegram: {
    title: 'Connect Telegram',
    subtitle: 'Your Member access is active — join the group to receive signals.',
    checklist: [
      { done: true, label: 'Wallet verified' },
      { done: true, label: 'Member tier active' },
      { done: false, label: 'Connect Telegram' },
    ],
    primaryCTA: {
      label: 'Open Telegram',
      href: '/dashboard#overview-verification',
      action: 'telegram',
    },
    showTelegramCountdown: true,
  },
  member_no_stake: {
    title: 'Stake $250 to unlock Pro',
    subtitle: '90-day lock. Real-time signals and priority Telegram access.',
    checklist: [
      { done: true, label: 'Wallet verified' },
      { done: true, label: 'Member in Telegram' },
      { done: false, label: 'Stake $250 for 90 days' },
    ],
    primaryCTA: {
      label: 'Stake Now',
      href: '/dashboard?tab=STAKE',
      action: 'stake',
    },
    showTelegramCountdown: false,
  },
  member_partial_stake: {
    title: 'Almost — add more stake',
    subtitle: 'Stake the remaining amount to unlock Pro.',
    checklist: [
      { done: true, label: 'Wallet verified' },
      { done: true, label: 'Partial stake active' },
      { done: false, label: 'Reach $250 staked' },
    ],
    primaryCTA: {
      label: 'Add Stake',
      href: '/dashboard?tab=STAKE',
      action: 'stake',
    },
    showTelegramCountdown: false,
  },
  pro_no_telegram: {
    title: 'One step from Pro signals',
    subtitle: 'Your Pro access is active — connect Telegram to receive signals.',
    checklist: [
      { done: true, label: 'Wallet verified' },
      { done: true, label: 'Pro staked' },
      { done: false, label: 'Connect Pro Telegram' },
    ],
    primaryCTA: {
      label: 'Open Telegram',
      href: '/dashboard#overview-verification',
      action: 'telegram',
    },
    showTelegramCountdown: true,
  },
  pro_active: {
    title: '',
    subtitle: '',
    checklist: [],
    primaryCTA: null,
    showTelegramCountdown: false,
  },
  pro_expired: {
    title: 'Your Pro stake expired',
    subtitle: 'Re-stake to restore real-time access.',
    checklist: [
      { done: true, label: 'Wallet verified' },
      { done: false, label: 'Re-stake $250 for 90 days' },
    ],
    primaryCTA: {
      label: 'Re-stake',
      href: '/dashboard?tab=STAKE',
      action: 'stake',
    },
    showTelegramCountdown: false,
  },
};
