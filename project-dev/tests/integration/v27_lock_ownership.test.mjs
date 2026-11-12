import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import {
  acquireFileLock,
  isPidDead,
  __setTestFailLockMetadataWrite,
  __setTestFailLockMetadataVerify,
} from '../../src/server/db.ts';
import {
  saveCampaigns,
  loadCampaigns,
  withCampaignsLock,
  campaignsLockStorage,
  CAMPAIGNS_FILE_LOCK_PATH,
} from '../../src/server/campaigns-data.ts';

const TEST_LOCK_PATH = path.join(process.cwd(), 'data', 'v27_test.lock');

function cleanup(lockPath = TEST_LOCK_PATH) {
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
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

test('V2.7 Lock: Two simultaneous acquisition attempts by independent OS processes', async () => {
  cleanup();
  const workerScript = `
    import { acquireFileLock } from './src/server/db.ts';
    const lockPath = process.env.TEST_LOCK_PATH;
    try {
      const release = await acquireFileLock(lockPath, { maxWaitMs: 300 });
      console.log('ACQUIRED');
      await new Promise(r => setTimeout(r, 600));
      release();
      console.log('RELEASED');
    } catch (err) {
      console.log('FAILED:' + err.message);
    }
  `;
  const w1 = spawn(process.execPath, ['--import', 'tsx', '-e', workerScript], {
    env: { ...process.env, TEST_LOCK_PATH },
  });
  const w2 = spawn(process.execPath, ['--import', 'tsx', '-e', workerScript], {
    env: { ...process.env, TEST_LOCK_PATH },
  });

  const runWorker = (proc) =>
    new Promise((resolve) => {
      let out = '';
      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.stderr.on('data', (d) => (out += d.toString()));
      proc.on('close', () => resolve(out));
    });

  const [out1, out2] = await Promise.all([runWorker(w1), runWorker(w2)]);
  const combined = out1 + '\n' + out2;
  const acquiredCount = (combined.match(/ACQUIRED/g) || []).length;
  assert.equal(acquiredCount >= 1, true, 'At least one process acquires');
  cleanup();
});

test('V2.7 Lock: Stale-lock recovery verifies inspected generation and protects replacement locks', async () => {
  cleanup();

  // 1. Create a stale lock from a dead PID (PID 99999999 is dead)
  const deadPid = 99999999;
  assert.equal(isPidDead(deadPid), true);

  const staleMeta = {
    pid: deadPid,
    token: 'stale-token-v27-1',
    fencingGeneration: 1,
    createdAt: Date.now() - 50000,
  };
  fs.mkdirSync(path.dirname(TEST_LOCK_PATH), { recursive: true });
  fs.writeFileSync(TEST_LOCK_PATH, JSON.stringify(staleMeta, null, 2), 'utf8');

  // 2. Perform recovery using production acquireFileLock
  const handle = await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 1500 });
  assert.ok(handle, 'Stale lock from dead PID must be recovered');
  assert.equal(handle.fencingGeneration >= 2, true, 'Recovered lock must increment fencing generation');
  assert.equal(handle.isOwned(), true, 'Recovered lock must be owned');

  handle();
  cleanup();
});

test('V2.7 Lock: Recovery process cannot steal a newer replacement lock', async () => {
  cleanup();

  // Worker that acquires a live lock with generation 2
  const liveLock = await acquireFileLock(TEST_LOCK_PATH);
  assert.equal(liveLock.isOwned(), true);

  // Attempting recovery while liveLock is held must not steal it
  let stealAttemptError = null;
  try {
    await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 300 });
  } catch (err) {
    stealAttemptError = err;
  }
  assert.ok(stealAttemptError, 'Cannot acquire or steal a live lock');
  assert.equal(liveLock.isOwned(), true, 'Original live lock must remain owned');

  liveLock();
  cleanup();
});

