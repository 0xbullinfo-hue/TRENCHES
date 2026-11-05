from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from telegram import ChatPermissions, Update
from telegram.constants import ChatMemberStatus
from telegram.ext import ContextTypes, MessageHandler, filters

from lib.config import Settings
from lib.repository import Repository

ADDRESS_RE = re.compile(r"(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,}(?![1-9A-HJ-NP-Za-km-z])")
URL_RE = re.compile(
    r"(?:https?://|www\.)[^\s<>]+|(?<!@)\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/[^\s<>]*)?",
    re.IGNORECASE,
)
TELEGRAM_LINK_RE = re.compile(r"(?:https?://)?t\.me/", re.IGNORECASE)

TEASER_TEMPLATE = """🚨 NEW ALPHA CALL POSTED

A new high-conviction call just dropped for Pro members.

📊 Entry · SL · Targets · Thesis
🔒 Verified members only

👉 View access tiers → {join_url}

⚠️ Not financial advice. Past performance ≠ future results."""


def teaser_text(join_url: str) -> str:
    return TEASER_TEMPLATE.format(join_url=join_url)


def is_spam_text(text: str, allowed_hosts: set[str]) -> tuple[bool, str | None]:
    if TELEGRAM_LINK_RE.search(text):
        return True, "telegram_link"
    if ADDRESS_RE.search(text):
        return True, "address_pattern"
    for match in URL_RE.finditer(text):
        candidate = match.group(0).rstrip(".,!?;:)")
        if "://" not in candidate:
            candidate = f"https://{candidate}"
        host = (urlparse(candidate).hostname or "").lower()
        if host not in allowed_hosts:
            return True, "unapproved_url"
    return False, None


def allowed_hosts(settings: Settings) -> set[str]:
    parsed = urlparse(settings.join_url if "://" in settings.join_url else f"https://{settings.join_url}")
    # Official site and docs hosts are the site root and its docs subdomain.
    base = parsed.hostname or "trenchlabs.xyz"
    return {base.lower(), f"www.{base}".lower(), f"docs.{base}".lower()}


async def post_teaser(bot, settings: Settings, repo: Repository) -> bool:
    allowed = await repo.claim_teaser_slot(settings.teaser_cooldown_minutes, settings.teaser_daily_cap)
    if not allowed:
        return False
    await bot.send_message(
        chat_id=settings.public_community_group_id,
        text=teaser_text(settings.join_url),
        disable_web_page_preview=True,
    )
    await repo.log_event("teaser_posted", payload={"destination": "public_community"})
    return True


async def moderate_community_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    user = update.effective_user
    if not message or not user or not update.effective_chat:
        return
    svc = context.application.bot_data["services"]
    settings: Settings = svc.settings
    if update.effective_chat.id != settings.public_community_group_id:
        return
    if await svc.repository.community_user_banned(user.id):
        try:
            await context.bot.ban_chat_member(settings.public_community_group_id, user.id)
        except Exception:
            pass
        return
    content = "\n".join(part for part in (message.text, message.caption) if part)
    entities = [*(getattr(message, "entities", None) or []),
                *(getattr(message, "caption_entities", None) or [])]
    for entity in entities:
        if entity.url:
            content += f"\n{entity.url}"
    if not content:
        return
    spam, reason = is_spam_text(content, allowed_hosts(settings))
    if not spam:
        return
    try:
        await message.delete()
    except Exception:
        pass
    warning = await svc.repository.add_community_warning(user.id)
    count = warning["warning_count"]
    await svc.repository.log_event(
        "spam_deleted", telegram_user_id=user.id,
        payload={"reason": reason, "warning_count": count},
    )
    try:
        await context.bot.send_message(
            chat_id=settings.public_community_group_id,
            text=f"Removed: community group doesn't allow CA/link sharing. Warning {count}.",
            reply_to_message_id=message.message_id,
        )
    except Exception:
        pass
    if count == 2:
        until = datetime.now(timezone.utc) + timedelta(hours=24)
        await context.bot.restrict_chat_member(
            settings.public_community_group_id,
            user.id,
            permissions=ChatPermissions(
                can_send_messages=False,
                can_send_audios=False,
                can_send_documents=False,
                can_send_photos=False,
                can_send_videos=False,
                can_send_video_notes=False,
                can_send_voice_notes=False,
                can_send_polls=False,
                can_send_other_messages=False,
                can_add_web_page_previews=False,
            ),
            until_date=until,
        )
        await svc.repository.set_community_muted(user.id, until)
    elif count >= 3:
        await context.bot.ban_chat_member(settings.public_community_group_id, user.id)
        await context.bot.unban_chat_member(settings.public_community_group_id, user.id, only_if_banned=True)
        await svc.repository.set_community_banned(user.id)


def community_message_handler() -> MessageHandler:
    return MessageHandler(filters.ALL & ~filters.StatusUpdate.ALL, moderate_community_message)


async def chat_member_update(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    event = update.chat_member
    if not event:
        return
    svc = context.application.bot_data["services"]
    settings: Settings = svc.settings
    if event.chat.id == settings.public_community_group_id:
        if await svc.repository.community_user_banned(event.new_chat_member.user.id):
            await context.bot.ban_chat_member(event.chat.id, event.new_chat_member.user.id)
        return
    groups = {settings.pro_group_id: "pro", settings.member_group_id: "member"}
    tier = groups.get(event.chat.id)
    if not tier:
        return
    new_status = getattr(event.new_chat_member.status, "value", event.new_chat_member.status)
    old_status = getattr(event.old_chat_member.status, "value", event.old_chat_member.status)
    if new_status in (ChatMemberStatus.MEMBER, "member") and old_status not in (ChatMemberStatus.MEMBER, "member"):
        invite_link = event.invite_link.invite_link if event.invite_link else None
        user = event.new_chat_member.user
        invite_valid = False
        if invite_link:
            invite_valid = await svc.repository.mark_invite_used(invite_link, user.id, tier)
        row = await svc.repository.get_member(user.id)
        await svc.repository.log_event("join", telegram_user_id=user.id,
            payload={"target_group": tier, "had_invite_link": bool(invite_link)})
        if not row or row["status"] != "active" or row["tier"] != tier or not invite_valid:
            await svc.invites.kick_member(tier, user.id, "unverified_or_wrong_tier")
