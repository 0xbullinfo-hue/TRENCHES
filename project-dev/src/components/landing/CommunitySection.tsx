'use client';

import React from 'react';
import { SOCIAL_LINKS } from '@/lib/config';
import { ArrowUpRight, Send } from 'lucide-react';

function XIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export const CommunitySection: React.FC = () => {
  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim() || SOCIAL_LINKS.telegram;

  return (
    <section id="community-section" className="border-b border-toxic-border bg-canvas py-16 sm:py-20">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-surface border border-border-default p-8 sm:p-12 lg:p-16 text-center space-y-6">
          <div className="space-y-3 max-w-2xl mx-auto">
            <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
              JOIN THE SYNDICATE
            </span>
            <h2 className="font-sans text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight text-white">
              BUILD WITH THE LAB.
            </h2>
            <p className="font-sans text-sm sm:text-base text-muted leading-relaxed">
              Join the community, follow research updates and stay informed as TRENCHLABS expands across every trench.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2 max-w-md mx-auto">
            <a
              href={communityUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto h-12 min-h-[44px] px-8 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm uppercase tracking-wide inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4 fill-current" />
              <span>JOIN TELEGRAM</span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </a>

            <a
              href={SOCIAL_LINKS.x}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto h-12 min-h-[44px] px-8 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-toxic text-white font-sans font-bold text-sm uppercase tracking-wide inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <XIcon className="w-4 h-4 text-toxic shrink-0" />
              <span>FOLLOW ON X</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

