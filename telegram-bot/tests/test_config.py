import pytest
from pydantic import SecretStr, ValidationError

from lib.config import Settings


BASE = {
    "BOT_TOKEN": "bot-secret",
    "PRO_GROUP_ID": "-1001",
    "MEMBER_GROUP_ID": "-1002",
    "PUBLIC_CHANNEL_ID": "-1003",
    "PUBLIC_COMMUNITY_GROUP_ID": "-1004",
    "ADMIN_USER_IDS": "12, 34",
    "HELIUS_API_KEY": "helius-secret",
    "GENESIS_MINT": "mint-address",
    "GENESIS_DECIMALS": "6",
    "JOIN_URL": "https://trenchlabs.xyz/join",
    "INTERNAL_SECRET": "internal-secret",
    "DATABASE_URL": "postgresql+asyncpg://user:pass@localhost/db",
    "BOOTSTRAP_OWNER_ID": "42",
}


def test_required_settings_and_defaults() -> None:
    settings = Settings(**BASE)
    assert settings.admin_user_ids == [12, 34]
    assert settings.teaser_cooldown_minutes == 30
    assert isinstance(settings.bot_token, SecretStr)
    assert "bot-secret" not in repr(settings)
    assert "helius-secret" not in repr(settings)


def test_missing_required_values_fail_validation() -> None:
    with pytest.raises(ValidationError):
        Settings()


def test_invalid_genesis_decimals_rejected() -> None:
    values = {**BASE, "GENESIS_DECIMALS": "8"}
    with pytest.raises(ValidationError):
        Settings(**values)


def test_logging_filter_redacts_all_configured_secrets() -> None:
    import logging

    from lib.logging_config import SecretRedactionFilter

    record = logging.LogRecord(
        "test", logging.INFO, __file__, 1,
        "secrets: %s %s %s %s",
        ("bot-secret", "helius-secret", "internal-secret", "postgres-password"),
        None,
    )
    redactor = SecretRedactionFilter(
        ["bot-secret", "helius-secret", "internal-secret", "postgres-password"]
    )
    assert redactor.filter(record)
    for secret in ("bot-secret", "helius-secret", "internal-secret", "postgres-password"):
        assert secret not in record.getMessage()
    assert record.getMessage().count("[REDACTED]") == 4
