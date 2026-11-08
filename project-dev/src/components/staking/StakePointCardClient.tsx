'use client';

import React, { useState, useEffect } from 'react';
import { StakePointPool } from '@/lib/stakepoint/types';
import { StakePointCardView } from './StakePointCard';
import { StakePointCardSkeleton } from './StakePointCardSkeleton';
import { StakePointCardError } from './StakePointCardError';

interface StakePointCardClientProps {
  initialPools?: StakePointPool[];
  hideIfEmpty?: boolean;
}

export function StakePointCardClient({ initialPools, hideIfEmpty = false }: StakePointCardClientProps) {
  const [pools, setPools] = useState<StakePointPool[] | null>(initialPools ?? null);
  const [loading, setLoading] = useState<boolean>(!initialPools);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/stakepoint/pools');
      if (!res.ok) {
        throw new Error(`Failed to load: HTTP ${res.status}`);
      }
      const data = await res.json();
      setPools(data.pools || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to StakePoint API';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialPools) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadData();
    }
  }, [initialPools]);

  if (loading && !pools) {
    return <StakePointCardSkeleton />;
  }

  if (error && !pools) {
    if (hideIfEmpty) return null;
    return <StakePointCardError onRetry={loadData} errorMessage={error} />;
  }

  if (hideIfEmpty && (!pools || pools.length === 0)) {
    return null;
  }

  return <StakePointCardView pools={pools || []} />;
}
