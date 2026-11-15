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
import { useWallet, type Wallet } from '@solana/wallet-adapter-react';
import { TrenchWalletModal } from '@/components/TrenchWalletModal';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { PublicKey } from '@solana/web3.js';
import {
  ADMIN_WALLET,
  GENESIS_MINT,
  isAdminWallet,
} from '@/lib/config';
import {
  MEMBER_USD_TARGET,
  calculateRequiredTokens,
  DEFAULT_GENESIS_USD_PRICE,
  TIERS,
  Tier,
  TierId,
  allocationCap,
  longevityPoints,
  tierFor,
} from '@/lib/tiers';

// Derived locally so we don't depend on @solana/spl-token (bigint-buffer advisory).
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export type DemoPreset = 'disconnected' | '0' | '1m' | 'admin' | 'live';

export const DEMO_ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_ALLOW_DEMO === 'true' ||
  (typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '0.0.0.0'));

const DEMO_WALLETS: Record<Exclude<DemoPreset, 'disconnected' | 'live'>, string> = {
  '0': 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  '1m': '11111111111111111111111111111111',
  admin: ADMIN_WALLET,
};

export const DEFAULT_MEMBER_TOKENS = calculateRequiredTokens(MEMBER_USD_TARGET, DEFAULT_GENESIS_USD_PRICE);

const DEMO_BALANCES: Record<Exclude<DemoPreset, 'disconnected' | 'live'>, number> = {
  '0': 0,
  '1m': DEFAULT_MEMBER_TOKENS,
  admin: DEFAULT_MEMBER_TOKENS,
};

export interface WalletContextValue {
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
  isAdmin: boolean;

  demoPreset: DemoPreset;
  setDemoPreset: (preset: DemoPreset) => void;
  connectWallet: () => void;
  switchWallet: () => void | Promise<void>;
  disconnectDemoOrWallet: () => Promise<void>;
  demoEnabled: boolean;

  boundEvmAddress: string;
  setBoundEvmAddress: (addr: string) => boolean;

  serverTier: TierId | null;
  setOnChainBalance: React.Dispatch<React.SetStateAction<number>>;
  setServerTier: React.Dispatch<React.SetStateAction<TierId | null>>;
}

