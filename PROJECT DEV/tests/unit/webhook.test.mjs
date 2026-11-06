import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = '123456:TESTTOKEN';
process.env.TELEGRAM_BOT_USERNAME = 'test_bot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret';
process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:9';
process.env.UPSTASH_REDIS_REST_TOKEN = 'x';

const { POST } = await import('../../src/app/api/telegram/webhook/route.ts');
const mk = (headers) =>
  new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ update_id: 1, message: { chat: { id: 1, type: 'private' }, text: '/help' } }),
  });

test('webhook rejects requests without the secret token (401)', async () => {
  assert.equal((await POST(mk({}))).status, 401);
});

test('webhook rejects a wrong secret token (401)', async () => {
  assert.equal((await POST(mk({ 'x-telegram-bot-api-secret-token': 'wrong-secret' }))).status, 401);
});

