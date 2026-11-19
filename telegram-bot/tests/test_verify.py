from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from lib.verify import VerificationService, VerifyRPCError


def account(amount: str) -> dict:
    return {"account": {"data": {"parsed": {"info": {"tokenAmount": {"amount": amount}}}}}}


@pytest.fixture

def providers():
    helius = AsyncMock()
    helius.get_token_accounts.return_value = [account("1230000"), account("770000")]
    stake = AsyncMock()
    stake.get_active_stake_usd.return_value = Decimal("0")
    price = AsyncMock()
    price.get_7d_twap_usd.return_value = Decimal("10")
    service = VerificationService(
        helius=helius,
        stake_reader=stake,
        price_reader=price,
        genesis_mint="mint",
        genesis_decimals=6,
        clock=lambda: datetime(2025, 1, 1, tzinfo=timezone.utc),
    )
    return service, helius, stake, price


@pytest.mark.asyncio
async def test_token_accounts_sum_raw_amounts_and_scale(providers) -> None:
    service, helius, _, _ = providers
    assert await service.get_token_balance("wallet") == Decimal("2")
    helius.get_token_accounts.assert_awaited_once_with("wallet", "mint")


@pytest.mark.asyncio
async def test_member_tier_and_gap_use_seven_day_twap(providers) -> None:
    service, _, _, price = providers
    result = await service.resolve_tier("wallet")
    assert result == {
        "tier": "member",
        "held_usd": Decimal("20"),
        "stake_usd": Decimal("0"),
        "next_tier": "pro",
        "gap_usd": Decimal("250"),
    }
    price.get_7d_twap_usd.assert_awaited_once_with("mint")


@pytest.mark.asyncio
async def test_pro_tier_depends_on_stake_threshold(providers) -> None:
    service, _, stake, _ = providers
    stake.get_active_stake_usd.return_value = Decimal("250")
    result = await service.resolve_tier("wallet")
    assert result["tier"] == "pro"
    assert result["next_tier"] is None
    assert result["gap_usd"] == Decimal("0")


@pytest.mark.asyncio
async def test_below_member_threshold_returns_gap(providers) -> None:
    service, helius, _, _ = providers
    helius.get_token_accounts.return_value = [account("1000000")]
    result = await service.resolve_tier("wallet")
    assert result["tier"] is None
    assert result["gap_usd"] == Decimal("10")


@pytest.mark.asyncio
async def test_twap_is_cached_for_one_hour(providers) -> None:
    service, _, _, price = providers
    assert await service.get_twap_price_usd() == Decimal("10")
    assert await service.get_twap_price_usd() == Decimal("10")
    price.get_7d_twap_usd.assert_awaited_once()


@pytest.mark.asyncio
async def test_rpc_error_is_not_converted_to_zero(providers) -> None:
    service, helius, _, _ = providers
    helius.get_token_accounts.side_effect = VerifyRPCError("upstream down")
    with pytest.raises(VerifyRPCError):
        await service.get_token_balance("wallet")


@pytest.mark.asyncio
async def test_malformed_rpc_account_raises_verify_error(providers) -> None:
    service, helius, _, _ = providers
    helius.get_token_accounts.return_value = [{"bad": "shape"}]
    with pytest.raises(VerifyRPCError):
        await service.get_token_balance("wallet")
