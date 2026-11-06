import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepGroupMembers } from '../../src/server/telegram.ts';
import { upsertTelegramMember, loadDb } from '../../src/server/db.ts';

test('Telegram Sweep: Skips members when tier is unknown (never evicts on RPC failure)', async () => {
  // Seed a member in db
  const testWallet = 'RpcFailWallet11111111111111111111111111111111';
  await upsertTelegramMember({
    wallet_address: testWallet,
    telegram_user_id: 999888777,
    tier: 'member',
    in_group: true,
  });

  // Run sweep with short budget
  const result = await sweepGroupMembers(5000);

  // Check that the member is STILL in group (not evicted)
  const db = await loadDb();
  const member = (db.telegram_members || []).find((m) => m.wallet_address === testWallet);
  assert.equal(member?.in_group, true, 'Member must NOT be evicted on RPC failure or unknown tier');
});