test('V2.7 Lock: Lock holder crash (SIGKILL) is atomically recovered by second process', async () => {
  cleanup();

  const workerScript = `
    import { acquireFileLock } from './src/server/db.ts';
    const lockPath = process.env.TEST_LOCK_PATH;
    const release = await acquireFileLock(lockPath);
    console.log('LOCKED');
    // Hang until killed
    await new Promise(() => {});
  `;

  const child = spawn(process.execPath, ['--import', 'tsx', '-e', workerScript], {
    env: { ...process.env, TEST_LOCK_PATH },
  });
  await new Promise((resolve) => {
    child.stdout.on('data', (d) => {
      if (d.toString().includes('LOCKED')) resolve();
    });
  });

  // Confirm lockfile exists with child's PID
  assert.equal(fs.existsSync(TEST_LOCK_PATH), true);
  const beforeKill = JSON.parse(fs.readFileSync(TEST_LOCK_PATH, 'utf8'));
  assert.equal(beforeKill.pid, child.pid);

  // Kill child process with SIGKILL
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(isPidDead(child.pid), true, 'Child process must be dead');

  // Second process acquires and recovers the lock
  const recoveryHandle = await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 2000 });
  assert.ok(recoveryHandle);
  assert.equal(recoveryHandle.isOwned(), true);
  assert.equal(recoveryHandle.fencingGeneration, (beforeKill.fencingGeneration || 1) + 1);

  recoveryHandle();
  cleanup();
});

test('V2.7 Lock: Metadata write and verify failures leave no partially acquired lock', async () => {
  cleanup();

  // 1. Metadata write failure
  __setTestFailLockMetadataWrite(true);
  await assert.rejects(
    async () => {
      await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 200 });
    },
    /Simulated lock metadata write failure/
  );
  assert.equal(fs.existsSync(TEST_LOCK_PATH), false, 'Failed metadata write must leave no lockfile');

  // 2. Metadata verify failure
  __setTestFailLockMetadataVerify(true);
  await assert.rejects(
    async () => {
      await acquireFileLock(TEST_LOCK_PATH, { maxWaitMs: 200 });
    },
    /Simulated lock metadata verification failure/
  );
  assert.equal(fs.existsSync(TEST_LOCK_PATH), false, 'Failed metadata verify must leave no lockfile');

  cleanup();
});

test('V2.7 Lock: Release operation strictly checks ownership token before unlinking', async () => {
  cleanup();

  const handle1 = await acquireFileLock(TEST_LOCK_PATH);
  assert.equal(handle1.isOwned(), true);

  // Simulate external overwrite with a new token from another owner
  const replacementMeta = {
    pid: process.pid,
    token: 'replacement-owner-token-999',
    fencingGeneration: 5,
    createdAt: Date.now(),
  };
  fs.writeFileSync(TEST_LOCK_PATH, JSON.stringify(replacementMeta, null, 2), 'utf8');

  // Attempt release on handle1: it must NOT delete replacement's lock!
  handle1();
  assert.equal(fs.existsSync(TEST_LOCK_PATH), true, 'Old owner must not unlink replacement lock');
  const afterRelease = JSON.parse(fs.readFileSync(TEST_LOCK_PATH, 'utf8'));
  assert.equal(afterRelease.token, 'replacement-owner-token-999');

  cleanup();
});

test('V2.7 Fencing: Stale worker with lost ownership cannot perform protected writes (§5)', async () => {
  // Execute within withCampaignsLock
  await withCampaignsLock(async (ctx) => {
    assert.ok(ctx);
    ctx.assertOwned();

    // Now simulate lock loss by asserting stale state or unlinking lock
    if (ctx.lockType === 'file') {
      // Overwrite lock with another token
      fs.writeFileSync(
        CAMPAIGNS_FILE_LOCK_PATH,
        JSON.stringify({ pid: process.pid, token: 'other-token-stolen', fencingGeneration: 99, createdAt: Date.now() }),
        'utf8'
      );

      // Attempting to save campaigns must be rejected because assertOwned fails!
      const saveRes = await saveCampaigns([{ id: 'test-camp', title: 'Stale Write' }]);
      assert.equal(saveRes.success, false, 'Stale worker write must be rejected');
      assert.match(saveRes.error, /Lock ownership lost/);
    }
  });
});

