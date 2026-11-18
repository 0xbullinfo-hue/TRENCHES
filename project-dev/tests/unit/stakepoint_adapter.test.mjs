import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GENESIS_MINT } from '../../src/lib/config.ts';
import { signSession, SESSION_COOKIE_NAME } from '../../src/server/auth.ts';
import {
  getStakePointIntegrationStatus,
  verifyAndRecordStakePointPosition,
} from '../../src/server/stakepoint.ts';
import { loadDb } from '../../src/server/db.ts';
import { GET as poolsGet } from '../../src/app/api/stakepoint/pools/route.ts';
import { POST as confirmPost } from '../../src/app/api/stake/confirm/route.ts';

const CONFIGURED_PROGRAM_ID = 'StakePnt11111111111111111111111111111111111';
const WRONG_PROGRAM_ID = 'WrongProg1111111111111111111111111111111111';
const CONFIGURED_POOL_ID = 'Poo1Cfg111111111111111111111111111111111111';
const WRONG_POOL_ID = 'Poo1Other1111111111111111111111111111111111';
const POOL_VAULT_ATA = 'Poo1Vault1111111111111111111111111111111111';
const OTHER_VAULT_ATA = 'OtherVau1t111111111111111111111111111111111';
const USER_WALLET = 'UserWa11et111111111111111111111111111111111';
const SECOND_WALLET = 'OtherWa11et11111111111111111111111111111111';
const USER_ATA = 'UserAta111111111111111111111111111111111111';
const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const VALID_PRICE = {
  priceUsd: 0.0001,
  source: 'dexscreener',
  timestamp: new Date().toISOString(),
  isFresh: true,
};

function makeSignature(seed) {
  return `${seed}_${'A'.repeat(Math.max(1, 88 - seed.length - 1))}`;
}

function makeMemoryStore() {
  const stakes = [];
  return {
    stakes,
    loadDb: async () => ({
      stakes,
      calls: [],
      ledger_entries: [],
      verification_sessions: [],
      telegram_members: [],
      webhook_events: [],
    }),
    createStakeIfAbsent: async (params) => {
      const existing = stakes.find((s) => s.tx_signature === params.tx_signature);
      if (existing) return { created: false, stake: existing };
      const now = new Date();
      const row = {
        id: `stake-${stakes.length + 1}`,
        wallet_address: params.wallet_address,
        amount_raw: params.amount_raw,
        staked_at: now.toISOString(),
        unlocks_at: new Date(now.getTime() + params.lock_days * 86400_000).toISOString(),
        status: 'active',
        tx_signature: params.tx_signature,
        staking_provider: 'stakepoint',
      };
      stakes.push(row);
      return { created: true, stake: row };
    },
  };
}

