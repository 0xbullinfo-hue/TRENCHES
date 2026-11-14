import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0A0E13',
};

export const metadata: Metadata = {
  title:
    'TrenchlabsHQ // Alpha Incubator - Token-gated Alpha Lab incubator powered by $H42 on Solana (EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump)',
  description:
    'Token-gated Alpha Lab incubator powered by $H42 on Solana (EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump). Real-time multi-chain signals, verifiable ledger, and 90-day StakePoint staking.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.png',
  },
  openGraph: {
    title:
      'TrenchlabsHQ // Alpha Incubator - Token-gated Alpha Lab incubator powered by $H42 on Solana (EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump)',
    description:
      'Token-gated Alpha Lab incubator powered by $H42 on Solana (EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump).',
    url: 'https://www.trenchlabshq.xyz',
    siteName: 'TrenchlabsHQ',
    images: [
      {
        url: '/images/trenchlabs-hero-removebg.png',
        width: 1200,
        height: 630,
        alt: 'TrenchlabsHQ Incubator',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title:
      'TrenchlabsHQ // Alpha Incubator - Token-gated Alpha Lab incubator powered by $H42 on Solana',
    description:
      'Token-gated Alpha Lab incubator powered by $H42 on Solana (EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump).',
    images: ['/images/trenchlabs-hero-removebg.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen flex flex-col bg-canvas text-ink font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

