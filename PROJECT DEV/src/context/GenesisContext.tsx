'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import {
  ADMIN_WALLET,
  GENESIS_MINT,
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

// Derived locally so we don't depend on @solana/spl-token (bigint-buffer advisory).
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export type DemoPreset = 'disconnected' | '0' | '1m' | 'admin' | 'live';

export const DEMO_ENABLED = process.env.NODE_ENV !== 'production';

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
  riskRewardRatio?: string;
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
  needsSignature: boolean;
  refreshAll: () => Promise<void>;
  requestUnlockSignature: () => Promise<void>;
  /** Wallet-signed headers for an arbitrary API call (message bound to method + path). Cached ~4 min. */
  signRequestHeaders: (method: string, path: string) => Promise<Record<string, string> | null>;

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
  setBoundEvmAddress: (addr: string) => boolean;

  demoPreset: DemoPreset;
  setDemoPreset: (preset: DemoPreset) => void;
  connectWallet: () => void;
  disconnectDemoOrWallet: () => Promise<void>;
  demoEnabled: boolean;
}

const GenesisContext = createContext<GenesisContextValue | undefined>(undefined);

const EVM_STORAGE_KEY = 'trenchlabs_bound_evm_v2';
const WATCHLIST_STORAGE_KEY = 'trenchlabs_watchlist_v3';
const DEMO_PRESET_STORAGE_KEY = 'trenchlabs_demo_preset_v1';
const ACCESS_STORAGE_KEY = 'trenchlabs_access_v1';

