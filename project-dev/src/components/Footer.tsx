'use client';

import React from 'react';
import { SOCIAL_LINKS } from '@/lib/config';
import { ArrowUp } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full bg-canvas border-t border-line font-sans text-xs text-muted mt-auto">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-pump" />
          <span className="text-white font-semibold">
            Trench<span className="text-pump">Labs</span>HQ © 2026 — Built in the Trenches
          </span>
        </div>

        <div className="flex items-center gap-4 uppercase">
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noreferrer"
            className="hover:text-pump transition-colors font-bold uppercase"
          >
            TELEGRAM
          </a>
          <a
            href={SOCIAL_LINKS.x}
            target="_blank"
            rel="noreferrer"
            className="hover:text-pump transition-colors font-bold uppercase"
          >
            X (TWITTER)
          </a>
          <a
            href="#hero-section"
            className="hidden md:inline-flex items-center gap-1 text-muted hover:text-pump font-bold uppercase transition-colors"
          >
            <span>BACK TO TOP</span>
            <ArrowUp className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </footer>
  );
};
