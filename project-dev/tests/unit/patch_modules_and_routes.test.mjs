import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

process.env.NODE_ENV = 'test';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const dom = installDomShim();
globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
const { z } = await import('zod');

const {
  parseUnits,
  formatUnits,
  formatTokenAmount,
  mulDiv,
  bps,
  clampBigInt,
  isPositive,
} = await import('../../src/lib/math/tokenMath.ts');
const { directionOf, semantic } = await import('../../src/lib/theme/semantic.ts');
const { parseServerEnv, getServerEnv } = await import('../../src/lib/env/server.ts');
const { parseClientEnv, getClientEnv } = await import('../../src/lib/env/client.ts');
const { withRouteAuth } = await import('../../src/lib/auth/withAuth.ts');
const { Price } = await import('../../src/components/primitives/Price.tsx');
const { TabularValue } = await import('../../src/components/primitives/TabularValue.tsx');
const { TradeWorkspaceSkeleton } = await import(
  '../../src/components/skeletons/TradeWorkspaceSkeleton.tsx'
);
const { executeOptimisticTransition } = await import('../../src/hooks/useOptimisticAction.ts');
const { shouldClearSessionOnWalletTransition } = await import('../../src/hooks/useWalletGuard.ts');
const { DEFAULT_GENESIS_MINT } = await import('../../src/lib/config.ts');
const { POST: confirmPost } = await import('../../src/app/api/stake/confirm/route.ts');

async function renderComponent(ui) {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;
  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(ui);
  });
  return {
    container,
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

test('tokenMath performs exact BigInt atomic conversions and arithmetic', () => {
  assert.equal(parseUnits('100.5', 6), 100_500_000n);
  assert.equal(parseUnits('1,234.5678909', 6), 1_234_567_890n);
  assert.equal(parseUnits('1e-6', 6), 1n);
  assert.equal(parseUnits(-2.5, 6), -2_500_000n);
  assert.throws(() => parseUnits('not-a-number', 6), SyntaxError);
  assert.throws(() => parseUnits(Number.NaN, 6), RangeError);

  assert.equal(formatUnits(1_234_567_890n, 6), '1234.56789');
  assert.equal(formatUnits(-500_000n, 6), '-0.5');
  assert.equal(formatTokenAmount(1_234_567_890n, 6, 4), '1,234.5678');

  assert.equal(mulDiv(1_000_000n, 3n, 4n), 750_000n);
  assert.throws(() => mulDiv(10n, 2n, 0n), RangeError);
  assert.equal(bps(1_000_000n, 250), 25_000n);
  assert.equal(clampBigInt(5n, 10n, 20n), 10n);
  assert.equal(clampBigInt(25n, 10n, 20n), 20n);
  assert.equal(isPositive(1n), true);
  assert.equal(isPositive(0n), false);
});

test('semantic theme maps direction tokens using repo palette classes', () => {
  assert.equal(directionOf(12.5), 'up');
  assert.equal(directionOf(-0.01), 'down');
  assert.equal(directionOf(0), 'flat');
  assert.equal(directionOf(5n), 'up');
  assert.equal(directionOf(-5n), 'down');
  assert.equal(directionOf(null), 'flat');
  assert.equal(directionOf(Number.NaN), 'flat');

  assert.equal(semantic.pnlClass(10), 'text-brand');
  assert.equal(semantic.pnlClass(-10), 'text-danger');
  assert.equal(semantic.pnlClass(0), 'text-muted');
  assert.match(semantic.deltaBadgeClass(4), /text-brand/);
  assert.match(semantic.deltaBadgeClass(-4), /text-danger/);
});

test('Price, TabularValue, and TradeWorkspaceSkeleton render cleanly', async () => {
  const priceView = await renderComponent(
    React.createElement(Price, {
      raw: 12_500_000n,
      decimals: 6,
      prefix: '$',
      delta: 8.4,
    })
  );
  const posSpan = priceView.container.querySelector('span[data-num="true"]');
  assert.equal(priceView.container.textContent, '$12.5');
  assert.ok(posSpan?.className.includes('text-brand'));
  assert.ok(posSpan?.className.includes('tabular'));
  await priceView.cleanup();

  const negPriceView = await renderComponent(
    React.createElement(Price, {
      value: 0.045,
      prefix: '$',
      delta: -2.1,
    })
  );
  const negSpan = negPriceView.container.querySelector('span[data-num="true"]');
  assert.equal(negPriceView.container.textContent, '$0.045');
  assert.ok(negSpan?.className.includes('text-danger'));
  await negPriceView.cleanup();

  const tvView = await renderComponent(
    React.createElement(TabularValue, {
      value: 2_500_000n,
      decimals: 6,
      showSign: true,
    })
  );
  assert.equal(tvView.container.textContent, '+2.5');
  await tvView.cleanup();

  const skelView = await renderComponent(
    React.createElement(TradeWorkspaceSkeleton, { rows: 4 })
  );
  const busyEl = skelView.container.querySelector('div[aria-busy="true"]');
  assert.ok(busyEl);
  const skeletonRows = busyEl.children.filter((el) => el.className.includes('grid'));
  assert.equal(skeletonRows.length, 4);
  await skelView.cleanup();
});

test('server and client env validators accept valid config and reject malformed inputs', () => {
  const okServer = parseServerEnv({
    NODE_ENV: 'production',
    SESSION_SECRET: '0123456789abcdef',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    SOLANA_RPC: 'https://api.mainnet-beta.solana.com',
  });
  assert.equal(okServer.NODE_ENV, 'production');
  assert.equal(okServer.UPSTASH_REDIS_REST_URL, undefined);

  assert.throws(
    () => parseServerEnv({ SESSION_SECRET: 'short' }),
    /SESSION_SECRET/
  );
  assert.throws(
    () => parseServerEnv({ UPSTASH_REDIS_REST_URL: 'https://redis.example.com' }),
    /UPSTASH_REDIS_REST_TOKEN/
  );

  assert.throws(() => getServerEnv(), /browser environment/);
  const savedWindow = globalThis.window;
  delete globalThis.window;
  try {
    assert.ok(getServerEnv().NODE_ENV);
  } finally {
    globalThis.window = savedWindow;
  }

  const okClient = parseClientEnv({});
  assert.equal(okClient.NEXT_PUBLIC_GENESIS_MINT, DEFAULT_GENESIS_MINT);
  assert.throws(
    () => parseClientEnv({ NEXT_PUBLIC_SITE_URL: 'not-a-url' }),
    /Invalid client environment/
  );
  assert.equal(typeof getClientEnv().NEXT_PUBLIC_GENESIS_MINT, 'string');
});

test('withRouteAuth enforces rate limit, session auth, and Zod schema validation', async () => {
  const schema = z.object({ enabled: z.boolean() });
  const handler = withRouteAuth(
    async ({ session, input }) =>
      Response.json({ ok: true, wallet: session.wallet, enabled: input.enabled }),
    {
      schema,
      invalidBodyMessage: 'enabled boolean is required',
      rateLimit: { prefix: 'test-rl', limit: 5, windowSec: 60 },
      deps: {
        clientIp: () => '198.51.100.1',
        rateLimit: async () => ({ ok: true, retryAfter: 0 }),
        getAuthSession: async (req) =>
          req.headers.get('x-test-auth') === '1'
            ? { wallet: '11111111111111111111111111111111', tier: 'pro' }
            : null,
      },
    }
  );

  const unauthRes = await handler(
    new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
  );
  assert.equal(unauthRes.status, 401);

  const badBodyRes = await handler(
    new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-auth': '1' },
      body: JSON.stringify({ enabled: 'yes' }),
    })
  );
  assert.equal(badBodyRes.status, 400);
  const badJson = await badBodyRes.json();
  assert.equal(badJson.message, 'enabled boolean is required');

  const okRes = await handler(
    new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-auth': '1' },
      body: JSON.stringify({ enabled: true }),
    })
  );
  assert.equal(okRes.status, 200);
  assert.deepEqual(await okRes.json(), {
    ok: true,
    wallet: '11111111111111111111111111111111',
    enabled: true,
  });

  const limitedHandler = withRouteAuth(async () => Response.json({ ok: true }), {
    rateLimit: { prefix: 'test-rl', limit: 1, windowSec: 60 },
    deps: {
      clientIp: () => '198.51.100.1',
      rateLimit: async () => ({ ok: false, retryAfter: 17 }),
      getAuthSession: async () => ({ wallet: '11111111111111111111111111111111', tier: 'pro' }),
    },
  });
  const limitedRes = await limitedHandler(new Request('http://localhost/api/test'));
  assert.equal(limitedRes.status, 429);
  assert.equal(limitedRes.headers.get('Retry-After'), '17');
});

