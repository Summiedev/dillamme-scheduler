import asyncio
import random
from uuid import uuid4
from utils.logger import get_logger

logger = get_logger()

async def handle_generate_report(payload: dict) -> dict:
    delay = random.uniform(0.5, 1.5)
    await asyncio.sleep(delay)
    report_id = str(uuid4())
    logger.info("report_generated", report_id=report_id)
    return {"report_id": report_id, "status": "generated", "rows": random.randint(100, 10000)}