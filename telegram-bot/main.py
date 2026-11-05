from __future__ import annotations

import asyncio
import logging
from decimal import Decimal

import uvicorn
from telegram import Update
from telegram.ext import Application

from api.app import create_api_app
from bot.application import build_application
from bot.selfcheck import startup_self_check
from lib.config import get_settings
from lib.db import Database
from lib.invites import InviteService
from lib.logging_config import configure_logging
from lib.price_reader import UnconfiguredTwapReader
from lib.repository import Repository
from lib.verify import DatabaseStakeReader, HeliusClient, VerificationService

logger = logging.getLogger(__name__)


async def run() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, [
        settings.bot_token.get_secret_value(), settings.helius_api_key.get_secret_value(),
        settings.database_url.get_secret_value(), settings.internal_secret.get_secret_value(),
    ])
    db = Database(settings.database_url.get_secret_value())
    helius = HeliusClient(settings.helius_api_key.get_secret_value())
    application: Application | None = None
    try:
        await db.run_migrations()
        repository = Repository(db.engine)
        verifier = VerificationService(
            helius=helius,
            stake_reader=DatabaseStakeReader(db.engine),
            price_reader=UnconfiguredTwapReader(),
            genesis_mint=settings.genesis_mint,
            genesis_decimals=settings.genesis_decimals,
            member_usd_threshold=Decimal(str(settings.member_usd_threshold)),
            pro_usd_threshold=Decimal(str(settings.pro_usd_threshold)),
        )
        invite_service = InviteService(None, settings, repository)
        application = build_application(settings, repository, verifier, invite_service)
        invite_service.bot = application.bot

        await application.initialize()
        check = await startup_self_check(application.bot, settings)
        for line in check.lines:
            (logger.info if check.ok else logger.error)("startup_self_check %s", line)
        if not check.ok:
            raise SystemExit(1)

        await application.start()
        if not application.updater:
            raise RuntimeError("Telegram polling updater unavailable")
        await application.updater.start_polling(allowed_updates=Update.ALL_TYPES)

        api_app = create_api_app(
            bot=application.bot, settings=settings, repository=repository,
            senders=application.bot_data["senders"], job_queue=application.job_queue,
        )
        server = uvicorn.Server(uvicorn.Config(
            api_app, host="127.0.0.1", port=8000,
            log_level=settings.log_level.lower(), access_log=False,
        ))
        await server.serve()
    finally:
        if application:
            try:
                if application.updater and application.updater.running:
                    await application.updater.stop()
                if application.running:
                    await application.stop()
                await application.shutdown()
            except Exception:
                logger.exception("error during Telegram shutdown")
        await helius.close()
        await db.close()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
