import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (relPath) =>
  fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');

test('Launch Lock L1: config.ts exports BUY_LOCK and WALLET_LOCK and LaunchLockedButton avoids LIVE SOON', () => {
  const configSrc = readSrc('src/lib/config.ts');
  assert.ok(
    configSrc.includes("export const BUY_LOCK = process.env.NEXT_PUBLIC_BUY_LOCK !== 'false';"),
    'config.ts must export BUY_LOCK'
  );
  assert.ok(
    configSrc.includes("export const WALLET_LOCK = process.env.NEXT_PUBLIC_WALLET_LOCK !== 'false';"),
    'config.ts must export WALLET_LOCK'
  );

  const btnSrc = readSrc('src/components/LaunchLockedButton.tsx');
  assert.ok(btnSrc.includes('title="Available soon"'));
  assert.ok(!btnSrc.includes('LIVE SOON'));
});

test('Launch Lock L2: all 6 $H42 buy link sites reference BUY_LOCK and preserve original href={BUY_LINKS.pump} in unlocked branch', () => {
  const l2Sites = [
    'src/components/HeroTerminal.tsx',
    'src/components/landing/TierSection.tsx',
    'src/components/LockedTerminal.tsx',
    'src/components/dashboard/DashboardOverview.tsx',
    'src/components/dashboard/AlphaInspectorModal.tsx',
    'src/components/Footer.tsx',
  ];

  for (const rel of l2Sites) {
    const src = readSrc(rel);
    assert.ok(src.includes('BUY_LOCK'), `${rel} must reference BUY_LOCK`);
    assert.ok(src.includes('href={BUY_LINKS.pump}'), `${rel} must preserve original BUY_LINKS.pump anchor`);
  }
});

test('Launch Lock L3: PublicHeader and TierCard enforce !WALLET_LOCK while dashboard files never contain LIVE SOON', () => {
  const headerSrc = readSrc('src/components/PublicHeader.tsx');
  const tierCardSrc = readSrc('src/components/landing/TierCard.tsx');
  const lockedSrc = readSrc('src/components/LockedTerminal.tsx');
  const terminalHeaderSrc = readSrc('src/components/TerminalHeader.tsx');

  assert.ok(headerSrc.includes('!WALLET_LOCK'), 'PublicHeader must enforce !WALLET_LOCK');
  assert.ok(tierCardSrc.includes('!WALLET_LOCK'), 'TierCard must enforce !WALLET_LOCK');
  assert.ok(!lockedSrc.includes('LIVE SOON'), 'LockedTerminal must not contain LIVE SOON');
  assert.ok(!terminalHeaderSrc.includes('LIVE SOON'), 'TerminalHeader must not contain LIVE SOON');
});
