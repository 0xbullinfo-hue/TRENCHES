'use client';

import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { SOLANA_RPC } from '@/lib/config';
import { GenesisProvider } from '@/context/GenesisContext';

import '@solana/wallet-adapter-react-ui/styles.css';

/**
 * Wallets: Phantom + Solflare adapters explicitly; Backpack (and any other
 * Wallet Standard wallet) is auto-detected by WalletProvider.
 */
export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <GenesisProvider>{children}</GenesisProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