export const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const EVM_STORAGE_KEY = 'trenchlabs_bound_evm_v2';
const DEMO_PRESET_STORAGE_KEY = 'trenchlabs_demo_preset_v1';
const ACCESS_STORAGE_KEY = 'trenchlabs_access_v1';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // In production, default strictly to 'disconnected'. In local development only, allow '1m'
  const [demoPreset, setDemoPresetState] = useState<DemoPreset>('disconnected');
  const [onChainBalance, setOnChainBalance] = useState<number>(0);
  const [ataAddress, setAtaAddress] = useState<string | null>(null);
  const [serverTier, setServerTier] = useState<TierId | null>(null);

  const [boundEvmAddress, setBoundEvmAddressState] = useState<string>('');
  const prevPublicKeyRef = useRef<string | null>(null);
  const pendingUnlockTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [connectingWalletName, setConnectingWalletName] = useState<string | null>(null);
  const [walletConnectError, setWalletConnectError] = useState<string | null>(null);

  const clearPendingUnlockWatcher = useCallback(() => {
    if (pendingUnlockTimerRef.current) {
      clearInterval(pendingUnlockTimerRef.current);
      pendingUnlockTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPendingUnlockWatcher();
  }, [clearPendingUnlockWatcher]);

  const finalizeWalletConnection = useCallback(
    (targetWallet: Wallet) => {
      clearPendingUnlockWatcher();
      try {
        sessionStorage.removeItem(ACCESS_STORAGE_KEY);
      } catch {
        // ignore
      }

      wallet.select(targetWallet.adapter.name);

      const ensureSynced = () => {
        if (targetWallet.adapter.connected && targetWallet.adapter.publicKey) {
          targetWallet.adapter.emit('connect', targetWallet.adapter.publicKey);
        }
      };
      queueMicrotask(ensureSynced);
      setTimeout(ensureSynced, 30);

      setDemoPresetState('live');
      try {
        window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, 'live');
      } catch {
        // ignore
      }

      setWalletConnectError(null);
      setConnectingWalletName(null);
      setIsWalletModalOpen(false);
    },
    [wallet, clearPendingUnlockWatcher]
  );

  const connectWallet = useCallback(() => {
    clearPendingUnlockWatcher();
    setWalletConnectError(null);
    setConnectingWalletName(null);
    setIsWalletModalOpen(true);
  }, [clearPendingUnlockWatcher]);

  const switchWallet = useCallback(() => {
    clearPendingUnlockWatcher();
    setWalletConnectError(null);
    setConnectingWalletName(null);
    setIsWalletModalOpen(true);
  }, [clearPendingUnlockWatcher]);

  const handleSelectWallet = useCallback(
    async (targetWallet: Wallet) => {
      clearPendingUnlockWatcher();
      setWalletConnectError(null);

      const isExtensionPresent =
        targetWallet.readyState === WalletReadyState.Installed ||
        (typeof window !== 'undefined' &&
          ((targetWallet.adapter.name === 'Solflare' && 'solflare' in window) ||
            (targetWallet.adapter.name === 'Phantom' && ('phantom' in window || 'solana' in window))));

      if (!isExtensionPresent) {
        if (targetWallet.adapter.url) {
          try {
            window.open(targetWallet.adapter.url, '_blank', 'noopener,noreferrer');
          } catch {
            // ignore popup blocker error
          }
        }
        setWalletConnectError(
          `${targetWallet.adapter.name} extension was not detected in this browser. Please install the extension, or select a quick connect preset below.`
        );
        return;
      }

      setConnectingWalletName(targetWallet.adapter.name);

      try {
        const previousAdapter = wallet.wallet?.adapter;
        const isSameAdapterReconnect = Boolean(
          previousAdapter === targetWallet.adapter &&
          targetWallet.adapter.connected &&
          demoPreset === 'live'
        );

        // If user clicked the already-connected live wallet in Switch Wallet, disconnect first so they can switch accounts or re-authorize
        if (isSameAdapterReconnect) {
          try {
            await targetWallet.adapter.disconnect();
          } catch {
            // ignore
          }
        }

        // Trigger connect() directly within the user click gesture with a 15-second safety timeout
        const connectPromise = targetWallet.adapter.connect();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  `Connection to ${targetWallet.adapter.name} timed out after 15 seconds. Please make sure your wallet extension is open, unlocked, and not blocked by a popup window.`
                )
              ),
            15000
          );
        });
        await Promise.race([connectPromise, timeoutPromise]);
        finalizeWalletConnection(targetWallet);
      } catch (err: unknown) {
        setConnectingWalletName(null);
        const errName = (err as { name?: string })?.name || '';
        const errMsg = (err as { message?: string })?.message || '';

        if (errName === 'WalletNotReadyError' && targetWallet.adapter.url) {
          window.open(targetWallet.adapter.url, '_blank', 'noopener,noreferrer');
          return;
        }

        // Handle Trust Wallet / extension 'INTERNAL_UnlockPopup already pending' state gracefully
        if (/INTERNAL_UnlockPopup|already pending/i.test(errMsg)) {
          setWalletConnectError(
            'Trust Wallet has an unlock prompt waiting for your password. Click the Trust Wallet extension icon in the top-right of your browser (or check behind your browser window) to unlock it — connection will complete automatically once unlocked.'
          );

          const onAdapterConnect = () => {
            if (targetWallet.adapter.connected && targetWallet.adapter.publicKey) {
              finalizeWalletConnection(targetWallet);
            }
          };
          targetWallet.adapter.once('connect', onAdapterConnect);

          pendingUnlockTimerRef.current = setInterval(async () => {
            const stdAccounts = (
              targetWallet.adapter as unknown as { wallet?: { accounts?: unknown[] } }
            ).wallet?.accounts;
            const winTrust = (
              window as unknown as {
                trustwallet?: { solana?: { isConnected?: boolean; publicKey?: unknown } };
              }
            ).trustwallet?.solana;

            if (targetWallet.adapter.connected && targetWallet.adapter.publicKey) {
              finalizeWalletConnection(targetWallet);
              return;
            }

            if (
              (Array.isArray(stdAccounts) && stdAccounts.length > 0) ||
              Boolean(winTrust?.isConnected && winTrust?.publicKey)
            ) {
              try {
                await targetWallet.adapter.connect();
                if (targetWallet.adapter.connected && targetWallet.adapter.publicKey) {
                  finalizeWalletConnection(targetWallet);
                }
              } catch {
                // still waiting for user unlock
              }
            }
          }, 1000);
          return;
        }

        const isUserDismissal =
          errName === 'WalletWindowClosedError' ||
          /user rejected|rejected the request|window closed|cancelled|canceled|denied/i.test(errMsg);

        if (isUserDismissal) {
          return;
        }

        console.warn('[TrenchLabs] Wallet connect error:', err);
        setWalletConnectError(
          errMsg ||
          `Could not connect to ${targetWallet.adapter.name}. Please unlock your wallet extension and try again.`
        );
      }
    },
    [wallet, demoPreset, clearPendingUnlockWatcher, finalizeWalletConnection]
  );

  useEffect(() => {
    try {
      const savedPreset = window.localStorage.getItem(DEMO_PRESET_STORAGE_KEY) as DemoPreset | null;
      if (savedPreset === 'disconnected') {
        queueMicrotask(() => {
          if (typeof wallet.select === 'function') {
            wallet.select(null as any);
          }
        });
        window.localStorage.removeItem('walletName');
        window.localStorage.removeItem('trenchlabs_wallet');
        sessionStorage.removeItem(ACCESS_STORAGE_KEY);
      } else if (DEMO_ENABLED) {
        if (savedPreset && savedPreset !== 'live') queueMicrotask(() => setDemoPresetState(savedPreset));
      }
      const savedEvm = window.localStorage.getItem(EVM_STORAGE_KEY);
      if (savedEvm) queueMicrotask(() => setBoundEvmAddressState(savedEvm));
    } catch {
      // ignore storage errors
    }
  }, [wallet]);

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

  // Synchronize WalletProviderBase if the selected adapter is already connected
  // (e.g. when adapter.connect() resolves before WalletProviderBase attaches its useEffect listener)
  useEffect(() => {
    const activeAdapter = wallet.wallet?.adapter;
    if (activeAdapter && activeAdapter.connected && activeAdapter.publicKey && !wallet.connected) {
      const timer = setTimeout(() => {
        if (activeAdapter.connected && activeAdapter.publicKey) {
          activeAdapter.emit('connect', activeAdapter.publicKey);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [wallet.wallet, wallet.connected]);

  useEffect(() => {
    if (wallet.connected && wallet.publicKey) {
      queueMicrotask(() => setDemoPresetState('live'));
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
      queueMicrotask(() => setAtaAddress(null));
      return;
    }
    try {
      const mintKey = new PublicKey(GENESIS_MINT);
      const [ata] = PublicKey.findProgramAddressSync(
        [wallet.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintKey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      queueMicrotask(() => setAtaAddress(ata.toBase58()));
    } catch {
      queueMicrotask(() => setAtaAddress(null));
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

  // Clear stale state immediately whenever the active wallet address changes
  useEffect(() => {
    if (prevPublicKeyRef.current !== publicKeyBase58) {
      const hadPrevious = prevPublicKeyRef.current !== null;
      prevPublicKeyRef.current = publicKeyBase58;
      if (hadPrevious) {
        queueMicrotask(() => {
          setOnChainBalance(0);
          setServerTier(null);
        });
      }
    }
  }, [publicKeyBase58]);

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
      return onChainBalance;
    }
    if (!connected) return 0;
    if (DEMO_ENABLED && demoPreset !== 'disconnected' && demoPreset !== 'live') {
      return DEMO_BALANCES[demoPreset];
    }
    return 0;
  }, [connected, demoPreset, onChainBalance, wallet.connected, wallet.publicKey]);

  const formattedBalance = useMemo(
    () => new Intl.NumberFormat('en-US').format(balance),
    [balance]
  );

  const tier = useMemo(() => {
    if (isAdmin) return TIERS.PRO;
    if (serverTier && (serverTier === 'PRO' || serverTier === 'LAB_MEMBER')) {
      const serverTierObj = TIERS[serverTier];
      const balanceTierObj = tierFor(balance);
      return serverTierObj.rank >= balanceTierObj.rank ? serverTierObj : balanceTierObj;
    }
    return tierFor(balance);
  }, [balance, serverTier, isAdmin]);

  const multiplier = tier.multiplier;
  const capSol = useMemo(() => allocationCap(tier), [tier]);
  const points = useMemo(() => longevityPoints(balance), [balance]);

  const isZeroBalance = connected && !isAdmin && serverTier !== 'PRO' && serverTier !== 'LAB_MEMBER' && balance < DEFAULT_MEMBER_TOKENS;

  const setDemoPreset = useCallback((preset: DemoPreset) => {
    if (!DEMO_ENABLED && preset !== 'live' && preset !== 'disconnected') return;
    setDemoPresetState(preset);
    setWalletConnectError(null);
    setConnectingWalletName(null);
    setIsWalletModalOpen(false);
    try {
      window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, preset);
    } catch {
      // ignore
    }
  }, []);

  const disconnectDemoOrWallet = useCallback(async () => {
    try {
      fetch('/api/auth/session', { method: 'DELETE' }).catch(() => { });
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
    setServerTier(null);
    setAtaAddress(null);

    try {
      window.localStorage.setItem(DEMO_PRESET_STORAGE_KEY, 'disconnected');
      window.localStorage.removeItem('walletName');
      window.localStorage.removeItem('trenchlabs_wallet');
      sessionStorage.removeItem(ACCESS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [wallet]);

  const value: WalletContextValue = {
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
    isAdmin,
    demoPreset,
    setDemoPreset,
    connectWallet,
    switchWallet,
    disconnectDemoOrWallet,
    demoEnabled: DEMO_ENABLED,
    boundEvmAddress,
    setBoundEvmAddress,
    serverTier,
    setOnChainBalance,
    setServerTier,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
      <TrenchWalletModal
        isOpen={isWalletModalOpen}
        onClose={() => {
          clearPendingUnlockWatcher();
          setConnectingWalletName(null);
          setWalletConnectError(null);
          setIsWalletModalOpen(false);
        }}
        wallets={wallet.wallets}
        onSelectWallet={handleSelectWallet}
        connectingWalletName={connectingWalletName}
        connectError={walletConnectError}
        onCancelConnecting={() => {
          clearPendingUnlockWatcher();
          setConnectingWalletName(null);
        }}
        demoEnabled={DEMO_ENABLED}
        onSelectDemoPreset={setDemoPreset}
      />
    </WalletContext.Provider>
  );
}

export function useWalletState(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWalletState must be used inside WalletProvider');
  }
  return ctx;
}
