import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const ROOT_DIR = path.resolve(process.cwd());
const REPO_ROOT = path.resolve(ROOT_DIR, '..');

test('Task 2 [1/4]: project-dev/vercel.json retains only daily /api/telegram/sweep cron for Hobby compatibility', () => {
  const vercelPath = path.join(ROOT_DIR, 'vercel.json');
  const parsed = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  assert.ok(Array.isArray(parsed.crons), 'vercel.json must define crons array');
  assert.equal(parsed.crons.length, 1, 'Hobby plan requires at most daily crons; only /api/telegram/sweep belongs here');
  assert.deepEqual(parsed.crons[0], {
    path: '/api/telegram/sweep',
    schedule: '0 3 * * *',
  });
});

test('Task 2 [2/4]: External scheduler workflow triggers all three 5m endpoints once with CRON_SECRET Bearer auth', () => {
  const wfPath = path.join(REPO_ROOT, '.github/workflows/tp-sl-monitor.yml');
  const content = fs.readFileSync(wfPath, 'utf8');

  assert.ok(content.includes("cron: '*/5 * * * *'"), 'Workflow must schedule every 5 minutes');
  assert.ok(content.includes('/api/telegram/monitor'), 'Workflow must call /api/telegram/monitor');
  assert.ok(content.includes('/api/telegram/dispatch-delayed'), 'Workflow must call /api/telegram/dispatch-delayed');
  assert.ok(content.includes('/api/admin/campaign-recovery'), 'Workflow must call /api/admin/campaign-recovery');
  assert.ok(content.includes('CRON_SECRET: ${{ secrets.CRON_SECRET }}'), 'Workflow must read CRON_SECRET from GitHub secrets');
  assert.ok(content.includes('Authorization: Bearer ${CRON_SECRET}'), 'Workflow must pass Bearer auth');
  assert.ok(!content.includes('cat /tmp/'), 'Workflow must never print raw temporary response payloads');
});

test('Task 2 [3/4]: /api/admin/campaign-recovery and /api/telegram/monitor fail closed without valid CRON_SECRET', async () => {
  const { GET: recoveryGet } = await import('../../src/app/api/admin/campaign-recovery/route.ts');
  const { GET: monitorGet } = await import('../../src/app/api/telegram/monitor/route.ts');

  const prev = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    const noCfgRecovery = await recoveryGet(new NextRequest('http://localhost:3000/api/admin/campaign-recovery'));
    assert.equal(noCfgRecovery.status, 503);
    const noCfgMonitor = await monitorGet(new NextRequest('http://localhost:3000/api/telegram/monitor'));
    assert.equal(noCfgMonitor.status, 500);

    process.env.CRON_SECRET = 'test-cron-secret-value';
    for (const [handler, url] of [
      [recoveryGet, 'http://localhost:3000/api/admin/campaign-recovery'],
      [monitorGet, 'http://localhost:3000/api/telegram/monitor'],
    ]) {
      const anon = await handler(new NextRequest(url));
      assert.equal(anon.status, 401);
      const bad = await handler(new NextRequest(url, { headers: { authorization: 'Bearer wrong' } }));
      assert.equal(bad.status, 401);
      const bare = await handler(new NextRequest(url, { headers: { authorization: 'test-cron-secret-value' } }));
      assert.equal(bare.status, 401);
    }
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
});

test('Task 4 [4/4]: StakePoint reports safe unconfigured status when program and pool IDs are absent', async () => {
  const { getStakeStatusForWallet } = await import('../../src/server/db.ts');
  const prevProg = process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID;
  const prevSrvProg = process.env.STAKEPOINT_PROGRAM_ID;
  const prevPool = process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID;

  try {
    delete process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID;
    delete process.env.STAKEPOINT_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID;

    const status = await getStakeStatusForWallet('FreeWallet1111111111111111111111111111111111');
    assert.equal(status.stakepoint.configured, false);
    assert.equal(status.stakepoint.program_configured, false);
    assert.equal(status.stakepoint.pool_configured, false);

    const stakeFormSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/stake/StakeForm.tsx'), 'utf8');
    const stakingCardSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/stake/DashboardStakingCard.tsx'), 'utf8');
    assert.ok(stakeFormSrc.includes('StakePoint staking is not yet configured.'), 'StakeForm must display safe not-configured copy');
    assert.ok(!stakeFormSrc.includes('LIVE SOON'), 'StakeForm must keep soft-launch wording rule');
    assert.ok(stakingCardSrc.includes('will be configured after token launch'), 'DashboardStakingCard must explain pending pool configuration');
  } finally {
    if (prevProg === undefined) delete process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID;
    else process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID = prevProg;
    if (prevSrvProg === undefined) delete process.env.STAKEPOINT_PROGRAM_ID;
    else process.env.STAKEPOINT_PROGRAM_ID = prevSrvProg;
    if (prevPool === undefined) delete process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID;
    else process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID = prevPool;
  }
});
