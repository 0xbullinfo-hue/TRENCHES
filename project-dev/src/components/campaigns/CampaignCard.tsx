'use client';

import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Campaign, CampaignSubmission } from '@/lib/types';
import {
  ExternalLink,
  CheckCircle2,
  Clock,
  Sparkles,
  Send,
  AlertCircle,
  Copy,
  Check,
  Twitter,
  Pin,
} from 'lucide-react';

interface CampaignCardProps {
  campaign: Campaign;
  userWallet?: string | null;
  isAdmin?: boolean;
  onSubmissionSuccess?: (submission: CampaignSubmission) => void;
  onTogglePin?: (campaignId: string, pinned: boolean) => void;
}

/**
 * Section 4.2 & 4.3:
 * Display CONFIGURED DURATION ONLY (e.g. 12 HOURS, 24 HOURS, 48 HOURS, 3 DAYS, 7 DAYS, 14 DAYS, N WEEKS).
 * Persisted durationHours is authoritative. Legacy records fall back safely or report "Duration unavailable".
 * Strictly NO countdown timers, no remaining hours/minutes, no tooltips revealing exact closing dates.
 */
function getConfiguredDurationLabel(
  durationHours?: number,
  createdAt?: string,
  expiresAt?: string
): string {
  if (typeof durationHours === 'number' && Number.isFinite(durationHours) && durationHours > 0) {
    if (durationHours % 168 === 0) {
      const weeks = durationHours / 168;
      return `${weeks} ${weeks === 1 ? 'WEEK' : 'WEEKS'}`;
    }
    if (durationHours % 24 === 0 && durationHours >= 48) {
      return `${durationHours / 24} DAYS`;
    }
    if (durationHours === 24) return '24 HOURS';
    return `${durationHours} HOURS`;
  }

  // Safe fallback for legacy records
  if (expiresAt && createdAt) {
    try {
      const end = new Date(expiresAt).getTime();
      const start = new Date(createdAt).getTime();
      const diffHours = Math.round((end - start) / (1000 * 60 * 60));
      if (diffHours > 0) {
        if (diffHours % 168 === 0) {
          const weeks = diffHours / 168;
          return `${weeks} ${weeks === 1 ? 'WEEK' : 'WEEKS'}`;
        }
        if (diffHours % 24 === 0 && diffHours >= 48) {
          return `${diffHours / 24} DAYS`;
        }
        if (diffHours <= 14) return '12 HOURS';
        if (diffHours <= 28) return '24 HOURS';
        if (diffHours <= 54) return '48 HOURS';
        if (diffHours <= 84) return '3 DAYS';
        if (diffHours <= 180) return '7 DAYS';
        if (diffHours <= 360) return '14 DAYS';
      }
    } catch {
      // ignore
    }
  }

  return 'Duration unavailable';
}

