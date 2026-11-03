'use client';

import React from 'react';
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

        <div className="flex items-center gap-4">
          <a
            href="https://t.me/TrenchLabsHQ"
            target="_blank"
            rel="noreferrer"
            className="hover:text-pump transition-colors font-medium"
          >
            Telegram
          </a>
          <a
            href="https://x.com/Trenchlabshq"
            target="_blank"
            rel="noreferrer"
            className="hover:text-pump transition-colors font-medium"
          >
            X (Twitter)
          </a>
          <a
            href="#hero-section"
            className="hidden md:inline-flex items-center gap-1 text-muted hover:text-pump font-semibold transition-colors"
          >
            <span>Back to top</span>
            <ArrowUp className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </footer>
  );
};
