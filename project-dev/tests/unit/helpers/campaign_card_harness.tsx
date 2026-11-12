import React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { WalletContext, type WalletContextState } from '@solana/wallet-adapter-react';
export { WalletContext };
import { GenesisContext, type GenesisContextValue } from '../../../src/context/GenesisContext';
import { CampaignCard } from '../../../src/components/campaigns/CampaignCard';
import type { Campaign, CampaignSubmission } from '../../../src/lib/types';

export function makeMockPublicKey(base58: string) {
  return {
    toBase58: () => base58,
    toString: () => base58,
    toBytes: () => new Uint8Array(32),
    toBuffer: () => Buffer.alloc(32),
    equals: (other: { toBase58?: () => string }) => other?.toBase58?.() === base58,
  } as unknown as NonNullable<WalletContextState['publicKey']>;
}

export function makeMockWalletContext(
  overrides: Partial<WalletContextState> & {
    adapterPublicKey?: string | null;
    adapterConnected?: boolean;
    adapterSignMessage?: ((msg: Uint8Array) => Promise<Uint8Array>) | null;
    adapterInstance?: Record<string, unknown> | null;
  } = {}
): WalletContextState {
  const pubkeyStr =
    overrides.publicKey !== undefined
      ? overrides.publicKey?.toBase58() ?? null
      : null;

  const adapterPkStr =
    overrides.adapterPublicKey !== undefined ? overrides.adapterPublicKey : pubkeyStr;

  const adapterConnected =
    overrides.adapterConnected !== undefined
      ? overrides.adapterConnected
      : Boolean(overrides.connected);

  const adapter =
    overrides.adapterInstance !== undefined
      ? overrides.adapterInstance
      : overrides.wallet === null
      ? null
      : {
          name: 'MockPhantom',
          connected: adapterConnected,
          publicKey: adapterPkStr ? makeMockPublicKey(adapterPkStr) : null,
          ...(overrides.adapterSignMessage
            ? { signMessage: overrides.adapterSignMessage }
            : {}),
        };

  return {
    autoConnect: false,
    wallets: [],
    wallet: adapter
      ? ({ adapter, readyState: 'Installed' } as unknown as WalletContextState['wallet'])
      : null,
    publicKey: overrides.publicKey !== undefined ? overrides.publicKey : null,
    connecting: false,
    connected: Boolean(overrides.connected),
    disconnecting: false,
    select: () => undefined,
    connect: async () => undefined,
    disconnect: async () => undefined,
    sendTransaction: async () => '' as unknown as string,
    signTransaction: undefined,
    signAllTransactions: undefined,
    signMessage: overrides.signMessage,
    signIn: undefined,
    ...overrides,
  };
}

export function makeMockGenesisContext(
  overrides: Partial<GenesisContextValue> = {}
): GenesisContextValue {
  return {
    connected: false,
    publicKeyBase58: null,
    shortAddress: '',
    ataAddress: null,
    genesisMint: 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump',
    balance: 0,
    formattedBalance: '0',
    tier: {
      id: 'FREE',
      name: 'Free',
      minTokens: 0,
      minUsd: 0,
      multiplier: 1,
      rank: 0,
      badge: 'FREE',
      description: 'Free',
    } as unknown as GenesisContextValue['tier'],
    multiplier: 1,
    capSol: 0,
    points: 0,
    isZeroBalance: true,
    isUnlocked: false,
    isAdmin: false,
    alphas: [],
    callers: [],
    portfolio: null,
    verifiedUsersCount: 0,
    apiLoading: false,
    apiError: null,
    needsSignature: true,
    verificationState: 'DISCONNECTED',
    refreshAll: async () => undefined,
    requestUnlockSignature: async () => undefined,
    signRequestHeaders: async () => null,
    createAlphaCall: async () => false,
    updateAlphaCall: async () => false,
    togglePinCall: async () => false,
    toggleMaxAlpha: async () => false,
    updateCallCategory: async () => false,
    toggleTpHit: async () => false,
    setCallOutcome: async () => false,
    updateCallMarketCap: async () => false,
    deleteAlphaCall: async () => false,
    watchlist: [],
    toggleWatchlist: () => undefined,
    recordAllocation: () => undefined,
    searchQuery: '',
    setSearchQuery: () => undefined,
    boundEvmAddress: '',
    setBoundEvmAddress: () => true,
    demoPreset: 'disconnected',
    setDemoPreset: () => undefined,
    connectWallet: () => undefined,
    switchWallet: () => undefined,
    disconnectDemoOrWallet: async () => undefined,
    demoEnabled: false,
    ...overrides,
  };
}

export function makeSampleCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-ux-test-1',
    title: 'Test Raid Campaign',
    description: 'Like, retweet, and post proof.',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/1850000000000000000',
    rewardAmount: '5,000 $GENESIS',
    status: 'ACTIVE',
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    durationHours: 24,
    postedBy: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
    ...overrides,
  };
}

export async function mountCampaignCard(opts: {
  campaign?: Campaign;
  walletContext: WalletContextState;
  genesisContext?: GenesisContextValue;
  userWallet?: string | null;
  onSubmissionSuccess?: (sub: CampaignSubmission) => void;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  let currentWallet = opts.walletContext;
  let currentGenesis = opts.genesisContext || makeMockGenesisContext();
  let currentCampaign = opts.campaign || makeSampleCampaign();

  const renderWith = async () => {
    await act(async () => {
      root.render(
        <WalletContext.Provider value={currentWallet}>
          <GenesisContext.Provider value={currentGenesis}>
            <CampaignCard
              campaign={currentCampaign}
              userWallet={opts.userWallet}
              onSubmissionSuccess={opts.onSubmissionSuccess}
            />
          </GenesisContext.Provider>
        </WalletContext.Provider>
      );
    });
    // Flush microtasks & session probe effects
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  };

  await renderWith();

  return {
    container,
    async update(next: {
      walletContext?: WalletContextState;
      genesisContext?: GenesisContextValue;
      campaign?: Campaign;
    }) {
      if (next.walletContext) currentWallet = next.walletContext;
      if (next.genesisContext) currentGenesis = next.genesisContext;
      if (next.campaign) currentCampaign = next.campaign;
      await renderWith();
    },
    async flush(ms = 15) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

