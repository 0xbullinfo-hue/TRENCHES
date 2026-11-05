from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from telegram import Bot

from lib.config import Settings
from lib.repository import Repository


class InviteService:
    def __init__(self, bot: Bot, settings: Settings, repository: Repository) -> None:
        self.bot = bot
        self.settings = settings
        self.repository = repository

    def chat_id(self, tier: str) -> int:
        if tier == "pro":
            return self.settings.pro_group_id
        if tier == "member":
            return self.settings.member_group_id
        raise ValueError("target_group must be 'member' or 'pro'")

    async def issue_invite(self, target_group: str, telegram_user_id: int) -> str:
        chat_id = self.chat_id(target_group)
        expires = datetime.now(timezone.utc) + timedelta(minutes=self.settings.invite_link_ttl_minutes)
        previous = await self.repository.get_active_invite(telegram_user_id, target_group)
        if previous:
            await self.bot.revoke_chat_invite_link(chat_id, previous["invite_link"])
        invite = await self.bot.create_chat_invite_link(
            chat_id=chat_id,
            member_limit=1,
            expire_date=expires,
            name=f"u{telegram_user_id}-{target_group}-{int(datetime.now().timestamp())}",
        )
        await self.repository.store_invite(telegram_user_id, target_group, invite.invite_link, expires)
        await self.repository.log_event("invite_issued", telegram_user_id=telegram_user_id,
                                        payload={"target_group": target_group})
        return invite.invite_link

    async def kick_member(self, target_group: str, telegram_user_id: int, reason: str) -> None:
        chat_id = self.chat_id(target_group)
        await self.bot.ban_chat_member(chat_id=chat_id, user_id=telegram_user_id)
        await self.bot.unban_chat_member(chat_id=chat_id, user_id=telegram_user_id,
                                         only_if_banned=True)
        row = await self.repository.get_member(telegram_user_id)
        if row and row["tier"] == target_group:
            await self.repository.mark_member_removed(telegram_user_id)
        await self.repository.log_event("kick", telegram_user_id=telegram_user_id,
                                        payload={"target_group": target_group, "reason": reason})
        try:
            await self.bot.send_message(
                chat_id=telegram_user_id,
                text=f"Your {target_group.title()} group access was removed ({reason}). "
                     "Run /verify again if your qualifying balance or stake is restored.",
            )
        except Exception:
            pass
