'use client';

import React, { useState } from 'react';
import type { Campaign, CampaignSubmission } from '@/lib/types';
import {
  ExternalLink,
  Gift,
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

  // Keep wallet input in sync if userWallet connects later
  React.useEffect(() => {
    let active = true;
    if (userWallet) {
      queueMicrotask(() => {
        if (active) {
          setWalletInput((prev) => prev || userWallet);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [userWallet]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanWallet = walletInput.trim();
    const cleanHandle = xHandleInput.trim();
    const cleanRetweet = retweetLinkInput.trim();

    if (!cleanWallet) {
      setErrorMsg('Please enter your Solana wallet address to receive the airdrop.');
      return;
    }
    if (!cleanHandle) {
      setErrorMsg('Please enter your X / Twitter handle.');
      return;
    }
    if (!cleanRetweet) {
      setErrorMsg('Please provide the URL of your retweet or quote tweet.');
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
  const isPaused = campaign.status === 'PAUSED';

  return (
    <article
      tabIndex={0}
      aria-label={`X Raid Campaign: ${campaign.title}`}
      className="group relative rounded-xl bg-surface flex flex-col justify-between h-full transition-all duration-200 p-4 border-2 border-purple-500 shadow-[0_0_22px_rgba(168,85,247,0.35)] ring-1 ring-purple-500/50 hover:border-purple-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
    >
      <div>
        {/* Top Row: Serial Tag + X Raid Indicator + Status + Participants */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-line">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded font-mono text-xs font-black bg-purple-500/15 border border-purple-500/80 text-purple-300">
              ⚡ X RAID
            </span>

            {campaign.pinned && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-600 text-white font-mono text-[10px] font-black uppercase shadow-sm">
                <Pin className="w-2.5 h-2.5" />
                <span>PRIORITY PIN</span>
              </span>
            )}

            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] font-black uppercase tracking-wider ${
                isCompleted
                  ? 'bg-neutral-800 text-muted border border-neutral-700'
                  : isPaused
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-purple-600 text-white shadow-sm'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isCompleted ? 'bg-muted' : isPaused ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
                }`}
              />
              <span>{campaign.status}</span>
            </span>

            <span className="px-2 py-0.5 rounded bg-surface-card border border-line font-mono text-[10px] font-bold text-white">
              ALL TIERS
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 text-muted font-mono text-xs">
            {isAdmin && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin?.(campaign.id, !campaign.pinned);
                }}
                className={`px-2 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors ${
                  campaign.pinned
                    ? 'bg-purple-600 text-white border-purple-500 font-black shadow-sm'
                    : 'bg-surface-card hover:bg-surface-3 border-line text-muted hover:text-white'
                }`}
                title={campaign.pinned ? 'Unpin Priority Raid' : 'Pin Raid as Priority'}
              >
                {campaign.pinned ? 'PINNED' : 'PIN'}
              </button>
            )}

            <div className="flex items-center gap-1">
              <Gift className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-purple-300 font-bold">
                {campaign.submissionsCount || 0} Raids
              </span>
            </div>
          </div>
        </div>

        {/* Campaign Title & Target Tweet Link */}
        <div className="pt-3 pb-2 space-y-2">
          <h3 className="font-sans text-base font-extrabold text-white group-hover:text-purple-300 transition-colors leading-tight">
            {campaign.title}
          </h3>

          <p className="font-sans text-xs text-muted leading-relaxed line-clamp-3">
            {campaign.description}
          </p>

          {/* Action pills: e.g. Like, Retweet, Quote */}
          {campaign.targetActions && campaign.targetActions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {campaign.targetActions.map((action, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded bg-surface-card border border-line text-[10px] font-mono font-semibold text-muted"
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
            className="inline-flex items-center justify-between w-full px-3 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/40 text-purple-300 font-sans text-xs font-bold transition-colors mt-2"
          >
            <span className="flex items-center gap-2">
              <Twitter className="w-4 h-4 text-purple-400" />
              <span>Open Target Post on X (Twitter)</span>
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
          </a>
        </div>

        {/* Reward Callout Banner */}
        <div className="my-2 p-2.5 rounded-lg bg-surface-card border border-purple-500/30 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
            <div>
              <div className="font-sans text-[10px] font-bold text-muted uppercase tracking-wider">
                AIRDROP REWARD PER USER
              </div>
              <div className="font-sans text-sm font-black text-purple-300">
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
      <div className="pt-3 border-t border-line mt-2">
        {userSubmission ? (
          /* User has already submitted */
          <div className="rounded-lg bg-surface-card border border-line p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 font-sans">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Raid Proof Submitted</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded font-mono text-[10px] font-extrabold uppercase ${
                  userSubmission.status === 'AIRDROPPED'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
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
                  className="text-purple-300 hover:underline font-bold"
                >
                  {userSubmission.xHandle}
                </a>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span>Wallet:</span>
                <button
                  type="button"
                  onClick={() => handleCopyWallet(userSubmission.walletAddress)}
                  className="inline-flex items-center gap-1 text-white hover:text-purple-300 font-mono"
                  title="Click to copy wallet"
                >
                  <span>
                    {userSubmission.walletAddress.slice(0, 4)}...
                    {userSubmission.walletAddress.slice(-4)}
                  </span>
                  {copiedWallet ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted" />
                  )}
                </button>
              </div>
              {userSubmission.airdropTx && (
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-neutral-800">
                  <span className="text-emerald-400">Tx Hash:</span>
                  <a
                    href={`https://solscan.io/tx/${userSubmission.airdropTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-300 hover:underline inline-flex items-center gap-0.5"
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
            <div className="font-sans text-[11px] font-extrabold uppercase text-purple-300 flex items-center justify-between">
              <span>Submit Proof for Airdrop</span>
              <span className="text-muted font-normal text-[10px]">Open to Free &amp; Pro</span>
            </div>

            {errorMsg && (
              <div className="p-2 rounded bg-danger/10 border border-danger/30 text-danger text-[11px] font-sans flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-sans flex items-start gap-1.5">
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
                  className="w-full h-8 px-2.5 rounded bg-surface-card border border-line focus:border-purple-400 font-mono text-[11px] text-white placeholder:text-neutral-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  value={xHandleInput}
                  onChange={(e) => setXHandleInput(e.target.value)}
                  placeholder="Your @XHandle..."
                  className="h-8 px-2.5 rounded bg-surface-card border border-line focus:border-purple-400 font-mono text-[11px] text-white placeholder:text-neutral-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={retweetLinkInput}
                  onChange={(e) => setRetweetLinkInput(e.target.value)}
                  placeholder="Retweet Link URL..."
                  className="h-8 px-2.5 rounded bg-surface-card border border-line focus:border-purple-400 font-mono text-[11px] text-white placeholder:text-neutral-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-8 px-3 rounded bg-purple-600 hover:bg-purple-500 text-white font-sans text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-sm disabled:opacity-50"
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
