import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'TrenchLabsHQ // Alpha Crypto Trade Calls Hub',
  description:
    'Token-gated Alpha Crypto Trade Calls Hub powered by $GENESIS on Solana (EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump).',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col bg-canvas text-ink font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

