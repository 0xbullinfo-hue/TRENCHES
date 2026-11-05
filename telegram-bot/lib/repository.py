from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


class Repository:
    """PostgreSQL persistence boundary; methods avoid leaking ORM/session state."""

    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    async def log_event(
        self,
        event_type: str,
        *,
        telegram_user_id: int | None = None,
        wallet_address: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""INSERT INTO verify_events
                (telegram_user_id, wallet_address, event_type, payload)
                VALUES (:user_id, :wallet, :event, CAST(:payload AS jsonb))"""), {
                "user_id": telegram_user_id,
                "wallet": wallet_address,
                "event": event_type,
                "payload": __import__("json").dumps(payload or {}),
            })

    async def issue_nonce(self, user_id: int, nonce: str, message: str, ttl_seconds: int) -> datetime:
        async with self.engine.begin() as conn:
            row = await conn.execute(text("""INSERT INTO verify_nonces
                (telegram_user_id, nonce, message, expires_at, used)
                VALUES (:user_id, :nonce, :message, now() + (:ttl * interval '1 second'), false)
                ON CONFLICT (telegram_user_id) DO UPDATE SET
                  nonce=EXCLUDED.nonce, message=EXCLUDED.message,
                  expires_at=EXCLUDED.expires_at, used=false
                RETURNING expires_at"""), {
                "user_id": user_id, "nonce": nonce, "message": message, "ttl": ttl_seconds,
            })
            return row.scalar_one()

    async def get_pending_nonce(self, user_id: int) -> dict[str, Any] | None:
        async with self.engine.connect() as conn:
            result = await conn.execute(text("""SELECT nonce, message, expires_at, used
                FROM verify_nonces WHERE telegram_user_id=:user_id"""), {"user_id": user_id})
            row = result.mappings().first()
            if not row or row["used"] or row["expires_at"] <= datetime.now(timezone.utc):
                return None
            return dict(row)

    async def consume_nonce(self, user_id: int, nonce: str) -> bool:
        async with self.engine.begin() as conn:
            result = await conn.execute(text("""UPDATE verify_nonces SET used=true
                WHERE telegram_user_id=:user_id AND nonce=:nonce AND used=false
                  AND expires_at > now() RETURNING telegram_user_id"""),
                {"user_id": user_id, "nonce": nonce})
            return result.scalar_one_or_none() is not None

    async def upsert_member(
        self, user_id: int, username: str | None, wallet: str, tier: str,
        stake_usd: Any,
    ) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""INSERT INTO telegram_members
                (telegram_user_id, username, wallet_address, tier, verified_at,
                 last_checked_at, stake_usd_at_verify, consecutive_failures, status)
                VALUES (:user_id, :username, :wallet, :tier, now(), now(), :stake, 0, 'active')
                ON CONFLICT (telegram_user_id) DO UPDATE SET
                  username=EXCLUDED.username, wallet_address=EXCLUDED.wallet_address,
                  tier=EXCLUDED.tier, verified_at=now(), last_checked_at=now(),
                  stake_usd_at_verify=EXCLUDED.stake_usd_at_verify,
                  consecutive_failures=0, status='active', removed_at=NULL"""), {
                "user_id": user_id, "username": username, "wallet": wallet,
                "tier": tier, "stake": stake_usd,
            })

    async def get_member(self, user_id: int) -> dict[str, Any] | None:
        async with self.engine.connect() as conn:
            result = await conn.execute(text("""SELECT * FROM telegram_members
                WHERE telegram_user_id=:user_id"""), {"user_id": user_id})
            row = result.mappings().first()
            return dict(row) if row else None

    async def active_members(self) -> list[dict[str, Any]]:
        async with self.engine.connect() as conn:
            result = await conn.execute(text("SELECT * FROM telegram_members WHERE status='active'"))
            return [dict(row) for row in result.mappings()]

    async def update_member_check(self, user_id: int, stake_usd: Any, failures: int) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""UPDATE telegram_members SET last_checked_at=now(),
                stake_usd_at_verify=:stake, consecutive_failures=:failures
                WHERE telegram_user_id=:user_id AND status='active'"""),
                {"user_id": user_id, "stake": stake_usd, "failures": failures})

    async def set_member_tier(self, user_id: int, tier: str) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""UPDATE telegram_members SET tier=:tier,
                last_checked_at=now(), consecutive_failures=0 WHERE telegram_user_id=:user_id"""),
                {"user_id": user_id, "tier": tier})

    async def mark_member_removed(self, user_id: int) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""UPDATE telegram_members SET status='removed', removed_at=now()
                WHERE telegram_user_id=:user_id"""), {"user_id": user_id})

    async def count_members_by_tier(self) -> dict[str, int]:
        async with self.engine.connect() as conn:
            result = await conn.execute(text("""SELECT tier, count(*) AS total
                FROM telegram_members WHERE status='active' GROUP BY tier"""))
            return {row["tier"]: row["total"] for row in result.mappings()}

    async def store_invite(
        self, user_id: int, tier: str, link: str, expires_at: datetime,
    ) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""UPDATE invite_links SET revoked=true
                WHERE telegram_user_id=:user_id AND target_group=:tier
                  AND used_at IS NULL AND revoked=false AND expires_at > now()"""),
                {"user_id": user_id, "tier": tier})
            await conn.execute(text("""INSERT INTO invite_links
                (telegram_user_id, target_group, invite_link, created_at, expires_at, revoked)
                VALUES (:user_id, :tier, :link, now(), :expires_at, false)"""),
                {"user_id": user_id, "tier": tier, "link": link, "expires_at": expires_at})

    async def get_active_invite(self, user_id: int, tier: str) -> dict[str, Any] | None:
        async with self.engine.connect() as conn:
            result = await conn.execute(text("""SELECT * FROM invite_links
                WHERE telegram_user_id=:user_id AND target_group=:tier
                  AND revoked=false AND used_at IS NULL AND expires_at > now()
                ORDER BY created_at DESC LIMIT 1"""), {"user_id": user_id, "tier": tier})
            row = result.mappings().first()
            return dict(row) if row else None

    async def mark_invite_used(self, link: str, user_id: int, tier: str) -> bool:
        async with self.engine.begin() as conn:
            result = await conn.execute(text("""UPDATE invite_links SET used_at=now()
                WHERE invite_link=:link AND telegram_user_id=:user_id AND target_group=:tier
                  AND revoked=false AND used_at IS NULL AND expires_at > now()
                RETURNING id"""), {"link": link, "user_id": user_id, "tier": tier})
            return result.scalar_one_or_none() is not None

    async def revoke_expired_invites(self) -> int:
        async with self.engine.begin() as conn:
            result = await conn.execute(text("""UPDATE invite_links SET revoked=true
                WHERE revoked=false AND (expires_at <= now() OR used_at IS NOT NULL)"""))
            return result.rowcount or 0

    async def reserve_call(self, call_id: str, ticker: str, chain: str,
                           contract_address: str) -> bool:
        async with self.engine.begin() as conn:
            result = await conn.execute(text("""INSERT INTO pushed_calls
                (call_id, ticker, chain, contract_address, pushed_at)
                VALUES (:call_id, :ticker, :chain, :contract_address, now())
                ON CONFLICT (call_id) DO NOTHING RETURNING call_id"""),
                {"call_id": call_id, "ticker": ticker, "chain": chain,
                 "contract_address": contract_address})
            return result.scalar_one_or_none() is not None

    async def delete_call_reservation(self, call_id: str) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("DELETE FROM pushed_calls WHERE call_id=:call_id AND telegram_message_id IS NULL"),
                               {"call_id": call_id})

    async def finalize_call_delivery(self, call_id: str, message_id: int,
                                    payload: dict[str, Any], delay_minutes: int) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("UPDATE pushed_calls SET telegram_message_id=:message_id WHERE call_id=:call_id"),
                               {"call_id": call_id, "message_id": message_id})
            await conn.execute(text("""INSERT INTO member_call_deliveries
                (call_id, payload, deliver_at) VALUES (:call_id, CAST(:payload AS jsonb),
                 now() + (:delay * interval '1 minute'))
                ON CONFLICT (call_id) DO NOTHING"""), {
                "call_id": call_id, "payload": __import__("json").dumps(payload),
                "delay": delay_minutes,
            })

    async def claim_member_delivery(self, call_id: str) -> dict[str, Any] | None:
        async with self.engine.begin() as conn:
            row = (await conn.execute(text("""UPDATE member_call_deliveries
                SET locked_until=now() + interval '2 minutes', attempts=attempts+1
                WHERE call_id=:call_id AND delivered_at IS NULL AND deliver_at <= now()
                  AND (locked_until IS NULL OR locked_until < now())
                RETURNING payload"""), {"call_id": call_id})).mappings().first()
            return dict(row["payload"]) if row else None

    async def claim_due_member_deliveries(self, limit: int = 25) -> list[dict[str, Any]]:
        async with self.engine.begin() as conn:
            result = await conn.execute(text("""WITH due AS (
                    SELECT call_id FROM member_call_deliveries
                    WHERE delivered_at IS NULL AND deliver_at <= now()
                      AND (locked_until IS NULL OR locked_until < now())
                    ORDER BY deliver_at FOR UPDATE SKIP LOCKED LIMIT :limit
                )
                UPDATE member_call_deliveries AS d
                SET locked_until=now() + interval '2 minutes', attempts=d.attempts+1
                FROM due WHERE d.call_id=due.call_id
                RETURNING d.call_id, d.payload"""), {"limit": limit})
            return [dict(row) for row in result.mappings()]

    async def complete_member_delivery(self, call_id: str) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""UPDATE member_call_deliveries
                SET delivered_at=now(), locked_until=NULL WHERE call_id=:call_id"""),
                {"call_id": call_id})

    async def release_member_delivery(self, call_id: str) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""UPDATE member_call_deliveries
                SET locked_until=NULL WHERE call_id=:call_id AND delivered_at IS NULL"""),
                {"call_id": call_id})

    async def get_call(self, call_id: str) -> dict[str, Any] | None:
        async with self.engine.connect() as conn:
            result = await conn.execute(text("SELECT * FROM pushed_calls WHERE call_id=:id"),
                                        {"id": call_id})
            row = result.mappings().first()
            return dict(row) if row else None

    async def claim_teaser_slot(self, cooldown_minutes: int, daily_cap: int) -> bool:
        """Atomically reserve a teaser slot across replicas; caller sends only on True."""
        now = datetime.now(timezone.utc)
        async with self.engine.begin() as conn:
            await conn.execute(text("INSERT INTO teaser_state(id) VALUES (1) ON CONFLICT DO NOTHING"))
            row = (await conn.execute(text("SELECT * FROM teaser_state WHERE id=1 FOR UPDATE"))).mappings().one()
            reset_at = row["daily_count_reset_at"]
            count = row["daily_count"]
            last = row["last_teaser_at"]
            if reset_at is None or reset_at < now - timedelta(hours=24):
                count, reset_at = 0, now
            if count >= daily_cap:
                if reset_at != row["daily_count_reset_at"]:
                    await conn.execute(text("UPDATE teaser_state SET daily_count=0, daily_count_reset_at=:reset WHERE id=1"), {"reset": reset_at})
                return False
            if last and last > now - timedelta(minutes=cooldown_minutes):
                if reset_at != row["daily_count_reset_at"]:
                    await conn.execute(text("UPDATE teaser_state SET daily_count=0, daily_count_reset_at=:reset WHERE id=1"), {"reset": reset_at})
                return False
            await conn.execute(text("""UPDATE teaser_state SET last_teaser_at=:now,
                daily_count=:count, daily_count_reset_at=:reset WHERE id=1"""),
                {"now": now, "count": count + 1, "reset": reset_at})
            return True

    async def add_community_warning(self, user_id: int) -> dict[str, Any]:
        async with self.engine.begin() as conn:
            row = (await conn.execute(text("""INSERT INTO community_warnings
                (telegram_user_id, warning_count, last_warning_at)
                VALUES (:user_id, 1, now())
                ON CONFLICT (telegram_user_id) DO UPDATE SET
                  warning_count=community_warnings.warning_count+1,
                  last_warning_at=now()
                RETURNING warning_count, banned"""), {"user_id": user_id})).mappings().one()
            return dict(row)

    async def set_community_muted(self, user_id: int, until: datetime) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""UPDATE community_warnings SET muted_until=:until
                WHERE telegram_user_id=:user_id"""), {"user_id": user_id, "until": until})

    async def set_community_banned(self, user_id: int) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""UPDATE community_warnings SET banned=true
                WHERE telegram_user_id=:user_id"""), {"user_id": user_id})

    async def community_user_banned(self, user_id: int) -> bool:
        async with self.engine.connect() as conn:
            result = await conn.execute(text("""SELECT banned FROM community_warnings
                WHERE telegram_user_id=:user_id"""), {"user_id": user_id})
            return bool(result.scalar_one_or_none())

    async def cleanup_nonces(self) -> int:
        async with self.engine.begin() as conn:
            result = await conn.execute(text("DELETE FROM verify_nonces WHERE expires_at < now() - interval '1 hour' OR (used=true AND expires_at < now())"))
            return result.rowcount or 0

    async def consume_rate_limit(self, user_id: int, command: str, limit: int,
                                 window_seconds: int = 3600) -> bool:
        async with self.engine.begin() as conn:
            row = (await conn.execute(text("""INSERT INTO command_rate_limits
                (telegram_user_id, command, window_started_at, request_count)
                VALUES (:user_id, :command, now(), 1)
                ON CONFLICT (telegram_user_id, command) DO UPDATE SET
                  window_started_at=CASE
                    WHEN command_rate_limits.window_started_at <= now() - (:window * interval '1 second')
                    THEN now() ELSE command_rate_limits.window_started_at END,
                  request_count=CASE
                    WHEN command_rate_limits.window_started_at <= now() - (:window * interval '1 second')
                    THEN 1 ELSE command_rate_limits.request_count+1 END
                RETURNING request_count"""), {
                "user_id": user_id, "command": command, "window": window_seconds,
            })).scalar_one()
            return row <= limit
