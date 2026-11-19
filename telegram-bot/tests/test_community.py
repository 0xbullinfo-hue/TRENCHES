from types import SimpleNamespace

from bot.community import allowed_hosts, is_spam_text, teaser_text
from lib.config import Settings


ENV = {
    "BOT_TOKEN": "x", "PRO_GROUP_ID": "-1", "MEMBER_GROUP_ID": "-2",
    "PUBLIC_CHANNEL_ID": "-3", "PUBLIC_COMMUNITY_GROUP_ID": "-4",
    "ADMIN_USER_IDS": "1", "HELIUS_API_KEY": "h", "GENESIS_MINT": "m",
    "GENESIS_DECIMALS": "6", "JOIN_URL": "https://trenchlabs.xyz/join",
    "INTERNAL_SECRET": "s", "DATABASE_URL": "postgresql+asyncpg://u:p@localhost/db",
    "BOOTSTRAP_OWNER_ID": "1",
}


def test_teaser_is_generic_and_contains_only_access_url_and_disclaimer() -> None:
    text = teaser_text("https://trenchlabs.xyz/join")
    lowered = text.lower()
    assert "new alpha call posted" in lowered
    assert "pro members" in lowered
    assert "https://trenchlabs.xyz/join" in text
    assert "not financial advice" in lowered
    for forbidden in ("wif", "solana", "entry price", "stop loss", "take profit", "0x", "calls/"):
        assert forbidden not in lowered


def test_anti_spam_detects_base58_addresses_and_telegram_links() -> None:
    hosts = {"trenchlabs.xyz", "docs.trenchlabs.xyz"}
    assert is_spam_text("address " + "A" * 40, hosts)[0]
    assert is_spam_text("join at t.me/example", hosts)[0]


def test_anti_spam_allows_official_url_but_rejects_other_urls() -> None:
    settings = Settings(**ENV)
    hosts = allowed_hosts(settings)
    assert is_spam_text("https://trenchlabs.xyz/join", hosts) == (False, None)
    assert is_spam_text("https://evil.example/path", hosts)[0]


def test_message_has_no_ticker_or_dashboard_url_by_construction() -> None:
    text = teaser_text("https://trenchlabs.xyz/join")
    assert "dashboard" not in text.lower()
    assert "ticker" not in text.lower()
