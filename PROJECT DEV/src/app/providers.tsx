'use client';

import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { TrustWalletAdapter } from '@/lib/trustWalletAdapter';
import { MAINTENANCE_CONFIG, SOLANA_RPC } from '@/lib/config';
import { MaintenanceScreen } from '@/components/MaintenanceScreen';
import { GenesisProvider } from '@/context/GenesisContext';

import '@solana/wallet-adapter-react-ui/styles.css';

const SafeConnectionProvider = ConnectionProvider as unknown as React.ComponentType<{
  endpoint: string;
  config?: { commitment?: 'processed' | 'confirmed' | 'finalized' };
  children: ReactNode;
}>;

/**
 * Wallets: Phantom, Solflare, and Trust Wallet adapters explicitly;
 * Backpack and any other Wallet Standard wallets are auto-detected by WalletProvider.
 */
export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new TrustWalletAdapter()],
    []
  );

  if (MAINTENANCE_CONFIG.enabled) {
    return <MaintenanceScreen />;
  }

  return (
    <SafeConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: 'confirmed' }}>
      <WalletProvider
        wallets={wallets}
        autoConnect
        onError={(err) => {
          console.error('[TrenchLabs Wallet Error]:', err?.message || err);
        }}
      >
        <WalletModalProvider>
          <GenesisProvider>{children}</GenesisProvider>
        </WalletModalProvider>
      </WalletProvider>
    </SafeConnectionProvider>
  );
}
