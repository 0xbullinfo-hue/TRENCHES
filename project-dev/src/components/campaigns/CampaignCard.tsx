'use client';

import React, { useState, useEffect } from 'react';
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

export const CampaignCard: React.FC<CampaignCardProps> = ({
  campaign,
  userWallet,
  isAdmin,
  onSubmissionSuccess,
  onTogglePin,
}) => {
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
  const [currentTime, setCurrentTime] = useState<number | null>(null);

  // Client-side timer initialization
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentTime(Date.now());
    }, 0);
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  // Keep wallet input in sync if userWallet connects later
  React.useEffect(() => {
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
  React.useEffect(() => {
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
      const res = await fetch(`/api/campaigns/${campaign.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: cleanWallet,
          xHandle: cleanHandle,
          xRetweetLink: cleanRetweet,
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

  const isCompleted = campaign.status === 'COMPLETED';

  // Format remaining raid duration safely
  const durationBadge = React.useMemo(() => {
    if (!campaign.expiresAt) return null;
    if (currentTime === null) return null;
    const diffMs = new Date(campaign.expiresAt).getTime() - currentTime;
    if (diffMs <= 0) return 'EXPIRED';
    const totalMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h left`;
    }
    if (hours > 0) {
      return `${hours}h ${mins}m left`;
    }
    return `${mins}m left`;
  }, [campaign.expiresAt, currentTime]);

  return (
    <article
      tabIndex={0}
      aria-label={`X Raid Campaign: ${campaign.title}`}
      className="group relative rounded-xl bg-surface flex flex-col justify-between h-full transition-all duration-150 p-4 sm:p-5 border border-raid-border hover:border-raid-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-raid-primary shadow-none"
    >
      <div>
        {/* Top Row: Category Tag + Priority Pin + Admin Pin Button */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border-default">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-md border border-raid-border bg-raid-bg px-2.5 py-1 font-mono text-[11px] font-semibold text-raid-text">
              <Sparkles className="w-3 h-3 text-raid-primary" />
              <span>SOCIAL RAID</span>
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

        {/* Campaign Title & Duration Badge Row */}
        <div className="pt-3 pb-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-sans text-base font-extrabold text-white group-hover:text-raid-text transition-colors leading-tight">
              {campaign.title}
            </h3>

            {durationBadge && (
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-mono text-xs font-bold uppercase tracking-wider shrink-0 ${
                  durationBadge === 'EXPIRED'
                    ? 'bg-surface-card text-muted border border-border-default'
                    : 'bg-raid-bg text-raid-text border border-raid-border'
                }`}
                title={campaign.expiresAt ? `Raid closes at ${new Date(campaign.expiresAt).toLocaleString()}` : undefined}
              >
                <Clock className="w-3 h-3 text-raid-primary" />
                <span>{durationBadge}</span>
              </span>
            )}
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

          {/* Primary Action Button: Open X Tweet (Standard 40px height) */}
          <a
            href={campaign.tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-between w-full h-10 px-3.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-raid-border text-white font-sans text-xs font-bold transition-colors mt-2"
          >
            <span className="flex items-center gap-2">
              <Twitter className="w-4 h-4 text-raid-primary" />
              <span>Open Target Post on X (Twitter)</span>
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
        ) : isCompleted ? (
          <div className="py-2 text-center text-xs font-sans text-muted">
            This raid campaign has concluded.
          </div>
        ) : (
          /* Submission Form */
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="font-sans text-[11px] font-extrabold uppercase text-raid-primary flex items-center justify-between">
              <span>Submit Proof for Airdrop</span>
              <span className="text-muted font-normal text-[10px]">Open to Free &amp; Pro</span>
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

            <div className="space-y-1.5">
              <div>
                <input
                  type="text"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="Your Solana wallet address..."
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  value={xHandleInput}
                  onChange={(e) => setXHandleInput(e.target.value)}
                  placeholder="Your @XHandle..."
                  className="h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                />
                <input
                  type="text"
                  value={retweetLinkInput}
                  onChange={(e) => setRetweetLinkInput(e.target.value)}
                  placeholder="Retweet Link URL..."
                  className="h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 px-4 rounded-lg bg-raid-strong hover:bg-raid-primary text-white font-sans text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-none disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting...' : 'Claim Raid Airdrop'}</span>
            </button>
          </form>
        )}
      </div>
    </article>
  );
};
