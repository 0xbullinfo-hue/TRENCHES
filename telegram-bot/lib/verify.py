from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


class VerifyRPCError(RuntimeError):
    """An upstream read failed; callers must not interpret this as zero balance."""


class HeliusClient:
    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._url = f"https://mainnet.helius-rpc.com/?api-key={api_key}"
        self._client = client or httpx.AsyncClient(timeout=15)
        self._owns_client = client is None

    async def get_token_accounts(self, wallet: str, mint: str) -> list[dict[str, Any]]:
        payload = {
            "jsonrpc": "2.0",
            "id": "trenchlabs-verify",
            "method": "getTokenAccountsByOwner",
            "params": [wallet, {"mint": mint}, {"encoding": "jsonParsed"}],
        }
        try:
            response = await self._client.post(self._url, json=payload)
            response.raise_for_status()
            data = response.json()
            if "error" in data or "result" not in data:
                raise VerifyRPCError("Helius returned an RPC error")
            return data["result"].get("value", [])
        except VerifyRPCError:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise VerifyRPCError("Helius token-account request failed") from exc

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()


class StakeReader(Protocol):
    async def get_active_stake_usd(self, wallet: str) -> Decimal: ...


class TwapPriceReader(Protocol):
    async def get_7d_twap_usd(self, mint: str) -> Decimal: ...


class DatabaseStakeReader:
    """Reads active stake rows shared with the platform from PostgreSQL."""

    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    async def get_active_stake_usd(self, wallet: str) -> Decimal:
        try:
            async with self.engine.connect() as conn:
                result = await conn.execute(
                    text("""SELECT COALESCE(SUM(stake_usd), 0)
                           FROM stakes
                           WHERE wallet_address = :wallet
                             AND status = 'active' AND unlocks_at > now()"""),
                    {"wallet": wallet},
                )
                return Decimal(result.scalar_one())
        except Exception as exc:
            raise VerifyRPCError("Stake database read failed") from exc


class VerificationService:
    def __init__(
        self,
        *,
        helius: HeliusClient,
        stake_reader: StakeReader,
        price_reader: TwapPriceReader,
        genesis_mint: str,
        genesis_decimals: int,
        member_usd_threshold: Decimal = Decimal("20"),
        pro_usd_threshold: Decimal = Decimal("250"),
        clock=lambda: datetime.now(timezone.utc),
    ) -> None:
        if genesis_decimals not in (6, 9):
            raise ValueError("GENESIS_DECIMALS must be 6 or 9")
        self.helius = helius
        self.stake_reader = stake_reader
        self.price_reader = price_reader
        self.genesis_mint = genesis_mint
        self.genesis_decimals = genesis_decimals
        self.member_usd_threshold = member_usd_threshold
        self.pro_usd_threshold = pro_usd_threshold
        self.clock = clock
        self._price_cache: tuple[Decimal, datetime] | None = None

    async def get_token_balance(self, wallet: str) -> Decimal:
        accounts = await self.helius.get_token_accounts(wallet, self.genesis_mint)
        raw_total = 0
        try:
            for item in accounts:
                amount = item["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]
                raw_total += int(amount)
        except (KeyError, TypeError, ValueError) as exc:
            raise VerifyRPCError("Helius returned malformed token-account data") from exc
        return Decimal(raw_total) / (Decimal(10) ** self.genesis_decimals)

    async def get_stake_usd(self, wallet: str) -> Decimal:
        try:
            return Decimal(await self.stake_reader.get_active_stake_usd(wallet))
        except VerifyRPCError:
            raise
        except Exception as exc:
            raise VerifyRPCError("Stake lookup failed") from exc

    async def get_twap_price_usd(self) -> Decimal:
        now = self.clock()
        if self._price_cache and now - self._price_cache[1] < timedelta(hours=1):
            return self._price_cache[0]
        try:
            price = Decimal(await self.price_reader.get_7d_twap_usd(self.genesis_mint))
            if not price.is_finite() or price <= 0:
                raise ValueError("TWAP must be finite and positive")
        except Exception as exc:
            raise VerifyRPCError("7-day TWAP lookup failed") from exc
        self._price_cache = (price, now)
        return price

    async def resolve_tier(self, wallet: str) -> dict[str, Any]:
        held_usd = await self.get_token_balance(wallet) * await self.get_twap_price_usd()
        stake_usd = await self.get_stake_usd(wallet)
        if stake_usd >= self.pro_usd_threshold:
            tier, next_tier, gap_usd = "pro", None, Decimal("0")
        elif held_usd >= self.member_usd_threshold:
            tier, next_tier = "member", "pro"
            gap_usd = max(Decimal("0"), self.pro_usd_threshold - stake_usd)
        else:
            tier, next_tier = None, "member"
            gap_usd = max(Decimal("0"), self.member_usd_threshold - held_usd)
        return {
            "tier": tier,
            "held_usd": held_usd,
            "stake_usd": stake_usd,
            "next_tier": next_tier,
            "gap_usd": gap_usd,
        }
