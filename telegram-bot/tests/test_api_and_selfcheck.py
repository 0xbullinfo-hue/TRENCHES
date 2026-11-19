from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from api.app import create_api_app
from api.routes import PushCall
from bot.selfcheck import check_telegram_permissions
from bot.senders import Senders
from lib.config import Settings

ENV = {
    "BOT_TOKEN": "x", "PRO_GROUP_ID": "-1", "MEMBER_GROUP_ID": "-2",
    "PUBLIC_CHANNEL_ID": "-3", "PUBLIC_COMMUNITY_GROUP_ID": "-4",
    "ADMIN_USER_IDS": "1", "HELIUS_API_KEY": "h", "GENESIS_MINT": "m",
    "GENESIS_DECIMALS": "6", "JOIN_URL": "https://trenchlabs.xyz/join",
    "INTERNAL_SECRET": "shared-secret", "DATABASE_URL": "postgresql+asyncpg://u:p@localhost/db",
    "BOOTSTRAP_OWNER_ID": "1",
}


def test_push_call_rejects_extra_sensitive_payload_fields() -> None:
    data = {
        "call_id": "c1", "ticker": "WIF", "chain": "solana", "entry_price": "0.1",
        "stop_loss": "0.05", "contract_address": "1" * 32,
        "dashboard_deeplink": "https://trenchlabs.xyz/calls/c1", "priority": "normal",
        "thesis": "must not be accepted",
    }
    with pytest.raises(Exception):
        PushCall.model_validate(data)


def test_push_call_rejects_http_dashboard_and_bad_price() -> None:
    data = {
        "call_id": "c1", "ticker": "WIF", "chain": "solana", "entry_price": "NaN",
        "stop_loss": "0.05", "contract_address": "1" * 32,
        "dashboard_deeplink": "http://trenchlabs.xyz/calls/c1", "priority": "normal",
    }
    with pytest.raises(Exception):
        PushCall.model_validate(data)


@pytest.mark.asyncio
async def test_startup_self_check_reports_missing_permissions() -> None:
    bot = AsyncMock()
    bot.get_me.return_value = SimpleNamespace(id=99, username="bot")
    bot.get_chat.side_effect = lambda chat_id: SimpleNamespace(title=f"chat-{chat_id}")
    bot.get_chat_member.return_value = SimpleNamespace(
        status="administrator", can_invite_users=True, can_restrict_members=True,
        can_post_messages=True, can_delete_messages=False,
    )
    result = await check_telegram_permissions(bot, Settings(**ENV))
    assert not result.ok
    assert any("can_delete_messages" in item for item in result.lines)


def test_internal_endpoint_requires_shared_secret() -> None:
    settings = Settings(**ENV)
    bot = AsyncMock()
    repository = AsyncMock()
    senders = SimpleNamespace()
    app = create_api_app(bot=bot, settings=settings, repository=repository,
                         senders=senders, job_queue=None)
    client = TestClient(app)
    response = client.post("/internal/push-call", json={})
    assert response.status_code == 403


def call_payload() -> dict[str, str]:
    return {
        "call_id": "c1", "ticker": "WIF", "chain": "solana", "entry_price": "0.1",
        "stop_loss": "0.05", "contract_address": "1" * 32,
        "dashboard_deeplink": "https://trenchlabs.xyz/calls/c1", "priority": "normal",
    }


def test_push_call_posts_protects_and_sends_generic_teaser() -> None:
    settings = Settings(**ENV)
    bot = AsyncMock()
    bot.send_message.return_value = SimpleNamespace(message_id=7)
    repository = AsyncMock()
    repository.reserve_call.return_value = True
    repository.claim_teaser_slot.return_value = True
    bot.send_message.return_value = SimpleNamespace(message_id=123)
    senders = Senders(bot, settings)
    app = create_api_app(bot=bot, settings=settings, repository=repository,
                         senders=senders, job_queue=None)
    response = TestClient(app).post(
        "/internal/push-call", headers={"X-Internal-Secret": "shared-secret"},
        json=call_payload(),
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "pro_message_id": 123}
    pro_text = bot.send_message.await_args_list[0].kwargs["text"]
    assert "WIF" in pro_text and "1" * 32 in pro_text
    assert bot.send_message.await_args_list[0].kwargs["protect_content"] is True
    teaser = bot.send_message.await_args.kwargs["text"]
    assert "WIF" not in teaser
    assert "1" * 32 not in teaser
    assert "trenchlabs.xyz/join" in teaser
    repository.finalize_call_delivery.assert_awaited_once()


def test_push_call_duplicate_returns_conflict_without_reposting() -> None:
    settings = Settings(**ENV)
    bot = AsyncMock()
    repository = AsyncMock()
    repository.reserve_call.return_value = False
    senders = SimpleNamespace(send_pro=AsyncMock())
    app = create_api_app(bot=bot, settings=settings, repository=repository,
                         senders=senders, job_queue=None)
    response = TestClient(app).post(
        "/internal/push-call", headers={"X-Internal-Secret": "shared-secret"},
        json=call_payload(),
    )
    assert response.status_code == 409
    senders.send_pro.assert_not_awaited()
