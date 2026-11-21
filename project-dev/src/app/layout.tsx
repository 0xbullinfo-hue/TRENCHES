import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
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

function resolveMetadataBase(): URL {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '').trim();
  if (raw) {
    try {
      return new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    } catch {
      // fall through to canonical default
    }
  }
  return new URL('https://trenchlabshq.xyz');
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: 'TrenchLabsHQ: research-backed token calls on Solana',
  description:
    'Token-gated Alpha Lab incubator powered by $H42 on Solana. Real-time multi-chain signals, verifiable ledger, and 90-day StakePoint staking.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.png',
  },
  openGraph: {
    title: 'TrenchLabsHQ: research-backed token calls on Solana',
    description:
      'Token-gated Alpha Lab incubator powered by $H42 on Solana.',
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
    title: 'TrenchLabsHQ: research-backed token calls on Solana',
    description:
      'Token-gated Alpha Lab incubator powered by $H42 on Solana.',
    images: ['/images/trenchlabs-hero-removebg.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen flex flex-col bg-canvas text-ink font-sans antialiased"
      >
        <Providers>{children}</Providers>
        <Toaster theme="dark" position="bottom-right" richColors />
      </body>
    </html>
  );
}

