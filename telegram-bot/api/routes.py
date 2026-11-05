from __future__ import annotations

import hmac
import logging
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

import base58
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator
from telegram.constants import ParseMode

from bot.community import post_teaser
from bot.deliveries import deliver_member_call
from bot.messages import format_call
from bot.senders import Senders
from lib.config import Settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal")


class PushCall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    call_id: str = Field(min_length=1, max_length=128)
    ticker: str = Field(min_length=1, max_length=24)
    chain: str = Field(min_length=1, max_length=32)
    entry_price: str = Field(min_length=1, max_length=64)
    stop_loss: str = Field(min_length=1, max_length=64)
    contract_address: str = Field(min_length=32, max_length=128)
    dashboard_deeplink: HttpUrl
    priority: Literal["normal", "high", "urgent"] = "normal"

    @field_validator("contract_address")
    @classmethod
    def sane_ca(cls, value: str) -> str:
        try:
            decoded = base58.b58decode(value)
        except (ValueError, TypeError) as exc:
            raise ValueError("contract address must be base58") from exc
        if len(decoded) != 32:
            raise ValueError("contract address must decode to 32 bytes")
        return value

    @field_validator("ticker", "chain")
    @classmethod
    def sane_identifier(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9._-]+", value):
            raise ValueError("identifier contains unsupported characters")
        return value

    @field_validator("entry_price", "stop_loss")
    @classmethod
    def valid_price(cls, value: str) -> str:
        try:
            amount = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError("price must be numeric") from exc
        if not amount.is_finite() or amount <= 0:
            raise ValueError("price must be positive")
        return value

    @field_validator("dashboard_deeplink")
    @classmethod
    def safe_dashboard_url(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme != "https":
            raise ValueError("dashboard URL must use HTTPS")
        if not (value.host == "trenchlabs.xyz" or value.host.endswith(".trenchlabs.xyz")):
            raise ValueError("dashboard URL must use the official site")
        return value


class TPResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    call_id: str
    event: Literal["tp_hit"]
    tp_label: str = Field(min_length=1, max_length=16)
    multiplier: str = Field(min_length=1, max_length=24)


class SLResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    call_id: str
    event: Literal["sl_hit"]
    loss_pct: str = Field(min_length=1, max_length=24)


class ClosedResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    call_id: str
    event: Literal["closed"]
    entry: str
    exit: str
    pnl_pct: str
    proof_url: HttpUrl
    closed_at: datetime

    @field_validator("proof_url")
    @classmethod
    def proof_https(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme != "https":
            raise ValueError("proof URL must use HTTPS")
        return value


async def authenticate(
    request: Request,
    x_internal_secret: Annotated[str | None, Header(alias="X-Internal-Secret")] = None,
) -> None:
    expected = request.app.state.settings.internal_secret.get_secret_value()
    if not x_internal_secret or not hmac.compare_digest(x_internal_secret, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/push-call", dependencies=[Depends(authenticate)])
async def push_call(payload: PushCall, request: Request):
    app = request.app
    repo = app.state.repository
    bot = app.state.bot
    settings: Settings = app.state.settings
    senders: Senders = app.state.senders

    # Reserve the unique call id before the external Telegram side effect so concurrent
    # requests cannot publish the same call twice.
    reserved = await repo.reserve_call(
        payload.call_id, payload.ticker, payload.chain, payload.contract_address
    )
    if not reserved:
        raise HTTPException(status_code=409, detail="call_id already processed")
    try:
        message = await senders.send_pro(
            format_call(payload.model_dump(mode="json")), parse_mode=ParseMode.HTML,
            disable_web_page_preview=True,
            reply_markup=app.state.copy_markup(payload.call_id),
        )
        await repo.finalize_call_delivery(
            payload.call_id, message.message_id, payload.model_dump(mode="json"),
            settings.member_delay_minutes,
        )
    except Exception:
        await repo.delete_call_reservation(payload.call_id)
        logger.exception("Pro call delivery failed call_id=%s ticker=%s chain=%s",
                         payload.call_id, payload.ticker, payload.chain)
        raise HTTPException(status_code=502, detail="Signal delivery failed")

    if app.state.job_queue is not None:
        app.state.job_queue.run_once(
            deliver_member_call,
            when=timedelta(minutes=settings.member_delay_minutes),
            data=payload.call_id,
            name=f"member-call-{payload.call_id}",
        )
    # Teaser failures are isolated: the Pro call has already been delivered successfully.
    try:
        await post_teaser(bot, settings, repo)
    except Exception:
        logger.exception("community teaser failed call_id=%s", payload.call_id)
    logger.info("call pushed call_id=%s ticker=%s chain=%s", payload.call_id,
                payload.ticker, payload.chain)
    return {"ok": True, "pro_message_id": message.message_id}


@router.post("/push-result", dependencies=[Depends(authenticate)])
async def push_result(request: Request):
    raw = await request.json()
    event = raw.get("event") if isinstance(raw, dict) else None
    if event == "tp_hit":
        payload = TPResult.model_validate(raw)
    elif event == "sl_hit":
        payload = SLResult.model_validate(raw)
    elif event == "closed":
        payload = ClosedResult.model_validate(raw)
    else:
        raise HTTPException(status_code=422, detail="Unsupported result event")
    repo = request.app.state.repository
    call = await repo.get_call(payload.call_id)
    if not call or not call.get("telegram_message_id"):
        raise HTTPException(status_code=404, detail="Unknown call_id")
    senders: Senders = request.app.state.senders
    ticker = call["ticker"]
    dashboard = f"https://trenchlabs.xyz/calls/{payload.call_id}"
    if isinstance(payload, TPResult):
        multiplier_text = payload.multiplier.lower().removesuffix("x")
        try:
            gain_pct = (Decimal(multiplier_text) - Decimal("1")) * Decimal("100")
        except InvalidOperation as exc:
            raise HTTPException(status_code=422, detail="multiplier must be numeric, e.g. 2.0x") from exc
        gain_text = format(gain_pct.normalize(), "f")
        text = (f"✅ {payload.tp_label} HIT — ${ticker} +{gain_text}% "
                f"({payload.multiplier})\n"
                f"Remaining targets → {dashboard}")
        await senders.send_pro(text, reply_to_message_id=call["telegram_message_id"])
    elif isinstance(payload, SLResult):
        text = f"❌ SL HIT — ${ticker} {payload.loss_pct}\nFull post-mortem → {dashboard}"
        await senders.send_pro(text, reply_to_message_id=call["telegram_message_id"])
    else:
        try:
            pnl = Decimal(payload.pnl_pct)
        except InvalidOperation as exc:
            raise HTTPException(status_code=422, detail="pnl_pct must be numeric") from exc
        proof = str(payload.proof_url)
        if pnl >= 0:
            public_text = (f"✅ ${ticker} closed: entry ${payload.entry} → exit ${payload.exit} "
                           f"(+{payload.pnl_pct}%).\nProof: {proof}\nPro members got this in real time.")
        else:
            public_text = (f"❌ ${ticker} closed at {payload.pnl_pct}%.\nProof: {proof}\n"
                           f"Full ledger → {request.app.state.settings.public_ledger_url}")
        await senders.send_channel(public_text, disable_web_page_preview=True)
        await senders.send_pro(public_text, reply_to_message_id=call["telegram_message_id"])
    logger.info("call result delivered call_id=%s event=%s", payload.call_id, payload.event)
    return {"ok": True}
