from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bot.community import chat_member_update
from lib.config import Settings

ENV = {
    "BOT_TOKEN": "x", "PRO_GROUP_ID": "-1", "MEMBER_GROUP_ID": "-2",
    "PUBLIC_CHANNEL_ID": "-3", "PUBLIC_COMMUNITY_GROUP_ID": "-4",
    "ADMIN_USER_IDS": "1", "HELIUS_API_KEY": "h", "GENESIS_MINT": "m",
    "GENESIS_DECIMALS": "6", "JOIN_URL": "https://trenchlabs.xyz/join",
    "INTERNAL_SECRET": "s", "DATABASE_URL": "postgresql+asyncpg://u:p@localhost/db",
    "BOOTSTRAP_OWNER_ID": "1",
}


def make_update(settings):
    user = SimpleNamespace(id=77)
    event = SimpleNamespace(
        chat=SimpleNamespace(id=settings.pro_group_id),
        old_chat_member=SimpleNamespace(status="left"),
        new_chat_member=SimpleNamespace(status="member", user=user),
        invite_link=SimpleNamespace(invite_link="borrowed-link"),
    )
    return SimpleNamespace(chat_member=event)


@pytest.mark.asyncio
async def test_join_without_user_owned_invite_is_removed() -> None:
    settings = Settings(**ENV)
    repository = AsyncMock()
    repository.community_user_banned.return_value = False
    repository.mark_invite_used.return_value = False
    repository.get_member.return_value = {"tier": "pro", "status": "active"}
    invites = SimpleNamespace(kick_member=AsyncMock())
    svc = SimpleNamespace(settings=settings, repository=repository, invites=invites)
    context = SimpleNamespace(application=SimpleNamespace(bot_data={"services": svc}))

    await chat_member_update(make_update(settings), context)

    invites.kick_member.assert_awaited_once_with("pro", 77, "unverified_or_wrong_tier")


@pytest.mark.asyncio
async def test_join_with_matching_member_invite_is_kept() -> None:
    settings = Settings(**ENV)
    repository = AsyncMock()
    repository.community_user_banned.return_value = False
    repository.mark_invite_used.return_value = True
    repository.get_member.return_value = {"tier": "pro", "status": "active"}
    repository.log_event = AsyncMock()
    invites = SimpleNamespace(kick_member=AsyncMock())
    svc = SimpleNamespace(settings=settings, repository=repository, invites=invites)
    context = SimpleNamespace(application=SimpleNamespace(bot_data={"services": svc}))

    await chat_member_update(make_update(settings), context)

    invites.kick_member.assert_not_awaited()
    repository.log_event.assert_awaited_once()
