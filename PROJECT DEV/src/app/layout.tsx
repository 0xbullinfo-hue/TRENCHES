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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col bg-canvas text-ink font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

