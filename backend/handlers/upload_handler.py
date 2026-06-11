import asyncio
import random
from uuid import uuid4
from utils.logger import get_logger

logger = get_logger()

async def handle_upload_file(payload: dict) -> dict:
    delay = random.uniform(0.3, 1.0)
    await asyncio.sleep(delay)
    file_url = f"https://storage.example.com/{uuid4()}.pdf"
    logger.info("file_uploaded", file_url=file_url)
    return {"file_url": file_url, "size_bytes": random.randint(1000, 500000)}