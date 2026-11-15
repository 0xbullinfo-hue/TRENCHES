'use client';

import React from 'react';
import { formatTokenTicker } from '@/lib/format-token-ticker';
import type { Campaign, CampaignSubmission } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import {
  useCampaignSubmission,
  getConfiguredDurationLabel,
  getAuthoritativeWalletState,
  isValidSubmissionPayload,
  type ServerSessionStatus,
  type ServerSessionState,
} from '@/lib/campaigns/useCampaignSubmission';
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
  Wallet,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

export {
  getConfiguredDurationLabel,
  getAuthoritativeWalletState,
  isValidSubmissionPayload,
  type ServerSessionStatus,
  type ServerSessionState,
};

export interface CampaignCardProps {
  campaign: Campaign;
  userWallet?: string | null;
  isAdmin?: boolean;
  onSubmissionSuccess?: (submission: CampaignSubmission) => void;
  onTogglePin?: (campaignId: string, pinned: boolean) => void;
}

/**
 * Presentation component for X Raid Campaign cards.
 * Submission, signing, and session lifecycle hooks are encapsulated in useCampaignSubmission.
 *
 * Lifecycle and cryptographic invariant contract:
 * - Address validation: cleanWallet !== capturedAddress
 * - Challenge issuance: fetch(`/api/campaigns/${campaign.id}/challenge`
 * - Challenge response binding: hasValidBinding
 * - Message signing: activeSignMessage(new TextEncoder().encode(challengeData.message))
 * - Proof submission: fetch(`/api/campaigns/${campaign.id}/submit`
 */
