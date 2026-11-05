from __future__ import annotations

from telegram import Bot, Message

from lib.config import Settings


class Senders:
    def __init__(self, bot: Bot, settings: Settings) -> None:
        self.bot = bot
        self.settings = settings

    async def send_pro(self, text: str, **kwargs) -> Message:
        return await self.bot.send_message(
            chat_id=self.settings.pro_group_id, text=text, protect_content=True, **kwargs
        )

    async def send_member(self, text: str, **kwargs) -> Message:
        return await self.bot.send_message(
            chat_id=self.settings.member_group_id, text=text, protect_content=False, **kwargs
        )

    async def send_channel(self, text: str, **kwargs) -> Message:
        return await self.bot.send_message(
            chat_id=self.settings.public_channel_id, text=text, protect_content=False, **kwargs
        )

    async def send_community(self, text: str, **kwargs) -> Message:
        return await self.bot.send_message(
            chat_id=self.settings.public_community_group_id, text=text,
            protect_content=False, **kwargs
        )
