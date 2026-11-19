from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass
from decimal import Decimal
from html import escape

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import ContextTypes

from bot.selfcheck import check_telegram_permissions
from lib.config import Settings
from lib.invites import InviteService
from lib.repository import Repository
from lib.sig import NONCE_TTL_SECONDS, SIG_MESSAGE_PREFIX, SignatureFormatError, verify_signature
from lib.verify import VerificationService, VerifyRPCError

logger = logging.getLogger(__name__)


@dataclass
class HandlerServices:
    settings: Settings
    repository: Repository
    verifier: VerificationService
    invites: InviteService


def services(context: ContextTypes.DEFAULT_TYPE) -> HandlerServices:
    return context.application.bot_data["services"]


def user_id(update: Update) -> int:
    if not update.effective_user:
        raise ValueError("No effective Telegram user")
    return update.effective_user.id


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "Welcome to TrenchLabsHQ. To verify your wallet:\n"
        "1. Send /verify\n2. Sign the message in Phantom, Solflare, or Backpack\n"
        "3. Reply with /sig <wallet_address> <base64_signature>\n"
        "The message expires in 5 minutes. Run /help for commands."
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "Commands: /verify, /sig <wallet> <signature_b64>, /status, /getlink. "
        "Verification uses a single-use signed nonce."
    )


async def verify_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = user_id(update)
    svc = services(context)
    if not await svc.repository.consume_rate_limit(uid, "verify", 5):
        await update.effective_message.reply_text("Rate limit reached. Please try again later.")
        return
    repo = svc.repository
    nonce = secrets.token_hex(8)
    timestamp = int(time.time())
    message = f"{SIG_MESSAGE_PREFIX}{nonce}:{timestamp}"
    await repo.issue_nonce(uid, nonce, message, NONCE_TTL_SECONDS)
    await repo.log_event("verify", telegram_user_id=uid)
    await update.effective_message.reply_text(
        "Sign this exact message in your wallet:\n"
        f"<code>{escape(message)}</code>\n"
        "Then reply with:\n<code>/sig &lt;your_wallet_address&gt; &lt;base64_signature&gt;</code>\n"
        "Expires in 5 minutes. Do not sign this message anywhere except here.",
        parse_mode=ParseMode.HTML,
    )


async def sig_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = user_id(update)
    svc = services(context)
    if not await svc.repository.consume_rate_limit(uid, "sig", 10):
        await update.effective_message.reply_text("Rate limit reached. Please try again later.")
        return
    pending = await svc.repository.get_pending_nonce(uid)
    if not pending:
        await update.effective_message.reply_text("No pending verification. Run /verify first.")
        return
    if len(context.args) != 2:
        await update.effective_message.reply_text(
            "Usage: /sig <your_wallet_address> <base64_signature>"
        )
        return
    wallet, signature = context.args
    try:
        valid = await verify_signature(wallet, pending["message"], signature)
    except SignatureFormatError:
        await update.effective_message.reply_text("Invalid format — try /verify again.")
        return
    if not valid:
        await update.effective_message.reply_text(
            "Signature did not verify. Make sure you signed the exact message shown above "
            "with the wallet whose address you provided. Run /verify to try again."
        )
        return
    if not await svc.repository.consume_nonce(uid, pending["nonce"]):
        await update.effective_message.reply_text("No pending verification. Run /verify first.")
        return
    try:
        tier_info = await svc.verifier.resolve_tier(wallet)
    except VerifyRPCError:
        await update.effective_message.reply_text("Verification network error. Please retry shortly.")
        return
    tier = tier_info["tier"]
    username = update.effective_user.username if update.effective_user else None
    if tier == "pro":
        link = await svc.invites.issue_invite("pro", uid)
        await svc.invites.kick_member("member", uid, "upgraded_to_pro")
        await svc.repository.upsert_member(uid, username, wallet, "pro", tier_info["stake_usd"])
        await svc.repository.log_event("verify", telegram_user_id=uid, wallet_address=wallet,
                                       payload={"tier": "pro"})
        await update.effective_message.reply_text(
            f"✅ Verified as Pro. Join the Pro signals group:\n{escape(link)}\n"
            f"(single use, expires in {svc.settings.invite_link_ttl_minutes} minutes)"
        )
    elif tier == "member":
        link = await svc.invites.issue_invite("member", uid)
        await svc.invites.kick_member("pro", uid, "downgraded_to_member")
        await svc.repository.upsert_member(uid, username, wallet, "member", tier_info["stake_usd"])
        await svc.repository.log_event("verify", telegram_user_id=uid, wallet_address=wallet,
                                       payload={"tier": "member"})
        await update.effective_message.reply_text(
            f"✅ Verified as Member. Join the community group:\n{escape(link)}\n"
            f"(single use, expires in {svc.settings.invite_link_ttl_minutes} minutes). "
            "Stake $250 for 90 days to unlock Pro signals."
        )
    else:
        await svc.repository.log_event("verify", telegram_user_id=uid, wallet_address=wallet,
                                       payload={"tier": None})
        await update.effective_message.reply_text(
            f"You hold ${tier_info['held_usd']:.2f} of $GENESIS. You need "
            f"${svc.settings.member_usd_threshold:.0f} held for Member, or "
            f"${svc.settings.pro_usd_threshold:.0f} staked for {svc.settings.pro_lock_days} days "
            f"for Pro.\nBuy $GENESIS: {svc.settings.buy_url}\n"
            f"Your current gap: ${tier_info['gap_usd']:.2f} more to reach Member."
        )


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = user_id(update)
    svc = services(context)
    row = await svc.repository.get_member(uid)
    if not row or row["status"] != "active":
        await update.effective_message.reply_text("No active verified membership. Run /verify to check access.")
        return
    try:
        result = await svc.verifier.resolve_tier(row["wallet_address"])
    except VerifyRPCError:
        await update.effective_message.reply_text("Status temporarily unavailable due to a network error. Please retry.")
        return
    await update.effective_message.reply_text(
        f"Tier: {row['tier'].title()}\nWallet: <code>{escape(row['wallet_address'])}</code>\n"
        f"Held value: ${result['held_usd']:.2f}\nStake: ${result['stake_usd']:.2f}\n"
        f"Next tier: {result['next_tier'] or 'Top tier'}\nGap: ${result['gap_usd']:.2f}\n"
        f"Group: {row['tier'].title()} group",
        parse_mode=ParseMode.HTML,
    )