export const CampaignCard: React.FC<CampaignCardProps> = ({
  campaign,
  userWallet,
  isAdmin,
  onSubmissionSuccess,
  onTogglePin,
}) => {
  const wallet = useWallet();
  const [walletInput, setWalletInput] = useState(userWallet || '');
  const [xHandleInput, setXHandleInput] = useState('');
  const [retweetLinkInput, setRetweetLinkInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [userSubmission, setUserSubmission] = useState<CampaignSubmission | null>(
    campaign.userSubmission || null
  );
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [now, setNow] = useState<number>(() =>
    typeof window !== 'undefined' ? Date.now() : 0
  );

  // Expiration boundary trigger and visibilitychange refresh (no polling, no decorative countdown)
  useEffect(() => {
    if (!campaign.expiresAt || campaign.status === 'COMPLETED' || campaign.status === 'PAUSED') {
      return;
    }
    const expiresAtMs = new Date(campaign.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return;

    let timer: NodeJS.Timeout | null = null;
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs > 0) {
      // Clamp delay to max 32-bit signed int (~24.8 days)
      const delay = Math.min(remainingMs, 2_147_483_647);
      timer = setTimeout(() => {
        setNow(Date.now());
      }, delay);
    } else {
      queueMicrotask(() => {
        setNow(Date.now());
      });
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [campaign.expiresAt, campaign.status]);

  // Keep wallet input in sync if userWallet connects later
  useEffect(() => {
    let active = true;
    if (userWallet) {
      queueMicrotask(() => {
        if (active) {
          setWalletInput((prev) => (!prev ? userWallet : prev));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [userWallet]);

  // Keep submission state synced if props refresh
  useEffect(() => {
    let active = true;
    if (campaign.userSubmission) {
      queueMicrotask(() => {
        if (active) {
          setUserSubmission(campaign.userSubmission || null);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [campaign.userSubmission]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (isCompleted || isPaused || isExpired) {
      setErrorMsg(`Submissions are closed for this campaign (${statusLabel}).`);
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanWallet = walletInput.trim();
    const cleanHandle = xHandleInput.trim();
    const cleanRetweet = retweetLinkInput.trim();

    if (!cleanWallet) {
      setErrorMsg('Please enter your Solana wallet address for the airdrop.');
      return;
    }
    if (!cleanHandle) {
      setErrorMsg('Please enter your @X (Twitter) handle.');
      return;
    }
    if (!cleanRetweet) {
      setErrorMsg('Please paste the URL link to your retweet/quote.');
      return;
    }

    setSubmitting(true);
    try {
      let signatureHex: string | undefined;
      let activeChallengeId: string | undefined;

      const activeAdapter = wallet.wallet?.adapter;
      const activeSignMessage =
        wallet.signMessage ||
        (activeAdapter && typeof (activeAdapter as any).signMessage === 'function'
          ? (activeAdapter as any).signMessage.bind(activeAdapter)
          : null);

      // Verify wallet ownership with server-generated cryptographic challenge signature
      if (activeSignMessage && wallet.publicKey && wallet.publicKey.toBase58() === cleanWallet) {
        // Ensure active wallet session exists
        let hasSession = false;
        try {
          const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
          if (sessionRes.ok) {
            const sess = await sessionRes.json();
            if (sess.wallet === cleanWallet) {
              hasSession = true;
            }
          }
        } catch {}

        if (!hasSession) {
          const ts = Date.now();
          const sessionMsg = `TrenchLabs Access|POST|/api/auth/session|${ts}`;
          const sessSigBytes = await activeSignMessage(new TextEncoder().encode(sessionMsg));
          const sessSigHex = Array.from(sessSigBytes)
            .map((b) => (b as number).toString(16).padStart(2, '0'))
            .join('');

          const authRes = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              wallet: cleanWallet,
              signature: sessSigHex,
              timestamp: ts,
            }),
          });
          if (!authRes.ok) {
            throw new Error('Wallet session authentication failed. Please retry.');
          }
        }

        // 1. Request server-issued challenge
        const challengeRes = await fetch(`/api/campaigns/${campaign.id}/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ walletAddress: cleanWallet }),
        });
        const challengeData = await challengeRes.json();
        if (!challengeRes.ok || !challengeData.ok || !challengeData.challengeId || !challengeData.message) {
          throw new Error(challengeData.error || 'Failed to request raid verification challenge.');
        }

        activeChallengeId = challengeData.challengeId;

        // 2. Sign exact server challenge message
        try {
          const sigBytes = await activeSignMessage(new TextEncoder().encode(challengeData.message));
          signatureHex = Array.from(sigBytes)
            .map((b) => (b as number).toString(16).padStart(2, '0'))
            .join('');
        } catch (signErr) {
          const signErrMsg = (signErr as Error)?.message || '';
          if (/user rejected|window closed|cancelled|canceled|denied/i.test(signErrMsg)) {
            setErrorMsg('Signature cancelled. Wallet verification is required to submit.');
            setSubmitting(false);
            return;
          }
          throw signErr;
        }
      }

      const res = await fetch(`/api/campaigns/${campaign.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          challengeId: activeChallengeId,
          walletAddress: cleanWallet,
          xHandle: cleanHandle,
          xRetweetLink: cleanRetweet,
          signature: signatureHex,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to submit raid proof');
      }

      setUserSubmission(json.submission);
      setSuccessMsg('Raid proof submitted! Awaiting admin airdrop verification.');
      if (onSubmissionSuccess) {
        onSubmissionSuccess(json.submission);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyWallet = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 1800);
  };

  // Section 4.4: Authoritative Campaign Status (PAUSED and EXPIRED must be distinct)
  const isCompleted = campaign.status === 'COMPLETED';
  const isPaused = campaign.status === 'PAUSED';
  const isExpired =
    !isCompleted &&
    !isPaused &&
    !!campaign.expiresAt &&
    Boolean(now && new Date(campaign.expiresAt).getTime() <= now);
  const statusLabel = isCompleted
    ? 'COMPLETED'
    : isPaused
    ? 'PAUSED'
    : isExpired
    ? 'EXPIRED'
    : 'ACTIVE';
  const configuredDuration = getConfiguredDurationLabel(
    campaign.durationHours,
    campaign.createdAt,
    campaign.expiresAt
  );

  return (
    <article
      tabIndex={0}
      aria-label={`X Raid Campaign: ${campaign.title}`}
      className="group relative rounded-xl bg-surface flex flex-col justify-between h-full transition-all duration-150 p-4 sm:p-5 border border-raid-border hover:border-raid-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-raid-primary shadow-none"
    >
      <div>
        {/* Top Row: Category Tag + Platform + Campaign Status + Priority Pin */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border-default">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-md border border-raid-border bg-raid-bg px-2.5 py-1 font-mono text-[11px] font-semibold text-raid-text">
              <Sparkles className="w-3 h-3 text-raid-primary" />
              <span>SOCIAL RAID</span>
            </span>

            {/* Campaign Status (Section 4.4) */}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase tracking-wider ${
                isCompleted
                  ? 'bg-surface-card border border-border-default text-muted'
                  : isPaused
                  ? 'bg-amber/15 text-amber border border-amber/40'
                  : isExpired
                  ? 'bg-danger/20 text-danger border border-danger/40'
                  : 'bg-raid-bg text-raid-text border border-raid-border'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isCompleted
                    ? 'bg-muted'
                    : isPaused
                    ? 'bg-amber'
                    : isExpired
                    ? 'bg-danger'
                    : 'bg-raid-primary'
                }`}
              />
              <span>{statusLabel}</span>
            </span>

            {campaign.pinned && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-raid-strong text-white font-mono text-[10px] font-black uppercase">
                <Pin className="w-2.5 h-2.5" />
                <span>PRIORITY PIN</span>
              </span>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1.5 shrink-0 text-muted font-mono text-xs">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin?.(campaign.id, !campaign.pinned);
                }}
                className={`px-2 py-0.5 rounded-md border text-[10px] font-mono cursor-pointer transition-colors ${
                  campaign.pinned
                    ? 'bg-raid-strong text-white border-raid-border font-black'
                    : 'bg-surface-card hover:bg-surface-3 border-border-default text-muted hover:text-white'
                }`}
                title={campaign.pinned ? 'Unpin Priority Raid' : 'Pin Raid as Priority'}
              >
                {campaign.pinned ? 'PINNED' : 'PIN'}
              </button>
            </div>
          )}
        </div>

        {/* Campaign Title & Configured Duration Row (Section 6.2) */}
        <div className="pt-3 pb-2 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-sans text-base font-extrabold text-white group-hover:text-raid-text transition-colors leading-tight">
              {campaign.title}
            </h3>

            {/* Configured Duration Badge ONLY (Section 6.2 - no countdowns, no closing timestamps) */}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-card border border-border-default font-mono text-xs font-bold text-muted uppercase tracking-wider shrink-0">
              <Clock className="w-3 h-3 text-raid-primary" />
              <span>{configuredDuration}</span>
            </span>
          </div>

          <p className="font-sans text-xs text-muted leading-relaxed line-clamp-3">
            {campaign.description}
          </p>

          {/* Action pills: e.g. Like, Retweet, Quote */}
          {campaign.targetActions && campaign.targetActions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {campaign.targetActions.map((action, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-md bg-surface-card border border-border-default text-[10px] font-mono font-semibold text-muted"
                >
                  ✓ {action}
                </span>
              ))}
            </div>
          )}

          {/* Primary Action Button: Open X Tweet */}
          <a
            href={campaign.tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-between w-full h-11 min-h-[44px] px-3.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-raid-border text-white font-sans text-xs font-bold transition-colors mt-2"
          >
            <span className="flex items-center gap-2">
              <Twitter className="w-4 h-4 text-raid-primary" />
              <span>View Raid Post on X</span>
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-raid-primary" />
          </a>
        </div>

        {/* Reward Callout Banner */}
        <div className="my-2 p-3 rounded-lg bg-surface-card border border-raid-border/40 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-raid-primary shrink-0" />
            <div>
              <div className="font-sans text-[10px] font-bold text-muted uppercase tracking-wider">
                AIRDROP REWARD PER USER
              </div>
              <div className="font-sans text-sm font-black text-raid-primary">
                {campaign.rewardAmount}
              </div>
            </div>
          </div>
          {campaign.totalPool && (
            <div className="text-right">
              <div className="font-sans text-[10px] font-bold text-muted uppercase tracking-wider">
                TOTAL POOL
              </div>
              <div className="font-mono text-xs font-bold text-white">
                {campaign.totalPool}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Area: Submission Form or Submission Status */}
      <div className="pt-3 border-t border-border-default mt-2">
        {userSubmission ? (
          /* User has already submitted */
          <div className="rounded-lg bg-surface-card border border-border-default p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-toxic font-sans">
                <CheckCircle2 className="w-4 h-4 text-toxic" />
                <span>Raid Proof Submitted</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-extrabold uppercase ${
                  userSubmission.status === 'AIRDROPPED'
                    ? 'bg-toxic-bg text-toxic border border-toxic-border'
                    : 'bg-amber/15 text-amber border border-amber/40'
                }`}
              >
                {userSubmission.status === 'AIRDROPPED' ? '✓ AIRDROPPED' : 'PENDING AIRDROP'}
              </span>
            </div>

            <div className="text-[11px] font-mono space-y-1 text-muted">
              <div className="flex items-center justify-between gap-1">
                <span>X Handle:</span>
                <a
                  href={`https://x.com/${userSubmission.xHandle.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-raid-primary hover:underline font-bold"
                >
                  {userSubmission.xHandle}
                </a>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span>Wallet:</span>
                <button
                  type="button"
                  onClick={() => handleCopyWallet(userSubmission.walletAddress)}
                  className="inline-flex items-center gap-1 text-white hover:text-raid-primary font-mono"
                  title="Click to copy wallet"
                >
                  <span>
                    {userSubmission.walletAddress.slice(0, 4)}...
                    {userSubmission.walletAddress.slice(-4)}
                  </span>
                  {copiedWallet ? (
                    <Check className="w-3 h-3 text-toxic" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted" />
                  )}
                </button>
              </div>
              {userSubmission.airdropTx && (
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-border-default">
                  <span className="text-toxic">Tx Hash:</span>
                  <a
                    href={`https://solscan.io/tx/${userSubmission.airdropTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-raid-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    <span>View Tx ↗</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        ) : isCompleted || isExpired || isPaused ? (
          <div className="py-3 px-4 text-center text-xs font-sans text-muted bg-surface-card rounded-lg border border-border-default">
            {isPaused
              ? 'This raid campaign is currently paused. Submissions are temporarily closed.'
              : isExpired
              ? 'This raid campaign has expired. Submissions are closed.'
              : `This raid campaign has concluded (${statusLabel}).`}
          </div>
        ) : (
          /* Submission Form (Section 6.4) */
          <form onSubmit={handleSubmit} className="space-y-2.5">
            <div className="font-sans text-[11px] font-extrabold uppercase text-raid-primary flex items-center justify-between">
              <span>Submit Proof for Airdrop</span>
              <span className="text-muted font-normal text-[10px]">Open to All Wallets</span>
            </div>

            {errorMsg && (
              <div className="p-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-[11px] font-sans flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2 rounded-md bg-toxic-bg border border-toxic-border text-toxic text-[11px] font-sans flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="space-y-2">
              <div>
                <label className="sr-only" htmlFor={`wallet-${campaign.id}`}>Solana Wallet Address</label>
                <input
                  id={`wallet-${campaign.id}`}
                  type="text"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="Your Solana wallet address..."
                  className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="sr-only" htmlFor={`xhandle-${campaign.id}`}>X Handle</label>
                  <input
                    id={`xhandle-${campaign.id}`}
                    type="text"
                    value={xHandleInput}
                    onChange={(e) => setXHandleInput(e.target.value)}
                    placeholder="Your @XHandle..."
                    className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                  />
                </div>
                <div>
                  <label className="sr-only" htmlFor={`retweet-${campaign.id}`}>Retweet Link</label>
                  <input
                    id={`retweet-${campaign.id}`}
                    type="text"
                    value={retweetLinkInput}
                    onChange={(e) => setRetweetLinkInput(e.target.value)}
                    placeholder="Retweet Link URL..."
                    className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 min-h-[44px] px-4 rounded-lg bg-raid-strong hover:bg-raid-primary text-white font-sans text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-none disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting Proof...' : 'Claim Raid Airdrop'}</span>
            </button>
          </form>
        )}
      </div>
    </article>
  );
};
