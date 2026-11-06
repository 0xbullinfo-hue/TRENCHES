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

test('createTelegramInvite falls back to official group invite URLs', async () => {
  const memberInvite = await tg.createTelegramInvite('member');
  assert.equal(memberInvite, 'https://t.me/+S5bRJX17PRkzMTE0');

  const proInvite = await tg.createTelegramInvite('pro');
  assert.equal(proInvite, 'https://t.me/+aCatLce8Dfk5ZjZk');
});

