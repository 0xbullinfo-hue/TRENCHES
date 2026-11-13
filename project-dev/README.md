# TrenchLabsHQ — project-dev

Next.js 16 (App Router) dApp: a token-gated terminal of alpha calls for **$H42** holders on Solana with **StakePoint** 90-day staking and live pool telemetry.

## Access Model (Multi-Tier)

All legacy fixed token gates (such as the flat 1,000,000 $H42 rule) have been completely removed. Gating is governed dynamically by USD value:

* **Free:** Public ledger & educational content.
* **Member Tier:** Buy & hold at least **$20 USD** in $H42 on-chain $\to$ unlocks incubator terminal dashboard & the Member community (`https://t.me/+S5bRJX17PRkzMTE0`).
* **Pro Tier:** Buy & stake at least **$250 USD** in $H42 on **StakePoint** (90-day lock) $\to$ unlocks priority real-time call alerts, high-conviction alpha & the Pro community (`https://t.me/+aCatLce8Dfk5ZjZk`).

### Stake Expiry & Demotion Lifecycle
When a user's 90-day stake expires or unlocks:
1. The automated sweep endpoint (`/api/telegram/sweep`) detects that the stake is no longer active.
2. The user is evicted from the Pro group.
3. If they still hold at least $20 in $H42, they are demoted to Member in the database, invited to the Member group (`https://t.me/+S5bRJX17PRkzMTE0`), and sent a direct alert prompting them to re-stake $250 on StakePoint to regain Pro.
4. If their wallet holds less than $20, they are evicted from both groups.

## Quick Start

```bash
cp .env.example .env.local   # Fill in values; see comments inside
npm ci
npm run dev
```

## Quality Checks

```bash
npm run typecheck         # tsc --noEmit
npm run lint              # eslint src
npm test                  # unit test suite (runs via tsx)
npm run test:integration  # real Redis Lua integration test suite
npm run test:e2e          # end-to-end HTTP acceptance & StakePoint suite
npm run build             # next build --webpack
```

### Running the Real Redis Lua Integration Suite Locally (`npm run test:integration`)

`tests/integration/redis-lua-outbox.test.mjs` executes the actual Lua scripts from `src/server/kv.ts` against a real `redis-server` instance (never connecting to production Upstash Redis):

1. **Automatic local launch:** If `redis-server` is installed on `PATH` (or cached at `~/.cache/redis-win/redis-server.exe` on Windows, or pointed to via `REDIS_SERVER_BIN`), running `npm run test:integration` automatically spawns an isolated ephemeral `redis-server` process bound to `127.0.0.1` with persistence disabled (`--save "" --appendonly no`).
2. **Existing local/Docker Redis container:** You can also run against any local Redis container (`docker run --rm -p 16379:6379 redis:7-alpine`) by setting `REDIS_TEST_PORT=16379 npm run test:integration`.
3. **Namespace isolation & cleanup:** All integration test keys use per-test UUID namespaces (`test:itg:<uuid>:*`) and are deleted automatically after every test.

## TP/SL Notification Outbox & At-Least-Once Delivery Semantics

The TP/SL notification outbox (`src/server/notification-outbox.ts` + `src/server/kv.ts`) persists triggered events (`trench:tpsl:outbox:events:v1`, `trench:tpsl:outbox:pending:v1`) and per-subscriber delivery states (`trench:tpsl:outbox:subs:v1:<eventId>`) in Upstash Redis before dispatching Telegram messages.

### Delivery Guarantee: At-Least-Once Delivery

- **Guarantee:** The outbox provides **at-least-once** notification delivery to eligible subscribers (`Pro` `$250` 90-day StakePoint stakers for all calls, and `Member` `$20` holders for non-Pro-only calls). It does **not** claim or advertise exactly-once delivery.
- **Duplicate suppression mechanisms:**
  - Deterministic event IDs (`tpsl:<callId>:<triggerType>:<targetId>`) and atomic Lua `HSETNX` creation prevent duplicate events across concurrent workers.
  - Per-subscriber processing leases (`status = 'processing'`, `processingToken`, `leaseExpiresAt`) and token-verified Lua completions (`kvOutboxCompleteSubscriber`) prevent concurrent duplicate sends and ensure any subscriber marked `delivered` is never re-sent the notification.
  - Tier-verification retries (`tierCheckAttemptCount`, `nextTierCheckAt`, `lastTierCheckFailureAt`) are tracked separately from Telegram delivery attempts (`attemptCount`), so temporary Solana RPC or price-oracle outages never consume Telegram delivery attempts or permanently exclude an eligible subscriber.
- **Telegram Acknowledgement Failure Window:**
  Because the Telegram Bot HTTP API (`sendMessage`) and Upstash Redis state acknowledgement are separate network systems without distributed two-phase commit:
  1. Telegram may accept and deliver a `sendMessage` request.
  2. If the serverless worker crashes, is terminated, or loses connectivity *before* `kvOutboxCompleteSubscriber` records `status = 'delivered'` in Redis,
  3. And the worker's processing lease (`leaseExpiresAt`) subsequently expires,
  4. The next scheduled worker will reclaim the expired lease and re-send the notification.
- **Non-sensitive Event Reference (`Ref: #<eventRef>`):**
  Every TP/SL Telegram alert includes a deterministic 8-character uppercase hex reference (`buildNotificationEventRef(eventId)`) derived from the SHA-256 hash of `eventId`. This allows subscribers and operators to identify duplicate deliveries from the acknowledgement failure window without exposing internal Redis keys, wallet addresses, chat IDs, or secrets.

## Production Telegram Setup

1. Copy `.env.example` to `.env.local` and configure your credentials.
2. Add `@Trenchlabs_bot` as an Administrator in both the Member and Pro groups with **Ban Users** permission.
3. Deploy to production, then register the webhook once:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://YOUR_DOMAIN/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","my_chat_member"]'
```

4. Verify webhook health:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```
