from __future__ import annotations

from html import escape

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import ContextTypes

from bot.senders import Senders


def call_copy_markup(call_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Copy CA", callback_data=f"copy:{call_id}")]]
    )


async def copy_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.data or not query.data.startswith("copy:"):
        return
    call_id = query.data.partition(":")[2]
    repo = context.application.bot_data["repository"]
    call = await repo.get_call(call_id)
    if not call or not call.get("contract_address"):
        await query.answer("Call data unavailable.", show_alert=True)
        return
    chat_id = query.message.chat_id if query.message else None
    if chat_id != context.application.bot_data["settings"].pro_group_id:
        await query.answer("Copy is available only in the Pro group.", show_alert=True)
        return
    await query.answer()
    senders: Senders = context.application.bot_data["senders"]
    await senders.send_pro(
        f"<code>{escape(call['contract_address'])}</code>",
        parse_mode=ParseMode.HTML,
        reply_to_message_id=query.message.message_id,
    )