async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function GenesisProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();

  // In production, default strictly to 'disconnected'. In local development only, allow '1m'
  const [demoPreset, setDemoPresetState] = useState<DemoPreset>('disconnected');
  const [onChainBalance, setOnChainBalance] = useState<number>(0);
  const [ataAddress, setAtaAddress] = useState<string | null>(null);

  const [alphas, setAlphas] = useState<AlphaItem[]>([]);
  const [callers, setCallers] = useState<SyndicateCaller[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [apiLoading, setApiLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [needsSignature, setNeedsSignature] = useState<boolean>(false);

  const [boundEvmAddress, setBoundEvmAddressState] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [watchlist, setWatchlist] = useState<string[]>(['pill-trench', 'robin-hoodlum', 'swordcat']);

  const abortControllerRef = useRef<AbortController | null>(null);

  const connectWallet = useCallback(() => {
    setDemoPresetState('live');
    try {
      window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, 'live');
    } catch {}

    if (wallet.wallet && !wallet.connected) {
      wallet.connect().catch(() => {
        openWalletModal(true);
      });
      return;
    }

    openWalletModal(true);
  }, [wallet, openWalletModal]);

  useEffect(() => {
    try {
      if (DEMO_ENABLED) {
        const savedPreset = window.localStorage.getItem(DEMO_PRESET_STORAGE_KEY) as DemoPreset | null;
        if (savedPreset && savedPreset !== 'live') setDemoPresetState(savedPreset);
      }
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

  const setBoundEvmAddress = useCallback((addr: string): boolean => {
    const trimmed = addr.trim();
    if (trimmed && !/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      return false;
    }
    setBoundEvmAddressState(trimmed);
    try {
      window.localStorage.setItem(EVM_STORAGE_KEY, trimmed);
    } catch {
      // ignore
    }
    return true;
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

  // P1-4: Never fabricate blockchain transaction signatures. Label clearly as simulated/illustrative.
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
          slot: 0,
          claimedAt: new Date().toISOString(),
          sig: `SIMULATED_${Date.now().toString(36)}`,
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
      try {
        window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, 'live');
      } catch {
        // ignore
      }
    }
  }, [wallet.connected, wallet.publicKey]);

  // Compute ATA address for display without issuing client-side RPC token queries
  useEffect(() => {
    if (!wallet.publicKey) {
      setAtaAddress(null);
      return;
    }
    try {
      const mintKey = new PublicKey(GENESIS_MINT);
      const [ata] = PublicKey.findProgramAddressSync(
        [wallet.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintKey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      setAtaAddress(ata.toBase58());
    } catch {
      setAtaAddress(null);
    }
  }, [wallet.publicKey]);

  const connected = useMemo(() => {
    if (wallet.connected && !!wallet.publicKey) return true;
    if (demoPreset === 'disconnected') return false;
    if (demoPreset === 'live') return false;
    return DEMO_ENABLED;
  }, [demoPreset, wallet.connected, wallet.publicKey]);

  const publicKeyBase58 = useMemo(() => {
    if (wallet.connected && wallet.publicKey) {
      return wallet.publicKey.toBase58();
    }
    if (!connected) return null;
    if (DEMO_ENABLED && demoPreset !== 'disconnected' && demoPreset !== 'live') {
      return DEMO_WALLETS[demoPreset];
    }
    return null;
  }, [connected, demoPreset, wallet.connected, wallet.publicKey]);

  const isAdmin = useMemo(
    () => Boolean(connected && publicKeyBase58 && isAdminWallet(publicKeyBase58)),
    [connected, publicKeyBase58]
  );

  const shortAddress = useMemo(() => {
    if (!publicKeyBase58) return '';
    return `${publicKeyBase58.slice(0, 4)}...${publicKeyBase58.slice(-4)}`;
  }, [publicKeyBase58]);

  const balance = useMemo(() => {
    if (wallet.connected && wallet.publicKey) {
      if (isAdmin && onChainBalance < MIN_GENESIS_REQUIRED) {
        return MIN_GENESIS_REQUIRED;
      }
      return onChainBalance;
    }
    if (!connected) return 0;
    if (DEMO_ENABLED && demoPreset !== 'disconnected' && demoPreset !== 'live') {
      return DEMO_BALANCES[demoPreset];
    }
    return 0;
  }, [connected, demoPreset, onChainBalance, isAdmin, wallet.connected, wallet.publicKey]);

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

  /**
   * Patch 1: Request or retrieve cached ed25519 signature headers proving wallet ownership.
   */
  const getAccessHeaders = useCallback(
    async (interactive = false): Promise<Record<string, string> | null> => {
      if (!wallet.publicKey || !wallet.signMessage) {
        return null;
      }
      const addr = wallet.publicKey.toBase58();

      try {
        const cached = JSON.parse(sessionStorage.getItem(ACCESS_STORAGE_KEY) || 'null');
        if (cached && cached.wallet === addr && Date.now() - cached.ts < 4 * 60_000) {
          return cached.headers;
        }
      } catch {
        // ignore cache read failure
      }

      if (!interactive) {
        // In non-interactive background fetches, do not trigger an unsolicited wallet popup
        return null;
      }

      try {
        const ts = Date.now();
        const msg = `TrenchLabs Access|GET|/api/alphas|${ts}`;
        const sig = await wallet.signMessage(new TextEncoder().encode(msg));
        const headers = {
          'x-wallet': addr,
          'x-timestamp': String(ts),
          'x-signature': Array.from(sig)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
        };
        try {
          sessionStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify({ wallet: addr, ts, headers }));
        } catch {
          // ignore cache write failure
        }
        return headers;
      } catch {
        return null;
      }
    },
    [wallet]
  );

  const signCacheRef = useRef(new Map<string, { ts: number; headers: Record<string, string> }>());

  const signRequestHeaders = useCallback(
    async (method: string, path: string): Promise<Record<string, string> | null> => {
      if (!wallet.publicKey || !wallet.signMessage) return null;
      const addr = wallet.publicKey.toBase58();
      const key = `${addr}|${method}|${path}`;
      const hit = signCacheRef.current.get(key);
      if (hit && Date.now() - hit.ts < 4 * 60_000) return hit.headers;
      try {
        const ts = Date.now();
        const sig = await wallet.signMessage(
          new TextEncoder().encode(`TrenchLabs Access|${method}|${path}|${ts}`)
        );
        const headers = {
          'x-wallet': addr,
          'x-timestamp': String(ts),
          'x-signature': Array.from(sig)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
        };
        signCacheRef.current.set(key, { ts, headers });
        return headers;
      } catch {
        return null;
      }
    },
    [wallet]
  );

  const fetchAlphasFromBackend = useCallback(
    async (interactiveAuth = false) => {
      if (!connected) {
        setAlphas([]);
        setCallers([]);
        setPortfolio(null);
        setApiError(null);
        setNeedsSignature(false);
        return;
      }

      // In dev mode with a demo preset, load fixture directly
      if (DEMO_ENABLED && demoPreset !== 'live') {
        setApiLoading(true);
        try {
          const res = await fetch('/api/alphas/fixture', { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            setAlphas(data.items || []);
            setCallers(data.callers || []);
            setPortfolio(data.portfolio || null);
            setApiError(null);
            setNeedsSignature(false);
            setApiLoading(false);
            return;
          }
        } catch {
          // fallback
        }
        setApiLoading(false);
      }

      // Live connected wallet: acquire cryptographic authorization headers
      const headers = await getAccessHeaders(interactiveAuth);
      if (!headers) {
        setNeedsSignature(true);
        return;
      }
      setNeedsSignature(false);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setApiLoading(true);
      try {
        const res = await fetch('/api/alphas', {
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        const data: AlphasResponse = await res.json();

        if (!res.ok || !data.ok) {
          if (typeof data.balance === 'number') {
            setOnChainBalance(data.balance);
          }
          setAlphas([]);
          setCallers([]);
          setPortfolio(null);
          setApiError(!data.ok ? data.message || data.error : 'ACCESS_DENIED_ZERO_BALANCE');
        } else {
          // Patch 7: Read verified balance from server response
          setOnChainBalance(data.balance);
          setAlphas(data.items);
          setCallers(data.callers ?? []);
          setPortfolio(data.portfolio);
          setApiError(null);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setApiError((err as Error).message || 'Solana RPC network unavailable');
        }
      } finally {
        setApiLoading(false);
      }
    },
    [connected, demoPreset, getAccessHeaders]
  );

  const requestUnlockSignature = useCallback(async () => {
    await fetchAlphasFromBackend(true);
  }, [fetchAlphasFromBackend]);

  useEffect(() => {
    fetchAlphasFromBackend(false);
  }, [fetchAlphasFromBackend]);

  /**
   * Patch 3: Admin request authentication bound to method, path, timestamp, and body hash.
   */
  const getAdminHeaders = useCallback(
    async (method: string, urlPath: string, bodyStr: string): Promise<Record<string, string>> => {
      const adminAddr = (wallet.publicKey ? wallet.publicKey.toBase58() : '') || ADMIN_WALLET;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-admin-wallet': adminAddr,
      };

      if (
        wallet.connected &&
        wallet.publicKey &&
        wallet.signMessage &&
        wallet.publicKey.toBase58() === ADMIN_WALLET
      ) {
        const ts = Date.now();
        const bodyHash = await sha256Hex(bodyStr);
        const message = ['TrenchLabs Admin', method, urlPath, ts, bodyHash].join('|');
        const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
        const sigHex = Array.from(sigBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        headers['x-admin-timestamp'] = String(ts);
        headers['x-admin-signature'] = sigHex;
        return headers;
      }

      throw new Error('Cryptographic signature required: connect Master Admin wallet');
    },
    [wallet]
  );

  const createAlphaCall = useCallback(
    async (payload: CreateCallPayload): Promise<boolean> => {
      try {
        const bodyStr = JSON.stringify(payload);
        const headers = await getAdminHeaders('POST', '/api/alphas', bodyStr);
        const res = await fetch('/api/alphas', {
          method: 'POST',
          headers,
          body: bodyStr,
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[TrenchLabs] createAlphaCall error:', err);
        return false;
      }
    },
    [getAdminHeaders]
  );

  const togglePinCall = useCallback(
    async (id: string, nextPinned: boolean): Promise<boolean> => {
      try {
        const bodyStr = JSON.stringify({ id, pinned: nextPinned });
        const headers = await getAdminHeaders('PATCH', '/api/alphas', bodyStr);
        const res = await fetch('/api/alphas', {
          method: 'PATCH',
          headers,
          body: bodyStr,
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[TrenchLabs] togglePinCall error:', err);
        return false;
      }
    },
    [getAdminHeaders]
  );

  const toggleTpHit = useCallback(
    async (id: string, tpIndex: number): Promise<boolean> => {
      try {
        const bodyStr = JSON.stringify({ id, toggleTpIndex: tpIndex });
        const headers = await getAdminHeaders('PATCH', '/api/alphas', bodyStr);
        const res = await fetch('/api/alphas', {
          method: 'PATCH',
          headers,
          body: bodyStr,
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[TrenchLabs] toggleTpHit error:', err);
        return false;
      }
    },
    [getAdminHeaders]
  );

  const setCallOutcome = useCallback(
    async (id: string, outcome: 'PROFIT' | 'LOSS' | 'PENDING'): Promise<boolean> => {
      try {
        const bodyStr = JSON.stringify({ id, outcome });
        const headers = await getAdminHeaders('PATCH', '/api/alphas', bodyStr);
        const res = await fetch('/api/alphas', {
          method: 'PATCH',
          headers,
          body: bodyStr,
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[TrenchLabs] setCallOutcome error:', err);
        return false;
      }
    },
    [getAdminHeaders]
  );

  const updateCallMarketCap = useCallback(
    async (id: string, marketCap: string): Promise<boolean> => {
      try {
        const bodyStr = JSON.stringify({ id, marketCap });
        const headers = await getAdminHeaders('PATCH', '/api/alphas', bodyStr);
        const res = await fetch('/api/alphas', {
          method: 'PATCH',
          headers,
          body: bodyStr,
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[TrenchLabs] updateCallMarketCap error:', err);
        return false;
      }
    },
    [getAdminHeaders]
  );

  const deleteAlphaCall = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const urlPath = `/api/alphas?id=${encodeURIComponent(id)}`;
        const headers = await getAdminHeaders('DELETE', urlPath, '');
        const res = await fetch(urlPath, {
          method: 'DELETE',
          headers,
        });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.items)) {
          setAlphas(json.items);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[TrenchLabs] deleteAlphaCall error:', err);
        return false;
      }
    },
    [getAdminHeaders]
  );

  const setDemoPreset = useCallback((preset: DemoPreset) => {
    if (!DEMO_ENABLED && preset !== 'live' && preset !== 'disconnected') return;
    setDemoPresetState(preset);
    try {
      window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, preset);
    } catch {
      // ignore
    }
  }, []);

  const disconnectDemoOrWallet = useCallback(async () => {
    try {
      if (wallet.connected || wallet.wallet) {
        await wallet.disconnect();
      }
    } catch (e) {
      console.warn('[TrenchLabs] Wallet disconnect warning:', e);
    }

    try {
      if (typeof wallet.select === 'function') {
        wallet.select(null as any);
      }
    } catch {
      // ignore
    }

    setDemoPresetState('disconnected');
    setOnChainBalance(0);
    setAtaAddress(null);
    setAlphas([]);
    setCallers([]);
    setPortfolio(null);
    setApiError(null);
    setNeedsSignature(false);

    try {
      window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, 'disconnected');
      window.localStorage.removeItem('walletName');
      sessionStorage.removeItem(ACCESS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [wallet]);

  const refreshAll = useCallback(async () => {
    await fetchAlphasFromBackend(true);
  }, [fetchAlphasFromBackend]);

  const value: GenesisContextValue = {
    connected,
    publicKeyBase58,
    shortAddress,
    ataAddress,
    genesisMint: GENESIS_MINT,
    signRequestHeaders,
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
    needsSignature,
    refreshAll,
    requestUnlockSignature,
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
    connectWallet,
    disconnectDemoOrWallet,
    demoEnabled: DEMO_ENABLED,
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
