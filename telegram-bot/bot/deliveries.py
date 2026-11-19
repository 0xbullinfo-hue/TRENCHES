from __future__ import annotations

import logging

from telegram.constants import ParseMode
from telegram.ext import ContextTypes

from bot.messages import format_call
from bot.senders import Senders
from lib.repository import Repository

logger = logging.getLogger(__name__)


async def _deliver(context: ContextTypes.DEFAULT_TYPE, call_id: str,
                   payload: dict) -> None:
    repo: Repository = context.application.bot_data["repository"]
    senders: Senders = context.application.bot_data["senders"]
    try:
        await senders.send_member(
            format_call(payload, delayed=True),
            parse_mode=ParseMode.HTML,
            disable_web_page_preview=True,
        )
        await repo.complete_member_delivery(call_id)
    except Exception as exc:
        await repo.release_member_delivery(call_id)
        logger.error("member delivery failed call_id=%s error_type=%s", call_id, type(exc).__name__)


async def deliver_member_call(context: ContextTypes.DEFAULT_TYPE) -> None:
    call_id = context.job.data
    repo: Repository = context.application.bot_data["repository"]
    payload = await repo.claim_member_delivery(call_id)
    if payload:
        await _deliver(context, call_id, payload)


async def recover_member_deliveries(context: ContextTypes.DEFAULT_TYPE) -> None:
    repo: Repository = context.application.bot_data["repository"]
    rows = await repo.claim_due_member_deliveries()
    for row in rows:
        await _deliver(context, row["call_id"], row["payload"])
