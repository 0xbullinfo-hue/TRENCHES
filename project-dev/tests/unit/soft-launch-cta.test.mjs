import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Landing Page Header: CONNECT WALLET button is disabled with LIVE SOON while connected DASHBOARD link remains active', () => {
  const headerSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/PublicHeader.tsx'),
    'utf8'
  );
  assert.ok(headerSrc.includes('CONNECT WALLET · LIVE SOON'));
  assert.ok(headerSrc.includes('disabled'));
  assert.ok(headerSrc.includes('aria-disabled="true"'));
  assert.ok(headerSrc.includes('cursor-not-allowed'));
  assert.ok(
    headerSrc.includes('href="/dashboard"') && headerSrc.includes('DASHBOARD ({shortAddress})'),
    'Authorized connected dashboard navigation must remain intact'
  );
});

test('Landing Page TierSection & TierCard: Member and Pro tier CTAs are disabled with LIVE SOON', () => {
  const tierSectionSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/landing/TierSection.tsx'),
    'utf8'
  );
  const tierCardSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/landing/TierCard.tsx'),
    'utf8'
  );
  assert.ok(tierSectionSrc.includes('ctaLabel="CONNECT WALLET · LIVE SOON"'));
  assert.ok(tierSectionSrc.includes('ctaLabel="EXPLORE STAKEPOINT · LIVE SOON"'));
  assert.ok(tierSectionSrc.includes('ctaDisabled={true}'));
  assert.ok(tierCardSrc.includes('disabled'));
  assert.ok(tierCardSrc.includes('cursor-not-allowed'));
});

test('Non-landing pages (Dashboard, TerminalHeader, LockedTerminal, StakeForm, StakePointCard) remain unmodified and functional', () => {
  const dashboardPageSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/(terminal)/dashboard/page.tsx'),
    'utf8'
  );
  const lockedSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/LockedTerminal.tsx'),
    'utf8'
  );
  const terminalHeaderSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/TerminalHeader.tsx'),
    'utf8'
  );
  const stakeFormSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/stake/StakeForm.tsx'),
    'utf8'
  );
  const stakePointCardSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/staking/StakePointCard.tsx'),
    'utf8'
  );

  assert.ok(!dashboardPageSrc.includes('PUBLIC_DASHBOARD_ENABLED'));
  assert.ok(lockedSrc.includes('onClick={connectWallet}'));
  assert.ok(!lockedSrc.includes('LIVE SOON'));
  assert.ok(terminalHeaderSrc.includes('onClick={connectWallet}'));
  assert.ok(!terminalHeaderSrc.includes('LIVE SOON'));
  assert.ok(!stakeFormSrc.includes('LIVE SOON'));
  assert.ok(!stakePointCardSrc.includes('LIVE SOON'));
});
