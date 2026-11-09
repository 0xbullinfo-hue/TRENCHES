import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUY_LINKS,
  GENESIS_MINT,
  PUBLIC_DASHBOARD_ENABLED,
  SOCIAL_LINKS,
  SOFT_LAUNCH_MESSAGE,
} from '../../src/lib/config.ts';

test('Soft-Launch Config: preserves live $GENESIS token links and soft-launch messaging', () => {
  assert.equal(PUBLIC_DASHBOARD_ENABLED, false);
  assert.equal(
    SOFT_LAUNCH_MESSAGE,
    'THE TOKEN IS LIVE. THE TRENCHLABS DASHBOARD IS COMING SOON. JOIN THE COMMUNITY FOR LAUNCH UPDATES.'
  );
  assert.ok(BUY_LINKS.pump.includes(GENESIS_MINT));
  assert.equal(SOCIAL_LINKS.telegram, 'https://t.me/TrenchLabsHQ');
  assert.equal(SOCIAL_LINKS.x, 'https://x.com/Trenchlabshq');
});

test('HeroTerminal: preserves BUY $GENESIS ON PUMP.FUN, JOIN THE LAB, FOLLOW ON X, and soft-launch message', () => {
  const heroSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/HeroTerminal.tsx'),
    'utf8'
  );
  assert.ok(heroSrc.includes('BUY $GENESIS ON PUMP.FUN'));
  assert.ok(heroSrc.includes('href={BUY_LINKS.pump}'));
  assert.ok(heroSrc.includes('JOIN THE LAB'));
  assert.ok(heroSrc.includes('href={SOCIAL_LINKS.telegram}'));
  assert.ok(heroSrc.includes('FOLLOW ON X'));
  assert.ok(heroSrc.includes('href={SOCIAL_LINKS.x}'));
  assert.ok(heroSrc.includes('SOFT_LAUNCH_MESSAGE'));
});

test('PublicHeader: renders JOIN THE SOFT LAUNCH in toxic-green CTA styling for disconnected and connected visitors during soft launch', () => {
  const headerSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/PublicHeader.tsx'),
    'utf8'
  );
  assert.ok(headerSrc.includes('JOIN THE SOFT LAUNCH'));
  assert.ok(!headerSrc.includes('CONNECT WALLET · LIVE SOON'));
  assert.ok(headerSrc.includes('connected && PUBLIC_DASHBOARD_ENABLED'));
  assert.ok(headerSrc.includes('href={SOCIAL_LINKS.telegram}'));
  assert.ok(headerSrc.includes('target="_blank"'));
  assert.ok(headerSrc.includes('bg-toxic hover:bg-toxic-bright text-canvas'));
});

test('Dashboard access protection: gates IncubatorHub for ordinary public visitors during soft launch while preserving admin access', () => {
  const dashboardPageSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/(terminal)/dashboard/page.tsx'),
    'utf8'
  );
  const lockedSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/LockedTerminal.tsx'),
    'utf8'
  );
  assert.ok(
    dashboardPageSrc.includes('connected && (PUBLIC_DASHBOARD_ENABLED || isAdmin)'),
    'DashboardPage must gate IncubatorHub behind PUBLIC_DASHBOARD_ENABLED || isAdmin'
  );
  assert.ok(
    lockedSrc.includes('!connected || (!PUBLIC_DASHBOARD_ENABLED && !isAdmin)'),
    'LockedTerminal must keep non-admin visitors locked during soft launch'
  );
  assert.ok(lockedSrc.includes('SOFT_LAUNCH_MESSAGE'));
  assert.ok(lockedSrc.includes('JOIN THE SOFT LAUNCH'));
});

