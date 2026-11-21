'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import type { Tier } from '@/lib/tiers';
import type {
  AlphaItem,
  CallType,
  Chain,
  FavoritePostKind,
  FavoritePostRecord,
  Portfolio,
  SyndicateCaller,
} from '@/lib/types';
import {
  type DemoPreset,
  DEMO_ENABLED,
  WalletContext,
  WalletProvider,
  useWalletState,
} from './WalletContext';
import {
  type CreateCallPayload,
  type VerificationState,
  AuthContext,
  AuthProvider,
  useAuthState,
} from './AuthContext';

export type { DemoPreset, CreateCallPayload, VerificationState };
export { DEMO_ENABLED, WalletContext, WalletProvider, useWalletState };
export { AuthContext, AuthProvider, useAuthState };

export interface GenesisContextValue {
  connected: boolean;
  publicKeyBase58: string | null;
  shortAddress: string;
  ataAddress: string | null;
  genesisMint: string;

  balance: number;
  formattedBalance: string;
  tier: Tier;
  multiplier: number;
  capSol: number;
  points: number;
  isZeroBalance: boolean;
  isUnlocked: boolean;
  isAdmin: boolean;

  alphas: AlphaItem[];
  adminAlphas?: AlphaItem[];
  adminActionError?: string | null;
  callers: SyndicateCaller[];
  portfolio: Portfolio | null;
  verifiedUsersCount: number;
  apiLoading: boolean;
  apiError: string | null;
  needsSignature: boolean;
  verificationState: VerificationState;
  refreshAll: () => Promise<void>;
  requestUnlockSignature: () => Promise<void>;
  /** Wallet-signed headers for an arbitrary API call (message bound to method + path). Cached ~4 min. */
  signRequestHeaders: (method: string, path: string) => Promise<Record<string, string> | null>;

  createAlphaCall: (payload: CreateCallPayload) => Promise<boolean>;
  updateAlphaCall: (id: string, updates: Record<string, unknown>) => Promise<boolean>;
  togglePinCall: (id: string, nextPinned: boolean) => Promise<boolean>;
  toggleMaxAlpha: (id: string, isMaxAlpha: boolean) => Promise<boolean>;
  updateCallCategory: (id: string, callType: CallType) => Promise<boolean>;
  toggleTpHit: (id: string, tpIndex: number) => Promise<boolean>;
  setCallOutcome: (id: string, outcome: 'PROFIT' | 'LOSS' | 'PENDING') => Promise<boolean>;
  updateCallMarketCap: (id: string, marketCap: string) => Promise<boolean>;
  deleteAlphaCall: (id: string) => Promise<boolean>;
  getAdminHeaders?: (method: string, urlPath: string, bodyStr: string) => Promise<Record<string, string>>;

  watchlist: string[];
  toggleWatchlist: (tokenId: string) => void;
  favorites?: FavoritePostRecord[];
  toggleFavorite?: (kind: FavoritePostKind, id: string) => void;
  isFavorited?: (kind: FavoritePostKind, id: string) => boolean;
  favoriteError?: string | null;
  clearFavoriteError?: () => void;
  recordAllocation: (ticker: string, chain: Chain, amountSol: string) => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  boundEvmAddress: string;
  setBoundEvmAddress: (addr: string) => boolean;

  demoPreset: DemoPreset;
  setDemoPreset: (preset: DemoPreset) => void;
  connectWallet: () => void;
  switchWallet: () => void | Promise<void>;
  disconnectDemoOrWallet: () => Promise<void>;
  demoEnabled: boolean;
}

export const GenesisContext = createContext<GenesisContextValue | undefined>(undefined);

function GenesisBridge({ children }: { children: React.ReactNode }) {
  const walletState = useWalletState();
  const authState = useAuthState();

  const disconnectDemoOrWallet = useCallback(async () => {
    authState.resetAuthState();
    await walletState.disconnectDemoOrWallet();
  }, [authState, walletState]);

  const value = useMemo<GenesisContextValue>(
    () => ({
      ...walletState,
      ...authState,
      disconnectDemoOrWallet,
    }),
    [walletState, authState, disconnectDemoOrWallet]
  );

  return <GenesisContext.Provider value={value}>{children}</GenesisContext.Provider>;
}

export function GenesisProvider({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <AuthProvider>
        <GenesisBridge>{children}</GenesisBridge>
      </AuthProvider>
    </WalletProvider>
  );
}

export function useGenesisBalance(): GenesisContextValue {
  const ctx = useContext(GenesisContext);
  if (!ctx) {
    throw new Error('useGenesisBalance must be used inside GenesisProvider');
  }
  return ctx;
}
