from __future__ import annotations

from decimal import Decimal

from lib.verify import VerifyRPCError


class UnconfiguredTwapReader:
    """Fail-closed until the operator selects a 7-day TWAP data provider.

    The spec names Helius/Jupiter/Birdeye as options but defines neither a provider,
    credential, nor response contract. A spot quote is intentionally never substituted.
    """

    async def get_7d_twap_usd(self, mint: str) -> Decimal:
        raise VerifyRPCError("7-day TWAP provider is not configured")
