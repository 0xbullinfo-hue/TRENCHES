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
import { ADMIN_WALLET } from '@/lib/config';
import type { TierId } from '@/lib/tiers';
import type {
  AlphaItem,
  AlphasErr,
  AlphasResponse,
  CallType,
  Chain,
  Portfolio,
  SyndicateCaller,
} from '@/lib/types';
import {
  DEFAULT_MEMBER_TOKENS,
  DEMO_ENABLED,
  useWalletState,
} from './WalletContext';

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
  callType?: CallType;
  isMaxAlpha?: boolean;
  minTier?: TierId;
  summary?: string;
  serialTag?: string;
  logoUrl?: string;
}

export type VerificationState =
  | 'DISCONNECTED'
  | 'CONNECTED_UNVERIFIED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'INSUFFICIENT_MEMBERSHIP';

export interface AuthContextValue {
  alphas: AlphaItem[];
  callers: SyndicateCaller[];
  portfolio: Portfolio | null;
  verifiedUsersCount: number;
  apiLoading: boolean;
  apiError: string | null;
  needsSignature: boolean;
  verificationState: VerificationState;
  isUnlocked: boolean;
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
  recordAllocation: (ticker: string, chain: Chain, amountSol: string) => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  resetAuthState: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const WATCHLIST_STORAGE_KEY = 'trenchlabs_watchlist_v3';
const getWatchlistStorageKey = (addr: string | null) =>
  addr ? `trenchlabs_watchlist_v4:${addr}` : 'trenchlabs_watchlist_anon_v4';
const ACCESS_STORAGE_KEY = 'trenchlabs_access_v1';

async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const walletState = useWalletState();
  const {
    connected,
    publicKeyBase58,
    isAdmin,
    balance,
    demoPreset,
    serverTier,
    setOnChainBalance,
    setServerTier,
  } = walletState;

