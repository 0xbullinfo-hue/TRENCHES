# Checkpoint 1 Plan — Scaffold and Foundation

**Goal:** Deliver project scaffold and tested config, persistent database schema/runner, wallet-signature verification, and mocked on-chain tier verification.

**Architecture:** Async Python package with SQLAlchemy Core on PostgreSQL/asyncpg; raw ordered SQL migrations; environment-backed Pydantic settings. Ed25519 verification is a pure function; Solana RPC, stake lookup, and 7-day TWAP are injected async providers so tests require no credentials or network.

**Tech stack:** Python 3.11+, pydantic-settings, SQLAlchemy Core, asyncpg, httpx, base58, PyNaCl, pytest, pytest-asyncio.

## Tasks

1. Scaffold source, tests, dependency metadata, Docker/Postgres 16, Fly config, `.env.example`, README, and SPEC.
2. Add validated configuration with secret fields redacted, PostgreSQL engine/pool, migration runner, and §4 schema migration.
3. Implement strict base58/base64 Ed25519 verifier and known-good/wrong-key/malformed-input tests.
4. Implement token raw-amount scaling, stake/TWAP provider contracts, tier resolution, RPC errors, and mocked branch tests.
5. Run the full checkpoint-one suite; review the diff for secrets; create a private GitHub repository and push if authentication and repository naming permit. Stop and report.

## Scope boundary

No bot handlers, Telegram live self-check, endpoint handlers, or credential-dependent live tests in this checkpoint. The owner will provide §0 credentials after this checkpoint. TWAP production provider remains an explicit integration choice; the security logic must fail closed on provider errors.
