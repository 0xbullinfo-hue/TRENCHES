from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bot.community import moderate_community_message
from lib.config import Settings

ENV = {
    "BOT_TOKEN": "x", "PRO_GROUP_ID": "-1", "MEMBER_GROUP_ID": "-2",
    "PUBLIC_CHANNEL_ID": "-3", "PUBLIC_COMMUNITY_GROUP_ID": "-4",
    "ADMIN_USER_IDS": "1", "HELIUS_API_KEY": "h", "GENESIS_MINT": "m",
    "GENESIS_DECIMALS": "6", "JOIN_URL": "https://trenchlabs.xyz/join",
    "INTERNAL_SECRET": "s", "DATABASE_URL": "postgresql+asyncpg://u:p@localhost/db",
    "BOOTSTRAP_OWNER_ID": "1",
}


@pytest.mark.asyncio
@pytest.mark.parametrize("warning_count", [1, 2, 3])
async def test_spam_warning_escalation(warning_count: int) -> None:
    settings = Settings(**ENV)
    message = SimpleNamespace(text="fake address " + "A" * 40, caption=None,
                              message_id=10, delete=AsyncMock())
    user = SimpleNamespace(id=44)
    repository = AsyncMock()
    repository.community_user_banned.return_value = False
    repository.add_community_warning.return_value = {"warning_count": warning_count}
    svc = SimpleNamespace(settings=settings, repository=repository)
    bot = AsyncMock()
    context = SimpleNamespace(application=SimpleNamespace(bot_data={"services": svc}), bot=bot)
    update = SimpleNamespace(effective_message=message, effective_user=user,
                             effective_chat=SimpleNamespace(id=settings.public_community_group_id))

    await moderate_community_message(update, context)

    message.delete.assert_awaited_once()
    repository.log_event.assert_awaited_once()
    if warning_count == 1:
        bot.restrict_chat_member.assert_not_awaited()
        bot.ban_chat_member.assert_not_awaited()
    elif warning_count == 2:
        bot.restrict_chat_member.assert_awaited_once()
        assert bot.restrict_chat_member.await_args.kwargs["until_date"]
        repository.set_community_muted.assert_awaited_once()
    else:
        bot.ban_chat_member.assert_awaited_once()
        bot.unban_chat_member.assert_awaited_once()
        repository.set_community_banned.assert_awaited_once()
