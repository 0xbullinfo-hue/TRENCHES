# TRENCHES — TrenchLabsHQ

[![Next.js](https://img.shields.io/badge/Next.js-16.4.5-black?style=flat&logo=next.js)](https://nextjs.org/)
[![Solana](https://img.shields.io/badge/Solana-Mainnet--Beta-9945FF?style=flat&logo=solana)](https://solana.com/)
[![Staking](https://img.shields.io/badge/Staking-StakePoint-00FF66?style=flat)](https://stakepoint.app/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(21%2F21)-brightgreen.svg)](tests/)

**TrenchLabsHQ** is a high-performance, token-gated terminal and automated signal telemetry system built for **$GENESIS** holders on Solana. It provides real-time multi-chain alpha calls, verifiable closed-trade P&L ledgers, 90-day **StakePoint** staking, live StakePoint pool telemetry, and automated multi-tier Telegram community management.

---

## 📑 Table of Contents

- [Access Model & Tier Gates](#-access-model--tier-gates)
- [StakePoint Staking Integration](#-stakepoint-staking-integration)
- [Telegram Bot & Group Lifecycle](#-telegram-bot--group-lifecycle)
- [Architecture & Security Hardening](#-architecture--security-hardening)
- [Project Structure](#-project-structure)
- [Environment Configuration](#-environment-configuration)
- [Local Development & Quality Checks](#-local-development--quality-checks)
- [Production Deployment (Vercel + Namecheap)](#-production-deployment-vercel--namecheap)
- [Telegram Webhook Setup](#-telegram-webhook-setup)

---

## 💎 Access Model & Tier Gates

TrenchLabsHQ has completely eliminated legacy fixed token gates (such as flat 1,000,000 $GENESIS rules). Access is governed dynamically by **USD-denominated targets** calculated from token market value:

| Tier | Requirement | Terminal & Feature Access | Telegram Benefits |
| :--- | :--- | :--- | :--- |
| **Free** | Public ($0) | Closed calls, verifiable P&L ledger, educational content | Public announcements channel |
| **Member** | **Buy & Hold $\ge$ $20 USD** in **$GENESIS** | Full incubator dashboard, live trade call feed, contract address inspection, market telemetry | Access to the official **Member Group** (`https://t.me/+S5bRJX17PRkzMTE0`) |
| **Pro** | **Buy & Stake $\ge$ $250 USD** in **$GENESIS** on **StakePoint** (90-day lock) | Priority high-conviction calls, push alerts, TP/SL triggers, analyst commentary, allocation caps | Direct bot DM call alerts + **Pro Group** (`https://t.me/+aCatLce8Dfk5ZjZk`) |

> **Dynamic Recalculation:** Token requirements are recalculated dynamically from the 7-day TWAP/market price (`token_amount = usd_target / twap_price_usd`).

---

## 🥩 StakePoint Staking Integration

**StakePoint** is the primary staking tool powering TrenchLabsHQ Pro membership:

- **90-Day Lock:** Stakers lock their $GENESIS for a minimum of 90 days on StakePoint to earn pool APR and qualify for Pro tier.
- **Live Pool Telemetry:** The dApp queries `/api/stakepoint/pools`, fetching live APR, total value locked (TVL), and direct pool links from `https://stakepoint.app/api/pools/by-token/[mint]`.
- **One-Click CTA & Auto-Verification:** Dashboard surfaces direct one-click links to the official StakePoint pool and provides an on-chain transaction verification flow (`POST /api/stake/confirm`) to activate Pro tier immediately upon staking.
- **Zero Streamflow Dependency:** Streamflow staking has been completely removed from the platform.

---

## 🤖 Telegram Bot & Group Lifecycle

An automated Telegram bot (`@Trenchlabs_bot`) verifies on-chain holdings and staking records, issues single-use invite links, broadcasts alpha calls, and demotes expired stakers:

```
                           ┌───────────────────────────┐
                           │      Connected Wallet     │
                           └─────────────┬─────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
      Hold >= $20 in $GENESIS                   Stake >= $250 on StakePoint
                    │                                         │
                    ▼                                         ▼
      ┌───────────────────────────┐             ┌───────────────────────────┐
      │       MEMBER TIER         │             │         PRO TIER          │
      │   Terminal Access         │             │   High-Conviction Alpha   │
      └─────────────┬─────────────┘             └─────────────┬─────────────┘
                    │                                         │
           Session vs_<id>                           Session vs_<id>
                    │                                         │
                    ▼                                         ▼
      ┌───────────────────────────┐             ┌───────────────────────────┐
      │ Verified by Bot           │             │ Verified by Bot           │
      │ Member Invite Link:       │             │ Pro Invite Link:          │
      │ https://t.me/+S5bRJX...   │             │ https://t.me/+aCatLce...  │
      └─────────────┬─────────────┘             └─────────────┬─────────────┘
                    │                                         │
                    └────────────────────┬────────────────────┘
                                         │
                             Recurring Holder Sweep
                             (/api/telegram/sweep)
                                         │
                                         ▼
                      ┌─────────────────────────────────────┐
                      │ Pro Stake Expired? (unlocks <= now) │
                      │  1. Evict from Pro Group            │
                      │  2. Balance >= $20?                 │
                      │     YES -> Invite to Member Group   │
                      │     NO  -> Evict from Member Group  │
                      │  3. DM: "Re-stake $250 to keep Pro" │
                      └─────────────────────────────────────┘
```

### 1. Verification Flow (`/start vs_<session_id>`)
1. User connects wallet on the dashboard and requests verification for Member or Pro.
2. The server creates an atomic, single-use 10-minute session (`vs_<session_id>`) tied to the wallet address.
3. User opens Telegram via deep-link: `https://t.me/Trenchlabs_bot?start=vs_<session_id>`.
4. Bot claims the session atomically, resolves the tier on-chain, and issues the single-use invite link:
   - **Pro verified:** Receives the Pro Group link (`https://t.me/+aCatLce8Dfk5ZjZk`).
   - **Member verified:** Receives the Member Group link (`https://t.me/+S5bRJX17PRkzMTE0`) with a prompt to stake $250 on StakePoint for Pro.
   - **Unqualified:** Warns user of insufficient balance/stake and provides links to buy or stake.

### 2. Automated Stake Expiry & Demotion Worker (`/api/telegram/sweep`)
Runs periodically (hourly or daily via `vercel.json` cron) to audit group members against live blockchain state:
- **Pro Stake Expiration:** When a 90-day stake expires (`unlocks_at <= now`), the worker evicts the user from the Pro group (ban + unban kick).
- **Member Transition:** If the user still maintains the $20 token balance, they are automatically demoted to Member in the database, sent the Member group link, and prompted via direct message to re-stake $250 via StakePoint to regain Pro access.
- **Token Dumps:** If the balance has fallen below $20, the user is removed from all groups.

---

## 🛡️ Architecture & Security Hardening

- **Cryptographic Wallet Authentication:** Ed25519 signature verification on all mutating requests. Messages are cryptographically bound to the HTTP method and request path with timestamp nonces.
- **Zero Committed Secrets:** All sensitive API keys, bot tokens, and RPC endpoints are strictly isolated to `.env.local` or host environment variables.
- **Timing-Safe Admin Verification:** Constant-time `crypto.timingSafeEqual` prevents timing side-channels when checking session signatures and webhook secrets.
- **Atomic Verification Claiming:** Verification sessions are claimed under a distributed lock (`trench:lock:db` or Upstash Redis) to prevent double-tap or race-condition replay attacks.
- **Serverless Persistence:** Full compatibility with Upstash Redis KV on Vercel/serverless environments, with local file persistence fallback for development.

---

## 📂 Project Structure

```
Trench_Lab/
├── PROJECT DEV/                     # Main Next.js 16 Web Application
│   ├── src/
│   │   ├── app/                     # App Router pages & API routes
│   │   │   ├── (public)/            # Landing page & public ledger
│   │   │   ├── (terminal)/          # Protected dashboard & staking pages
│   │   │   └── api/                 # Secure backend endpoints
│   │   │       ├── alphas/          # Trade calls feed & admin management
│   │   │       ├── stake/           # StakePoint status & confirm endpoints
│   │   │       ├── stakepoint/      # Live StakePoint pool telemetry proxy
│   │   │       ├── telegram/        # Webhook & automated sweep worker
│   │   │       └── verification/    # Telegram session generation
│   │   ├── components/              # UI components (Tailwind CSS)
│   │   │   ├── dashboard/           # Incubator Hub, Alpha Cards, Inspector
│   │   │   ├── stake/               # StakePoint Staking Card & verify form
│   │   │   ├── staking/             # StakePoint telemetry cards & skeleton
│   │   │   └── telegram/            # Telegram connect & verification widgets
│   │   ├── context/                 # GenesisContext (Wallet & balance state)
│   │   ├── lib/                     # Client helpers, config, tier definitions
│   │   │   ├── config.ts            # Mint, admin wallet, URLs
│   │   │   ├── tiers.ts             # $20 Member / $250 Pro definitions
│   │   │   └── stakepoint/          # StakePoint API client & types
│   │   └── server/                  # Server-only logic (DB, Auth, KV, Telegram)
│   ├── tests/                       # Automated test suite
│   ├── .env.example                 # Environment configuration template
│   ├── package.json                 # Dependencies & build scripts
│   └── vercel.json                  # Deployment & cron configuration
└── README.md                        # Project documentation (this file)
```

---

## ⚙️ Environment Configuration

Copy `PROJECT DEV/.env.example` to `PROJECT DEV/.env.local` and populate:

```ini
# Production Session Secret (32+ characters)
SESSION_SECRET=your_32_character_random_session_secret_key

# Upstash Redis KV (Required for serverless hosts like Vercel)
UPSTASH_REDIS_REST_URL=https://your-upstash-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_rest_token

# Solana RPC
SOLANA_RPC=https://api.mainnet-beta.solana.com
NEXT_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com

# Official Token Mint & Master Admin
NEXT_PUBLIC_GENESIS_MINT=EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump
ADMIN_WALLET=FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e
SITE_URL=https://trenchlabshq.xyz

# Telegram Bot & Group Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_BOT_USERNAME=Trenchlabs_bot
TELEGRAM_WEBHOOK_SECRET=your_random_webhook_secret_string
TELEGRAM_MEMBER_GROUP_ID=-1001234567890
TELEGRAM_PRO_GROUP_ID=-1009876543210
TELEGRAM_MEMBER_INVITE_URL=https://t.me/+S5bRJX17PRkzMTE0
TELEGRAM_PRO_INVITE_URL=https://t.me/+aCatLce8Dfk5ZjZk

# Vercel Cron Secret (protects /api/telegram/sweep)
CRON_SECRET=your_cron_bearer_token

# StakePoint Configuration
NEXT_PUBLIC_STAKEPOINT_URL=https://stakepoint.app
NEXT_PUBLIC_STAKEPOINT_POOL_ID=
STAKE_MINIMUM_USD=250
STAKE_LOCK_DAYS=90
```

---

## 🛠️ Local Development & Quality Checks

Run all commands from inside the `PROJECT DEV` directory:

```bash
cd "PROJECT DEV"

# Install clean dependencies
npm ci

# Start local Next.js dev server
npm run dev
```

### Run Quality Verification Suite

```bash
# 1. TypeScript compilation check
npm run typecheck

# 2. ESLint verification
npm run lint

# 3. Unit and Acceptance test suite
npm test

# 4. Production build
npm run build
```

---

## 🚀 Production Deployment (Vercel + Namecheap)

For modern Next.js App Router applications, **Vercel** is the official and recommended deployment host.

### Why Vercel?
1. **App Router & Serverless Native:** Next.js Server Components, streaming, API route edge handling, and revalidation work out of the box.
2. **Automated Crons:** The hourly `/api/telegram/sweep` worker is executed automatically through `vercel.json` crons.
3. **Zero Server Maintenance:** Automated SSL certificates, global CDN edge caching, and DDoS mitigation.

### Connecting Namecheap Domain to Vercel

1. In the **Vercel Project Dashboard** $\to$ **Settings** $\to$ **Domains**, add your domain (e.g., `trenchlabshq.xyz`).
2. Log into your **Namecheap Account** $\to$ **Domain List** $\to$ **Manage** $\to$ **Advanced DNS**:
   - **Type A Record:**
     - Host: `@`
     - Value: `76.76.21.21`
     - TTL: `Automatic`
   - **Type CNAME Record:**
     - Host: `www`
     - Value: `cname.vercel-dns.com.`
     - TTL: `Automatic`
3. Vercel automatically provisions free, auto-renewing Let's Encrypt SSL certificates within minutes.

### Setting Root Directory in Vercel
In Vercel **Project Settings** $\to$ **General**:
- Set **Root Directory** to `PROJECT DEV`.

---

## 📡 Telegram Webhook Setup

Once deployed to production:

1. Add `@Trenchlabs_bot` as an Administrator in both the Member and Pro groups with **Ban Users** permission.
2. Register the webhook with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://YOUR_DOMAIN/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","my_chat_member"]'
```

3. Confirm webhook status:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```
