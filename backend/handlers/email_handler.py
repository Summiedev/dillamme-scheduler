"""Mock email handler with real validation, 20% failure rate for retry testing."""

from __future__ import annotations

import asyncio
import json
import os
import random
import re
import uuid
from datetime import datetime, UTC

import aiofiles
from utils.logger import get_logger

logger = get_logger()

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


async def handle_send_email(payload: dict) -> dict:
    """Validate email fields, simulate sending, 20% failure rate.

    Raises ValueError or ConnectionError on failure — these trigger
    the worker's retry/DLQ machinery.
    """
    required = ["to", "subject"]
    for field in required:
        if field not in payload:
            raise ValueError(f"Missing required field: {field}")

    if not EMAIL_RE.match(payload["to"]):
        raise ValueError(f"Invalid email address: {payload['to']}")

    # Simulate network latency
    await asyncio.sleep(random.uniform(0.1, 0.5))

    # 20% simulated failure to exercise retry logic
    if random.random() < 0.20:
        raise ConnectionError("SMTP server unavailable (simulated)")

    entry = {
        "to": payload["to"],
        "subject": payload["subject"],
        "body": payload.get("body", ""),
        "sent_at": datetime.now(UTC).isoformat(),
        "message_id": str(uuid.uuid4()),
    }

    # Append to JSONL log
    os.makedirs("logs", exist_ok=True)
    async with aiofiles.open("logs/sent_emails.jsonl", "a") as f:
        await f.write(json.dumps(entry) + "\n")

    logger.info("email_sent", to=payload["to"], message_id=entry["message_id"])
    return {"message_id": entry["message_id"], "status": "sent"}
