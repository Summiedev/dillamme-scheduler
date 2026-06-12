"""Health check route: GET /api/health.

Checks MongoDB connectivity, Redis connectivity, and worker status.
Worker health logic:
  - alive if last_seen is within the last 15 seconds
  - stale if last_seen is older than 15 seconds
  - return "ok" if at least one worker is alive
  - return "stale" if all known workers are stale
  - return "unknown" if the collection has no documents
"""

from __future__ import annotations

from datetime import datetime, UTC

from fastapi import APIRouter

from db.connection import get_db, get_redis
from utils.logger import get_logger

router = APIRouter(prefix="/api", tags=["health"])
logger = get_logger()


async def check_mongodb() -> str:
    """Ping MongoDB, return 'ok' or 'error'."""
    try:
        db = await get_db()
        await db.command("ping")
        return "ok"
    except Exception as exc:
        logger.error("health_mongodb_error", error=str(exc))
        return "error"


async def check_redis() -> str:
    """Ping Redis, return 'ok' or 'error'."""
    try:
        redis = await get_redis()
        await redis.ping()
        return "ok"
    except Exception as exc:
        logger.error("health_redis_error", error=str(exc))
        return "error"


async def check_worker(db) -> str:
    """Check worker heartbeat status.

    Returns:
        ok — at least one worker alive (last_seen within 15s)
        stale — all known workers are stale (last_seen older than 15s)
        unknown — no workers registered
    """
    try:
        now = datetime.now(UTC)
        alive_threshold = 15  # seconds

        workers = await db.worker_heartbeats.find({}).to_list(length=100)

        if not workers:
            return "unknown"

        alive_count = 0
        for worker in workers:
            last_seen = worker.get("last_seen")
            if last_seen:
                if last_seen.tzinfo is None:
                    last_seen = last_seen.replace(tzinfo=UTC)
                elapsed = (now - last_seen).total_seconds()
                if elapsed <= alive_threshold:
                    alive_count += 1

        if alive_count > 0:
            return "ok"
        return "stale"
    except Exception as exc:
        logger.error("health_worker_error", error=str(exc))
        return "unknown"


@router.get("/health")
async def health_check():
    """Return system health status."""
    mongodb_status = await check_mongodb()
    redis_status = await check_redis()

    db = await get_db()
    worker_status = await check_worker(db)

    # Overall status: ok only if all three are ok
    if mongodb_status == "ok" and redis_status == "ok" and worker_status == "ok":
        overall = "ok"
    elif mongodb_status == "error" or redis_status == "error":
        overall = "error"
    else:
        overall = "degraded"

    return {
        "status": overall,
        "mongodb": mongodb_status,
        "redis": redis_status,
        "worker": worker_status,
        "timestamp": datetime.now(UTC).isoformat() + "Z",
    }