  const [alphas, setAlphas] = useState<AlphaItem[]>([]);
  const [callers, setCallers] = useState<SyndicateCaller[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [verifiedUsersCount, setVerifiedUsersCount] = useState<number>(0);
  const [apiLoading, setApiLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [needsSignature, setNeedsSignature] = useState<boolean>(false);
  const [verificationState, setVerificationState] = useState<VerificationState>('DISCONNECTED');

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [watchlist, setWatchlist] = useState<string[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const signCacheRef = useRef(new Map<string, { ts: number; headers: Record<string, string> }>());
  const prevPublicKeyRef = useRef<string | null>(null);
  const fetchAlphasRef = useRef<(interactiveAuth?: boolean, gen?: number) => Promise<void>>(async () => { });

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

  // Clear stale state immediately whenever the active wallet address changes
  useEffect(() => {
    if (prevPublicKeyRef.current !== publicKeyBase58) {
      const hadPrevious = prevPublicKeyRef.current !== null;
      prevPublicKeyRef.current = publicKeyBase58;
      signCacheRef.current.clear();
      try {
        sessionStorage.removeItem(ACCESS_STORAGE_KEY);
      } catch {
        // ignore
      }
      if (hadPrevious) {
        requestGenerationRef.current += 1;
        if (abortControllerRef.current) abortControllerRef.current.abort();
        queueMicrotask(() => {
          setAlphas([]);
          setCallers([]);
          setPortfolio(null);
          setWatchlist([]);
          setApiError(null);
          setNeedsSignature(connected);
          setVerificationState(connected ? 'CONNECTED_UNVERIFIED' : 'DISCONNECTED');
        });
      }
    }
  }, [publicKeyBase58, connected]);

  // Load and isolate personal watchlist per connected wallet, migrating legacy once
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const key = getWatchlistStorageKey(publicKeyBase58);
      const saved = window.localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          queueMicrotask(() => setWatchlist(parsed));
          return;
        }
      }

      // Legacy Watchlist migration occurs only once:
      const legacy = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
      if (legacy && publicKeyBase58) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length > 0) {
          window.localStorage.setItem(key, JSON.stringify(parsed));
          window.localStorage.removeItem(WATCHLIST_STORAGE_KEY);
          queueMicrotask(() => setWatchlist(parsed));
          return;
        }
      }

      queueMicrotask(() => setWatchlist([]));
    } catch {
      queueMicrotask(() => setWatchlist([]));
    }
  }, [publicKeyBase58]);

  const toggleWatchlist = useCallback((tokenId: string) => {
    setWatchlist((prev) => {
      const exists = prev.includes(tokenId);
      const next = exists ? prev.filter((id) => id !== tokenId) : [...prev, tokenId];
      try {
        const key = getWatchlistStorageKey(publicKeyBase58);
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [publicKeyBase58]);

  const isUnlocked = connected && !needsSignature && (isAdmin || serverTier === 'PRO' || serverTier === 'LAB_MEMBER' || balance >= DEFAULT_MEMBER_TOKENS);

  const getAccessHeaders = useCallback(
    async (interactive = false): Promise<Record<string, string> | null> => {
      const activeAdapter = wallet.wallet?.adapter;
      const pubKey = wallet.publicKey || activeAdapter?.publicKey;
      if (!pubKey) {
        return null;
      }
      const addr = pubKey.toBase58();

      try {
        const cached = JSON.parse(sessionStorage.getItem(ACCESS_STORAGE_KEY) || 'null');
        if (cached && cached.wallet === addr && Date.now() - cached.ts < 4 * 60_000) {
          return cached.headers;
        }
      } catch {
        // ignore cache read failure
      }

      if (!interactive) {
        return null;
      }

      const activeSignMessage =
        wallet.signMessage ||
        (activeAdapter && typeof (activeAdapter as any).signMessage === 'function'
          ? (activeAdapter as any).signMessage.bind(activeAdapter)
          : null);

      if (!activeSignMessage) {
        return null;
      }

      try {
        const ts = Date.now();
        const msg = `TrenchLabs Access|GET|/api/alphas|${ts}`;
        const sig = await activeSignMessage(new TextEncoder().encode(msg));
        const headers = {
          'x-wallet': addr,
          'x-timestamp': String(ts),
          'x-signature': Array.from(sig)
            .map((b) => (b as number).toString(16).padStart(2, '0'))
            .join(''),
        };
        try {
          sessionStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify({ wallet: addr, ts, headers }));
          fetch('/api/auth/session', { method: 'POST', headers }).catch(() => { });
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

  const signRequestHeaders = useCallback(
    async (method: string, path: string): Promise<Record<string, string> | null> => {
      const activeAdapter = wallet.wallet?.adapter;
      const pubKey = wallet.publicKey || activeAdapter?.publicKey;
      if (!pubKey) return null;
      const addr = pubKey.toBase58();
      const key = `${addr}|${method}|${path}`;
      const hit = signCacheRef.current.get(key);
      if (hit && Date.now() - hit.ts < 4 * 60_000) return hit.headers;

      const activeSignMessage =
        wallet.signMessage ||
        (activeAdapter && typeof (activeAdapter as any).signMessage === 'function'
          ? (activeAdapter as any).signMessage.bind(activeAdapter)
          : null);

      if (!activeSignMessage) return null;

      try {
        const ts = Date.now();
        const sig = await activeSignMessage(
          new TextEncoder().encode(`TrenchLabs Access|${method}|${path}|${ts}`)
        );
        const headers = {
          'x-wallet': addr,
          'x-timestamp': String(ts),
          'x-signature': Array.from(sig)
            .map((b) => (b as number).toString(16).padStart(2, '0'))
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
    async (interactiveAuth = false, generation?: number) => {
      if (!connected) {
        setAlphas([]);
        setCallers([]);
        setPortfolio(null);
        setApiError(null);
        setNeedsSignature(false);
        setVerificationState('DISCONNECTED');
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
            setVerificationState('VERIFIED');
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
      if (typeof generation === 'number' && generation !== requestGenerationRef.current) return;
      if (!headers) {
        setOnChainBalance(0);
        setServerTier(null);
        setAlphas([]);
        setCallers([]);
        setPortfolio(null);
        setNeedsSignature(true);
        setVerificationState('CONNECTED_UNVERIFIED');
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
        if (typeof generation === 'number' && generation !== requestGenerationRef.current) return;

        if (!res.ok || !data.ok) {
          if (typeof data.balance === 'number') {
            setOnChainBalance(data.balance);
          }
          setAlphas([]);
          setCallers([]);
          setPortfolio(null);
          setVerifiedUsersCount(0);
          const errData = data as AlphasErr;
          if (errData.error === 'ACCESS_DENIED_ZERO_BALANCE') {
            setVerificationState('INSUFFICIENT_MEMBERSHIP');
          } else {
            setVerificationState('VERIFICATION_FAILED');
          }
          setApiError(!data.ok ? errData.message || errData.error : 'ACCESS_DENIED_ZERO_BALANCE');
        } else {
          setOnChainBalance(data.balance);
          if (data.tier) {
            setServerTier(data.tier);
          }
          setAlphas(data.items);
          setCallers(data.callers ?? []);
          setPortfolio(data.portfolio);
          setVerifiedUsersCount(typeof data.verifiedUsersCount === 'number' ? data.verifiedUsersCount : 0);
          setApiError(null);
          setVerificationState('VERIFIED');
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          if (typeof generation !== 'number' || generation === requestGenerationRef.current) {
            setApiError((err as Error).message || 'Solana RPC network unavailable');
            setVerificationState('VERIFICATION_FAILED');
          }
        }
      } finally {
        if (typeof generation !== 'number' || generation === requestGenerationRef.current) {
          setApiLoading(false);
        }
      }
    },
    [connected, demoPreset, getAccessHeaders, setOnChainBalance, setServerTier]
  );

  useEffect(() => {
    fetchAlphasRef.current = fetchAlphasFromBackend;
  }, [fetchAlphasFromBackend]);

  const requestUnlockSignature = useCallback(async () => {
    if (DEMO_ENABLED && demoPreset !== 'live') {
      setNeedsSignature(false);
      setVerificationState('VERIFIED');
      const gen = ++requestGenerationRef.current;
      await fetchAlphasFromBackend(true, gen);
      return;
    }

    const activeAdapter = wallet.wallet?.adapter;
    const pubKey = wallet.publicKey || activeAdapter?.publicKey;
    if (!pubKey) {
      console.warn('[TrenchLabs] Cannot sign: no active wallet public key');
      setApiError('No active wallet connected. Please connect your Solana wallet.');
      setVerificationState('CONNECTED_UNVERIFIED');
      return;
    }
    const addr = pubKey.toBase58();

    const activeSignMessage =
      wallet.signMessage ||
      (activeAdapter && typeof (activeAdapter as any).signMessage === 'function'
        ? (activeAdapter as any).signMessage.bind(activeAdapter)
        : null);

    if (!activeSignMessage) {
      console.warn('[TrenchLabs] Active wallet does not support message signing');
      setApiError(
        'Connected wallet does not support message signing. Please connect with Phantom, Solflare, or Trust Wallet.'
      );
      setVerificationState('VERIFICATION_FAILED');
      return;
    }

    try {
      setVerificationState('VERIFYING');
      setApiLoading(true);
      const ts = Date.now();
      const msg = `TrenchLabs Access|GET|/api/alphas|${ts}`;
      const sigBytes = await activeSignMessage(new TextEncoder().encode(msg));
      const sigHex = Array.from(sigBytes)
        .map((b) => (b as number).toString(16).padStart(2, '0'))
        .join('');
      const headers = {
        'x-wallet': addr,
        'x-timestamp': String(ts),
        'x-signature': sigHex,
      };
      sessionStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify({ wallet: addr, ts, headers }));
      fetch('/api/auth/session', { method: 'POST', headers }).catch(() => { });
      setNeedsSignature(false);
      const gen = ++requestGenerationRef.current;
      await fetchAlphasFromBackend(true, gen);
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || '';
      if (/user rejected|window closed|cancelled|canceled|denied/i.test(errMsg)) {
        setVerificationState('CONNECTED_UNVERIFIED');
        return;
      }
      console.warn('[TrenchLabs] Sign to unlock error:', err);
      setVerificationState('VERIFICATION_FAILED');
      setApiError(errMsg || 'Failed to sign message. Please unlock your wallet and try again.');
    } finally {
      setApiLoading(false);
    }
  }, [wallet, demoPreset, fetchAlphasFromBackend]);

  useEffect(() => {
    const gen = ++requestGenerationRef.current;
    queueMicrotask(() => { fetchAlphasFromBackend(false, gen); });
    return () => {
      requestGenerationRef.current += 1;
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [fetchAlphasFromBackend]);

  const getAdminHeaders = useCallback(
    async (method: string, urlPath: string, bodyStr: string): Promise<Record<string, string>> => {
      const activeAdapter = wallet.wallet?.adapter;
      const pubKey = wallet.publicKey || activeAdapter?.publicKey;
      const adminAddr = (pubKey ? pubKey.toBase58() : '') || ADMIN_WALLET;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-admin-wallet': adminAddr,
      };

      const activeSignMessage =
        wallet.signMessage ||
        (activeAdapter && typeof (activeAdapter as any).signMessage === 'function'
          ? (activeAdapter as any).signMessage.bind(activeAdapter)
          : null);

      if (
        (wallet.connected || activeAdapter?.connected) &&
        pubKey &&
        activeSignMessage &&
        pubKey.toBase58() === ADMIN_WALLET
      ) {
        const ts = Date.now();
        const bodyHash = await sha256Hex(bodyStr);
        const message = ['TrenchLabs Admin', method, urlPath, ts, bodyHash].join('|');
        const sigBytes = await activeSignMessage(new TextEncoder().encode(message));
        const sigHex = Array.from(sigBytes)
          .map((b) => (b as number).toString(16).padStart(2, '0'))
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

  const updateAlphaCall = useCallback(
    async (id: string, updates: Record<string, unknown>): Promise<boolean> => {
      try {
        const bodyStr = JSON.stringify({ id, ...updates });
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
        console.error('[TrenchLabs] updateAlphaCall error:', err);
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

  const toggleMaxAlpha = useCallback(
    async (id: string, nextMaxAlpha: boolean): Promise<boolean> => {
      try {
        const bodyStr = JSON.stringify({ id, isMaxAlpha: nextMaxAlpha });
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
        console.error('[TrenchLabs] toggleMaxAlpha error:', err);
        return false;
      }
    },
    [getAdminHeaders]
  );

  const updateCallCategory = useCallback(
    async (id: string, callType: CallType): Promise<boolean> => {
      try {
        const bodyStr = JSON.stringify({ id, callType });
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
        console.error('[TrenchLabs] updateCallCategory error:', err);
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

  const resetAuthState = useCallback(() => {
    requestGenerationRef.current += 1;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    signCacheRef.current.clear();
    setAlphas([]);
    setCallers([]);
    setPortfolio(null);
    setVerifiedUsersCount(0);
    setApiError(null);
    setNeedsSignature(false);
    setVerificationState('DISCONNECTED');
    try {
      sessionStorage.removeItem(ACCESS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const gen = ++requestGenerationRef.current;
    await fetchAlphasFromBackend(true, gen);
  }, [fetchAlphasFromBackend]);

  const value: AuthContextValue = {
    alphas,
    callers,
    portfolio,
    verifiedUsersCount,
    apiLoading,
    apiError,
    needsSignature,
    verificationState,
    isUnlocked,
    refreshAll,
    requestUnlockSignature,
    signRequestHeaders,
    createAlphaCall,
    updateAlphaCall,
    togglePinCall,
    toggleMaxAlpha,
    updateCallCategory,
    toggleTpHit,
    setCallOutcome,
    updateCallMarketCap,
    deleteAlphaCall,
    getAdminHeaders,
    searchQuery,
    setSearchQuery,
    watchlist,
    toggleWatchlist,
    recordAllocation,
    resetAuthState,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthState(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthState must be used inside AuthProvider');
  }
  return ctx;
}
