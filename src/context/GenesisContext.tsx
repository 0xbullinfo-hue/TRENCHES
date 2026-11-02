'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { GENESIS_MINT, MINT_CONFIGURED } from '@/lib/config';
import {
  MIN_GENESIS_REQUIRED,
  Tier,
  allocationCap,
  longevityPoints,
  tierFor,
} from '@/lib/tiers';
import type {
  AlphaItem,
  AlphasResponse,
  Chain,
  Portfolio,
  SyndicateCaller,
} from '@/lib/types';

export type DemoPreset = 'disconnected' | '0' | '1m' | 'live';

const DEMO_WALLETS: Record<Exclude<DemoPreset, 'disconnected' | 'live'>, string> = {
  '0': '8xK4ZeroBal1111111111111111111111111119Lm2',
  '1m': '8xK4LabMember1M111111111111111111111119Lm2',
};

const DEMO_BALANCES: Record<Exclude<DemoPreset, 'disconnected' | 'live'>, number> = {
  '0': 0,
  '1m': 1_000_000,
};

interface GenesisContextValue {
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

  alphas: AlphaItem[];
  callers: SyndicateCaller[];
  portfolio: Portfolio | null;
  apiLoading: boolean;
  apiError: string | null;
  refreshAll: () => Promise<void>;

  watchlist: string[];
  toggleWatchlist: (tokenId: string) => void;
  recordAllocation: (ticker: string, chain: Chain, amountSol: string) => void;

  boundEvmAddress: string;
  setBoundEvmAddress: (addr: string) => void;

  demoPreset: DemoPreset;
  setDemoPreset: (preset: DemoPreset) => void;
  disconnectDemoOrWallet: () => void;
}

const GenesisContext = createContext<GenesisContextValue | undefined>(undefined);

const EVM_STORAGE_KEY = 'trenchlabs_bound_evm_v2';
const WATCHLIST_STORAGE_KEY = 'trenchlabs_watchlist_v3';

