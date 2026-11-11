import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Navigation Audit: PublicHeader uses root-relative anchors, active tracking and links PERFORMANCE to /ledger', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/components/PublicHeader.tsx'),
    'utf-8'
  );

  // Check desktop nav uses root-relative anchors so they work from /ledger
  assert.ok(src.includes('href="/#hero-section"'), 'Desktop HOME must point to /#hero-section');
  assert.ok(src.includes('href="/#how-it-works"'), 'Desktop HOW IT WORKS must point to /#how-it-works');
  assert.ok(src.includes('href="/#pipeline-section"'), 'Desktop INCUBATOR must point to /#pipeline-section');
  assert.ok(src.includes('href="/#choose-your-access"'), 'Desktop MEMBERSHIP must point to /#choose-your-access');

  // Check PERFORMANCE links to /ledger
  assert.ok(src.includes('href="/ledger"'), 'PERFORMANCE must link to /ledger');

  // Check mobile drawer also uses root-relative anchors and closes menu
  assert.ok(src.includes('onClick={() => setMobileMenuOpen(false)}'), 'Drawer links must close menu on navigation');

  // Check touch targets are at least 44px
  assert.ok(src.includes('min-h-[44px]'), 'Touch targets must be at least 44px');
  assert.ok(src.includes('min-w-[44px]'), 'Hamburger button must be at least 44px wide');

  // Check Active Section Tracking implementation
  assert.ok(src.includes('IntersectionObserver'), 'PublicHeader must use IntersectionObserver for active section tracking');
  assert.ok(src.includes('activeSection'), 'PublicHeader must manage activeSection state');
  assert.ok(src.includes('LANDING_SECTIONS'), 'PublicHeader must register landing sections for tracking');
  assert.ok(src.includes('handleSectionNav'), 'PublicHeader must have section navigation handler');
});

test('Navigation Audit: Landing page sections define proper scroll-margin-top for sticky header clearance', () => {
  const heroSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/HeroTerminal.tsx'), 'utf-8');
  const howSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/landing/HowItWorksSection.tsx'), 'utf-8');
  const pipeSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/PipelineGrid.tsx'), 'utf-8');
  const tierSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/landing/TierSection.tsx'), 'utf-8');

  assert.ok(heroSrc.includes('scroll-mt-20'), 'HeroTerminal must include scroll-mt-20 offset');
  assert.ok(howSrc.includes('scroll-mt-20'), 'HowItWorksSection must include scroll-mt-20 offset');
  assert.ok(pipeSrc.includes('scroll-mt-20'), 'PipelineGrid must include scroll-mt-20 offset');
  assert.ok(tierSrc.includes('scroll-mt-20'), 'TierSection must include scroll-mt-20 offset');
});

test('Navigation Audit: Global CSS enforces scroll-padding-top and prefers-reduced-motion', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf-8');
  assert.ok(css.includes('scroll-padding-top: 88px'), 'Global CSS must set scroll-padding-top');
  assert.ok(css.includes('prefers-reduced-motion: reduce'), 'Global CSS must handle prefers-reduced-motion');
});

test('Navigation Audit: TerminalHeader routes PERFORMANCE to /ledger and does not use broken anchors', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/components/TerminalHeader.tsx'),
    'utf-8'
  );

  // Must not have dead anchor jump
  assert.ok(!src.includes('href="#ledger-embed"'), 'TerminalHeader must not use #ledger-embed anchor jump');

  // Must link to /ledger in desktop and mobile sub-bar
  assert.ok(src.includes('href="/ledger"'), 'TerminalHeader must link to /ledger');

  // Must link to /dashboard
  assert.ok(src.includes('href="/dashboard"'), 'TerminalHeader must link to /dashboard');

  // Must preserve wallet connect action
  assert.ok(src.includes('onClick={connectWallet}'), 'TerminalHeader must preserve connectWallet action');
  assert.ok(!src.includes('LIVE SOON'), 'TerminalHeader must not contain LIVE SOON');
});

test('Navigation Audit: Footer platform links are root-relative and BACK TO TOP adapts to route', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/components/Footer.tsx'),
    'utf-8'
  );

  assert.ok(src.includes('href="/#hero-section"'), 'Footer Home must point to /#hero-section');
  assert.ok(src.includes('href="/#how-it-works"'), 'Footer How The Lab Works must point to /#how-it-works');
  assert.ok(src.includes('href="/#pipeline-section"'), 'Footer Incubator Pipeline must point to /#pipeline-section');
  assert.ok(src.includes('href="/#choose-your-access"'), 'Footer Membership Tiers must point to /#choose-your-access');
  assert.ok(src.includes('href="/ledger"'), 'Footer Performance Ledger must link to /ledger');
  assert.ok(src.includes('href="/dashboard"'), 'Footer Terminal Login must link to /dashboard');

  // Back to top adaptability
  assert.ok(src.includes('handleBackToTop'), 'Footer must handle back to top scrolling');
  assert.ok(src.includes('isHomePage ? \'#hero-section\' : \'/#hero-section\''), 'Footer must route to /#hero-section on subpages');
});

test('Navigation Audit: DashboardLedgerEmbed provides direct Link to /ledger', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ledger/DashboardLedgerEmbed.tsx'),
    'utf-8'
  );

  assert.ok(src.includes('href="/ledger"'), 'DashboardLedgerEmbed must provide a direct Link to /ledger');
  assert.ok(src.includes('setIsOpen(true)'), 'DashboardLedgerEmbed must allow inline preview toggle');
});

test('Navigation Audit: IncubatorHub four tabs have role="tab", min-h-[44px], URL synchronization, and popstate handling', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/components/dashboard/IncubatorHub.tsx'),
    'utf-8'
  );

  // Four tabs
  assert.ok(src.includes("handleSelectTab('ALPHA')"), 'Alpha tab handler must exist');
  assert.ok(src.includes("handleSelectTab('SOCIAL')"), 'Social tab handler must exist');
  assert.ok(src.includes("handleSelectTab('WATCHLIST')"), 'Watchlist tab handler must exist');
  assert.ok(src.includes("handleSelectTab('MAX_ALPHA')"), 'Max Alpha tab handler must exist');

  // Accessibility and sizing
  assert.ok(src.includes('role="tablist"'), 'Tab container must have role="tablist"');
  assert.ok(src.includes('role="tab"'), 'Tab items must have role="tab"');
  assert.ok(src.includes('min-h-[44px]'), 'Tabs must have min-h-[44px] touch targets');

  // History and URL state
  assert.ok(src.includes('window.history.pushState'), 'Tab selection must update browser history via pushState');
  assert.ok(src.includes('window.addEventListener(\'popstate\''), 'IncubatorHub must listen to popstate for back/forward sync');

  // Restriction handling
  assert.ok(src.includes('<MembershipRestrictionScreen'), 'IncubatorHub must render restriction screen for unauthorized tabs');
  assert.ok(src.includes("currentTab === 'SOCIAL'"), 'IncubatorHub must render CampaignSection when SOCIAL is selected');
});
