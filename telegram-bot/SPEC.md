# TrenchLabsHQ Telegram Bot — Complete Requirements Specification
# Version 1.0 — Build from scratch, no existing repo

=====================================================================
§0 — PRE-FLIGHT: REQUEST THESE FROM THE OPERATOR BEFORE STARTING
=====================================================================

Pause and request these before writing code. Do not proceed with placeholders.

  1. BOT_TOKEN                 — Telegram bot token from BotFather
  2. PRO_GROUP_ID              — numeric ID of private Pro supergroup (negative)
  3. MEMBER_GROUP_ID           — numeric ID of private Member supergroup (negative)
  4. PUBLIC_CHANNEL_ID         — numeric ID of public results channel (negative)
  5. PUBLIC_COMMUNITY_GROUP_ID — numeric ID of public community group (negative)
  6. HELIUS_API_KEY            — Helius API key for Solana reads
  7. GENESIS_MINT              — SPL mint address of $GENESIS
  8. GENESIS_DECIMALS          — on-chain decimals (6 or 9 — verify on-chain)
  9. ADMIN_USER_IDS            — comma-separated Telegram user IDs for admin cmds
  10. JOIN_URL                 — access-tiers page URL (e.g. trenchlabs.xyz/join)
  11. DEPLOYMENT_TARGET        — Fly.io / Railway / Render / VPS. Default: Fly.io

Confirm with operator that:
  - Bot is already admin in PRO_GROUP_ID and MEMBER_GROUP_ID with
    "Invite Users" and "Ban Users" permissions
  - Bot is already admin in PUBLIC_CHANNEL_ID with "Post Messages"
  - Bot is already admin in PUBLIC_COMMUNITY_GROUP_ID with
    "Delete Messages" and "Ban Users"

If any permission is missing → stop and report exact steps to fix.

=====================================================================
§1 — OBJECTIVE
=====================================================================

Build a Telegram bot that:

  a. Verifies Solana wallet ownership via an ed25519 signature and checks
     on-chain $GENESIS balance/stake.
  b. Issues single-use, expiring invite links to the Member group
     (>= $20 held) and Pro group (>= $250 staked for 90 days).
  c. Receives signal calls from the platform's web backend via an internal
     HTTP endpoint and pushes them to the Pro group real-time, the Member
     group with a 15-minute delay, and a teaser to the public community
     group.
  d. Pushes TP-hit / SL-hit follow-ups as replies to the original Pro-group
     message.
  e. Posts closed-call results to the public results channel.
  f. Re-verifies every active member every 6 hours with a 2-strike rule and
     removes lapsed members from the relevant group(s).
  g. Exposes /status and /getlink so users can check state and recover
     a lost invite.
  h. Enforces all of the above server-side. Never trusts user input for
     access decisions.

=====================================================================
§2 — ARCHITECTURE & ENTITIES
=====================================================================

Four Telegram entities, one bot, one Postgres database.

  PUBLIC_COMMUNITY_GROUP_ID — open, ungated. Teasers, Q&A, onboarding.
  PUBLIC_CHANNEL_ID         — broadcast only, no discussion. Closed results.
  MEMBER_GROUP_ID           — private supergroup, gated by $20 held.
  PRO_GROUP_ID              — private supergroup, gated by $250 staked 90d.

Membership rules:
  - Pro users are in PRO_GROUP_ID only (not Member — avoids duplicate msgs).
  - Member users are in MEMBER_GROUP_ID only.
  - Community group and Results channel are ungated (anyone can join).
  - Upgrade Member → Pro: kick from Member, invite to Pro.
  - Downgrade Pro → Member (stake expires, still holds $20): kick from Pro,
    invite back to Member.
  - Downgrade to nothing: kick from the gated group, no replacement invite.

The bot exposes two internal HTTP endpoints for the web platform to call:
  POST /internal/push-call     — new signal created
  POST /internal/push-result   — call closed / TP hit / SL hit
Both require header X-Internal-Secret. Never public.

Stack (locked — do not substitute):
  Python 3.11+
  python-telegram-bot v20+ (async, JobQueue enabled) — all bot handlers
  FastAPI + uvicorn — internal HTTP endpoints (bind 127.0.0.1)
  asyncpg + SQLAlchemy Core — Postgres
  helius SDK (or httpx to Helius RPC) — Solana reads
  PyNaCl (nacl) or solana-py — ed25519 signature verification
  pydantic-settings — typed env loading with secret redaction
  pytest + pytest-asyncio — tests
  Dockerfile + docker-compose.yml + Fly.io config (or target host)
  Alembic or raw SQL files in migrations/ — schema migrations
  Postgres 16 for both local (docker-compose) and production (Fly Postgres)

