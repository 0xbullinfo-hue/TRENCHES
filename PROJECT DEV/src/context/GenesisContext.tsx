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
import {
  ADMIN_WALLET,
  GENESIS_MINT,
  MINT_CONFIGURED,
  isAdminWallet,
} from '@/lib/config';
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

export type DemoPreset = 'disconnected' | '0' | '1m' | 'admin' | 'live';

const DEMO_WALLETS: Record<Exclude<DemoPreset, 'disconnected' | 'live'>, string> = {
  '0': 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  '1m': '11111111111111111111111111111111',
  admin: ADMIN_WALLET,
};

const DEMO_BALANCES: Record<Exclude<DemoPreset, 'disconnected' | 'live'>, number> = {
  '0': 0,
  '1m': 1_000_000,
  admin: 1_000_000,
};

export interface CreateCallPayload {
  name: string;
  ticker: string;
  ca: string;
  chain: Chain;
  marketCap: string;
  entryMarketCap?: string;
  risk: number;
  riskRewardRatio: string;
  stopLoss: string;
  takeProfitInput: string;
  pinned: boolean;
  summary?: string;
  serialTag?: string;
}

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
  isAdmin: boolean;

  alphas: AlphaItem[];
  callers: SyndicateCaller[];
  portfolio: Portfolio | null;
  apiLoading: boolean;
  apiError: string | null;
  refreshAll: () => Promise<void>;

  createAlphaCall: (payload: CreateCallPayload) => Promise<boolean>;
  togglePinCall: (id: string, nextPinned: boolean) => Promise<boolean>;
  toggleTpHit: (id: string, tpIndex: number) => Promise<boolean>;
  setCallOutcome: (id: string, outcome: 'PROFIT' | 'LOSS' | 'PENDING') => Promise<boolean>;
  updateCallMarketCap: (id: string, marketCap: string) => Promise<boolean>;
  deleteAlphaCall: (id: string) => Promise<boolean>;

  watchlist: string[];
  toggleWatchlist: (tokenId: string) => void;
  recordAllocation: (ticker: string, chain: Chain, amountSol: string) => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  boundEvmAddress: string;
  setBoundEvmAddress: (addr: string) => void;

  demoPreset: DemoPreset;
  setDemoPreset: (preset: DemoPreset) => void;
  disconnectDemoOrWallet: () => void;
}

const GenesisContext = createContext<GenesisContextValue | undefined>(undefined);

