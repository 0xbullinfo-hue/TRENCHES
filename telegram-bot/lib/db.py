from __future__ import annotations

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


class Database:
    def __init__(self, database_url: str) -> None:
        if not database_url.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must use postgresql+asyncpg://")
        self.engine: AsyncEngine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
        )

    async def run_migrations(self, migrations_dir: Path | None = None) -> None:
        directory = migrations_dir or Path(__file__).resolve().parents[1] / "migrations"
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """))
            rows = await conn.execute(text("SELECT version FROM schema_migrations"))
            applied = set(rows.scalars())
            for migration in sorted(directory.glob("*.sql")):
                if migration.name in applied:
                    continue
                sql = migration.read_text(encoding="utf-8")
                # asyncpg disallows multi-statement SQL through prepared execution;
                # execute each semicolon-delimited statement within this transaction.
                for statement in (part.strip() for part in sql.split(";")):
                    if statement:
                        await conn.exec_driver_sql(statement)
                await conn.execute(
                    text("INSERT INTO schema_migrations(version) VALUES (:version)"),
                    {"version": migration.name},
                )

    async def close(self) -> None:
        await self.engine.dispose()