function buildParsedStakeTx(opts = {}) {
  const signer = opts.signer ?? USER_WALLET;
  const programId = opts.programId ?? CONFIGURED_PROGRAM_ID;
  const instructionProgramId = opts.instructionProgramId ?? programId;
  const vaultOwner = opts.vaultOwner ?? CONFIGURED_POOL_ID;
  const vaultAccount = opts.vaultAccount ?? POOL_VAULT_ATA;
  const instructionAccounts = opts.instructionAccounts ?? [signer, vaultOwner, vaultAccount];
  const mint = opts.mint ?? GENESIS_MINT;
  const amountRaw = opts.amountRaw ?? '3000000000000'; // 3,000,000 H42 @ $0.0001 = $300
  const splDest = opts.splTransferDest ?? vaultAccount;

  const accountKeys = [
    { pubkey: signer, signer: opts.signerFlag ?? true, writable: true },
    { pubkey: USER_ATA, signer: false, writable: true },
    { pubkey: vaultAccount, signer: false, writable: true },
    { pubkey: vaultOwner, signer: false, writable: false },
    { pubkey: programId, signer: false, writable: false },
    ...(opts.extraAccountKeys ?? []).map((k) => ({ pubkey: k, signer: false, writable: false })),
  ];

  const vaultIdx = accountKeys.findIndex((k) => k.pubkey === vaultAccount);

  return {
    transaction: {
      message: {
        accountKeys,
        instructions: [
          {
            programId: instructionProgramId,
            accounts: instructionAccounts,
          },
        ],
      },
    },
    meta: {
      err: opts.err ?? null,
      preTokenBalances: [
        { accountIndex: 1, mint, owner: signer, uiTokenAmount: { amount: '5000000000000' } },
        { accountIndex: vaultIdx, mint, owner: vaultOwner, uiTokenAmount: { amount: '1000000000000' } },
      ],
      postTokenBalances: [
        {
          accountIndex: 1,
          mint,
          owner: signer,
          uiTokenAmount: { amount: String(BigInt('5000000000000') - BigInt(amountRaw)) },
        },
        {
          accountIndex: vaultIdx,
          mint,
          owner: vaultOwner,
          uiTokenAmount: { amount: String(BigInt('1000000000000') + BigInt(amountRaw)) },
        },
      ],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              program: 'spl-token',
              programId: SPL_TOKEN_PROGRAM,
              parsed: {
                type: 'transferChecked',
                info: {
                  source: USER_ATA,
                  destination: splDest,
                  authority: signer,
                  mint,
                  tokenAmount: { amount: amountRaw },
                },
              },
            },
          ],
        },
      ],
    },
  };
}