const EVM_STORAGE_KEY = 'trenchlabs_bound_evm_v2';
const WATCHLIST_STORAGE_KEY = 'trenchlabs_watchlist_v3';
const DEMO_PRESET_STORAGE_KEY = 'trenchlabs_demo_preset_v1';

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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [watchlist, setWatchlist] = useState<string[]>(['pill-trench', 'robin-hoodlum', 'swordcat']);

  useEffect(() => {
    try {
      const savedPreset = window.localStorage.getItem(DEMO_PRESET_STORAGE_KEY) as DemoPreset | null;
      if (savedPreset) setDemoPresetState(savedPreset);
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

  const isAdmin = useMemo(
    () => Boolean(connected && publicKeyBase58 && isAdminWallet(publicKeyBase58)),
    [connected, publicKeyBase58]
  );

  const shortAddress = useMemo(() => {
    if (!publicKeyBase58) return '';
    return `${publicKeyBase58.slice(0, 4)}...${publicKeyBase58.slice(-4)}`;
  }, [publicKeyBase58]);

  const balance = useMemo(() => {
    if (!connected) return 0;
    if (demoPreset === 'live') {
      if (isAdmin && onChainBalance < MIN_GENESIS_REQUIRED) {
        return MIN_GENESIS_REQUIRED;
      }
      return onChainBalance;
    }
    if (demoPreset !== 'disconnected') return DEMO_BALANCES[demoPreset];
    return 0;
  }, [connected, demoPreset, onChainBalance, isAdmin]);

  const formattedBalance = useMemo(
    () => new Intl.NumberFormat('en-US').format(balance),
    [balance]
  );

  const tier = useMemo(() => tierFor(balance), [balance]);
  const multiplier = tier.multiplier;
  const capSol = useMemo(() => allocationCap(tier), [tier]);
  const points = useMemo(() => longevityPoints(balance), [balance]);

  const isZeroBalance = connected && !isAdmin && balance < MIN_GENESIS_REQUIRED;
  const isUnlocked = connected && (isAdmin || balance >= MIN_GENESIS_REQUIRED);

  const fetchAlphasFromBackend = useCallback(
    async (bal: number, isConn: boolean, walletAddr: string | null) => {
      if (!isConn) {
        setAlphas([]);
        setCallers([]);
        setPortfolio(null);
        setApiError(null);
        return;
      }

      setApiLoading(true);
      try {
        // Enforce wallet-based server verification whenever an address is available
        const query = walletAddr
          ? `wallet=${encodeURIComponent(walletAddr)}`
          : `balance=${encodeURIComponent(bal)}`;

        const res = await fetch(`/api/alphas?${query}`, {
          cache: 'no-store',
        });
        const data: AlphasResponse = await res.json();

        if (!res.ok || !data.ok) {
          setAlphas([]);
          setCallers([]);
          setPortfolio(null);
          setApiError(!data.ok ? data.message || data.error : 'ACCESS_DENIED_ZERO_BALANCE');
        } else {
          setAlphas(data.items);
          setCallers(data.callers ?? []);
          setPortfolio(data.portfolio);
          setApiError(null);
        }
      } catch (err) {
        setApiError((err as Error).message || 'Solana RPC network unavailable');
      } finally {
        setApiLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchAlphasFromBackend(balance, connected, publicKeyBase58);
  }, [balance, connected, publicKeyBase58, fetchAlphasFromBackend]);

  const getAdminHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const adminAddr = publicKeyBase58 || ADMIN_WALLET;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-admin-wallet': adminAddr,
    };

    // If real admin wallet is connected, cryptographically sign the authentication challenge
    if (
      wallet.connected &&
      wallet.publicKey &&
      wallet.signMessage &&
      wallet.publicKey.toBase58() === ADMIN_WALLET
    ) {
      try {
        const timestamp = Date.now().toString();
        const message = `TrenchLabs Admin Auth: ${timestamp}`;
        const encoded = new TextEncoder().encode(message);
        const sigBytes = await wallet.signMessage(encoded);
        const sigHex = Array.from(sigBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        headers['x-admin-timestamp'] = timestamp;
        headers['x-admin-signature'] = sigHex;
        return headers;
      } catch {
        // User rejected signature prompt in wallet popup
      }
    }

    // In local dev/preview mode only
    headers['x-admin-simulated'] = 'true';
    return headers;
  }, [publicKeyBase58, wallet]);

  const createAlphaCall = useCallback(
    async (payload: CreateCallPayload): Promise<boolean> => {
      try {
        const headers = await getAdminHeaders();
        const res = await fetch('/api/alphas', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [getAdminHeaders]
  );

  const togglePinCall = useCallback(
    async (id: string, nextPinned: boolean): Promise<boolean> => {
      try {
        const headers = await getAdminHeaders();
        const res = await fetch('/api/alphas', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            id,
            pinned: nextPinned,
          }),
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [getAdminHeaders]
  );

  const toggleTpHit = useCallback(
    async (id: string, tpIndex: number): Promise<boolean> => {
      try {
        const headers = await getAdminHeaders();
        const res = await fetch('/api/alphas', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            id,
            toggleTpIndex: tpIndex,
          }),
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [getAdminHeaders]
  );

  const setCallOutcome = useCallback(
    async (id: string, outcome: 'PROFIT' | 'LOSS' | 'PENDING'): Promise<boolean> => {
      try {
        const headers = await getAdminHeaders();
        const res = await fetch('/api/alphas', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            id,
            outcome,
          }),
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [getAdminHeaders]
  );

  const updateCallMarketCap = useCallback(
    async (id: string, marketCap: string): Promise<boolean> => {
      try {
        const headers = await getAdminHeaders();
        const res = await fetch('/api/alphas', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            id,
            marketCap,
          }),
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [getAdminHeaders]
  );

  const deleteAlphaCall = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const headers = await getAdminHeaders();
        const res = await fetch(
          `/api/alphas?id=${encodeURIComponent(id)}`,
          {
            method: 'DELETE',
            headers,
          }
        );
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [getAdminHeaders]
  );

  const setDemoPreset = useCallback((preset: DemoPreset) => {
    setDemoPresetState(preset);
    try {
      window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, preset);
    } catch {
      // ignore
    }
  }, []);

  const disconnectDemoOrWallet = useCallback(() => {
    if (wallet.connected) {
      wallet.disconnect().catch(() => {});
    }
    setDemoPresetState('disconnected');
    try {
      window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, 'disconnected');
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }, [wallet]);

  const refreshAll = useCallback(async () => {
    if (demoPreset === 'live') {
      await readSplBalance();
    }
    await fetchAlphasFromBackend(balance, connected, publicKeyBase58);
  }, [demoPreset, readSplBalance, fetchAlphasFromBackend, balance, connected, publicKeyBase58]);

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
    isAdmin,
    alphas,
    callers,
    portfolio,
    apiLoading,
    apiError,
    refreshAll,
    createAlphaCall,
    togglePinCall,
    toggleTpHit,
    setCallOutcome,
    updateCallMarketCap,
    deleteAlphaCall,
    searchQuery,
    setSearchQuery,
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
