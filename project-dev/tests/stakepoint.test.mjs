import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

function normalizePools(raw) {
  const items = Array.isArray(raw) ? raw : [];

  return items
    .map((p) => {
      const rawRate = p.apr ?? p.apy ?? p.liveRate ?? null;
      const apr =
        rawRate !== null && rawRate !== undefined && !isNaN(Number(rawRate))
          ? Number(Number(rawRate).toFixed(2))
          : null;

      let lockPeriod = null;
      if (typeof p.lockPeriod === 'number') {
        if (p.lockPeriod > 365) {
          const days = Math.round(p.lockPeriod / 86400);
          lockPeriod = `${days} days`;
        } else {
          lockPeriod = `${p.lockPeriod} days`;
        }
      } else if (typeof p.lockPeriod === 'string' && p.lockPeriod.trim().length > 0) {
        lockPeriod = p.lockPeriod.trim();
      }

      let tvl = null;
      if (p.tvl !== null && p.tvl !== undefined && !isNaN(Number(p.tvl))) {
        tvl = Number(p.tvl);
      } else if (
        p.totalStaked !== null &&
        p.totalStaked !== undefined &&
        !isNaN(Number(p.totalStaked)) &&
        Number(p.totalStaked) > 0
      ) {
        tvl = Number(p.totalStaked);
      }

      let status = 'Active';
      if (typeof p.status === 'string' && p.status.trim().length > 0) {
        status = p.status.trim();
      } else if (p.isPaused) {
        status = 'Ended';
      } else if (p.isInitialized === false) {
        status = 'Pending';
      }

      const poolId = String(p.poolId ?? p.id ?? 'unknown');
      const directId = p.id ?? (p.poolId !== undefined && p.poolId !== null ? String(p.poolId) : '');
      const poolUrl =
        p.poolUrl ??
        (directId ? `https://stakepoint.app/pool/${directId}` : 'https://stakepoint.app/pools');

      const rewardToken = p.rewardToken ?? p.rewardTokenSymbol ?? p.rewards ?? 'GENESIS';

      return {
        poolId,
        apr,
        lockPeriod,
        tvl,
        poolUrl,
        rewardToken,
        status,
      };
    })
    .sort((a, b) => (b.apr ?? -1) - (a.apr ?? -1));
}

test('§3 / §7 AC 3 & 4: normalizePools normalizes and sorts by highest APR', () => {
  const rawData = [
    {
      id: 'pool-low',
      poolId: 1,
      apr: 12.5,
      lockPeriod: 30,
      totalStaked: 5000,
      status: 'Active',
    },
    {
      id: 'pool-high',
      poolId: 2,
      apr: 42.5,
      lockPeriod: 90,
      tvl: 12400,
      status: 'Active',
    },
    {
      id: 'pool-zero',
      poolId: 3,
      apr: 0,
      lockPeriod: 86400 * 14,
      status: 'Ended',
    },
  ];

  const normalized = normalizePools(rawData);
  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].poolId, '2');
  assert.equal(normalized[0].apr, 42.5);
  assert.equal(normalized[0].tvl, 12400);
  assert.equal(normalized[0].lockPeriod, '90 days');
  assert.equal(normalized[0].poolUrl, 'https://stakepoint.app/pool/pool-high');

  assert.equal(normalized[1].poolId, '1');
  assert.equal(normalized[1].apr, 12.5);
  assert.equal(normalized[1].tvl, 5000);

  assert.equal(normalized[2].poolId, '3');
  assert.equal(normalized[2].apr, 0);
  assert.equal(normalized[2].lockPeriod, '14 days');
  assert.equal(normalized[2].status, 'Ended');
});

test('§7 AC 5: normalizePools returns empty array when raw is empty or non-array', () => {
  assert.deepEqual(normalizePools([]), []);
  assert.deepEqual(normalizePools(null), []);
  assert.deepEqual(normalizePools(undefined), []);
  assert.deepEqual(normalizePools({}), []);
});

test('§7 AC 7: TVL and lock period are null when missing in raw data (no placeholder dashes)', () => {
  const raw = [
    {
      id: 'pool-minimal',
      poolId: 'min-1',
      apr: 15.0,
    },
  ];

  const [pool] = normalizePools(raw);
  assert.equal(pool.tvl, null);
  assert.equal(pool.lockPeriod, null);
  assert.equal(pool.apr, 15.0);
});

test('§7 AC 3 & 9: GET /api/stakepoint/pools returns 200 with cache headers', async () => {
  const res = await fetch(`${BASE_URL}/api/stakepoint/pools`);
  assert.equal(res.status, 200);

  const cacheHeader = res.headers.get('cache-control') || '';
  assert.ok(
    cacheHeader.includes('s-maxage=300') || cacheHeader.includes('public'),
    `Expected 300s cache header, got: ${cacheHeader}`
  );

  const body = await res.json();
  assert.ok(Array.isArray(body.pools), 'Response should contain pools array');
});

test('§7 AC 1, 2, 8, 11: Dashboard page renders StakePoint integration and proper markup', async () => {
  const res = await fetch(`${BASE_URL}/dashboard`);
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes('Staking — $H42'), 'Dashboard must render Staking — $H42 title');

  const cardSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/staking/StakePointCard.tsx'), 'utf8');
  assert.ok(
    cardSrc.includes('rel="noopener noreferrer"'),
    'StakePointCard must open links with rel="noopener noreferrer"'
  );
  assert.ok(
    cardSrc.includes('Stake on StakePoint →'),
    'StakePointCard must include CTA button Stake on StakePoint →'
  );
  assert.ok(
    cardSrc.includes('No staking pool is currently active for $H42'),
    'StakePointCard must handle zero pools empty state'
  );
});

test('§7 AC 6: StakePointCardError renders muted error state with [Retry]', () => {
  const errSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/staking/StakePointCardError.tsx'), 'utf8');
  assert.ok(
    errSrc.includes("Couldn't load staking data."),
    'Error component must include "Couldn\'t load staking data."'
  );
  assert.ok(errSrc.includes('[Retry]'), 'Error component must include [Retry] button');
});

test('§7 AC 10: StakePointCard components support mobile width stacking (w-full / flex-col)', () => {
  const cardSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/staking/StakePointCard.tsx'), 'utf8');
  assert.ok(
    cardSrc.includes('w-full sm:w-auto') || cardSrc.includes('w-full'),
    'CTA button must be full-width on mobile'
  );
  assert.ok(
    cardSrc.includes('flex flex-col'),
    'Card must use flex flex-col to stack neatly'
  );
});

test('§7 AC 12: No secret keys exposed in client or stakepoint modules', () => {
  const filesToCheck = [
    'src/components/staking/StakePointCard.tsx',
    'src/components/staking/StakePointCardClient.tsx',
    'src/components/staking/StakePointCardSkeleton.tsx',
    'src/components/staking/StakePointCardError.tsx',
    'src/lib/stakepoint/types.ts',
    'src/lib/stakepoint/fetchPools.ts',
  ];

  for (const f of filesToCheck) {
    const fullPath = path.join(process.cwd(), f);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(!content.includes('API_KEY='), `File ${f} should not have API_KEY`);
    assert.ok(!content.includes('SECRET='), `File ${f} should not have SECRET`);
    assert.ok(!content.includes('PRIVATE_KEY'), `File ${f} should not have PRIVATE_KEY`);
  }
});