export function GenesisProvider({ children }: { children: React.ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();

  // Default to '1m' (1,000,000 $GENESIS Lab Member) so the dashboard can be inspected immediately,
  // and switches to 'live' automatically when a real Solana wallet connects.
  const [demoPreset, setDemoPresetState] = useState<DemoPreset>('1m');
  const [onChainBalance, setOnChainBalance] = useState<number>(0);
  const [ataAddress, setAtaAddress] = useState<string | null>(null);

  const [alphas, setAlphas] = useState<AlphaItem[]>([]);
  const [callers, setCallers] = useState<SyndicateCaller[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [apiLoading, setApiLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [boundEvmAddress, setBoundEvmAddressState] = useState<string>('');
  const [watchlist, setWatchlist] = useState<string[]>(['pill-trench', 'swordcat']);

  useEffect(() => {
    try {
      const savedEvm = window.localStorage.getItem(EVM_STORAGE_KEY);
      if (savedEvm) setBoundEvmAddressState(savedEvm);
      const savedWatch = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
      if (savedWatch) {
        const parsed = JSON.parse(savedWatch);
        if (Array.isArray(parsed)) setWatchlist(parsed);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const setBoundEvmAddress = useCallback((addr: string) => {
    setBoundEvmAddressState(addr);
    try {
      window.localStorage.setItem(EVM_STORAGE_KEY, addr);
    } catch {
      // ignore
    }
  }, []);

  const toggleWatchlist = useCallback((tokenId: string) => {
    setWatchlist((prev) => {
      const exists = prev.includes(tokenId);
      const next = exists ? prev.filter((id) => id !== tokenId) : [...prev, tokenId];
      try {
        window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const recordAllocation = useCallback(
    (ticker: string, chain: Chain, amountSol: string) => {
      setPortfolio((prev) => {
        const base = prev ?? {
          claimedCount: 0,
          totalRealizedPnl: '+42.50 SOL',
          history: [],
        };
        const newEntry = {
          ticker,
          chain,
          size: amountSol,
          pnl: 'OPEN ALLOC',
          pnlPositive: true,
          slot: 299_104_880 + Math.floor(Math.random() * 900),
          claimedAt: new Date().toISOString(),
          sig: `5xGen${Math.random().toString(36).slice(2, 10)}TrenchLabsVerifiedAllocationSig99`,
        };
        return {
          ...base,
          claimedCount: base.claimedCount + 1,
          history: [newEntry, ...base.history],
        };
      });
    },
    []
  );

  useEffect(() => {
    if (wallet.connected && wallet.publicKey) {
      setDemoPresetState('live');
    }
  }, [wallet.connected, wallet.publicKey]);

  const readSplBalance = useCallback(async () => {
    if (!wallet.publicKey) {
      setOnChainBalance(0);
      setAtaAddress(null);
      return;
    }

    try {
      const mintKey = new PublicKey(GENESIS_MINT);
      const ata = getAssociatedTokenAddressSync(mintKey, wallet.publicKey);
      setAtaAddress(ata.toBase58());

      if (!MINT_CONFIGURED) {
        setOnChainBalance(0);
        return;
      }

      const parsed = await connection.getParsedTokenAccountsByOwner(
        wallet.publicKey,
        { mint: mintKey },
        'confirmed'
      );

      const total = parsed.value.reduce((acc, item) => {
        const uiAmount = item.account.data.parsed?.info?.tokenAmount?.uiAmount;
        return acc + (typeof uiAmount === 'number' ? uiAmount : 0);
      }, 0);

      setOnChainBalance(total);
    } catch {
      setOnChainBalance(0);
    }
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    if (demoPreset === 'live') {
      readSplBalance();
    }
  }, [demoPreset, readSplBalance]);

  const connected = useMemo(() => {
    if (demoPreset === 'disconnected') return false;
    if (demoPreset === 'live') return wallet.connected && !!wallet.publicKey;
    return true;
  }, [demoPreset, wallet.connected, wallet.publicKey]);

  const publicKeyBase58 = useMemo(() => {
    if (!connected) return null;
    if (demoPreset === 'live' && wallet.publicKey) {
      return wallet.publicKey.toBase58();
    }
    if (demoPreset !== 'disconnected' && demoPreset !== 'live') {
      return DEMO_WALLETS[demoPreset];
    }
    return null;
  }, [connected, demoPreset, wallet.publicKey]);

  const shortAddress = useMemo(() => {
    if (!publicKeyBase58) return '';
    return `${publicKeyBase58.slice(0, 4)}...${publicKeyBase58.slice(-4)}`;
  }, [publicKeyBase58]);

  const balance = useMemo(() => {
    if (!connected) return 0;
    if (demoPreset === 'live') return onChainBalance;
    if (demoPreset !== 'disconnected') return DEMO_BALANCES[demoPreset];
    return 0;
  }, [connected, demoPreset, onChainBalance]);

  const formattedBalance = useMemo(
    () => new Intl.NumberFormat('en-US').format(balance),
    [balance]
  );

  const tier = useMemo(() => tierFor(balance), [balance]);
  const multiplier = tier.multiplier;
  const capSol = useMemo(() => allocationCap(tier), [tier]);
  const points = useMemo(() => longevityPoints(balance), [balance]);

  const isZeroBalance = connected && balance < MIN_GENESIS_REQUIRED;
  const isUnlocked = connected && balance >= MIN_GENESIS_REQUIRED;

  const fetchAlphasFromBackend = useCallback(async (bal: number, isConn: boolean) => {
    if (!isConn) {
      setAlphas([]);
      setCallers([]);
      setPortfolio(null);
      setApiError(null);
      return;
    }

    setApiLoading(true);
    try {
      const res = await fetch(`/api/alphas?balance=${encodeURIComponent(bal)}`, {
        cache: 'no-store',
      });
      const data: AlphasResponse = await res.json();

      if (!res.ok || !data.ok) {
        setAlphas([]);
        setCallers([]);
        setPortfolio(null);
        setApiError(!data.ok ? data.error : 'ACCESS_DENIED_ZERO_BALANCE');
      } else {
        setAlphas(data.items);
        setCallers(data.callers ?? []);
        setPortfolio(data.portfolio);
        setApiError(null);
      }
    } catch {
      setApiError('RPC_UNAVAILABLE');
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlphasFromBackend(balance, connected);
  }, [balance, connected, fetchAlphasFromBackend]);

  const setDemoPreset = useCallback((preset: DemoPreset) => {
    setDemoPresetState(preset);
  }, []);

  const disconnectDemoOrWallet = useCallback(() => {
    if (wallet.connected) {
      wallet.disconnect().catch(() => {});
    }
    setDemoPresetState('disconnected');
  }, [wallet]);

  const refreshAll = useCallback(async () => {
    if (demoPreset === 'live') {
      await readSplBalance();
    }
    await fetchAlphasFromBackend(balance, connected);
  }, [demoPreset, readSplBalance, fetchAlphasFromBackend, balance, connected]);

  const value: GenesisContextValue = {
    connected,
    publicKeyBase58,
    shortAddress,
    ataAddress,
    genesisMint: GENESIS_MINT,
    balance,
    formattedBalance,
    tier,
    multiplier,
    capSol,
    points,
    isZeroBalance,
    isUnlocked,
    alphas,
    callers,
    portfolio,
    apiLoading,
    apiError,
    refreshAll,
    watchlist,
    toggleWatchlist,
    recordAllocation,
    boundEvmAddress,
    setBoundEvmAddress,
    demoPreset,
    setDemoPreset,
    disconnectDemoOrWallet,
  };

  return <GenesisContext.Provider value={value}>{children}</GenesisContext.Provider>;
}

export function useGenesisBalance() {
  const ctx = useContext(GenesisContext);
  if (!ctx) {
    throw new Error('useGenesisBalance must be used inside GenesisProvider');
  }
  return ctx;
}
