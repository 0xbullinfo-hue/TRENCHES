from __future__ import annotations

from html import escape
from typing import Mapping, Any


def format_call(payload: Mapping[str, Any], delayed: bool = False) -> str:
    prefix = "⏱ 15-min delay\n" if delayed else ""
    return (
        f"{prefix}🚨 NEW CALL — ${escape(str(payload['ticker']))} "
        f"({escape(str(payload['chain']))})\n\n"
        f"Entry: ${escape(str(payload['entry_price']))}\n"
        f"SL: ${escape(str(payload['stop_loss']))}\n\n"
        f"CA: <code>{escape(str(payload['contract_address']))}</code>\n\n"
        f"🎯 Targets, thesis &amp; tracker →\n{escape(str(payload['dashboard_deeplink']))}\n\n"
        "⚠️ Not financial advice"
    )
