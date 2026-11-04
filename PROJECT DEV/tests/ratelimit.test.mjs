import test from 'node:test';
import assert from 'node:assert/strict';

test('Rate limit calculation logic', async () => {
  const mem = new Map();
  const limit = 5;
  const windowSec = 10;
  const key = 'test-ip-127.0.0.1';

  function mockRateLimit(now) {
    const cur = mem.get(key);
    if (!cur || cur.reset < now) {
      mem.set(key, { n: 1, reset: now + windowSec * 1000 });
      return { ok: true, count: 1 };
    }
    cur.n += 1;
    return { ok: cur.n <= limit, count: cur.n };
  }

  const t0 = 1_000_000;
  // 5 requests allowed
  for (let i = 1; i <= 5; i++) {
    const res = mockRateLimit(t0);
    assert.equal(res.ok, true, `Request ${i} should be allowed`);
    assert.equal(res.count, i);
  }

  // 6th request rejected
  const res6 = mockRateLimit(t0);
  assert.equal(res6.ok, false, 'Request exceeding limit must be rejected');
  assert.equal(res6.count, 6);

  // After window expiration, counter resets
  const resAfterWindow = mockRateLimit(t0 + windowSec * 1000 + 1);
  assert.equal(resAfterWindow.ok, true, 'Request in new window must be allowed');
  assert.equal(resAfterWindow.count, 1);
});
