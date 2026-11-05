import React from 'react';
import { TerminalHeader } from '@/components/TerminalHeader';
import { TelegramStatusBanner } from '@/components/telegram/TelegramStatusBanner';
import { Footer } from '@/components/Footer';

export default function TerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink overflow-x-hidden w-full">
      <TerminalHeader />
      <TelegramStatusBanner />
      <main className="flex-1 flex flex-col">{children}</main>
      <Footer />
    </div>
  );
}