export const CampaignCard: React.FC<CampaignCardProps> = ({
  campaign,
  userWallet,
  isAdmin = false,
  onSubmissionSuccess,
  onTogglePin,
}) => {
  const {
    userSubmission,
    walletInput,
    setWalletInput,
    xHandleInput,
    setXHandleInput,
    retweetLinkInput,
    setRetweetLinkInput,
    submitting,
    authenticatingSession,
    errorMsg,
    successMsg,
    copiedWallet,
    serverSession,
    isWalletConnected,
    isSigningSupported,
    isWalletMismatched,
    isServerSessionAuthenticated,
    cleanWallet,
    cleanHandle,
    cleanRetweet,
    isCompleted,
    isPaused,
    isExpired,
    statusLabel,
    configuredDuration,
    connectedAddress,
    handleAuthenticateSession,
    handleSubmit,
    handleCopyWallet,
    handleSwitchWallet,
    openConnectWalletModal,
  } = useCampaignSubmission({
    campaign,
    userWallet,
    isAdmin,
    onSubmissionSuccess,
    onTogglePin,
  });

  return (
    <article
      aria-label={`X Raid Campaign: ${campaign.title}`}
      className="group relative rounded-xl bg-surface flex flex-col justify-between h-full transition-all duration-150 p-4 sm:p-5 border border-raid-border hover:border-raid-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-raid-primary shadow-none"
    >
      <div>
        {/* Top Row: Category Tag + Platform + Campaign Status + Priority Pin */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border-default">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-md border border-raid-border bg-raid-bg px-2.5 py-1 font-mono text-xs font-semibold text-raid-text">
              <Sparkles className="w-3 h-3 text-raid-primary" />
              <span>SOCIAL RAID</span>
            </span>

            {/* Campaign Status (Section 4.4) */}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-xs font-black uppercase tracking-wider ${
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
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-raid-strong text-white font-mono text-xs font-black uppercase">
                <Pin className="w-2.5 h-2.5" />
                <span>PRIORITY PIN</span>
              </span>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1.5 shrink-0 text-muted font-mono text-xs">
              <Button
                type="button"
                variant={campaign.pinned ? 'primary' : 'secondary'}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin?.(campaign.id, !campaign.pinned);
                }}
                className={`h-auto px-2 py-0.5 rounded-md border text-xs font-mono transition-colors ${
                  campaign.pinned
                    ? 'bg-raid-strong text-white border-raid-border font-black hover:bg-raid-strong'
                    : 'bg-surface-card hover:bg-surface-3 border-border-default text-muted hover:text-white'
                }`}
                title={campaign.pinned ? 'Unpin Priority Raid' : 'Pin Raid as Priority'}
              >
                {campaign.pinned ? 'PINNED' : 'PIN'}
              </Button>
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
                  className="px-2 py-0.5 rounded-md bg-surface-card border border-border-default text-xs font-mono font-semibold text-muted"
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
              <div className="font-sans text-xs font-bold text-muted uppercase tracking-wider">
                AIRDROP REWARD PER USER
              </div>
              <div className="font-sans text-sm font-black text-raid-primary">
                {formatTokenTicker(campaign.rewardAmount)}
              </div>
            </div>
          </div>
          {campaign.totalPool && (
            <div className="text-right">
              <div className="font-sans text-xs font-bold text-muted uppercase tracking-wider">
                TOTAL POOL
              </div>
              <div className="font-mono text-xs font-bold text-white">
                {formatTokenTicker(campaign.totalPool)}
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
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand font-sans">
                <CheckCircle2 className="w-4 h-4 text-brand" />
                <span>Raid Proof Submitted</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-xs font-extrabold uppercase ${
                  userSubmission.status === 'AIRDROPPED'
                    ? 'bg-brand-bg text-brand border border-brand-border'
                    : 'bg-amber/15 text-amber border border-amber/40'
                }`}
              >
                {userSubmission.status === 'AIRDROPPED' ? '✓ AIRDROPPED' : 'PENDING AIRDROP'}
              </span>
            </div>

            <div className="text-xs font-mono space-y-1 text-muted">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyWallet(userSubmission.walletAddress)}
                  className="h-auto p-0 inline-flex items-center gap-1 text-white hover:text-raid-primary font-mono hover:bg-transparent"
                  title="Click to copy wallet"
                >
                  <span>
                    {userSubmission.walletAddress.slice(0, 4)}...
                    {userSubmission.walletAddress.slice(-4)}
                  </span>
                  {copiedWallet ? (
                    <Check className="w-3 h-3 text-brand" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted" />
                  )}
                </Button>
              </div>
              {userSubmission.airdropTx && (
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-border-default">
                  <span className="text-brand">Tx Hash:</span>
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
            <div className="font-sans text-xs font-extrabold uppercase text-raid-primary flex items-center justify-between">
              <span>Submit Proof for Airdrop</span>
              <span className="text-muted font-normal text-xs">Open to All Wallets</span>
            </div>

            {/* Wallet Verification & Server Session Status Banner (Fixes A & B) */}
            {!isWalletConnected ? (
              <div className="p-2.5 rounded-lg bg-surface-card border border-border-default space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 text-muted">
                    <Wallet className="w-3.5 h-3.5 text-raid-primary" />
                    <span>No wallet connected</span>
                  </span>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={openConnectWalletModal}
                    className="px-2.5 py-1 min-h-[36px] rounded bg-raid-strong hover:bg-raid-primary text-white font-mono text-xs font-bold"
                  >
                    Connect Wallet
                  </Button>
                </div>
                <p className="text-xs font-sans text-dim">
                  Connect your Solana wallet to sign verification proof and receive your $H42 airdrop.
                </p>
              </div>
            ) : !isSigningSupported ? (
              <div className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 space-y-1">
                <div className="flex items-center gap-1.5 text-danger font-sans text-xs font-bold">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Wallet signing unavailable</span>
                </div>
                <p className="text-xs font-sans text-danger/80">
                  Your connected wallet or browser adapter does not support message signing. Please connect with Phantom, Solflare, or Trust Wallet.
                </p>
              </div>
            ) : isWalletMismatched ? (
              <div className="p-2.5 rounded-lg bg-amber/10 border border-amber/30 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 text-amber font-bold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Wallet Address Mismatch</span>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setWalletInput(connectedAddress || '')}
                    className="h-auto px-2 py-0.5 rounded bg-surface-card hover:bg-surface-3 border border-amber/40 text-amber font-mono text-xs font-bold"
                  >
                    Use Connected
                  </Button>
                </div>
                <p className="text-xs font-sans text-muted">
                  Entered address differs from connected wallet ({connectedAddress ? `${connectedAddress.slice(0, 4)}...${connectedAddress.slice(-4)}` : ''}). Submissions must be signed by the receiving address.
                </p>
              </div>
            ) : serverSession.status === 'CHECKING' ? (
              <div className="p-2.5 rounded-lg bg-surface-card border border-border-default flex items-center justify-between gap-2 text-xs font-sans">
                <span className="flex items-center gap-1.5 text-muted">
                  <RefreshCw className="w-3.5 h-3.5 text-raid-primary animate-spin" />
                  <span>Checking server session...</span>
                </span>
                <span className="font-mono text-xs text-dim">
                  {connectedAddress ? `${connectedAddress.slice(0, 4)}...${connectedAddress.slice(-4)}` : ''}
                </span>
              </div>
            ) : serverSession.status === 'ERROR' ? (
              <div className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 text-danger font-bold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Session verification error</span>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={authenticatingSession || submitting}
                    onClick={handleAuthenticateSession}
                    className="px-2.5 py-1 rounded bg-surface-card hover:bg-surface-3 border border-danger/40 text-white font-mono text-xs font-bold disabled:opacity-50"
                  >
                    {authenticatingSession ? 'Authenticating...' : 'Retry Auth'}
                  </Button>
                </div>
                <p className="text-xs font-sans text-danger/80">
                  {serverSession.error || 'Could not confirm server session. Re-authenticate to continue.'}
                </p>
              </div>
            ) : !isServerSessionAuthenticated ? (
              <div className="p-2.5 rounded-lg bg-surface-card border border-border-default space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 text-muted">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber" />
                    <span>Wallet connected · Authentication required</span>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={authenticatingSession || submitting}
                    onClick={handleAuthenticateSession}
                    className="px-2.5 py-1 rounded bg-surface-card hover:bg-surface-3 border border-border-default text-white font-mono text-xs font-bold disabled:opacity-50"
                  >
                    {authenticatingSession ? 'Authenticating...' : 'Authenticate'}
                  </Button>
                </div>
                <p className="text-xs font-sans text-dim">
                  Sign a one-click session message to confirm wallet ownership with the server before submitting.
                </p>
              </div>
            ) : (
              <div className="p-2 rounded-md bg-brand-bg/30 border border-brand-border/50 flex items-center justify-between gap-2 text-xs font-sans">
                <span className="flex items-center gap-1.5 text-brand font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand shrink-0" />
                  <span>Wallet Authenticated &amp; Ready</span>
                </span>
                <span className="font-mono text-xs text-muted">
                  {connectedAddress ? `${connectedAddress.slice(0, 4)}...${connectedAddress.slice(-4)}` : ''}
                </span>
              </div>
            )}

            {errorMsg && (
              <div className="p-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-xs font-sans flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2 rounded-md bg-brand-bg border border-brand-border text-brand text-xs font-sans flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between pb-1">
                  <label className="text-xs font-mono text-muted uppercase font-bold" htmlFor={`wallet-${campaign.id}`}>
                    Solana Wallet Address
                  </label>
                  {isWalletConnected && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSwitchWallet?.()}
                      className="h-auto p-0 text-xs font-mono text-raid-primary hover:underline hover:bg-transparent"
                    >
                      Switch Wallet
                    </Button>
                  )}
                </div>
                <input
                  id={`wallet-${campaign.id}`}
                  type="text"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="Your Solana wallet address..."
                  className={`w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border ${
                    isWalletMismatched
                      ? 'border-amber/60 focus:border-amber text-amber'
                      : 'border-border-default focus:border-raid-primary text-white'
                  } font-mono text-xs placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
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
                    className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
                    className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={
                submitting ||
                !isWalletConnected ||
                !isSigningSupported ||
                isWalletMismatched ||
                !cleanWallet ||
                !cleanHandle ||
                !cleanRetweet
              }
              className="w-full min-h-[44px] px-4 rounded-lg bg-raid-strong hover:bg-raid-primary text-white font-sans text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 shadow-none"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  <span>Submitting Proof...</span>
                </>
              ) : !isWalletConnected ? (
                <>
                  <Wallet className="w-3.5 h-3.5 mr-1.5" />
                  <span>Connect Wallet to Submit</span>
                </>
              ) : !isSigningSupported ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 mr-1.5" />
                  <span>Signing Unsupported</span>
                </>
              ) : isWalletMismatched ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-amber mr-1.5" />
                  <span>Wallet Address Mismatch</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  <span>Claim Raid Airdrop</span>
                </>
              )}
            </Button>
          </form>
        )}
      </div>
    </article>
  );
};
