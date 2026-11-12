import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  acquireFileLock,
  isPidDead,
  getAndIncrementDurableGeneration,
} from '../../src/server/db.ts';
import {
  saveCampaigns,
  loadCampaigns,
  saveSubmissions,
  loadSubmissions,
  withCampaignsLock,
  campaignsLockStorage,
  CAMPAIGNS_FILE_LOCK_PATH,
} from '../../src/server/campaigns-data.ts';

const TEST_LOCK_PATH = path.join(process.cwd(), 'data', 'v28_test.lock');

function cleanup(lockPath = TEST_LOCK_PATH) {
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {}
  try {
    const genFile = `${lockPath}.gen`;
    if (fs.existsSync(genFile)) fs.unlinkSync(genFile);
  } catch {}
  try {
    const dir = path.dirname(lockPath);
    const base = path.basename(lockPath);
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${base}.reclaim.`)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}

test('V2.8 Locking [1/4]: Fencing generations are strictly monotonic across sequential acquisitions (§3)', async () => {
  cleanup();

  try {
    // First acquisition
    const release1 = await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 1000 });
    const gen1 = release1.fencingGeneration;
    assert.equal(gen1 >= 1, true, 'First lock acquisition has gen >= 1');
    assert.equal(release1.isOwned(), true);
    release1();
    assert.equal(release1.isOwned(), false);

    // Second acquisition
    const release2 = await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 1000 });
    const gen2 = release2.fencingGeneration;
    assert.equal(gen2 > gen1, true, `Second generation (${gen2}) must be strictly greater than first (${gen1})`);
    release2();

    // Third acquisition
    const release3 = await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 1000 });
    const gen3 = release3.fencingGeneration;
    assert.equal(gen3 > gen2, true, `Third generation (${gen3}) must be strictly greater than second (${gen2})`);
    release3();
  } finally {
    cleanup();
  }
});

test('V2.8 Locking [2/4]: Stale-lock recovery from dead PID increments generation monotonically (§3)', async () => {
  cleanup();

  try {
    // 1. Establish an initial generation baseline
    const initialGen = getAndIncrementDurableGeneration(TEST_LOCK_PATH, 5);
    assert.equal(initialGen >= 5, true);

    // 2. Plant a stale lock with dead PID
    const deadPid = 99999999;
    assert.equal(isPidDead(deadPid), true);
    const staleMeta = {
      pid: deadPid,
      token: 'stale-dead-token-v28',
      fencingGeneration: initialGen,
      createdAt: Date.now() - 60000,
    };
    fs.mkdirSync(path.dirname(TEST_LOCK_PATH), { recursive: true });
    fs.writeFileSync(TEST_LOCK_PATH, JSON.stringify(staleMeta, null, 2), 'utf8');

    // 3. Recover the stale lock
    const handle = await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 1500 });
    assert.ok(handle, 'Stale lock must be recovered');
    assert.equal(
      handle.fencingGeneration > initialGen,
      true,
      `Recovered fencing generation (${handle.fencingGeneration}) must exceed initial (${initialGen})`
    );
    assert.equal(handle.isOwned(), true);
    handle();
  } finally {
    cleanup();
  }
});

test('V2.8 Locking [3/4]: Stale-lock recovery never overwrites or replaces a newer owner lock (§3)', async () => {
  cleanup();

  try {
    // Plant a stale lock
    const deadPid = 99999999;
    const staleMeta = {
      pid: deadPid,
      token: 'stale-token-v28',
      fencingGeneration: 10,
      createdAt: Date.now() - 60000,
    };
    fs.mkdirSync(path.dirname(TEST_LOCK_PATH), { recursive: true });
    fs.writeFileSync(TEST_LOCK_PATH, JSON.stringify(staleMeta, null, 2), 'utf8');

    // Simulate another worker grabbing the lock right when recovery starts
    const validToken = 'valid-replacement-token';
    const validMeta = {
      pid: process.pid,
      token: validToken,
      fencingGeneration: 12,
      createdAt: Date.now(),
    };

    // When recovery reclaims, if a valid replacement lock exists, it must not be clobbered
    fs.writeFileSync(TEST_LOCK_PATH, JSON.stringify(validMeta, null, 2), 'utf8');

    const handle = await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 300 }).catch((err) => null);
    // Because validMeta has current active PID and recent createdAt, acquireFileLock should either wait or timeout
    // but the file must still retain validMeta
    const fileContent = JSON.parse(fs.readFileSync(TEST_LOCK_PATH, 'utf8'));
    assert.equal(fileContent.token, validToken, 'Replacement lock token must NOT have been overwritten');
    if (handle) handle();
  } finally {
    cleanup();
  }
});

test('V2.8 Fencing [4/4]: Stale lock holder with lost ownership is prevented from protected writes (§3 & §4)', async () => {
  const campaigns = await loadCampaigns();

  // Attempting to save campaigns with a stale or expired lock context
  const fakeStaleLock = {
    token: 'stale-worker-token-000',
    fencingGeneration: 0,
    isOwned: () => false,
    assertOwned: () => {
      throw new Error('Lock lease expired or stolen by newer generation');
    },
  };

  await campaignsLockStorage.run(fakeStaleLock, async () => {
    // Even if called within async context, if isOwned() / assertOwned() fails, it must fail closed
    let threw = false;
    try {
      const res = await saveCampaigns(campaigns);
      if (!res.success) {
        threw = true;
      }
    } catch {
      threw = true;
    }
    assert.equal(threw, true, 'Protected write must throw or return failure when lock ownership is lost');
  });
});
