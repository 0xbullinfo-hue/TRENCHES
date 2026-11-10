'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { Campaign, CampaignSubmission } from '@/lib/types';
import { CampaignCard } from './CampaignCard';
import { Gift, RefreshCw, Sparkles } from 'lucide-react';

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
              className="rounded-xl bg-surface border border-border-default p-5 space-y-4 animate-pulse min-h-[320px]"
            >
              <div className="flex justify-between items-center">
                <div className="w-24 h-5 rounded-md bg-surface-card" />
                <div className="w-16 h-5 rounded-md bg-surface-card" />
              </div>
              <div className="space-y-2">
                <div className="w-3/4 h-5 rounded-md bg-surface-card" />
                <div className="w-full h-12 rounded-md bg-surface-card" />
              </div>
              <div className="w-full h-10 rounded-lg bg-surface-card" />
              <div className="w-full h-20 rounded-lg bg-surface-card" />
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
            Check back soon for upcoming viral X raids, retweets, and community $GENESIS airdrops.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              userWallet={userWallet}
              isAdmin={isAdmin}
              onTogglePin={onTogglePin}
              onSubmissionSuccess={handleInternalSubmissionSuccess}
            />
          ))}
        </div>
      )}
    </div>
  );
};
