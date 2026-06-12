import asyncio
import random
import json
from datetime import datetime
from pathlib import Path

LOG_FILE = Path("logs/processed_logs.jsonl")

async def handle_log_processing(payload: dict) -> dict:
    message = payload.get("message")
    if not message:
        raise ValueError("Missing required field: message")
    level = payload.get("level", "info")
    source = payload.get("source", "unknown")
    await asyncio.sleep(random.uniform(0.05, 0.2))
    if random.random() < 0.1:
        raise RuntimeError("Log processor pipeline failure")
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "message": message,
        "level": level,
        "source": source,
        "metadata": payload.get("metadata", {}),
        "processed_at": datetime.utcnow().isoformat(),
    }
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"processed": True, "level": level, "processed_at": entry["processed_at"]}