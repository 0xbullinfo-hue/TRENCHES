'use client';

import React, { useMemo, useState } from 'react';
import type { AlphaItem, Campaign, FavoritePostKind, FavoritePostRecord } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { ArrowUpRight, PinOff, RadioTower, Star, Target, Zap } from 'lucide-react';

export interface MyPinnedPostsProps {
  favorites: FavoritePostRecord[];
  alphas: AlphaItem[];
  campaigns: Campaign[];
  membershipTier: 'FREE' | 'MEMBER' | 'PRO';
  isAdmin?: boolean;
  onOpenAlpha: (coin: AlphaItem, destination: 'ALPHA' | 'MAX_ALPHA') => void;
  onOpenRaid: (campaignId: string) => void;
  onUnpin: (kind: FavoritePostKind, id: string) => void;
  onBrowseWorkspace?: (ws: 'ALPHA' | 'MAX_ALPHA' | 'SOCIAL') => void;
}

type PinnedFilter = 'ALL' | 'ALPHA' | 'MAX_ALPHA' | 'RAID';

interface ResolvedPinnedItem {
  key: string;
  id: string;
  storedKind: FavoritePostKind;
  displayKind: FavoritePostKind;
  title: string;
  subtitle: string;
  meta: string;
  badgeLabel: string;
  badgeClass: string;
  targetWorkspace: 'ALPHA' | 'MAX_ALPHA' | 'SOCIAL';
  alpha?: AlphaItem;
  campaign?: Campaign;
  createdAt: string;
}

const PREVIEW_LIMIT = 4;

