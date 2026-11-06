// Tests the REAL src/server/telegram.ts
import test from 'node:test';
import assert from 'node:assert/strict';

const tg = await import('../../src/server/telegram.ts');

test('classifySendFailure: only definitive unreachable errors may unlink a subscriber', () => {
  assert.equal(tg.classifySendFailure(403, 'Forbidden: bot was blocked by the user'), 'blocked');
  assert.equal(tg.classifySendFailure(400, 'Bad Request: chat not found'), 'blocked');
  assert.equal(tg.classifySendFailure(400, 'Bad Request: user is deactivated'), 'blocked');
  // Malformed message must never unlink
  assert.equal(tg.classifySendFailure(400, "Bad Request: can't parse entities: Unsupported start tag"), 'other');
  assert.equal(tg.classifySendFailure(400, ''), 'other');
  assert.equal(tg.classifySendFailure(429, 'Too Many Requests'), 'retry');
  assert.equal(tg.classifySendFailure(502, ''), 'retry');
  assert.equal(tg.classifySendFailure(0, ''), 'retry');
});

test('formatCallMessage escapes HTML in every user-controlled field', () => {
  const msg = tg.formatCallMessage({
    ticker: '<DEGEN>',
    chain: 'SOL & BASE',
    entryMarketCap: '$1.2M',
    risk: 3,
    stopLoss: 'SL <50%>',
    riskRewardRatio: '1:3',
    takeProfits: [{ label: 'TP1 <2x>' }, { label: 'TP2 & 5x' }],
    ca: 'Token<script>',
  });
  assert.ok(msg.includes('&lt;DEGEN&gt;'));
  assert.ok(msg.includes('SOL &amp; BASE'));
  assert.ok(msg.includes('TP1 &lt;2x&gt;'));
  assert.ok(msg.includes('Token&lt;script&gt;'));
  assert.ok(!/<DEGEN>|<script>|<2x>/.test(msg), 'no raw user HTML may remain');
});

test('createTelegramInvite rejects when credentials or group IDs are unconfigured (no leaked defaults)', async () => {
  const origMember = process.env.TELEGRAM_MEMBER_INVITE_URL;
  const origPro = process.env.TELEGRAM_PRO_INVITE_URL;
  delete process.env.TELEGRAM_MEMBER_INVITE_URL;
  delete process.env.TELEGRAM_PRO_INVITE_URL;

  await assert.rejects(
    async () => await tg.createTelegramInvite('member'),
    /Unable to generate invite link/
  );

  await assert.rejects(
    async () => await tg.createTelegramInvite('pro'),
    /Unable to generate invite link/
  );

  if (origMember) process.env.TELEGRAM_MEMBER_INVITE_URL = origMember;
  if (origPro) process.env.TELEGRAM_PRO_INVITE_URL = origPro;
});

