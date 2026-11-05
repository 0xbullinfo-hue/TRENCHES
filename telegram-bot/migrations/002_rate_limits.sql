CREATE TABLE IF NOT EXISTS command_rate_limits (
    telegram_user_id BIGINT NOT NULL,
    command TEXT NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_user_id, command)
);
