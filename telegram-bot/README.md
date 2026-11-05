# TrenchLabsHQ Telegram Bot

Python 3.11+ service for Telegram membership verification and signal delivery. The locked stack is python-telegram-bot (async + JobQueue), FastAPI/uvicorn, PostgreSQL 16, SQLAlchemy Core/asyncpg, Helius RPC, and PyNaCl.

## Implemented

- PostgreSQL migrations and Core metadata for members, nonces, invites, calls, teaser state, community warnings, audit events, command rate limits, and durable delayed Member deliveries.
- `/start`, `/help`, `/verify`, `/sig`, `/status`, `/getlink`, `/members`, `/checkall`, `/kick`, and `/diag` commands.
- Strict Ed25519 signature checking, Helius SPL balance reads, platform stake reads, and an injectable 7-day TWAP provider.
- Startup permission self-check before Telegram polling or HTTP serving.
- Authenticated `/internal/push-call` and `/internal/push-result` endpoints; protected Pro sends, idempotent call IDs, delayed Member posts, closed results, and generic public teasers.
- Public community address/link moderation with durable warning, mute, and ban state.

Live Telegram and on-chain behavior remains unverified until the operator supplies §0 credentials, confirms permissions, and selects a production 7-day TWAP source.

## Local development

1. Copy `.env.example` to `.env` and fill required values from §3 of `SPEC.md`.
2. Start PostgreSQL with `docker compose up -d db`.
3. Create a Python 3.11+ virtual environment and install `pip install -e '.[test]'`.
4. Run `pytest -q`.

The database schema is managed by ordered SQL files in `migrations/`; `lib.db.run_migrations()` applies unapplied files at startup and records them in `schema_migrations`. PostgreSQL is the only supported bot state store. The `stakes` table is platform-owned and read, not created, by bot migrations; it must provide `wallet_address`, `status`, `unlocks_at`, and `stake_usd`.

## Environment variables

See `.env.example` for the required §3 names plus optional `BUY_URL` and `PUBLIC_LEDGER_URL`. Never commit `.env` or log secret values.

## Internal API

The service binds uvicorn to `127.0.0.1:8000`. Requests require `X-Internal-Secret`. See `SPEC.md` §§10–11 for payload shapes. `/internal/push-call` rejects unknown fields; the payload cannot carry thesis, targets, or analyst statistics. Do not expose this listener publicly.

## Local commands

From `telegram-bot/`:

```bash
docker compose up -d db
python -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest -q
cp .env.example .env  # fill values securely before running
.venv/bin/python -m main
```

## Deployment

`Dockerfile`, `docker-compose.yml`, and `fly.toml` are included. Production deployment is deliberately gated on the live Telegram startup self-check and operator-provided §0 credentials. Provision a Fly Postgres 16 cluster and attach it before deploying; configure secrets using Fly's secret store. The production TWAP adapter must be selected and tested before membership decisions are enabled; the runtime currently fails closed instead of substituting spot price.
