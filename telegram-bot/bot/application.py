from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    ChatMemberHandler,
    CommandHandler,
    ContextTypes,
    JobQueue,
)

from bot.community import chat_member_update, community_message_handler
from bot.copy_button import copy_callback
from bot.deliveries import recover_member_deliveries
from bot.handlers import (
    HandlerServices,
    checkall_command,
    diag_command,
    getlink_command,
    help_command,
    kick_command,
    members_command,
    reverify_all,
    sig_command,
    start,
    status_command,
    verify_command,
)
from bot.senders import Senders
from lib.config import Settings
from lib.invites import InviteService
from lib.repository import Repository

logger = logging.getLogger(__name__)


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    services: HandlerServices = context.application.bot_data["services"]
    logger.error("telegram handler failed error_type=%s", type(context.error).__name__)
    user = update.effective_user if isinstance(update, Update) else None
    if user:
        try:
            await context.bot.send_message(user.id, "Something went wrong. Please try again shortly.")
        except Exception:
            pass
    try:
        await services.repository.log_event(
            "error", telegram_user_id=user.id if user else None,
            payload={"error_type": type(context.error).__name__},
        )
    except Exception:
        logger.error("failed to persist Telegram handler error event")


def build_application(settings: Settings, repository: Repository,
                      verifier, invite_service: InviteService) -> Application:
    token = settings.bot_token.get_secret_value()
    application = ApplicationBuilder().token(token).job_queue(JobQueue()).build()
    senders = Senders(application.bot, settings)
    svc = HandlerServices(settings, repository, verifier, invite_service)
    application.bot_data.update({
        "services": svc,
        "repository": repository,
        "settings": settings,
        "senders": senders,
    })
    commands = [
        ("start", start), ("help", help_command), ("verify", verify_command),
        ("sig", sig_command), ("status", status_command), ("getlink", getlink_command),
        ("members", members_command), ("checkall", checkall_command),
        ("kick", kick_command), ("diag", diag_command),
    ]
    for name, callback in commands:
        application.add_handler(CommandHandler(name, callback))
    application.add_handler(CallbackQueryHandler(copy_callback, pattern=r"^copy:"))
    application.add_handler(ChatMemberHandler(chat_member_update, ChatMemberHandler.CHAT_MEMBER))
    application.add_handler(community_message_handler())
    application.add_error_handler(error_handler)
    queue = application.job_queue
    if queue:
        queue.run_repeating(reverify_all, interval=settings.recalc_interval_hours * 3600,
                            first=settings.recalc_interval_hours * 3600, name="reverify-members")
        queue.run_repeating(_cleanup_job, interval=3600, first=60, name="cleanup-state")
        queue.run_repeating(recover_member_deliveries, interval=30, first=30,
                            name="recover-member-deliveries")
    return application


async def _cleanup_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    repo: Repository = context.application.bot_data["repository"]
    await repo.revoke_expired_invites()
    await repo.cleanup_nonces()
