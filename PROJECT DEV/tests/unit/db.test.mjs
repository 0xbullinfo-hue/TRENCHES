// Tests the REAL src/server/db.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'trench-db-')));

const db = await import(new URL('../../src/server/db.ts', import.meta.url).href);
const { createOrReuseVerificationSession, claimVerificationSession, releaseVerificationSession, resolveTier, getTierThresholds } = db;

test('a verification session can be claimed exactly once, even under concurrency', async () => {
  const created = await createOrReuseVerificationSession('WalletConcurrent111', 'pro');
  assert.ok('session' in created);
  const id = created.session.session_id;

  const results = await Promise.all(Array.from({ length: 5 }, () => claimVerificationSession(id, 42)));
  assert.equal(results.filter((r) => r.status === 'ok').length, 1, 'exactly one winner');
  assert.equal(results.filter((r) => r.status === 'used').length, 4);
});

test('release makes a claimed session usable again; unknown and expired sessions are rejected', async () => {
  const created = await createOrReuseVerificationSession('WalletRelease222', 'member');
  const id = created.session.session_id;

  assert.equal((await claimVerificationSession(id, 7)).status, 'ok');
  await releaseVerificationSession(id);
  assert.equal((await claimVerificationSession(id, 7)).status, 'ok');

  assert.equal((await claimVerificationSession('doesNotExist', 1)).status, 'not_found');

  // Force-expire a session on disk and confirm it cannot be claimed
  const file = path.join(process.cwd(), 'data', 'db.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exp = data.verification_sessions.find((s) => s.session_id === id);
  exp.used_at = null;
  exp.expires_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(data));
  assert.equal((await claimVerificationSession(id, 7)).status, 'expired');
});

test('multi-tier thresholds exist for member ($20) and pro ($250)', async () => {
  const thresholds = await getTierThresholds();
  assert.equal(thresholds.member.usd_target, 20);
  assert.equal(thresholds.pro.usd_target, 250);
});

test('admin wallet resolves directly to pro', async () => {
  const adminTier = await resolveTier('FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e');
  assert.equal(adminTier, 'pro');
});

