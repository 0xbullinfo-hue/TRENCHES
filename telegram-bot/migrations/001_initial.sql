CREATE TABLE IF NOT EXISTS telegram_members (
    telegram_user_id BIGINT PRIMARY KEY,
    username TEXT,
    wallet_address TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('pro', 'member')),
    verified_at TIMESTAMPTZ NOT NULL,
    last_checked_at TIMESTAMPTZ NOT NULL,
    stake_usd_at_verify NUMERIC,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    removed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_telegram_members_wallet_address ON telegram_members(wallet_address);
CREATE INDEX IF NOT EXISTS ix_telegram_members_status ON telegram_members(status);
CREATE INDEX IF NOT EXISTS ix_telegram_members_tier_status ON telegram_members(tier, status);

CREATE TABLE IF NOT EXISTS verify_nonces (
    telegram_user_id BIGINT PRIMARY KEY,
    nonce TEXT NOT NULL,
    message TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS ix_verify_nonces_expires_at ON verify_nonces(expires_at);

CREATE TABLE IF NOT EXISTS invite_links (
    id BIGSERIAL PRIMARY KEY,
    telegram_user_id BIGINT,
    target_group TEXT CHECK (target_group IN ('member', 'pro')),
    invite_link TEXT,
    created_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ,
    revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS ix_invite_links_user_group ON invite_links(telegram_user_id, target_group);

CREATE TABLE IF NOT EXISTS pushed_calls (
    call_id TEXT PRIMARY KEY,
    telegram_message_id BIGINT,
    ticker TEXT,
    chain TEXT,
    pushed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS teaser_state (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_teaser_at TIMESTAMPTZ,
    daily_count INTEGER NOT NULL DEFAULT 0,
    daily_count_reset_at TIMESTAMPTZ
);
INSERT INTO teaser_state(id, daily_count) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS community_warnings (
    telegram_user_id BIGINT PRIMARY KEY,
    warning_count INTEGER NOT NULL DEFAULT 0,
    muted_until TIMESTAMPTZ,
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    last_warning_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS verify_events (
    id BIGSERIAL PRIMARY KEY,
    telegram_user_id BIGINT,
    wallet_address TEXT,
    event_type TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_verify_events_created_at_desc ON verify_events(created_at DESC);
