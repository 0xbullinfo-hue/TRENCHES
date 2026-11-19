"""SQLAlchemy Core table metadata mirroring migrations/001_initial.sql."""

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    Table,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()

telegram_members = Table(
    "telegram_members", metadata,
    Column("telegram_user_id", BigInteger, primary_key=True),
    Column("username", Text),
    Column("wallet_address", Text, nullable=False),
    Column("tier", Text, nullable=False),
    Column("verified_at", DateTime(timezone=True), nullable=False),
    Column("last_checked_at", DateTime(timezone=True), nullable=False),
    Column("stake_usd_at_verify", Numeric),
    Column("consecutive_failures", Integer, nullable=False, server_default="0"),
    Column("status", Text, nullable=False, server_default="active"),
    Column("removed_at", DateTime(timezone=True)),
    CheckConstraint("tier IN ('pro', 'member')", name="ck_telegram_members_tier"),
    CheckConstraint("status IN ('active', 'removed')", name="ck_telegram_members_status"),
)
Index("ix_telegram_members_wallet_address", telegram_members.c.wallet_address)
Index("ix_telegram_members_status", telegram_members.c.status)
Index("ix_telegram_members_tier_status", telegram_members.c.tier, telegram_members.c.status)

verify_nonces = Table(
    "verify_nonces", metadata,
    Column("telegram_user_id", BigInteger, primary_key=True),
    Column("nonce", Text, nullable=False),
    Column("message", Text, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("used", Boolean, nullable=False, server_default=text("false")),
)
Index("ix_verify_nonces_expires_at", verify_nonces.c.expires_at)

invite_links = Table(
    "invite_links", metadata,
    Column("id", BigInteger, primary_key=True),
    Column("telegram_user_id", BigInteger),
    Column("target_group", Text),
    Column("invite_link", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("expires_at", DateTime(timezone=True)),
    Column("used_at", DateTime(timezone=True)),
    Column("revoked", Boolean, nullable=False, server_default=text("false")),
)
Index("ix_invite_links_user_group", invite_links.c.telegram_user_id, invite_links.c.target_group)

pushed_calls = Table(
    "pushed_calls", metadata,
    Column("call_id", Text, primary_key=True),
    Column("telegram_message_id", BigInteger),
    Column("ticker", Text),
    Column("chain", Text),
    Column("contract_address", Text),
    Column("pushed_at", DateTime(timezone=True)),
)

teaser_state = Table(
    "teaser_state", metadata,
    Column("id", Integer, primary_key=True, server_default="1"),
    Column("last_teaser_at", DateTime(timezone=True)),
    Column("daily_count", Integer, nullable=False, server_default="0"),
    Column("daily_count_reset_at", DateTime(timezone=True)),
    CheckConstraint("id = 1", name="ck_teaser_state_singleton"),
)

community_warnings = Table(
    "community_warnings", metadata,
    Column("telegram_user_id", BigInteger, primary_key=True),
    Column("warning_count", Integer, nullable=False, server_default="0"),
    Column("muted_until", DateTime(timezone=True)),
    Column("banned", Boolean, nullable=False, server_default=text("false")),
    Column("last_warning_at", DateTime(timezone=True)),
)

verify_events = Table(
    "verify_events", metadata,
    Column("id", BigInteger, primary_key=True),
    Column("telegram_user_id", BigInteger),
    Column("wallet_address", Text),
    Column("event_type", Text, nullable=False),
    Column("payload", JSONB),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)
Index("ix_verify_events_created_at_desc", verify_events.c.created_at.desc())

schema_migrations = Table(
    "schema_migrations", metadata,
    Column("version", Text, primary_key=True),
    Column("applied_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

command_rate_limits = Table(
    "command_rate_limits", metadata,
    Column("telegram_user_id", BigInteger, primary_key=True),
    Column("command", Text, primary_key=True),
    Column("window_started_at", DateTime(timezone=True), nullable=False),
    Column("request_count", Integer, nullable=False, server_default="0"),
)

member_call_deliveries = Table(
    "member_call_deliveries", metadata,
    Column("call_id", Text, ForeignKey("pushed_calls.call_id", ondelete="CASCADE"), primary_key=True),
    Column("payload", JSONB, nullable=False),
    Column("deliver_at", DateTime(timezone=True), nullable=False),
    Column("delivered_at", DateTime(timezone=True)),
    Column("locked_until", DateTime(timezone=True)),
    Column("attempts", Integer, nullable=False, server_default="0"),
)
Index("ix_member_call_deliveries_due", member_call_deliveries.c.deliver_at,
      postgresql_where=member_call_deliveries.c.delivered_at.is_(None))
