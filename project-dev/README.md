# TrenchLabsHQ — project-dev

Next.js 16 (App Router) dApp: a token-gated terminal of alpha calls for **$GENESIS** holders on Solana with **StakePoint** 90-day staking and live pool telemetry.

## Access Model (Multi-Tier)

All legacy fixed token gates (such as the flat 1,000,000 $GENESIS rule) have been completely removed. Gating is governed dynamically by USD value:

* **Free:** Public ledger & educational content.
* **Member Tier:** Buy & hold at least **$20 USD** in $GENESIS on-chain $\to$ unlocks incubator terminal dashboard & the Member community (`https://t.me/+S5bRJX17PRkzMTE0`).
* **Pro Tier:** Buy & stake at least **$250 USD** in $GENESIS on **StakePoint** (90-day lock) $\to$ unlocks priority real-time call alerts, high-conviction alpha & the Pro community (`https://t.me/+aCatLce8Dfk5ZjZk`).

### Stake Expiry & Demotion Lifecycle
When a user's 90-day stake expires or unlocks:
1. The automated sweep endpoint (`/api/telegram/sweep`) detects that the stake is no longer active.
2. The user is evicted from the Pro group.
3. If they still hold at least $20 in $GENESIS, they are demoted to Member in the database, invited to the Member group (`https://t.me/+S5bRJX17PRkzMTE0`), and sent a direct alert prompting them to re-stake $250 on StakePoint to regain Pro.
4. If their wallet holds less than $20, they are evicted from both groups.

## Quick Start

```bash
cp .env.example .env.local   # Fill in values; see comments inside
npm ci
npm run dev
```

## Quality Checks

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src
npm test             # unit test suite (runs via tsx)
npm run build        # next build --webpack
```

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
