from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from api.app import create_api_app
from lib.config import Settings

ENV = {
    "BOT_TOKEN": "x", "PRO_GROUP_ID": "-1", "MEMBER_GROUP_ID": "-2",
    "PUBLIC_CHANNEL_ID": "-3", "PUBLIC_COMMUNITY_GROUP_ID": "-4",
    "ADMIN_USER_IDS": "1", "HELIUS_API_KEY": "h", "GENESIS_MINT": "m",
    "GENESIS_DECIMALS": "6", "JOIN_URL": "https://trenchlabs.xyz/join",
    "INTERNAL_SECRET": "shared-secret", "DATABASE_URL": "postgresql+asyncpg://u:p@localhost/db",
    "BOOTSTRAP_OWNER_ID": "1",
}


def test_tp_result_replies_to_original_pro_message_only() -> None:
    settings = Settings(**ENV)
    repository = AsyncMock()
    repository.get_call.return_value = {"ticker": "WIF", "telegram_message_id": 123}
    senders = SimpleNamespace(send_pro=AsyncMock(), send_channel=AsyncMock())
    bot = AsyncMock()
    app = create_api_app(bot=bot, settings=settings, repository=repository,
                         senders=senders, job_queue=None)
    response = TestClient(app).post(
        "/internal/push-result", headers={"X-Internal-Secret": "shared-secret"},
        json={"call_id": "c1", "event": "tp_hit", "tp_label": "TP1", "multiplier": "2.0x"},
    )
    assert response.status_code == 200
    text = senders.send_pro.await_args.args[0]
    assert "TP1 HIT" in text and "+100%" in text
    assert senders.send_pro.await_args.kwargs["reply_to_message_id"] == 123
    senders.send_channel.assert_not_awaited()
    bot.send_message.assert_not_awaited()


def test_closed_result_posts_public_and_pro_with_proof_url() -> None:
    settings = Settings(**ENV)
    repository = AsyncMock()
    repository.get_call.return_value = {"ticker": "WIF", "telegram_message_id": 123}
    senders = SimpleNamespace(send_pro=AsyncMock(), send_channel=AsyncMock())
    app = create_api_app(bot=AsyncMock(), settings=settings, repository=repository,
                         senders=senders, job_queue=None)
    response = TestClient(app).post(
        "/internal/push-result", headers={"X-Internal-Secret": "shared-secret"},
        json={"call_id": "c1", "event": "closed", "entry": "1", "exit": "2",
              "pnl_pct": "100", "proof_url": "https://trenchlabs.xyz/proof/1",
              "closed_at": "2026-11-05T00:00:00Z"},
    )
    assert response.status_code == 200
    senders.send_channel.assert_awaited_once()
    senders.send_pro.assert_awaited_once()
    assert "proof/1" in senders.send_channel.await_args.args[0]
    assert "CA" not in senders.send_channel.await_args.args[0]
    assert senders.send_pro.await_args.kwargs["reply_to_message_id"] == 123
