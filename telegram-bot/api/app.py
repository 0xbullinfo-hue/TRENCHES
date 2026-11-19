from __future__ import annotations

from fastapi import FastAPI
from telegram import Bot
from telegram.ext import JobQueue

from api.routes import router
from bot.copy_button import call_copy_markup
from bot.senders import Senders
from lib.config import Settings
from lib.repository import Repository


def create_api_app(
    *, bot: Bot, settings: Settings, repository: Repository,
    senders: Senders, job_queue: JobQueue | None,
) -> FastAPI:
    app = FastAPI(title="TrenchLabsHQ internal bot API", docs_url=None, redoc_url=None)
    app.state.bot = bot
    app.state.settings = settings
    app.state.repository = repository
    app.state.senders = senders
    app.state.job_queue = job_queue
    app.state.copy_markup = call_copy_markup
    app.include_router(router)
    return app