test('optimistic action rolls back cleanly and wallet guard triggers only on live disconnect', async () => {
  let state = false;
  let capturedErr = null;
  const failResult = await executeOptimisticTransition(true, {
    applyOptimistic: (next) => {
      const prev = state;
      state = next;
      return () => {
        state = prev;
      };
    },
    run: async () => {
      throw new Error('RPC rejected');
    },
    onError: (err) => {
      capturedErr = err.message;
    },
  });
  assert.equal(failResult.ok, false);
  assert.equal(state, false);
  assert.equal(capturedErr, 'RPC rejected');

  assert.equal(shouldClearSessionOnWalletTransition(false, false, false), false);
  assert.equal(shouldClearSessionOnWalletTransition(false, false, true), false);
  assert.equal(shouldClearSessionOnWalletTransition(true, false, true), false);
  assert.equal(shouldClearSessionOnWalletTransition(true, true, false), false);
  assert.equal(shouldClearSessionOnWalletTransition(true, false, false), true);
});

test('POST /api/stake/confirm enforces IP rate limit with 429 and Retry-After', async () => {
  const uniqueIp = '203.0.113.241';
  const mkReq = () =>
    new Request('http://localhost/api/stake/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': uniqueIp,
      },
      body: JSON.stringify({ tx_signature: 'invalid' }),
    });

  for (let i = 0; i < 20; i += 1) {
    const res = await confirmPost(mkReq());
    assert.equal(res.status, 401);
  }

  const limited = await confirmPost(mkReq());
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) >= 1);
  const body = await limited.json();
  assert.equal(body.error, 'rate_limited');
});
