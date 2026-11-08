// Tests the REAL src/server/auth.ts (loaded through tsx)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const SECRET = 'a'.repeat(40);

async function loadAuth() {
  return import('../../src/server/auth.ts');
}

test('production without SESSION_SECRET: cannot sign and rejects every token (fails closed)', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.SESSION_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret-must-not-be-used-as-fallback';
  const auth = await loadAuth();

  assert.throws(() => auth.signSession('Wallet111'), /SESSION_SECRET/);

  // A token forged with the old hard-coded fallback or the webhook secret must NOT verify.
  for (const secret of ['trenchlabs-session-secret-key-32ch', process.env.TELEGRAM_WEBHOOK_SECRET]) {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const payload = `Wallet111|${exp}`;
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    assert.equal(auth.verifySessionToken(`${payload}.${hmac}`), null);
  }
});

test('session token round-trip, tamper and expiry', async () => {
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = SECRET;
  const auth = await loadAuth();

  const token = auth.signSession('Wallet111');
  assert.deepEqual(auth.verifySessionToken(token), { wallet: 'Wallet111' });

  assert.equal(auth.verifySessionToken(token.replace('Wallet111', 'Wallet222')), null, 'payload tamper');
  assert.equal(auth.verifySessionToken(token.slice(0, -2) + '00'), null, 'signature tamper');
  assert.equal(auth.verifySessionToken(token.slice(0, -1)), null, 'truncated signature');
  assert.equal(auth.verifySessionToken(auth.signSession('Wallet111', -10)), null, 'expired');
  assert.equal(auth.verifySessionToken('garbage'), null);
});

test('SESSION_SECRET shorter than 32 chars is rejected in production', async () => {
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'too-short';
  const auth = await loadAuth();
  assert.throws(() => auth.signSession('Wallet111'), /SESSION_SECRET/);
});

test('parseCookieHeader keeps values containing "=" and tolerates bad encoding', async () => {
  const auth = await loadAuth();
  const out = auth.parseCookieHeader('a=1; trench_session=abc=def==; bad=%E0%A4%A; empty=');
  assert.equal(out.a, '1');
  assert.equal(out.trench_session, 'abc=def==');
  assert.equal(out.bad, '%E0%A4%A');
  assert.equal('empty' in out, false);
});