export const MyPinnedPosts: React.FC<MyPinnedPostsProps> = ({
  favorites,
  alphas,
  campaigns,
  membershipTier,
  isAdmin = false,
  onOpenAlpha,
  onOpenRaid,
  onUnpin,
  onBrowseWorkspace,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<PinnedFilter>('ALL');
  const [expanded, setExpanded] = useState(false);

  const isProOrAdmin = isAdmin || membershipTier === 'PRO';
  const isMemberOrAbove = isProOrAdmin || membershipTier === 'MEMBER';

  const resolvedItems = useMemo<ResolvedPinnedItem[]>(() => {
    const alphasById = new Map(alphas.map((a) => [a.id, a]));
    const campaignsById = new Map(campaigns.map((c) => [c.id, c]));
    const dedup = new Map<string, ResolvedPinnedItem>();

    for (const fav of favorites) {
      if (fav.kind === 'RAID') {
        const campaign = campaignsById.get(fav.id);
        if (!campaign) continue;
        const key = `RAID:${fav.id}`;
        if (dedup.has(key)) continue;

        dedup.set(key, {
          key,
          id: fav.id,
          storedKind: 'RAID',
          displayKind: 'RAID',
          title: campaign.title,
          subtitle: campaign.rewardAmount ? `Reward ${campaign.rewardAmount}` : 'Community Campaign',
          meta: campaign.status === 'ACTIVE' ? 'Live Raid' : campaign.status,
          badgeLabel: 'RAID',
          badgeClass: 'bg-raid-bg text-raid-primary border-raid-border',
          targetWorkspace: 'SOCIAL',
          campaign,
          createdAt: fav.createdAt,
        });
        continue;
      }

      const alpha = alphasById.get(fav.id);
      if (!alpha || alpha.callType === 'WATCHLIST') continue;

      const isMaxAlphaItem =
        alpha.callType === 'MAX_ALPHA' ||
        Boolean(alpha.isMaxAlpha) ||
        (Boolean(alpha.destinations?.includes('MAX_ALPHA')) && !alpha.destinations?.includes('ALPHA'));

      // Enforce tier permissions strictly so favourites never become a restricted-content bypass
      if (!isMemberOrAbove) continue;
      if (isMaxAlphaItem && !isProOrAdmin) continue;

      const displayKind: FavoritePostKind = isMaxAlphaItem ? 'MAX_ALPHA' : 'ALPHA';
      const key = `CALL:${fav.id}`;
      if (dedup.has(key)) continue;

      dedup.set(key, {
        key,
        id: fav.id,
        storedKind: fav.kind,
        displayKind,
        title: alpha.name,
        subtitle: alpha.ticker,
        meta: `${alpha.chain} · MC ${alpha.marketCap || '—'} · ${alpha.riskRewardRatio || `Lvl ${alpha.risk}/5`}`,
        badgeLabel: displayKind === 'MAX_ALPHA' ? 'MAX ALPHA' : 'ALPHA CALL',
        badgeClass:
          displayKind === 'MAX_ALPHA'
            ? 'bg-alpha-strong/20 text-alpha-primary border-alpha-strong'
            : 'bg-brand-bg text-brand border-brand-border',
        targetWorkspace: displayKind === 'MAX_ALPHA' ? 'MAX_ALPHA' : 'ALPHA',
        alpha,
        createdAt: fav.createdAt,
      });
    }

    return Array.from(dedup.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [favorites, alphas, campaigns, isMemberOrAbove, isProOrAdmin]);

  const counts = useMemo(() => {
    const out = { ALL: resolvedItems.length, ALPHA: 0, MAX_ALPHA: 0, RAID: 0 };
    for (const item of resolvedItems) {
      if (item.displayKind === 'ALPHA') out.ALPHA += 1;
      else if (item.displayKind === 'MAX_ALPHA') out.MAX_ALPHA += 1;
      else if (item.displayKind === 'RAID') out.RAID += 1;
    }
    return out;
  }, [resolvedItems]);

  const effectiveFilter: PinnedFilter =
    categoryFilter === 'MAX_ALPHA' && !isProOrAdmin
      ? 'ALL'
      : categoryFilter === 'ALPHA' && !isMemberOrAbove
      ? 'ALL'
      : categoryFilter;

  const filteredItems = useMemo(() => {
    if (effectiveFilter === 'ALL') return resolvedItems;
    return resolvedItems.filter((item) => item.displayKind === effectiveFilter);
  }, [resolvedItems, effectiveFilter]);

  const visibleItems = expanded ? filteredItems : filteredItems.slice(0, PREVIEW_LIMIT);
  const hasMore = filteredItems.length > PREVIEW_LIMIT;

  const filterOptions: Array<{ id: PinnedFilter; label: string; count: number; show: boolean }> = [
    { id: 'ALL', label: 'All', count: counts.ALL, show: true },
    { id: 'ALPHA', label: 'Alpha', count: counts.ALPHA, show: isMemberOrAbove },
    { id: 'MAX_ALPHA', label: 'Max Alpha', count: counts.MAX_ALPHA, show: isProOrAdmin },
    { id: 'RAID', label: 'Raid', count: counts.RAID, show: true },
  ];

  return (
    <section
      id="pinned-posts"
      data-testid="my-pinned-posts"
      aria-labelledby="my-pinned-posts-heading"
      className="rounded-xl bg-surface border border-border-default p-4 sm:p-5 space-y-4 flex flex-col justify-between"
    >
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-border-default">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber/10 border border-amber/30 flex items-center justify-center text-amber shrink-0">
              <Star className="w-4 h-4 fill-amber" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="my-pinned-posts-heading"
                  className="font-sans text-sm sm:text-base font-extrabold text-white tracking-tight"
                >
                  My Pinned Posts
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-surface-card border border-border-default font-mono text-[11px] font-bold text-amber tnum">
                  {counts.ALL}
                </span>
              </div>
              <p className="font-sans text-xs text-muted">
                Saved Alpha Calls, Max Alpha setups &amp; Raid campaigns
              </p>
            </div>
          </div>

          {resolvedItems.length > 0 && (
            <div
              role="group"
              aria-label="Filter pinned posts by category"
              className="flex items-center gap-1 flex-wrap"
            >
              {filterOptions
                .filter((opt) => opt.show)
                .map((opt) => {
                  const active = effectiveFilter === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`pinned-filter-${opt.id.toLowerCase()}`}
                      onClick={() => setCategoryFilter(opt.id)}
                      className={`h-7 px-2.5 rounded-md font-mono text-[11px] font-bold border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                        active
                          ? 'bg-brand-bg border-brand text-brand'
                          : 'bg-surface-card border-border-default text-muted hover:text-white'
                      }`}
                    >
                      {opt.label} ({opt.count})
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        {resolvedItems.length === 0 ? (
          <div
            data-testid="pinned-posts-empty"
            className="rounded-lg bg-surface-card/70 border border-dashed border-border-default p-5 text-center space-y-3"
          >
            <div className="space-y-1">
              <p className="font-sans text-xs font-bold text-white uppercase tracking-wide">
                No Pinned Posts Yet
              </p>
              <p className="font-sans text-xs text-muted max-w-md mx-auto leading-relaxed">
                Click the star button on any Alpha Call, Max Alpha setup (Pro), or Raid campaign card to pin it here for quick tracking.
              </p>
            </div>
            {onBrowseWorkspace && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {isMemberOrAbove && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onBrowseWorkspace('ALPHA')}
                    className="h-8 px-3 text-xs font-mono font-bold gap-1.5"
                  >
                    <Target className="w-3.5 h-3.5 text-alpha-primary" />
                    <span>Browse Alpha Calls</span>
                  </Button>
                )}
                {isProOrAdmin && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onBrowseWorkspace('MAX_ALPHA')}
                    className="h-8 px-3 text-xs font-mono font-bold gap-1.5"
                  >
                    <Zap className="w-3.5 h-3.5 text-alpha-primary" />
                    <span>Browse Max Alpha</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onBrowseWorkspace('SOCIAL')}
                  className="h-8 px-3 text-xs font-mono font-bold gap-1.5"
                >
                  <RadioTower className="w-3.5 h-3.5 text-raid-primary" />
                  <span>Browse Raids</span>
                </Button>
              </div>
            )}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-lg bg-surface-card/70 border border-border-default p-4 text-center space-y-2">
            <p className="font-sans text-xs text-muted">
              No pinned posts match this category filter.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCategoryFilter('ALL')}
              className="h-7 px-3 text-xs font-mono font-bold text-brand"
            >
              Show All ({counts.ALL})
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleItems.map((item) => (
              <div
                key={item.key}
                data-testid={`pinned-post-item-${item.id}`}
                onClick={() => {
                  if (item.alpha) {
                    onOpenAlpha(item.alpha, item.targetWorkspace === 'MAX_ALPHA' ? 'MAX_ALPHA' : 'ALPHA');
                  } else if (item.campaign) {
                    onOpenRaid(item.campaign.id);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (item.alpha) {
                      onOpenAlpha(item.alpha, item.targetWorkspace === 'MAX_ALPHA' ? 'MAX_ALPHA' : 'ALPHA');
                    } else if (item.campaign) {
                      onOpenRaid(item.campaign.id);
                    }
                  }
                }}
                className="group rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-brand/50 px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-black uppercase shrink-0 ${item.badgeClass}`}
                    >
                      {item.badgeLabel}
                    </span>
                    <span className="font-sans text-xs sm:text-sm font-bold text-white truncate">
                      {item.title}
                    </span>
                    <span className="font-mono text-xs font-bold text-brand shrink-0">
                      {item.subtitle}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-muted truncate tnum">
                    {item.meta}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.alpha) {
                        onOpenAlpha(item.alpha, item.targetWorkspace === 'MAX_ALPHA' ? 'MAX_ALPHA' : 'ALPHA');
                      } else if (item.campaign) {
                        onOpenRaid(item.campaign.id);
                      }
                    }}
                    className="h-8 px-2.5 text-[11px] font-mono font-bold gap-1"
                    title={`Open in ${item.badgeLabel}`}
                  >
                    <span>Open</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`unpin-post-${item.id}`}
                    aria-label={`Unpin ${item.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnpin(item.storedKind, item.id);
                    }}
                    className="h-8 w-8 p-0 border border-border-default hover:border-danger/60 text-muted hover:text-danger"
                    title={`Unpin ${item.title}`}
                  >
                    <PinOff className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hasMore && (
        <div className="pt-1 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            className="h-7 px-2.5 text-xs font-mono font-bold text-brand hover:text-brand-bright"
          >
            {expanded ? 'Show fewer' : `Show all (${filteredItems.length})`}
          </Button>
        </div>
      )}
    </section>
  );
};
