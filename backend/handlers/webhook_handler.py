import asyncio
import random
import httpx
from datetime import datetime

async def handle_webhook(payload: dict) -> dict:
    url = payload.get("url")
    if not url:
        raise ValueError("Missing required field: url")
    if not url.startswith("http://") and not url.startswith("https://"):
        raise ValueError("url must start with http:// or https://")
    method = payload.get("method", "POST").upper()
    body = payload.get("body", {})
    await asyncio.sleep(random.uniform(0.1, 0.5))
    if random.random() < 0.15:
        raise ConnectionError(f"Webhook delivery failed: connection timeout to {url}")
    return {
        "delivered": True,
        "url": url,
        "method": method,
        "status_code": 200,
        "delivered_at": datetime.utcnow().isoformat(),
    }