"""Structured JSON logging via structlog.

Output goes to stdout AND logs/app.jsonl.
Never use print() — always use structlog.
"""

from __future__ import annotations

import os
import logging
import structlog
from config import settings


def setup_logging():
    """Configure structlog for production JSON output."""
    # Ensure log directory exists
    os.makedirs("logs", exist_ok=True)

    # Console + file handler
    handlers = [
        logging.StreamHandler(),
        logging.FileHandler("logs/app.jsonl", encoding="utf-8"),
    ]

    # Force JSON everywhere
    for handler in handlers:
        handler.setFormatter(
            structlog.stdlib.ProcessorFormatter(
                processor=structlog.processors.JSONRenderer(),
            )
        )

    # Root logger config
    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        handlers=handlers,
    )

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


def get_logger() -> structlog.stdlib.BoundLogger:
    """Return a bound structlog logger."""
    return structlog.get_logger()