Do NOT use SQLite, in-memory stores, or Redis-only persistence. All state
that matters (cooldowns, warnings, members, invites, nonces) must survive
restarts and scale to multiple replicas later.

=====================================================================
§3 — ENVIRONMENT VARIABLES (fail fast if any required var is missing)
=====================================================================

Required:
  BOT_TOKEN
  PRO_GROUP_ID
  MEMBER_GROUP_ID
  PUBLIC_CHANNEL_ID
  PUBLIC_COMMUNITY_GROUP_ID
  ADMIN_USER_IDS
  HELIUS_API_KEY
  GENESIS_MINT
  GENESIS_DECIMALS
  JOIN_URL
  INTERNAL_SECRET
  DATABASE_URL
  BOOTSTRAP_OWNER_ID

Configurable with defaults:
  MEMBER_USD_THRESHOLD       = 20
  PRO_USD_THRESHOLD          = 250
  PRO_LOCK_DAYS              = 90
  MEMBER_DELAY_MINUTES       = 15
  RECALC_INTERVAL_HOURS      = 6
  INVITE_LINK_TTL_MINUTES    = 60
  TEASER_COOLDOWN_MINUTES    = 30
  TEASER_DAILY_CAP           = 6
  LOG_LEVEL                  = INFO

Never log secrets. Redact BOT_TOKEN, HELIUS_API_KEY, DATABASE_URL,
INTERNAL_SECRET in all log output.

=====================================================================
§4 — DATABASE SCHEMA (create on startup if not present)
=====================================================================

telegram_members
  telegram_user_id     bigint pk
  username             text
  wallet_address       text not null
  tier                 text not null                -- 'pro' | 'member'
  verified_at          timestamptz not null
  last_checked_at      timestamptz not null
  stake_usd_at_verify  numeric
  consecutive_failures int default 0
  status               text default 'active'        -- 'active' | 'removed'
  removed_at           timestamptz

verify_nonces
  telegram_user_id     bigint pk
  nonce                text not null
  message              text not null
  expires_at           timestamptz not null
  used                 boolean default false

invite_links
  id                   bigserial pk
  telegram_user_id     bigint
  target_group         text                         -- 'member' | 'pro'
  invite_link          text
  created_at           timestamptz
  expires_at           timestamptz
  used_at              timestamptz
  revoked              boolean default false

pushed_calls
  call_id              text pk                      -- from web platform
  telegram_message_id  bigint                       -- in Pro group
  ticker               text
  chain                text
  pushed_at            timestamptz

teaser_state
  id                   int pk default 1             -- singleton row
  last_teaser_at       timestamptz
  daily_count          int default 0
  daily_count_reset_at timestamptz

community_warnings
  telegram_user_id     bigint pk
  warning_count        int default 0
  muted_until          timestamptz
  banned               boolean default false
  last_warning_at      timestamptz

verify_events (audit log)
  id                   bigserial pk
  telegram_user_id     bigint
  wallet_address       text
  event_type           text                         -- 'verify'|'invite_issued'
                                                    -- 'join'|'kick'|'error'
                                                    -- 'teaser_posted'|'spam_deleted'
  payload              jsonb
  created_at           timestamptz default now()

Indexes:
  telegram_members(wallet_address)
  telegram_members(status)
  telegram_members(tier, status)
  verify_nonces(expires_at)
  invite_links(telegram_user_id, target_group)
  verify_events(created_at desc)

=====================================================================
§5 — WALLET SIGNATURE VERIFICATION (lib/sig.py)
=====================================================================

Protocol: ed25519 signature over a canonical message. This is the security
foundation — the operator will test this with a real wallet at Checkpoint 3.

CONSTANTS:
  SIG_MESSAGE_PREFIX = "TrenchLabsHQ-verify:"
  NONCE_TTL_SECONDS  = 300     (5 minutes)
  SIG_ALGORITHM      = "ed25519"

MESSAGE FORMAT:
  f"{SIG_MESSAGE_PREFIX}{nonce}:{timestamp}"

  Where:
    nonce     = secrets.token_hex(8)         → 16 lowercase hex chars
    timestamp = int(time.time())              → Unix seconds

  Example:
    "TrenchLabsHQ-verify:a7f3c9e1b2d40001:1730918400"

