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
          <span className="px-2.5 py-1 rounded bg-purple-600 text-white font-mono text-xs font-black uppercase inline-flex items-center gap-1.5 shadow-sm">
            <Gift className="w-3.5 h-3.5" />
            <span>COMMUNITY REWARD RAIDS ({campaigns.length})</span>
          </span>
          <span className="font-sans text-xs text-muted hidden sm:inline">
            Run X campaigns, retweet official announcements, and claim verified airdrops (Open to all Free, Member &amp; Pro holders)
          </span>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-1 text-xs font-mono text-purple-400 hover:text-purple-300 self-start sm:self-auto cursor-pointer"
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
              className="rounded-xl bg-surface border-2 border-purple-500/40 p-4 space-y-3 animate-pulse"
            >
              <div className="w-full h-8 bg-surface-card rounded-md" />
              <div className="h-4 bg-surface-card rounded w-3/4" />
              <div className="h-16 bg-surface-card rounded w-full" />
              <div className="h-10 bg-surface-card rounded w-full" />
            </div>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl bg-surface border border-purple-500/30 p-10 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-purple-500/15 border border-purple-500/40 mx-auto flex items-center justify-center text-purple-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <h3 className="font-sans text-base font-bold text-white">No active raid campaigns right now</h3>
          <p className="font-sans text-xs text-muted max-w-sm mx-auto">
            Check back soon for upcoming X community raids and verified $GENESIS airdrop missions.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {campaigns.map((camp) => (
            <CampaignCard
              key={camp.id}
              campaign={camp}
              userWallet={userWallet}
              isAdmin={isAdmin}
              onSubmissionSuccess={handleInternalSubmissionSuccess}
              onTogglePin={onTogglePin}
            />
          ))}
        </div>
      )}
    </div>
  );
};
