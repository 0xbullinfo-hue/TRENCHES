from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    bot_token: SecretStr = Field(validation_alias="BOT_TOKEN")
    pro_group_id: int = Field(validation_alias="PRO_GROUP_ID")
    member_group_id: int = Field(validation_alias="MEMBER_GROUP_ID")
    public_channel_id: int = Field(validation_alias="PUBLIC_CHANNEL_ID")
    public_community_group_id: int = Field(validation_alias="PUBLIC_COMMUNITY_GROUP_ID")
    admin_user_ids: list[int] = Field(validation_alias="ADMIN_USER_IDS")
    helius_api_key: SecretStr = Field(validation_alias="HELIUS_API_KEY")
    genesis_mint: str = Field(validation_alias="GENESIS_MINT")
    genesis_decimals: int = Field(validation_alias="GENESIS_DECIMALS")
    join_url: str = Field(validation_alias="JOIN_URL")
    internal_secret: SecretStr = Field(validation_alias="INTERNAL_SECRET")
    database_url: SecretStr = Field(validation_alias="DATABASE_URL")
    bootstrap_owner_id: int = Field(validation_alias="BOOTSTRAP_OWNER_ID")

    member_usd_threshold: float = Field(20, validation_alias="MEMBER_USD_THRESHOLD")
    pro_usd_threshold: float = Field(250, validation_alias="PRO_USD_THRESHOLD")
    pro_lock_days: int = Field(90, validation_alias="PRO_LOCK_DAYS")
    member_delay_minutes: int = Field(15, validation_alias="MEMBER_DELAY_MINUTES")
    recalc_interval_hours: int = Field(6, validation_alias="RECALC_INTERVAL_HOURS")
    invite_link_ttl_minutes: int = Field(60, validation_alias="INVITE_LINK_TTL_MINUTES")
    teaser_cooldown_minutes: int = Field(30, validation_alias="TEASER_COOLDOWN_MINUTES")
    teaser_daily_cap: int = Field(6, validation_alias="TEASER_DAILY_CAP")
    log_level: str = Field("INFO", validation_alias="LOG_LEVEL")

    @field_validator("genesis_decimals")
    @classmethod
    def valid_decimals(cls, value: int) -> int:
        if value not in (6, 9):
            raise ValueError("GENESIS_DECIMALS must be 6 or 9")
        return value

    @field_validator("admin_user_ids", mode="before")
    @classmethod
    def parse_admin_ids(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
