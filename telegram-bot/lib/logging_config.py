from __future__ import annotations

import logging
import re
from collections.abc import Iterable

_SECRET_PATTERNS = (
    re.compile(r"\b\d{6,}:[A-Za-z0-9_-]{25,}\b"),
    re.compile(r"api-key=[^\s&]+", re.IGNORECASE),
    re.compile(r"(postgres(?:ql)?\+?asyncpg?://[^:/\s]+:)[^@\s]+(@)", re.IGNORECASE),
)


class SecretRedactionFilter(logging.Filter):
    def __init__(self, secret_values: Iterable[str] = ()) -> None:
        super().__init__()
        self._secret_values = tuple(value for value in secret_values if value)

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for secret in self._secret_values:
            message = message.replace(secret, "[REDACTED]")
        for pattern in _SECRET_PATTERNS:
            if pattern.groups == 2:
                message = pattern.sub(r"\1[REDACTED]\2", message)
            else:
                message = pattern.sub("[REDACTED]", message)
        record.msg = message
        record.args = ()
        return True


def configure_logging(level: str = "INFO", secret_values: Iterable[str] = ()) -> None:
    handler = logging.StreamHandler()
    handler.addFilter(SecretRedactionFilter(secret_values))
    logging.basicConfig(level=level.upper(), handlers=[handler], force=True)