async def getlink_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = user_id(update)
    svc = services(context)
    if not await svc.repository.consume_rate_limit(uid, "getlink_short", 1, 600):
        await update.effective_message.reply_text("Please wait 10 minutes before requesting another invite.")
        return
    if not await svc.repository.consume_rate_limit(uid, "getlink", 6):
        await update.effective_message.reply_text("Rate limit reached. Please try again later.")
        return
    row = await svc.repository.get_member(uid)
    if not row or row["status"] != "active":
        await update.effective_message.reply_text("No active verified membership. Run /verify first.")
        return
    link = await svc.invites.issue_invite(row["tier"], uid)
    await update.effective_message.reply_text(
        f"Fresh {row['tier'].title()} invite (single use, expires in "
        f"{svc.settings.invite_link_ttl_minutes} minutes):\n{escape(link)}"
    )


async def is_admin(update: Update, settings: Settings) -> bool:
    return bool(update.effective_user and update.effective_user.id in settings.admin_user_ids)


async def members_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    svc = services(context)
    if not await is_admin(update, svc.settings):
        await update.effective_message.reply_text("Not authorized.")
        return
    counts = await svc.repository.count_members_by_tier()
    await update.effective_message.reply_text(
        f"Active members — Pro: {counts.get('pro', 0)}, Member: {counts.get('member', 0)}"
    )


async def diag_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    svc = services(context)
    if not await is_admin(update, svc.settings):
        await update.effective_message.reply_text("Not authorized.")
        return
    result = await check_telegram_permissions(context.bot, svc.settings)
    await update.effective_message.reply_text("\n".join(result.lines))


async def kick_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    svc = services(context)
    if not await is_admin(update, svc.settings):
        await update.effective_message.reply_text("Not authorized.")
        return
    if len(context.args) != 1 or not context.args[0].lstrip("-").isdigit():
        await update.effective_message.reply_text("Usage: /kick <telegram_user_id>")
        return
    target_id = int(context.args[0])
    row = await svc.repository.get_member(target_id)
    if not row:
        await update.effective_message.reply_text("No matching member record.")
        return
    await svc.invites.kick_member(row["tier"], target_id, "admin_action")
    await update.effective_message.reply_text(f"Removed user {target_id} from {row['tier']} group.")


async def checkall_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    svc = services(context)
    if not await is_admin(update, svc.settings):
        await update.effective_message.reply_text("Not authorized.")
        return
    context.application.create_task(reverify_all(context))
    await update.effective_message.reply_text("Re-verification cycle started.")


async def reverify_all(context: ContextTypes.DEFAULT_TYPE) -> None:
    svc: HandlerServices = context.application.bot_data["services"]
    for row in await svc.repository.active_members():
        uid = row["telegram_user_id"]
        try:
            result = await svc.verifier.resolve_tier(row["wallet_address"])
        except VerifyRPCError:
            logger.warning("reverify skipped user_id=%s reason=rpc_error", uid)
            continue
        current, new = row["tier"], result["tier"]
        if new == current or (current == "member" and new == "pro"):
            await svc.repository.update_member_check(uid, result["stake_usd"], 0)
            if current == "member" and new == "pro":
                await svc.invites.kick_member("member", uid, "upgraded_to_pro")
                link = await svc.invites.issue_invite("pro", uid)
                await svc.repository.set_member_tier(uid, "pro")
                try:
                    await context.bot.send_message(uid, f"You upgraded to Pro. Join: {escape(link)}")
                except Exception:
                    pass
            continue
        failures = int(row["consecutive_failures"]) + 1
        if failures < 2:
            await svc.repository.update_member_check(uid, result["stake_usd"], failures)
            continue
        await svc.invites.kick_member(current, uid, "threshold_not_met")
        if current == "pro" and new == "member":
            link = await svc.invites.issue_invite("member", uid)
            await svc.repository.upsert_member(uid, row.get("username"), row["wallet_address"],
                                               "member", result["stake_usd"])
            try:
                await context.bot.send_message(uid, f"Pro access ended — stake below $250. Rejoin Member: {escape(link)}")
            except Exception:
                pass
