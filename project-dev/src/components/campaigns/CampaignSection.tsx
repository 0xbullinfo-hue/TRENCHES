'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { Campaign, CampaignSubmission } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { CampaignCard } from './CampaignCard';
import {
  SocialInitiationCard,
  INITIATION_STORAGE_KEY,
  type InitiationRecord,
} from './SocialInitiationCard';
import { Gift, Lock, RefreshCw, Sparkles } from 'lucide-react';

interface CampaignSectionProps {
  userWallet?: string | null;
  isAdmin?: boolean;
  campaigns?: Campaign[];
  loading?: boolean;
  onRefresh?: () => void;
  onTogglePin?: (campaignId: string, pinned: boolean) => void;
  onSubmissionSuccess?: (submission: CampaignSubmission) => void;
}

export const CampaignSection: React.FC<CampaignSectionProps> = ({
  userWallet,
  isAdmin,
  campaigns: externalCampaigns,
  loading: externalLoading,
  onRefresh,
  onTogglePin,
  onSubmissionSuccess,
}) => {
  const [internalCampaigns, setInternalCampaigns] = useState<Campaign[]>([]);
  const [internalLoading, setInternalLoading] = useState(true);
  const [initiationRecord, setInitiationRecord] = useState<InitiationRecord | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(INITIATION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as InitiationRecord;
      return parsed && parsed.completed ? parsed : null;
    } catch {
      return null;
    }
  });

  const isInitiationCompleted = Boolean(initiationRecord?.completed);

  const handleCompleteInitiation = useCallback((record: InitiationRecord) => {
    setInitiationRecord(record);
    try {
      window.localStorage.setItem(INITIATION_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const isControlled = externalCampaigns !== undefined;
  const campaigns = isControlled ? externalCampaigns : internalCampaigns;
  const loading = isControlled ? Boolean(externalLoading) : internalLoading;

  const fetchInternalCampaigns = useCallback(async () => {
    try {
      const url = userWallet
        ? `/api/campaigns?wallet=${encodeURIComponent(userWallet)}`
        : '/api/campaigns';
      const res = await fetch(url);
      const json = await res.json();
      if (res.ok && json.ok && Array.isArray(json.campaigns)) {
        setInternalCampaigns(json.campaigns);
      }
    } catch (err) {
      console.error('[CampaignSection] error:', err);
    } finally {
      setInternalLoading(false);
    }
  }, [userWallet]);

  useEffect(() => {
    if (isControlled) return;
    let active = true;
    const run = async () => {
      try {
        const url = userWallet
          ? `/api/campaigns?wallet=${encodeURIComponent(userWallet)}`
          : '/api/campaigns';
        const res = await fetch(url);
        const json = await res.json();
        if (active && res.ok && json.ok && Array.isArray(json.campaigns)) {
          setInternalCampaigns(json.campaigns);
        }
      } catch (err) {
        console.error('[CampaignSection] error:', err);
      } finally {
        if (active) setInternalLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [userWallet, isControlled]);

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      fetchInternalCampaigns();
    }
  };

  const handleInternalSubmissionSuccess = (submission: CampaignSubmission) => {
    if (onSubmissionSuccess) {
      onSubmissionSuccess(submission);
    }
    if (!isControlled) {
      setInternalCampaigns((prev) =>
        prev.map((c) =>
          c.id === submission.campaignId
            ? {
                ...c,
                userSubmission: submission,
                submissionsCount: (c.submissionsCount || 0) + 1,
              }
            : c
        )
      );
    }
  };

  return (
    <div className="space-y-4 pt-2">
      {/* Permanent Mandatory Initiation Card (Required before live social cards activate) */}
      <SocialInitiationCard
        userWallet={userWallet}
        isCompleted={isInitiationCompleted}
        completedRecord={initiationRecord}
        onComplete={handleCompleteInitiation}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="px-3 py-1 rounded-md bg-raid-bg border border-raid-border text-raid-text font-mono text-xs font-black uppercase inline-flex items-center gap-1.5 shadow-none">
            <Gift className="w-3.5 h-3.5 text-raid-primary" />
            <span>COMMUNITY REWARD RAIDS ({campaigns.length})</span>
          </span>
          <span className="font-sans text-xs text-muted hidden sm:inline">
            Run X campaigns, retweet official announcements, and claim verified airdrops (Open to all Free, Member &amp; Pro holders)
          </span>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-1 text-xs font-mono text-raid-primary hover:text-raid-strong self-start sm:self-auto cursor-pointer transition-colors"
          title="Refresh campaigns"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Raids</span>
        </button>
      </div>

      {loading && campaigns.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl bg-surface border border-border-default p-5 space-y-4 min-h-[320px]"
            >
              <div className="flex justify-between items-center">
                <Skeleton className="w-24 h-5 rounded-md" />
                <Skeleton className="w-16 h-5 rounded-md" />
              </div>
              <div className="space-y-2">
                <Skeleton className="w-3/4 h-5 rounded-md" />
                <Skeleton className="w-full h-12 rounded-md" />
              </div>
              <Skeleton className="w-full h-10 rounded-lg" />
              <Skeleton className="w-full h-20 rounded-lg" />
            </div>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl bg-surface border border-border-default p-8 text-center space-y-2">
          <Sparkles className="w-6 h-6 text-raid-primary mx-auto" />
          <h4 className="font-sans font-bold text-sm text-white uppercase">
            No Active Raid Campaigns
          </h4>
          <p className="font-sans text-xs text-muted max-w-sm mx-auto">
            Check back soon for upcoming viral X raids, retweets, and community $H42 airdrops.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
          {campaigns.map((c) =>
            isInitiationCompleted ? (
              <CampaignCard
                key={c.id}
                campaign={c}
                userWallet={userWallet}
                isAdmin={isAdmin}
                onTogglePin={onTogglePin}
                onSubmissionSuccess={handleInternalSubmissionSuccess}
              />
            ) : (
              <div
                key={c.id}
                data-testid="locked-social-card-gate"
                className="relative rounded-xl overflow-hidden h-full"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none select-none opacity-35 blur-[1.5px] h-full"
                >
                  <CampaignCard
                    campaign={c}
                    userWallet={userWallet}
                    isAdmin={isAdmin}
                    onTogglePin={onTogglePin}
                    onSubmissionSuccess={handleInternalSubmissionSuccess}
                  />
                </div>
                <div className="absolute inset-0 bg-canvas/75 flex flex-col items-center justify-center p-6 text-center rounded-xl border border-raid-border space-y-2.5">
                  <div className="w-10 h-10 rounded-lg bg-raid-bg border border-raid-border flex items-center justify-center text-raid-primary">
                    <Lock className="w-5 h-5" />
                  </div>
                  <h4 className="font-sans text-sm font-extrabold uppercase text-white tracking-tight">
                    Complete Assistant Initiation First
                  </h4>
                  <p className="font-sans text-xs text-muted max-w-xs leading-relaxed">
                    Carry out the permanent Official TrenchLabs Assistant share task above to activate this live social card.
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};