function withEnv(vars, fn) {
  return async () => {
    const prev = {};
    for (const key of [
      'NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID',
      'STAKEPOINT_PROGRAM_ID',
      'NEXT_PUBLIC_STAKEPOINT_POOL_ID',
      'SESSION_SECRET',
    ]) {
      prev[key] = process.env[key];
      if (key in vars) {
        if (vars[key] === undefined) delete process.env[key];
        else process.env[key] = vars[key];
      }
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

test('StakePoint Adapter: getStakePointIntegrationStatus reports BLOCKED when program ID is unconfigured', () => {
  const origProg = process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID;
  const origSrvProg = process.env.STAKEPOINT_PROGRAM_ID;
  const origPool = process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID;
  delete process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID;
  delete process.env.STAKEPOINT_PROGRAM_ID;
  delete process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID;

  try {
    const status = getStakePointIntegrationStatus();
    assert.equal(status.status, 'BLOCKED');
    assert.equal(status.configured, false);
    assert.equal(status.programId, null);
    assert.equal(status.poolId, null);
    assert.ok(status.message.includes('not configured'));
  } finally {
    if (origProg) process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID = origProg;
    if (origSrvProg) process.env.STAKEPOINT_PROGRAM_ID = origSrvProg;
    if (origPool) process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID = origPool;
  }
});

test('StakePoint Adapter: Rejects signature with invalid format', async () => {
  const result = await verifyAndRecordStakePointPosition({
    walletAddress: USER_WALLET,
    txSignature: 'short-invalid-sig',
    lockDays: 90,
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.error?.includes('signature format'));
});

test('StakePoint Adapter: Rejects lock period less than 90 days', async () => {
  const result = await verifyAndRecordStakePointPosition({
    walletAddress: USER_WALLET,
    txSignature: makeSignature('5J4_short_lock'),
    lockDays: 30,
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.error?.includes('90 days'));
});

test('StakePoint Adapter: Replay prevention rejects duplicate transaction signature', async () => {
  const store = makeMemoryStore();
  const duplicateSig = makeSignature(`5J4_replay_${Date.now()}`);
  await store.createStakeIfAbsent({
    wallet_address: USER_WALLET,
    amount_raw: '16000000000000',
    lock_days: 90,
    tx_signature: duplicateSig,
  });

  const result = await verifyAndRecordStakePointPosition(
    {
      walletAddress: SECOND_WALLET,
      txSignature: duplicateSig,
      lockDays: 90,
    },
    { loadDb: store.loadDb, createStakeIfAbsent: store.createStakeIfAbsent }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.error?.includes('already been registered'));
});

test('Security [1/8]: Program ID missing produces BLOCKED without calling RPC or creating stake record', async () => {
  const store = makeMemoryStore();
  let rpcCalled = false;
  const env = { NEXT_PUBLIC_STAKEPOINT_POOL_ID: CONFIGURED_POOL_ID };

  assert.equal(getStakePointIntegrationStatus(env).status, 'BLOCKED');

  const res = await verifyAndRecordStakePointPosition(
    { walletAddress: USER_WALLET, txSignature: makeSignature('missing_prog'), lockDays: 90 },
    {
      env,
      loadDb: store.loadDb,
      createStakeIfAbsent: store.createStakeIfAbsent,
      fetchTransaction: async () => {
        rpcCalled = true;
        return buildParsedStakeTx();
      },
      getPrice: async () => VALID_PRICE,
    }
  );

  assert.equal(res.success, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(rpcCalled, false);
  assert.equal(store.stakes.length, 0);
});

test('Security [2/8]: Pool ID missing produces BLOCKED without calling RPC or creating stake record', async () => {
  const store = makeMemoryStore();
  let rpcCalled = false;
  const env = { NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID };

  const status = getStakePointIntegrationStatus(env);
  assert.equal(status.status, 'BLOCKED');
  assert.equal(status.programConfigured, true);
  assert.equal(status.poolConfigured, false);

  const res = await verifyAndRecordStakePointPosition(
    {
      walletAddress: USER_WALLET,
      txSignature: makeSignature('missing_pool'),
      lockDays: 90,
      poolId: CONFIGURED_POOL_ID, // Client-supplied poolId must never bypass server config
    },
    {
      env,
      loadDb: store.loadDb,
      createStakeIfAbsent: store.createStakeIfAbsent,
      fetchTransaction: async () => {
        rpcCalled = true;
        return buildParsedStakeTx();
      },
      getPrice: async () => VALID_PRICE,
    }
  );

  assert.equal(res.success, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(rpcCalled, false);
  assert.equal(store.stakes.length, 0);
});

test(
  'Security [3/8]: Both IDs missing produces BLOCKED on verifier and 503 / BLOCKED on HTTP routes without creating a stake',
  withEnv(
    {
      NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID: undefined,
      STAKEPOINT_PROGRAM_ID: undefined,
      NEXT_PUBLIC_STAKEPOINT_POOL_ID: undefined,
      SESSION_SECRET: 'test-session-secret-0000000000000000',
    },
    async () => {
      const dbBefore = await loadDb();
      const walletStakeCountBefore = dbBefore.stakes.filter(
        (s) => s.wallet_address === USER_WALLET
      ).length;
      const missingSig = makeSignature(`both_missing_route_${Date.now()}`);

      const poolsRes = await poolsGet();
      assert.equal(poolsRes.status, 200);
      const poolsJson = await poolsRes.json();
      assert.equal(poolsJson.status, 'BLOCKED');
      assert.equal(poolsJson.configured, false);
      assert.deepEqual(poolsJson.pools, []);

      const cookie = `${SESSION_COOKIE_NAME}=${signSession(USER_WALLET)}`;
      const confirmReq = new NextRequest('http://localhost:3000/api/stake/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          tx_signature: missingSig,
          lock_days: 90,
          pool_id: CONFIGURED_POOL_ID,
        }),
      });
      const confirmRes = await confirmPost(confirmReq);
      assert.equal(confirmRes.status, 503);
      const confirmJson = await confirmRes.json();
      assert.equal(confirmJson.error, 'stakepoint_not_configured');
      assert.equal(confirmJson.status, 'BLOCKED');

      const dbAfter = await loadDb();
      assert.equal(
        dbAfter.stakes.some((s) => s.tx_signature === missingSig),
        false
      );
      assert.equal(
        dbAfter.stakes.filter((s) => s.wallet_address === USER_WALLET).length,
        walletStakeCountBefore
      );
    }
  )
);

test('Security [4/8]: Incorrect program interaction (wrong program or uninvoked program) is REJECTED', async () => {
  const store = makeMemoryStore();
  const env = {
    STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID,
    NEXT_PUBLIC_STAKEPOINT_POOL_ID: CONFIGURED_POOL_ID,
  };

  const wrongProgRes = await verifyAndRecordStakePointPosition(
    { walletAddress: USER_WALLET, txSignature: makeSignature('wrong_prog_1'), lockDays: 90 },
    {
      env,
      loadDb: store.loadDb,
      createStakeIfAbsent: store.createStakeIfAbsent,
      fetchTransaction: async () => buildParsedStakeTx({ programId: WRONG_PROGRAM_ID }),
      getPrice: async () => VALID_PRICE,
    }
  );
  assert.equal(wrongProgRes.success, false);
  assert.equal(wrongProgRes.status, 'REJECTED');

  const stuffedKeyRes = await verifyAndRecordStakePointPosition(
    { walletAddress: USER_WALLET, txSignature: makeSignature('wrong_prog_2'), lockDays: 90 },
    {
      env,
      loadDb: store.loadDb,
      createStakeIfAbsent: store.createStakeIfAbsent,
      fetchTransaction: async () =>
        buildParsedStakeTx({
          programId: CONFIGURED_PROGRAM_ID,
          instructionProgramId: WRONG_PROGRAM_ID,
        }),
      getPrice: async () => VALID_PRICE,
    }
  );
  assert.equal(stuffedKeyRes.success, false);
  assert.equal(stuffedKeyRes.status, 'REJECTED');
  assert.equal(store.stakes.length, 0);
});

test(
  'Security [5/8]: Incorrect pool interaction (wrong pool, wrong vault, wrong mint, or spoofed client pool_id) is REJECTED',
  withEnv(
    {
      NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID,
      NEXT_PUBLIC_STAKEPOINT_POOL_ID: CONFIGURED_POOL_ID,
      SESSION_SECRET: 'test-session-secret-0000000000000000',
    },
    async () => {
      const store = makeMemoryStore();
      const env = {
        NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID,
        NEXT_PUBLIC_STAKEPOINT_POOL_ID: CONFIGURED_POOL_ID,
      };

      // HTTP route rejects mismatched client pool_id cleanly with 400
      const cookie = `${SESSION_COOKIE_NAME}=${signSession(USER_WALLET)}`;
      const spoofRouteRes = await confirmPost(
        new NextRequest('http://localhost:3000/api/stake/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            tx_signature: makeSignature('spoof_route_pool'),
            lock_days: 90,
            pool_id: WRONG_POOL_ID,
          }),
        })
      );
      assert.equal(spoofRouteRes.status, 400);
      assert.equal((await spoofRouteRes.json()).error, 'verification_failed');

      const otherPoolRes = await verifyAndRecordStakePointPosition(
        { walletAddress: USER_WALLET, txSignature: makeSignature('wrong_pool_onchain'), lockDays: 90 },
        {
          env,
          loadDb: store.loadDb,
          createStakeIfAbsent: store.createStakeIfAbsent,
          fetchTransaction: async () =>
            buildParsedStakeTx({
              vaultOwner: WRONG_POOL_ID,
              vaultAccount: OTHER_VAULT_ATA,
            }),
          getPrice: async () => VALID_PRICE,
        }
      );
      assert.equal(otherPoolRes.success, false);
      assert.equal(otherPoolRes.status, 'REJECTED');

      const attackerVaultRes = await verifyAndRecordStakePointPosition(
        { walletAddress: USER_WALLET, txSignature: makeSignature('wrong_vault_owner'), lockDays: 90 },
        {
          env,
          loadDb: store.loadDb,
          createStakeIfAbsent: store.createStakeIfAbsent,
          fetchTransaction: async () =>
            buildParsedStakeTx({
              vaultOwner: SECOND_WALLET,
              vaultAccount: OTHER_VAULT_ATA,
              instructionAccounts: [USER_WALLET, CONFIGURED_POOL_ID, OTHER_VAULT_ATA],
              extraAccountKeys: [CONFIGURED_POOL_ID],
            }),
          getPrice: async () => VALID_PRICE,
        }
      );
      assert.equal(attackerVaultRes.success, false);
      assert.equal(attackerVaultRes.status, 'REJECTED');

      const wrongMintRes = await verifyAndRecordStakePointPosition(
        { walletAddress: USER_WALLET, txSignature: makeSignature('wrong_mint'), lockDays: 90 },
        {
          env,
          loadDb: store.loadDb,
          createStakeIfAbsent: store.createStakeIfAbsent,
          fetchTransaction: async () =>
            buildParsedStakeTx({
              mint: 'So11111111111111111111111111111111111111112',
            }),
          getPrice: async () => VALID_PRICE,
        }
      );
      assert.equal(wrongMintRes.success, false);
      assert.equal(wrongMintRes.status, 'REJECTED');
      assert.equal(store.stakes.length, 0);
    }
  )
);

test(
  'Security [6/8]: Valid configured pool interaction succeeds and /api/stakepoint/pools filters to configured pool only',
  withEnv(
    {
      NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID,
      NEXT_PUBLIC_STAKEPOINT_POOL_ID: CONFIGURED_POOL_ID,
    },
    async () => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        if (String(url).includes('stakepoint.app/api/pools/by-token')) {
          return new Response(
            JSON.stringify([
              { id: CONFIGURED_POOL_ID, poolId: CONFIGURED_POOL_ID, poolAddress: CONFIGURED_POOL_ID, apr: 25, status: 'Active', tokenMint: GENESIS_MINT },
              { id: WRONG_POOL_ID, poolId: WRONG_POOL_ID, poolAddress: WRONG_POOL_ID, apr: 99, status: 'Active', tokenMint: GENESIS_MINT },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return realFetch(url);
      };

      try {
        const poolsRes = await poolsGet();
        assert.equal(poolsRes.status, 200);
        const poolsJson = await poolsRes.json();
        assert.equal(poolsJson.status, 'ACTIVE');
        assert.equal(poolsJson.configured, true);
        assert.equal(poolsJson.pools.length, 1);
        assert.equal(poolsJson.pools[0].poolId, CONFIGURED_POOL_ID);
      } finally {
        globalThis.fetch = realFetch;
      }

      const store = makeMemoryStore();
      const env = {
        STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID,
        NEXT_PUBLIC_STAKEPOINT_POOL_ID: CONFIGURED_POOL_ID,
      };
      const validSig = makeSignature('valid_configured_stake');

      const res = await verifyAndRecordStakePointPosition(
        {
          walletAddress: USER_WALLET,
          txSignature: validSig,
          lockDays: 90,
          poolId: CONFIGURED_POOL_ID,
        },
        {
          env,
          loadDb: store.loadDb,
          createStakeIfAbsent: store.createStakeIfAbsent,
          fetchTransaction: async () => buildParsedStakeTx(),
          getPrice: async () => VALID_PRICE,
        }
      );

      assert.equal(res.success, true);
      assert.equal(res.status, 'VERIFIED');
      assert.equal(res.stake?.tx_signature, validSig);
      assert.equal(res.details?.programId, CONFIGURED_PROGRAM_ID);
      assert.equal(res.details?.poolId, CONFIGURED_POOL_ID);
      assert.equal(store.stakes.length, 1);

      const offchainStore = makeMemoryStore();
      const offchainEnv = {
        NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID,
        NEXT_PUBLIC_STAKEPOINT_POOL_ID: 'official-h42-pool',
      };
      const offchainSig = makeSignature('valid_offchain_pool_id');
      const offchainRes = await verifyAndRecordStakePointPosition(
        {
          walletAddress: USER_WALLET,
          txSignature: offchainSig,
          lockDays: 90,
        },
        {
          env: offchainEnv,
          loadDb: offchainStore.loadDb,
          createStakeIfAbsent: offchainStore.createStakeIfAbsent,
          fetchPools: async () => [
            {
              id: 'official-h42-pool',
              poolId: 'official-h42-pool',
              apr: 25,
              lockPeriod: '90 days',
              tvl: 10000,
              poolUrl: 'https://stakepoint.app/pool/official-h42-pool',
              rewardToken: '$H42',
              status: 'Active',
              poolAddress: CONFIGURED_POOL_ID,
              vaultAddress: POOL_VAULT_ATA,
              tokenMint: GENESIS_MINT,
            },
          ],
          fetchTransaction: async () => buildParsedStakeTx(),
          getPrice: async () => VALID_PRICE,
        }
      );
      assert.equal(offchainRes.success, true);
      assert.equal(offchainRes.status, 'VERIFIED');
      assert.equal(offchainRes.details?.poolId, 'official-h42-pool');
      assert.equal(offchainRes.details?.poolAddress, CONFIGURED_POOL_ID);
      assert.equal(offchainStore.stakes.length, 1);
    }
  )
);

test('Security [7/8]: Duplicate transaction signature against configured verifier is REJECTED without double recording', async () => {
  const store = makeMemoryStore();
  const env = {
    NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID,
    NEXT_PUBLIC_STAKEPOINT_POOL_ID: CONFIGURED_POOL_ID,
  };
  const sig = makeSignature('duplicate_configured_tx');

  const first = await verifyAndRecordStakePointPosition(
    { walletAddress: USER_WALLET, txSignature: sig, lockDays: 90 },
    {
      env,
      loadDb: store.loadDb,
      createStakeIfAbsent: store.createStakeIfAbsent,
      fetchTransaction: async () => buildParsedStakeTx(),
      getPrice: async () => VALID_PRICE,
    }
  );
  assert.equal(first.status, 'VERIFIED');
  assert.equal(store.stakes.length, 1);

  const second = await verifyAndRecordStakePointPosition(
    { walletAddress: USER_WALLET, txSignature: sig, lockDays: 90 },
    {
      env,
      loadDb: store.loadDb,
      createStakeIfAbsent: store.createStakeIfAbsent,
      fetchTransaction: async () => buildParsedStakeTx(),
      getPrice: async () => VALID_PRICE,
    }
  );
  assert.equal(second.success, false);
  assert.equal(second.status, 'REJECTED');
  assert.ok(second.error?.includes('already been registered'));
  assert.equal(store.stakes.length, 1);
});

test('Security [8/8]: Failed Solana transaction and missing RPC tx are REJECTED without creating a stake', async () => {
  const store = makeMemoryStore();
  const env = {
    NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID: CONFIGURED_PROGRAM_ID,
    NEXT_PUBLIC_STAKEPOINT_POOL_ID: CONFIGURED_POOL_ID,
  };

  const failedRes = await verifyAndRecordStakePointPosition(
    { walletAddress: USER_WALLET, txSignature: makeSignature('failed_solana_tx'), lockDays: 90 },
    {
      env,
      loadDb: store.loadDb,
      createStakeIfAbsent: store.createStakeIfAbsent,
      fetchTransaction: async () => buildParsedStakeTx({ err: { InstructionError: [0, 'Custom'] } }),
      getPrice: async () => VALID_PRICE,
    }
  );
  assert.equal(failedRes.success, false);
  assert.equal(failedRes.status, 'REJECTED');

  const nullRes = await verifyAndRecordStakePointPosition(
    { walletAddress: USER_WALLET, txSignature: makeSignature('null_solana_tx'), lockDays: 90 },
    {
      env,
      loadDb: store.loadDb,
      createStakeIfAbsent: store.createStakeIfAbsent,
      fetchTransaction: async () => null,
      getPrice: async () => VALID_PRICE,
    }
  );
  assert.equal(nullRes.success, false);
  assert.equal(nullRes.status, 'REJECTED');
  assert.equal(store.stakes.length, 0);
});
