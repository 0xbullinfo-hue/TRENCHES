# TrenchLabsHQ Telegram Bot

Python 3.11+ service for Telegram membership verification and signal delivery. The locked stack is python-telegram-bot (async + JobQueue), FastAPI/uvicorn, PostgreSQL 16, SQLAlchemy Core/asyncpg, Helius RPC, and PyNaCl.

## Current build stage

Checkpoint 1 implements the scaffold and security/data foundation (configuration, PostgreSQL migration runner, ed25519 verification, and mocked on-chain verification tests). Telegram handlers, API routes, startup permission checks, and deployment are intentionally deferred to later checkpoints.

## Local development

1. Copy `.env.example` to `.env` and fill required values from §3 of `SPEC.md`.
2. Start PostgreSQL with `docker compose up -d db`.
3. Create a Python 3.11+ virtual environment and install `pip install -e '.[test]'`.
4. Run `pytest -q`.

The database schema is managed by ordered SQL files in `migrations/`; `lib.db.run_migrations()` applies unapplied files at startup and records them in `schema_migrations`. PostgreSQL is the only supported state store.

## Environment variables

See `.env.example` for the complete variable-name list. Required values are documented in §3 of `SPEC.md`. Never commit `.env` or log secret values.

## Deployment

`Dockerfile`, `docker-compose.yml`, and `fly.toml` are scaffolded. Production deployment is deliberately gated on the later Telegram startup self-check and operator-provided §0 credentials. Provision a Fly Postgres 16 cluster and attach it before deploying; configure secrets using Fly's secret store.
