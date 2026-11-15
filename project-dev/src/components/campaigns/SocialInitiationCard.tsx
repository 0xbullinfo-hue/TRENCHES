'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
  Pin,
  Sparkles,
  Twitter,
  Unlock,
  AlertCircle,
} from 'lucide-react';

export const INITIATION_STORAGE_KEY = 'trenchlabs_social_initiation_v1';

export const INITIATION_TWEET_TEXT =
  "I am now an official assistant of TrenchLabs and I earn by carrying out tasks. TrenchLabs got some crazy Alpha's - check it out here www.trenchlabshq.xyz $H42 #SOL #Trenchlabs";

export const INITIATION_INTENT_URL = `https://x.com/intent/tweet?text=${encodeURIComponent(
  INITIATION_TWEET_TEXT
)}`;

export interface InitiationRecord {
  completed: boolean;
  postUrl?: string;
  completedAt: string;
  wallet?: string | null;
}

export function isValidXPostUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com') return false;
    return /\/status\/\d+/i.test(parsed.pathname) || parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

export interface SocialInitiationCardProps {
  userWallet?: string | null;
  isCompleted: boolean;
  completedRecord?: InitiationRecord | null;
  onComplete: (record: InitiationRecord) => void;
}

export const SocialInitiationCard: React.FC<SocialInitiationCardProps> = ({
  userWallet,
  isCompleted,
  completedRecord,
  onComplete,
}) => {
  const [hasClickedShare, setHasClickedShare] = useState(false);
  const [postUrlInput, setPostUrlInput] = useState('');
  const [copiedText, setCopiedText] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopyPostText = async () => {
    try {
      await navigator.clipboard.writeText(INITIATION_TWEET_TEXT);
      setCopiedText(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedText(false), 2000);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleShareClick = () => {
    setHasClickedShare(true);
    setErrorMsg(null);
  };

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!hasClickedShare && !postUrlInput.trim()) {
      setErrorMsg('Please click "Share on X" first to post the official campaign message.');
      return;
    }

    const trimmedUrl = postUrlInput.trim();
    if (trimmedUrl && !isValidXPostUrl(trimmedUrl)) {
      setErrorMsg('Please enter a valid X (x.com or twitter.com) post link.');
      return;
    }

    const record: InitiationRecord = {
      completed: true,
      postUrl: trimmedUrl || undefined,
      completedAt: new Date().toISOString(),
      wallet: userWallet ?? null,
    };

    onComplete(record);
  };

  return (
    <article
      aria-label="Permanent Campaign: Official TrenchLabs Assistant Initiation"
      data-testid="social-initiation-card"
      className="group relative rounded-xl bg-surface border border-raid-border hover:border-raid-primary transition-all duration-150 p-4 sm:p-5 shadow-none"
    >
      {/* Top Row: Category Tag + Status + Permanent Pin */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border-default">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 rounded-md border border-raid-border bg-raid-bg px-2.5 py-1 font-mono text-xs font-semibold text-raid-text">
            <Sparkles className="w-3 h-3 text-raid-primary" />
            <span>OFFICIAL ASSISTANT CAMPAIGN</span>
          </span>

          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-xs font-black uppercase tracking-wider ${
              isCompleted
                ? 'bg-brand-bg text-brand border border-brand-border'
                : 'bg-amber/15 text-amber border border-amber/40'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isCompleted ? 'bg-brand' : 'bg-amber'
              }`}
            />
            <span>{isCompleted ? 'COMPLETED • RAIDS UNLOCKED' : 'MANDATORY TASK #0'}</span>
          </span>

          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-raid-strong text-white font-mono text-xs font-black uppercase">
            <Pin className="w-2.5 h-2.5" />
            <span>PERMANENT CAMPAIGN</span>
          </span>
        </div>

        <span className="font-mono text-xs font-bold text-raid-primary uppercase">
          {isCompleted ? '✓ Official Assistant Verified' : 'Required for All Social Users'}
        </span>
      </div>

      {/* Main Content Grid */}
      <div className="pt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        {/* Left Column: Mascot + Heading + Pre-loaded Tweet Content */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-surface-card border border-raid-border overflow-hidden shrink-0 flex items-center justify-center">
              <Image
                src="/images/trenchlabs-hero.webp"
                alt=""
                width={48}
                height={48}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-1">
              <h3 className="font-sans text-base sm:text-lg font-extrabold text-white leading-tight">
                Official TrenchLabs Assistant Initiation
              </h3>
              <p className="font-sans text-xs text-muted leading-relaxed">
                Every Free Tier and new community user must share this official campaign post on X before live social raid cards activate.
              </p>
            </div>
          </div>

          {/* Pre-loaded Tweet Box */}
          <div className="rounded-lg bg-surface-card border border-raid-border/60 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold uppercase text-raid-primary flex items-center gap-1.5">
                <Twitter className="w-3.5 h-3.5 text-raid-primary" />
                <span>Campaign Broadcast Copy</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopyPostText}
                className="h-auto px-2 py-0.5 rounded bg-surface hover:bg-surface-3 border border-border-default font-mono text-xs text-muted hover:text-white inline-flex items-center gap-1"
                title="Copy campaign tweet text"
              >
                {copiedText ? (
                  <>
                    <Check className="w-3 h-3 text-brand" />
                    <span className="text-brand">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-raid-primary" />
                    <span>Copy Text</span>
                  </>
                )}
              </Button>
            </div>

            <blockquote
              data-testid="initiation-tweet-copy"
              className="font-sans text-xs sm:text-sm text-white leading-relaxed border-l-2 border-raid-primary pl-3 py-0.5"
            >
              &ldquo;I am now an official assistant of TrenchLabs and I earn by carrying out tasks. TrenchLabs got some crazy Alpha&apos;s - check it out here{' '}
              <span className="font-mono font-bold text-brand underline">
                www.trenchlabshq.xyz
              </span>{' '}
              <span className="font-mono font-bold text-raid-primary">
                $H42 #SOL #Trenchlabs
              </span>
              &rdquo;
            </blockquote>
          </div>
        </div>

        {/* Right Column: Share CTA + Unlock Verification */}
        <div className="lg:col-span-5">
          {isCompleted ? (
            <div className="rounded-xl bg-surface-card border border-brand-border/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-sans text-xs font-extrabold text-brand uppercase">
                  <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />
                  <span>Official Assistant Active</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-brand-bg border border-brand-border font-mono text-xs font-bold text-brand">
                  LIVE RAIDS UNLOCKED
                </span>
              </div>

              <p className="font-sans text-xs text-muted leading-relaxed">
                Thank you for broadcasting TrenchLabs! All live Social Raid cards below are now unlocked and ready for your submissions.
              </p>

              {completedRecord?.postUrl && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-default font-mono text-xs text-muted">
                  <span>Shared Post:</span>
                  <a
                    href={
                      completedRecord.postUrl.startsWith('http')
                        ? completedRecord.postUrl
                        : `https://${completedRecord.postUrl}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-raid-primary hover:underline inline-flex items-center gap-1 font-bold"
                  >
                    <span>View X Post</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              <a
                href={INITIATION_INTENT_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="initiation-share-button"
                className="inline-flex items-center justify-center gap-2 w-full h-11 min-h-[44px] px-4 rounded-lg bg-raid-strong hover:bg-raid-primary text-white font-sans text-xs font-black uppercase tracking-wider transition-colors"
              >
                <Twitter className="w-4 h-4" />
                <span>Share Campaign Post on X Again</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <form
              onSubmit={handleVerifySubmit}
              className="rounded-xl bg-surface-card border border-border-default p-4 space-y-3"
            >
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-raid-primary font-bold uppercase">
                  {hasClickedShare ? 'Step 2 of 2: Activate Raids' : 'Step 1 of 2: Share on X'}
                </span>
                <span className="text-amber font-bold flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>Raids Locked</span>
                </span>
              </div>

              {/* Primary Share Button */}
              <a
                href={INITIATION_INTENT_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleShareClick}
                data-testid="initiation-share-button"
                className="inline-flex items-center justify-center gap-2 w-full h-11 min-h-[44px] px-4 rounded-lg bg-raid-strong hover:bg-raid-primary text-white font-sans text-xs font-black uppercase tracking-wider transition-colors"
              >
                <Twitter className="w-4 h-4" />
                <span>1. Share Official Assistant Post on X</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <div className="space-y-1.5">
                <label
                  htmlFor="initiation-post-url"
                  className="block font-mono text-xs text-muted"
                >
                  Optional: Paste your X post URL (or click Unlock after sharing)
                </label>
                <input
                  id="initiation-post-url"
                  type="text"
                  value={postUrlInput}
                  onChange={(e) => setPostUrlInput(e.target.value)}
                  placeholder="https://x.com/yourhandle/status/..."
                  className="w-full h-10 min-h-[40px] px-3 rounded-lg bg-surface border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              {errorMsg && (
                <div className="p-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-xs font-sans flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                data-testid="initiation-unlock-button"
                className="w-full min-h-[44px] px-4 rounded-lg bg-brand hover:bg-brand-bright text-canvas font-sans text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 shadow-none"
              >
                <Unlock className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>2. Complete Task &amp; Activate Live Social Cards</span>
              </Button>
            </form>
          )}
        </div>
      </div>
    </article>
  );
};
