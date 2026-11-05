CREATE TABLE IF NOT EXISTS member_call_deliveries (
    call_id TEXT PRIMARY KEY REFERENCES pushed_calls(call_id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    deliver_at TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_member_call_deliveries_due
    ON member_call_deliveries(deliver_at) WHERE delivered_at IS NULL;
