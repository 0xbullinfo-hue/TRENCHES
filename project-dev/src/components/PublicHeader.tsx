'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useGenesisBalance } from '@/context/GenesisContext';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { SOCIAL_LINKS } from '@/lib/config';
import { ArrowUpRight, LogOut, Menu, Send, Wallet, X } from 'lucide-react';

const LANDING_SECTIONS = [
  { id: 'hero-section', label: 'HOME' },
  { id: 'how-it-works', label: 'HOW IT WORKS' },
  { id: 'pipeline-section', label: 'INCUBATOR' },
  { id: 'choose-your-access', label: 'MEMBERSHIP' },
] as const;

export const PublicHeader: React.FC = () => {
  const pathname = usePathname();
  const isHome = pathname === '/';
  const isPerformanceActive = pathname === '/ledger';
  const { connected, shortAddress, disconnectDemoOrWallet } = useGenesisBalance();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '');
      if (hash && LANDING_SECTIONS.some((s) => s.id === hash)) {
        return hash;
      }
    }
    return 'hero-section';
  });

  const isNavigatingRef = useRef(false);
  const navTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Close mobile menu on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    };
  }, []);

  // Section Observer & Scroll Tracking on the homepage
  useEffect(() => {
    if (pathname !== '/') return;

    const calculateActiveSection = () => {
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;

      // 1. Top of page boundary -> HOME
      if (scrollY < 80) {
        return 'hero-section';
      }

      // 2. Bottom of page boundary -> MEMBERSHIP (last section)
      if (windowHeight + scrollY >= docHeight - 80) {
        return 'choose-your-access';
      }

      // 3. Focal point scan: check which section covers the focal point (220px below top)
      const focalY = 220;
      for (const s of LANDING_SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= focalY && r.bottom > focalY) {
          return s.id;
        }
      }

      // 4. Fallback: closest section top to focalY
      let closest = 'hero-section';
      let minDistance = Infinity;
      for (const s of LANDING_SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top - focalY);
        if (dist < minDistance) {
          minDistance = dist;
          closest = s.id;
        }
      }
      return closest;
    };

    const updateActiveSection = () => {
      if (isNavigatingRef.current) return;
      setActiveSection(calculateActiveSection());
    };

    let observer: IntersectionObserver | null = null;
    let hydrateTimer: NodeJS.Timeout | null = null;

    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        () => {
          updateActiveSection();
        },
        {
          rootMargin: '-88px 0px -40% 0px',
          threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
        }
      );

      const observeAll = () => {
        LANDING_SECTIONS.forEach((s) => {
          const el = document.getElementById(s.id);
          if (el) observer?.observe(el);
        });
      };

      observeAll();
      hydrateTimer = setTimeout(observeAll, 250);
    }

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateActiveSection();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    window.addEventListener('popstate', handleScroll);

    // Initial check
    handleScroll();

    return () => {
      if (hydrateTimer) clearTimeout(hydrateTimer);
      observer?.disconnect();
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('popstate', handleScroll);
    };
  }, [pathname]);

  const handleSectionNav = useCallback(
    (sectionId: string, e: React.MouseEvent) => {
      if (pathname === '/') {
        e.preventDefault();
        setMobileMenuOpen(false);
        setActiveSection(sectionId);
        isNavigatingRef.current = true;
        if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
        navTimeoutRef.current = setTimeout(() => {
          isNavigatingRef.current = false;
        }, 800);

        const el = document.getElementById(sectionId);
        if (el) {
          const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const headerHeight = window.innerWidth < 640 ? 68 : 84;
          const targetY = Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerHeight);
          window.scrollTo({
            top: targetY,
            behavior: prefersReduced ? 'auto' : 'smooth',
          });
          window.history.pushState(null, '', `#${sectionId}`);
        }
      } else {
        setMobileMenuOpen(false);
      }
    },
    [pathname]
  );

  const getDesktopNavClass = (sectionId: string) => {
    const isActive = isHome && activeSection === sectionId;
    return `px-3 py-2 rounded-lg uppercase font-sans text-xs xl:text-sm font-extrabold transition-colors ${
      isActive
        ? 'text-toxic font-black bg-surface-card border border-toxic/40 shadow-none'
        : 'text-muted hover:text-toxic hover:bg-surface border border-transparent'
    }`;
  };

  const getMobileNavClass = (sectionId: string) => {
    const isActive = isHome && activeSection === sectionId;
    return `flex items-center h-12 min-h-[44px] px-4 rounded-lg font-sans font-bold text-sm uppercase tracking-wider transition-colors ${
      isActive
        ? 'text-toxic font-black bg-surface-card border border-toxic/40'
        : 'text-muted hover:bg-surface-card hover:text-toxic border border-transparent'
    }`;
  };

  const handleDisconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    await disconnectDemoOrWallet();
  };

  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim() || SOCIAL_LINKS.telegram;

  return (
    <header className="sticky top-0 z-40 w-full bg-canvas border-b border-toxic-border">
      <div className="max-w-[1360px] mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hex Cube Icon + Bold TrenchLabsHQ Wordmark */}
        <Link href="/" className="flex items-center gap-2 sm:gap-3 shrink-0 group">
          <HexCubeLogo />
          <span className="font-sans font-extrabold tracking-tight text-base sm:text-2xl text-white">
            Trench<span className="text-toxic">Labs</span>HQ
          </span>
        </Link>

        {/* Center: Clean Navigation Menu Tabs (Desktop) */}
        <nav
          aria-label="Public Navigation"
          className="hidden lg:flex items-center gap-1 xl:gap-2 font-sans text-xs xl:text-sm font-extrabold uppercase tracking-wide"
        >
          <Link
            href="/#hero-section"
            onClick={(e) => handleSectionNav('hero-section', e)}
            className={getDesktopNavClass('hero-section')}
          >
            HOME
          </Link>
          <Link
            href="/#how-it-works"
            onClick={(e) => handleSectionNav('how-it-works', e)}
            className={getDesktopNavClass('how-it-works')}
          >
            HOW IT WORKS
          </Link>
          <Link
            href="/#pipeline-section"
            onClick={(e) => handleSectionNav('pipeline-section', e)}
            className={getDesktopNavClass('pipeline-section')}
          >
            INCUBATOR
          </Link>
          <Link
            href="/#choose-your-access"
            onClick={(e) => handleSectionNav('choose-your-access', e)}
            className={getDesktopNavClass('choose-your-access')}
          >
            MEMBERSHIP
          </Link>
          <Link
            href="/ledger"
            className={`px-3 py-2 rounded-lg uppercase transition-colors ${
              isPerformanceActive
                ? 'text-toxic font-black bg-surface-card border border-toxic/40 shadow-none'
                : 'text-muted hover:text-toxic hover:bg-surface border border-transparent'
            }`}
          >
            PERFORMANCE
          </Link>
        </nav>

        {/* Right: Primary Community CTA, Wallet Connect & Mobile Hamburger Toggle */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Primary CTA: JOIN COMMUNITY */}
          <a
            href={communityUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 h-9 sm:h-11 px-3 sm:px-4 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wide transition-colors cursor-pointer shrink-0"
          >
            <Send className="w-3.5 h-3.5 fill-current" />
            <span>JOIN COMMUNITY</span>
            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </a>

          {/* Wallet State (Controlled Soft-Launch: disabled with LIVE SOON or active when connected) */}
          {connected ? (
            <Link
              href="/dashboard"
              className="h-9 sm:h-11 px-2.5 sm:px-4 rounded-lg bg-surface border border-toxic hover:border-toxic-bright text-white font-sans text-xs sm:text-sm font-bold uppercase tracking-wide inline-flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer shrink-0"
            >
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5] text-toxic" />
              <span className="hidden xl:inline">DASHBOARD ({shortAddress})</span>
              <span className="xl:hidden">{shortAddress}</span>
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Wallet connection coming soon"
              className="h-9 sm:h-11 px-2.5 sm:px-4 rounded-lg bg-surface border border-toxic-border/60 text-muted font-sans text-[11px] sm:text-xs font-black uppercase tracking-wide inline-flex items-center gap-1.5 sm:gap-2 cursor-not-allowed opacity-75 select-none shrink-0"
            >
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5] text-muted shrink-0" />
              <span className="hidden md:inline">CONNECT WALLET · LIVE SOON</span>
              <span className="md:hidden">LIVE SOON</span>
            </button>
          )}

          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="h-9 w-9 sm:h-11 sm:w-11 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border text-muted hover:text-danger flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Disconnect Wallet"
              aria-label="Disconnect Wallet"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}

          {/* Mobile Navigation Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden h-10 w-10 sm:h-11 sm:w-11 min-h-[44px] min-w-[44px] rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-toxic text-white flex items-center justify-center transition-colors shrink-0"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-toxic" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Collapsible Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 right-0 border-t border-border-default bg-surface px-4 py-4 space-y-2 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150">
          <Link
            href="/#hero-section"
            onClick={(e) => {
              setMobileMenuOpen(false);
              handleSectionNav('hero-section', e);
            }}
            className={getMobileNavClass('hero-section')}
          >
            HOME
          </Link>
          <Link
            href="/#how-it-works"
            onClick={(e) => {
              setMobileMenuOpen(false);
              handleSectionNav('how-it-works', e);
            }}
            className={getMobileNavClass('how-it-works')}
          >
            HOW IT WORKS
          </Link>
          <Link
            href="/#pipeline-section"
            onClick={(e) => {
              setMobileMenuOpen(false);
              handleSectionNav('pipeline-section', e);
            }}
            className={getMobileNavClass('pipeline-section')}
          >
            INCUBATOR
          </Link>
          <Link
            href="/#choose-your-access"
            onClick={(e) => {
              setMobileMenuOpen(false);
              handleSectionNav('choose-your-access', e);
            }}
            className={getMobileNavClass('choose-your-access')}
          >
            MEMBERSHIP
          </Link>
          <Link
            href="/ledger"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center h-12 min-h-[44px] px-4 rounded-lg font-sans font-bold text-sm hover:bg-surface-card hover:text-toxic transition-colors uppercase tracking-wider ${
              isPerformanceActive ? 'text-toxic font-black bg-surface-card border border-toxic/40' : 'text-muted'
            }`}
          >
            PERFORMANCE
          </Link>
          <div className="pt-2">
            <a
              href={communityUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between h-12 min-h-[44px] px-4 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm uppercase tracking-wider transition-colors"
            >
              <span className="flex items-center gap-2">
                <Send className="w-4 h-4 fill-current" />
                <span>JOIN COMMUNITY</span>
              </span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </a>
          </div>
        </div>
      )}
    </header>
  );
};