NONCE LIFECYCLE (in DB table verify_nonces):
  1. /verify generates nonce, timestamp, message; inserts a row keyed by
     telegram_user_id with expires_at = now() + NONCE_TTL_SECONDS.
  2. Only ONE active nonce per telegram_user_id — a new /verify overwrites
     the previous one (so users can't accumulate stale nonces).
  3. On successful verification, mark used=true. Rows with used=true or
     expires_at < now() are rejected.
  4. Cleanup job removes rows older than 1 hour every hour.

FUNCTION SIGNATURE:

  async def verify_signature(
      wallet_address: str,
      message: str,
      signature_b64: str,
  ) -> bool:
      """
      Verify that signature_b64 is a valid ed25519 signature over message,
      produced by the private key corresponding to wallet_address.

      Returns True iff:
        - wallet_address decodes to exactly 32 bytes (base58)
        - signature_b64 decodes to exactly 64 bytes (base64)
        - nacl.signing.VerifyKey(wallet_bytes).verify(message_bytes, sig_bytes)
          succeeds without raising BadSignatureError

      Returns False on any decode error or signature mismatch.
      Raises SignatureFormatError only if inputs are structurally invalid
      (wrong length, not decodable) — caller should treat that as a failed
      attempt and reply "Invalid format — try /verify again."
      """

  IMPLEMENTATION NOTES:
    - Use base58 (from `solana` package or `base58`) to decode wallet.
      Validate length == 32 bytes. If not, return False.
    - Use `base64.b64decode(signature_b64, validate=True)` to decode sig.
      Validate length == 64 bytes. If not, return False.
    - Message bytes: message.encode("utf-8"). Do NOT hash or modify.
    - Use nacl.signing.VerifyKey(wallet_bytes).verify(message_bytes,
      sig_bytes) which raises nacl.exceptions.BadSignatureError on failure.
    - IMPORTANT: ed25519 does NOT support public key recovery from a
      signature. The wallet address MUST be supplied by the user. The
      security property comes from verifying the signature against the
      claimed address — a valid signature from a DIFFERENT keypair will
      NOT verify against the claimed address, so claiming someone else's
      wallet address will fail.

WHY THIS IS SECURE:
  - An attacker who claims wallet X must produce a signature over the
    nonce message that verifies under X's public key. Only the holder of
    X's private key can do this. Claiming a whale's address without the
    private key results in BadSignatureError → rejected.
  - The nonce prevents replay: a signature captured from a previous
    /verify cannot be reused for a future /verify because the message
    (which contains the new nonce) differs.
  - The timestamp is cosmetic (defense-in-depth + audit trail); the nonce
    is what enforces single-use.

=====================================================================
§6 — ON-CHAIN VERIFICATION (lib/verify.py)
=====================================================================

async def get_token_balance(wallet: str) -> Decimal:
    """
    Query all SPL token accounts owned by wallet for GENESIS_MINT, sum raw
    amounts, divide by 10**GENESIS_DECIMALS.
    Return Decimal("0") if wallet holds no GENESIS.
    On RPC error: RAISE VerifyRPCError — never return 0.
    """

async def get_stake_usd(wallet: str) -> Decimal:
    """
    Read active stakes from the `stakes` table (populated by the web
    platform's staking flow) joined on wallet_address, status='active',
    unlocks_at > now(). Sum USD value.
    Optionally cross-check against on-chain staking program account.
    Return Decimal("0") if no active stake.
    On RPC error: RAISE VerifyRPCError.
    """

async def get_twap_price_usd() -> Decimal:
    """
    7-day TWAP of $GENESIS via Helius price API / Jupiter / Birdeye.
    Cache result 1 hour.
    NEVER use live spot for threshold comparisons.
    On error: RAISE VerifyRPCError.
    """

async def resolve_tier(wallet: str) -> dict:
    """
    held_usd  = (await get_token_balance(wallet)) * (await get_twap_price_usd())
    stake_usd = await get_stake_usd(wallet)

    if stake_usd >= PRO_USD_THRESHOLD:
        tier = "pro"
        next_tier = None
        gap_usd = Decimal("0")
    elif held_usd >= MEMBER_USD_THRESHOLD:
        tier = "member"
        next_tier = "pro"
        gap_usd = PRO_USD_THRESHOLD - stake_usd
    else:
        tier = None
        next_tier = "member"
        gap_usd = MEMBER_USD_THRESHOLD - held_usd

    return {
        "tier": tier,
        "held_usd": held_usd,
        "stake_usd": stake_usd,
        "next_tier": next_tier,
        "gap_usd": gap_usd,
    }

RULES:
  - On-chain state is the only source of truth.
  - Never accept a wallet address or balance from a request body without
    a valid signature proving ownership.
  - Never downgrade a user because the RPC failed — raise and let the
    caller surface "retry, network error."

=====================================================================
§7 — VERIFICATION FLOW (/verify)
=====================================================================

STEP 1 — /start
  Bot: "Welcome to TrenchLabsHQ. To verify your wallet:
        1. Send /verify
        2. I'll give you a message to sign in Phantom/Solflare/Backpack
        3. Paste back the signature. Expires in 5 minutes."

STEP 2 — /verify
  Bot (server-side):
    - nonce = secrets.token_hex(8)
    - timestamp = int(time.time())
    - message = f"TrenchLabsHQ-verify:{nonce}:{timestamp}"
    - Insert (overwrite) row in verify_nonces keyed by telegram_user_id
      with used=false, expires_at = now() + 300s
  Bot replies:
    "Sign this exact message in your wallet:
     {message}
     Then reply with:
     /sig <your_wallet_address> <base64_signature>
     Expires in 5 minutes. Do not sign this message anywhere except here."

STEP 3 — /sig <wallet> <signature_b64>
  Bot (server-side):
    a. Look up nonce for telegram_user_id. If missing / used / expired:
       "No pending verification. Run /verify first."
    b. Call verify_signature(wallet, message, signature_b64).
       If invalid:
       "Signature did not verify. Make sure you signed the exact message
        shown above with the wallet whose address you provided. Run /verify
        to try again."
    c. Mark nonce used=true.
    d. Call resolve_tier(wallet).
    e. Route based on result:

       IF tier == "pro":
           - issue_invite("pro", telegram_user_id) → link
           - If user is in MEMBER_GROUP_ID: kick from Member
           - Upsert telegram_members row (tier='pro')
           - DM: "✅ Verified as Pro. Join the Pro signals group:
                  {link}
                  (single use, expires in 60 minutes)"
       ELIF tier == "member":
           - issue_invite("member", telegram_user_id) → link
           - If user is in PRO_GROUP_ID: kick from Pro
           - Upsert telegram_members row (tier='member')
           - DM: "✅ Verified as Member. Join the community group:
                  {link}
                  (single use, expires in 60 minutes).
                  Stake $250 for 90 days to unlock Pro signals."
       ELSE (below both thresholds):
           - No invite
           - DM: "You hold $X of $GENESIS. You need $20 held for Member,
                  or $250 staked for 90 days for Pro.
                  Buy $GENESIS: {BUY_URL}
                  Your current gap: ${gap} more to reach Member."

STEP 4 — On chat_member join event (any gated group):
  - Match invite link name → telegram_user_id → mark invite_links.used_at
  - Log verify_event 'join'
  - If user joins MEMBER while telegram_members.tier='pro' (shouldn't
    happen since we kicked them) → kick and warn

Rule: no path into a gated group without a signature-verified wallet whose
stake/hold meets the threshold.

=====================================================================
§8 — BOT COMMANDS
=====================================================================

User-facing:
  /start    — welcome, tier explainer, "run /verify to begin"
  /verify   — generate nonce + message
  /sig <wallet> <signature_b64> — submit signature
  /status   — current tier, wallet, held_usd, stake_usd, unlocks_in (if pro),
              gap to next tier, which group to be in
  /getlink  — re-issue current tier invite (rate-limit 1 per 10 min)

Admin-only (ADMIN_USER_IDS):
  /members   — count of active members by tier
  /checkall  — trigger immediate re-verification cycle
  /kick <id> — manually remove a member (ban+unban)
  /diag      — check bot is admin in all 4 entities, report missing perms

All handlers async. Global error handler logs to verify_events and replies
with a friendly message. Never leak stack traces.

Rate limits:
  /verify   — 5 per user per hour
  /sig      — 10 per user per hour (some users will need retries)
  /getlink  — 6 per user per hour

=====================================================================
§9 — INVITE LINKS (lib/invites.py)
=====================================================================

async def issue_invite(target_group: str, telegram_user_id: int) -> str:
    """
    target_group ∈ {'member', 'pro'}
    chat_id = env var based on target_group
    Revoke any existing unused unexpired link for this user + group.
    link = bot.create_chat_invite_link(
        chat_id=chat_id,
        member_limit=1,
        expire_date=int((now + INVITE_LINK_TTL_MINUTES*60).timestamp()),
        name=f"u{telegram_user_id}-{target_group}-{int(time.time())}"
    )
    Persist to invite_links, log 'invite_issued'
    Return link.invite_link
    """

async def kick_member(target_group: str, telegram_user_id: int, reason: str):
    """
    chat_id = env var based on target_group
    await bot.ban_chat_member(chat_id, user_id)
    await bot.unban_chat_member(chat_id, user_id, only_if_banned=True)
    Mark telegram_members.status='removed', removed_at=now() (if this was
    the tier they were being kicked from)
    Log 'kick' with reason
    DM the user with the reason + how to return
    """

Rules:
  - Every invite has member_limit=1 AND expire_date set.
  - Kick uses ban+unban (not ban alone) so re-staking users can return.
  - Never add users to groups directly — Telegram forbids it. Invite links only.

=====================================================================
§10 — SIGNAL PUSH (/internal/push-call)
=====================================================================

FastAPI endpoint, X-Internal-Secret header required, bound to 127.0.0.1.

Payload from web (exactly these fields, nothing more):
{
  "call_id": "abc123",
  "ticker": "WIF",
  "chain": "solana",
  "entry_price": "0.0001",
  "stop_loss": "0.00007",
  "contract_address": "WIFxxxx...",
  "dashboard_deeplink": "https://trenchlabs.xyz/calls/abc123",
  "priority": "normal"
}

CRITICAL: The bot NEVER receives take_profits, multipliers, risk_ratio,
thesis, or analyst stats. Those live on the web only. This is the boundary
that guarantees the bot cannot leak them even if compromised.

Handler:
  1. Validate X-Internal-Secret.
  2. Validate payload (required fields present, CA format sane).
  3. Post to PRO_GROUP_ID (protect_content=True):
       🚨 NEW CALL — ${ticker} ({chain})

       Entry: ${entry_price}
       SL: ${stop_loss}

       CA: {contract_address}
       [Copy button callback_data=f"copy:{call_id}"]

       🎯 Targets, thesis & tracker →
       {dashboard_deeplink}

       ⚠️ Not financial advice
  4. Store (call_id, telegram_message_id, ticker, chain, pushed_at) in
     pushed_calls. If call_id already exists → 409 (idempotency).
  5. Schedule Member-group post via JobQueue after MEMBER_DELAY_MINUTES
     (protect_content=False so Members can share — this is by design):
       Same message as above, prefixed with "⏱ 15-min delay" tag.
  6. Fire teaser to PUBLIC_COMMUNITY_GROUP_ID (see §13).
  7. Return 200 {"ok": true, "pro_message_id": <id>}.

Copy button handler:
  - On callback_data="copy:<call_id>": reply in the same chat with the CA
    in a monospace code block so the user can long-press to copy.
  - Use copy_text inline button if python-telegram-bot version supports it.

=====================================================================
§11 — TP-HIT / SL-HIT / RESULT (/internal/push-result)
=====================================================================

FastAPI endpoint, X-Internal-Secret header required.

TP-hit payload:
  { "call_id", "event": "tp_hit", "tp_label": "TP1", "multiplier": "2.0x" }

Handler:
  - Look up pushed_calls.telegram_message_id
  - Reply in PRO_GROUP_ID with reply_to_message_id:
      "✅ TP1 HIT — ${ticker} +100% (2x)
       Remaining targets → {dashboard_deeplink}"
  - protect_content=True
  - Do NOT post to Member group or community group

SL-hit payload:
  { "call_id", "event": "sl_hit", "loss_pct": "-30%" }

Handler:
  - Reply in PRO_GROUP_ID:
      "❌ SL HIT — ${ticker} -30%
       Full post-mortem → {dashboard_deeplink}"
  - protect_content=True

Closed payload:
  { "call_id", "event": "closed", "entry", "exit", "pnl_pct",
    "proof_url", "closed_at" }

Handler:
  - Post to PUBLIC_CHANNEL_ID (no protect_content — this is marketing):
      Win:  "✅ ${ticker} closed: entry ${entry} → exit ${exit}
             (+${pnl_pct}%).
             Proof: {proof_url}
             Pro members got this in real time."
      Loss: "❌ ${ticker} closed at ${pnl_pct}%.
             Proof: {proof_url}
             Full ledger → {PUBLIC_LEDGER_URL}"
  - Include losses. A track record with only wins is not credible.
  - Reply in PRO_GROUP_ID to the original call with the same result
    (protect_content=True there).

=====================================================================
§12 — PERIODIC RE-VERIFICATION (JobQueue, every 6h)
=====================================================================

async def reverify_all(context):
    for row in telegram_members where status='active':
        try:
            result = await resolve_tier(row.wallet_address)
        except VerifyRPCError:
            # DO NOT increment failures on RPC error
            log.warn(f"reverify skipped {row.wallet_address}: RPC error")
            continue

        if result.tier == row.tier or \
           (row.tier == 'member' and result.tier == 'pro'):
            # Still valid or upgraded
            update last_checked_at=now(), stake_usd_at_verify=result.stake_usd,
                   consecutive_failures=0
            if row.tier == 'member' and result.tier == 'pro':
                await upgrade_to_pro(row)
        else:
            new_failures = row.consecutive_failures + 1
            if new_failures >= 2:
                await kick_member(row.tier, row.telegram_user_id,
                                  reason='threshold_not_met')
                if row.tier == 'pro' and result.tier == 'member':
                    link = await issue_invite('member', row.telegram_user_id)
                    await dm(row.telegram_user_id,
                             f"Pro access ended — stake below $250.\n"
                             f"Rejoin Member group: {link}")
            else:
                update consecutive_failures=new_failures

Two-strike rule: a single RPC hiccup must never kick a paying user.
Two consecutive failed checks 6h apart means the stake truly dropped.

Also register a JobQueue job to revoke expired invite_links every hour
and clean up used/expired verify_nonces every hour.

=====================================================================
§13 — PUBLIC COMMUNITY TEASERS
=====================================================================

On every successful /internal/push-call (after Pro post succeeds), attempt
a teaser to PUBLIC_COMMUNITY_GROUP_ID.

TEASER MESSAGE:
  🚨 NEW ALPHA CALL POSTED

  A new high-conviction call just dropped for Pro members.

  📊 Entry · SL · Targets · Thesis
  🔒 Verified members only

  👉 View access tiers → {JOIN_URL}

  ⚠️ Not financial advice. Past performance ≠ future results.

TEASER MUST NOT INCLUDE:
  - ticker / token name
  - contract address
  - chain
  - entry price
  - stop loss
  - take profit levels
  - direction or confidence
  - dashboard deeplink (only generic JOIN_URL)

The teaser contains exactly: "a call happened", "it's for Pro members",
a JOIN_URL, and a disclaimer. Nothing more.

FREQUENCY CONTROLS (in the bot, not the platform):
  - Min 30 minutes between teaser posts (TEASER_COOLDOWN_MINUTES)
  - Max 6 teasers per rolling 24h (TEASER_DAILY_CAP)
  - If a call is created during cooldown or at the cap → SUPPRESS the
    teaser (do not queue — a stale teaser is worse than no teaser)
  - Never post teasers for TP hits, SL hits, or closed calls
  - Reset daily_count when daily_count_reset_at < now() - 24h

State: teaser_state table (singleton row) with last_teaser_at,
daily_count, daily_count_reset_at.

ANTI-SPAM in PUBLIC_COMMUNITY_GROUP_ID (auto-moderation):
  On any message in the community group, check text content. If it
  contains ANY of:
    - base58 string >= 32 chars (contract address pattern)
    - "t.me/" link
    - wallet address pattern (base58 >= 32 chars, standalone)
    - a URL not in the allowlist (JOIN_URL, official site, docs)
  → delete the message (bot.delete_message)
  → increment community_warnings.warning_count for the sender
  → reply "Removed: community group doesn't allow CA/link sharing"
  → if warning_count >= 2 → mute 24h (restrictChatMember with
    until_date = now + 24h, can_send_messages=False)
  → if warning_count >= 3 → ban (banChatMember + unban, but set
    community_warnings.banned=true so a rejoin isn't auto-cleared)
  → log verify_event 'spam_deleted' with payload

The bot must be admin with "Delete messages" + "Ban users" in the
community group for this to work. Startup self-check verifies this.

=====================================================================
§14 — STARTUP SELF-CHECK (main.py)
=====================================================================

On startup, before serving traffic, the bot MUST:

  1. bot.get_me() — confirm token is valid. Log bot username.
  2. For each of PRO_GROUP_ID, MEMBER_GROUP_ID:
       member = await bot.get_chat_member(chat_id, bot.id)
       assert member.status == 'administrator'
       assert member.can_invite_users
       assert member.can_restrict_members
  3. For PUBLIC_CHANNEL_ID:
       assert bot can post messages (get_chat_member, can_post_messages)
  4. For PUBLIC_COMMUNITY_GROUP_ID:
       assert bot is admin with can_delete_messages and can_restrict_members
  5. DM BOOTSTRAP_OWNER_ID: "TrenchLabsHQ bot online. Self-check passed."
     Include a one-line summary of each entity (name + id).

On any failure: log the exact missing permission with UI steps to fix,
then exit(1). Do NOT start with missing permissions and hope someone
notices later.

=====================================================================
§15 — SECURITY NON-NEGOTIABLES
=====================================================================

☐ No secret is hardcoded or logged. Use pydantic-settings + log redaction.
☐ Every message to PRO_GROUP_ID uses protect_content=True.
  Enforce via send_pro(text, **kwargs) wrapper; add a unit test that greps
  the codebase and fails if any direct bot.send_message(PRO_GROUP_ID) call
  bypasses the wrapper.
☐ Every invite link has member_limit=1 AND expire_date set.
☐ Wallet ownership is proven by ed25519 signature before any invite is
  issued. Wallet address is claimed by the user, but the signature verifies
  under that address's public key — claiming someone else's address fails.
☐ Nonces are single-use and expire in 5 minutes.
☐ /internal/* endpoints require X-Internal-Secret AND bind to 127.0.0.1
  (or behind the platform's reverse proxy). Never public.
☐ Telegram user cannot become a member without a verified wallet row.
☐ Kicks use ban+unban (so re-staking users can return).
☐ RPC failures NEVER cause a kick. Two-strike rule.
☐ Public channel posts never contain open-call data (no entry, no TP,
  no live CA for an unclosed call).
☐ Community teasers never contain ticker, CA, chain, entry, SL, TP,
  direction, or a deeplink.
☐ Admin commands check ADMIN_USER_IDS (not just "user is in group").
☐ All user input is HTML-escaped before rendering in Telegram.
☐ /verify, /sig, /getlink rate-limited.
☐ The bot's process never logs full call payloads — only call_id,
  ticker, chain.

=====================================================================
§16 — ACCEPTANCE TESTS (write these as automated tests)
=====================================================================

  1. Startup self-check exits(1) when bot lacks admin perms in any of the
     4 entities.
  2. verify_signature returns True for a known-good ed25519 signature over
     a fixed message; returns False for a signature from a different keypair.
  3. verify_signature raises SignatureFormatError on malformed inputs
     (wrong base58 length, wrong base64 length, non-decodable).
  4. /verify with an expired nonce → rejected with "run /verify first".
  5. /verify with an already-used nonce → rejected.
  6. /sig with a valid signature for wallet A but user claims wallet B
     → verify_signature fails (signature doesn't verify under B's key)
     → no invite issued.
  7. /sig with a valid signature from a wallet holding < $20 → no invite,
     DM shows gap.
  8. /sig with a valid signature, wallet holds >= $20 but stakes < $250
     → Member invite only, single-use, expires in 60 min.
  9. /sig with a valid signature, wallet stakes >= $250 → Pro invite only;
     if user was in Member group, they are kicked from it.
  10. POST /internal/push-call without X-Internal-Secret → 403.
  11. POST /internal/push-call with valid payload → message appears in
      PRO_GROUP_ID within 5s with protect_content=true (verify by
      attempting to forward from a test account — should fail); scheduled
      job fires MEMBER_DELAY_MINUTES later to MEMBER_GROUP_ID.
  12. POST /internal/push-call → teaser appears in PUBLIC_COMMUNITY_GROUP_ID
      within 5s. Assert the teaser text does NOT contain ticker, CA, chain,
      entry, SL, TP, or dashboard_deeplink. Only JOIN_URL and generic text.
  13. Two calls within 30 min → only one teaser posted (cooldown).
  14. Seven calls in 24h → only 6 teasers posted (daily cap).
  15. TP-hit payload → reply in PRO_GROUP_ID to the original message_id;
      no teaser to community group.
  16. Closed payload → post in PUBLIC_CHANNEL_ID with proof_url; no live CA.
  17. Re-verify with one member whose stake dropped: first cycle increments
      failures, second cycle kicks. RPC error on first cycle does NOT
      increment failures.
  18. Kicked user re-stakes and runs /verify → gets fresh invite (proves
      ban+unban and re-entry).
  19. Post a message in PUBLIC_COMMUNITY_GROUP_ID containing a fake CA →
      bot deletes it and warns the sender. Second violation → mute.
      Third → ban.
  20. Unit test fails the build if any code path calls bot.send_message
      with PRO_GROUP_ID without protect_content=True.
  21. 6th /verify in an hour → friendly throttle message.
  22. Logs captured during tests contain no secrets (grep BOT_TOKEN,
      HELIUS_API_KEY, DATABASE_URL, INTERNAL_SECRET).

=====================================================================
§17 — EXECUTION ORDER (build in this order, test each step)
=====================================================================

Step 1: Scaffold
  - pyproject.toml, requirements.txt, .env.example, README.md, .gitignore
  - Dockerfile + docker-compose.yml (bot + Postgres 16 for local dev)
  - fly.toml (or target-host config) + a separate Fly Postgres attachment
  - Directory structure:
      bot/          (handlers, telegram_application builder)
      lib/          (verify.py, sig.py, invites.py, db.py, config.py)
      api/          (FastAPI app, /internal/* routes)
      migrations/   (SQL or alembic)
      tests/
  - .env.example with all §3 vars named (no values)

Step 2: Foundation
  - config.py (pydantic-settings, redaction)
  - db.py (asyncpg pool, migration runner on startup)
  - lib/sig.py + unit tests (§5) — wallet decoding, sig verification,
    format error handling
  - lib/verify.py + unit tests (mocked Helius client) — balance math,
    TWAP, resolve_tier branches

Step 3: Bot skeleton
  - main.py with startup self-check (§14)
  - /start, /help, global error handler
  - /diag admin command
  - Verify bot boots, self-check passes, /diag reports green

Step 4: Verification flow
  - /verify, /sig handlers
  - lib/invites.py (single-use invite creation, revocation of old)
  - Integration test: mock Helius, drive /verify → /sig → assert invite
    issued with member_limit=1

Step 5: Group management
  - chat_member event handler (mark invite used, upsert member row)
  - kick_member with ban+unban
  - send_pro / send_member / send_channel wrappers with protect_content
    rules
  - Lint test: greps for direct bot.send_message(PRO_GROUP_ID)

Step 6: Signal push
  - FastAPI app with /internal/push-call, /internal/push-result
  - X-Internal-Secret middleware
  - Pro-group push + pushed_calls persistence
  - Member-group delayed post via JobQueue
  - Idempotency on call_id (409 on duplicate)

Step 7: Follow-ups + results
  - TP-hit / SL-hit replies via pushed_calls.telegram_message_id
  - Closed-call public channel post (no protect_content, includes losses)

Step 8: Re-verification
  - JobQueue job every RECALC_INTERVAL_HOURS with 2-strike rule
  - Upgrade path (Member → Pro)
  - Downgrade path (Pro → Member)
  - Expired invite cleanup job
  - Nonce cleanup job

Step 9: Public community teasers + anti-spam
  - Teaser logic with cooldown + daily cap (§13)
  - Anti-spam auto-moderation for community group (§13)
  - Tests 12–15, 19

Step 10: Tests + docs
  - All §16 acceptance tests pass
  - README with:
    * How to add the bot to groups and grant admin perms (UI steps)
    * Env var reference (all §3 vars)
    * Deployment steps for the target host
    * How the web platform calls /internal/push-call (curl example)
    * How the web platform calls /internal/push-result (curl examples
      for tp_hit, sl_hit, closed)

Step 11: Deploy
  - Deploy to Fly.io (or target host)
  - Provision Fly Postgres and attach
  - Set all env vars via `fly secrets set`
  - Run startup self-check in production — must pass
  - DM BOOTSTRAP_OWNER_ID confirming online

=====================================================================
§18 — CHECKPOINTS (pause and report at each)
=====================================================================

Checkpoint 1 — Repo created, Step 1 + Step 2 complete, sig/verify unit
                tests passing.
                Report: repo URL, test output for lib/sig + lib/verify.

Checkpoint 2 — Step 3 complete. Bot boots, startup self-check passes
                against all 4 real Telegram entities.
                Report: screenshot of /diag output, log of self-check.

Checkpoint 3 — Steps 4 + 5 complete. /verify → /sig → invite works
                end-to-end with a real wallet signature.
                Report: DM transcript of the exchange, invite link
                properties (member_limit, expiry).

Checkpoint 4 — Steps 6 + 7 complete. push-call reaches all 3 destination
                groups (Pro real-time, Member delayed, Community teaser).
                Report: screenshots of each group after a test push.

Checkpoint 5 — Steps 8 + 9 complete. Re-verification, teasers, and
                anti-spam all work.
                Report: test output for §16 tests 12–19.

Checkpoint 6 — Step 10 + 11 complete. Full acceptance suite passing,
                deployed, online.
                Report: full test output, deployment URL, DM confirmation.

If any checkpoint fails or reveals a spec gap → stop and report. Do not
patch around it silently.

=====================================================================
§19 — FINAL REPORT (what to send when done)
=====================================================================

  - Repo URL
  - Deployment URL / host
  - .env var checklist (names only, no values) and which are set
  - Test run summary per §16 (pass/fail for each)
  - Screenshots of:
      * /diag output
      * /verify → /sig DM exchange with a real signature
      * A test call pushed to all 3 groups
      * A test kick + re-invite flow
      * A test teaser with no leaked fields
  - Spec ambiguities resolved: list each and the choice made
  - Known limitations / deferred features (e.g., "DMs for high-priority
    calls deferred", "USDC subscriptions not implemented")

Do not build outside this spec. Do not add referral systems, analytics
dashboards, or USDC subscription flows. Build exactly what is described,
with tests, and make the signature-proof + per-group re-verification
model unbypassable. - Full spec attached as SPEC.md — this consolidates all sections (§0–§19)
including the wallet-signature protocol (§5), DB schemas (§4), execution
order (§17), and acceptance tests (§16).

The signature protocol is now explicitly defined in §5: ed25519,
message format "TrenchLabsHQ-verify:{nonce}:{timestamp}", wallet address
supplied by the user, verified against the claimed address. You can build
meaningful signature tests from this — test vectors are described in §16
items 2–3.

Proceed with Step 1 (scaffold) + Step 2 (foundation). You can do these
before I supply the §0 credentials, since they don't require live
Telegram or Helius access — only the .env.example structure and the
mock-based unit tests. Pause at Checkpoint 1 with the repo URL and test
output.

I will supply §0 credentials after you confirm the scaffold is in place.