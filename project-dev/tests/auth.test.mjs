import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

test('Ed25519 signature binding and replay prevention logic', async () => {
  // Generate ed25519 keypair using Node.js built-in crypto
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const ts = Date.now();
  const rawBody = JSON.stringify({ ticker: 'TEST', chain: 'SOL' });
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const msg = ['TrenchLabs Admin', 'POST', '/api/alphas', ts, bodyHash].join('|');
  const msgBuffer = Buffer.from(msg, 'utf8');

  // Sign message
  const sig = crypto.sign(null, msgBuffer, privateKey);

  // 1. Signature verifies correctly with public key
  const valid = crypto.verify(null, msgBuffer, publicKey, sig);
  assert.equal(valid, true, 'Ed25519 signature must verify');

  // 2. Tampered body hash fails verification
  const tamperedMsg = Buffer.from(['TrenchLabs Admin', 'POST', '/api/alphas', ts, 'tampered_hash'].join('|'));
  const tamperedValid = crypto.verify(null, tamperedMsg, publicKey, sig);
  assert.equal(tamperedValid, false, 'Tampered request must fail signature check');

  // 3. Timestamp expiration check
  const expiredTs = Date.now() - (6 * 60 * 1000); // 6 mins ago
  const isExpired = Math.abs(Date.now() - expiredTs) > 5 * 60 * 1000;
  assert.equal(isExpired, true, 'Timestamps older than 5 minutes must be flagged expired');

  // 4. In-memory replay detection simulation
  const sigHex = sig.toString('hex');
  const seenSignatures = new Map();
  assert.equal(seenSignatures.has(sigHex), false, 'First use must not be detected as replay');
  seenSignatures.set(sigHex, Date.now() + 300_000);
  assert.equal(seenSignatures.has(sigHex), true, 'Second use must be detected as signature replay');

  // 5. Distributed KV replay protection simulation across two independent instances
  const sharedKVStore = new Map();
  async function mockKvLock(key, token, ttlSec) {
    if (sharedKVStore.has(key)) return false; // NX fail
    sharedKVStore.set(key, token);
    return true;
  }

  const replayId = crypto.createHash('sha256').update(sigHex).digest('hex');
  const lockKey = `admin-replay:${replayId}`;

  // Instance A receives the request
  const instanceAFirstUse = await mockKvLock(lockKey, 'used', 300);
  assert.equal(instanceAFirstUse, true, 'Instance A must acquire lock and process');

  // Instance B receives the same request (replay)
  const instanceBReplay = await mockKvLock(lockKey, 'used', 300);
  assert.equal(instanceBReplay, false, 'Instance B must reject replay on shared store');
});
