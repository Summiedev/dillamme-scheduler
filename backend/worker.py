"""Dilamme Scheduler — Worker Process.

Runs independently from FastAPI.  Communicates via MongoDB + Redis only.
Managed by PM2.  Never imported by main.py.
"""

from __future__ import annotations

import asyncio
import random
import sys
import traceback
import uuid
from datetime import datetime, timedelta, UTC

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import structlog

from pymongo import UpdateOne
from config import settings
from core.backoff import calculate_backoff
from core.sse_manager import SSEManager
from core.timing_wheel import TimingWheel, PriorityQueue, IndexedPriorityQueue
from db.connection import get_db, get_redis, close_db_connections
from db.indexes import ensure_indexes
from handlers import get_handler
from models.job import INTERVAL_SECONDS, JobInterval

logger = structlog.get_logger()

# ── Shared state ──────────────────────────────────────────────────────────

wheel = TimingWheel()
heap = IndexedPriorityQueue()
last_starvation_check = datetime.now(UTC)


# ── Logging helper ────────────────────────────────────────────────────────

def _log(event: str, job_id: str | None = None, **kwargs):
    log = logger.bind(worker_id=settings.worker_id)
    if job_id:
        log = log.bind(job_id=job_id)
    getattr(log, "info")(event, **kwargs)


# ── Helpers ───────────────────────────────────────────────────────────────

async def dependencies_met(job: dict, db) -> bool:
    """Check if all dependencies of a job are completed."""
    deps = job.get("dependencies") or []
    if not deps:
        return True
    dep_docs = await db.jobs.find(
        {"job_id": {"$in": deps}}
    ).to_list(length=len(deps))
    if len(dep_docs) != len(deps):
        blocking = set(deps) - {d["job_id"] for d in dep_docs}
        _log("dependency_pending", job["job_id"], blocking=list(blocking))
        return False
    ready = all(d["status"] == "completed" for d in dep_docs)
    if not ready:
        blocking = [d["job_id"] for d in dep_docs if d["status"] != "completed"]
        _log("dependency_pending", job["job_id"], blocking=blocking)
    return ready


async def claim_job(job_id: str, db):
    """Atomically claim a job using find_one_and_update."""
    now = datetime.now(UTC)
    result = await db.jobs.find_one_and_update(
        {"job_id": job_id, "status": "pending"},
        {"$set": {"status": "processing", "updated_at": now}},
        return_document=True,
    )
    return result


async def acquire_lock(job_id: str, redis) -> bool:
    """Acquire Redis NX lock for duplicate protection."""
    result = await redis.set(
        f"job_lock:{job_id}",
        settings.worker_id,
        nx=True,
        ex=settings.redis_lock_ttl,
    )
    return result is True


async def release_lock(job_id: str, redis):
    """Release the Redis lock."""
    # Only delete if we still hold it
    val = await redis.get(f"job_lock:{job_id}")
    if val == settings.worker_id:
        await redis.delete(f"job_lock:{job_id}")


async def extend_lock(job_id: str, redis):
    """Extend Redis lock TTL for long-running jobs."""
    val = await redis.get(f"job_lock:{job_id}")
    if val == settings.worker_id:
        await redis.expire(f"job_lock:{job_id}", settings.lock_extend_by)


async def write_log(db, job_id: str, event: str, message: str, metadata: dict | None = None):
    doc = {
        "job_id": job_id,
        "event": event,
        "message": message,
        "metadata": metadata,
        "timestamp": datetime.now(UTC),
    }
    try:
        await db.job_logs.insert_one(doc)
    except Exception:
        logger.error("log_write_failed", job_id=job_id, event=event)


async def send_heartbeat(db):
    await db.worker_heartbeats.update_one(
        {"worker_id": settings.worker_id},
        {"$set": {"worker_id": settings.worker_id, "last_seen": datetime.now(UTC)}},
        upsert=True,
    )
    _log("worker_heartbeat")


async def starvation_check(db):
    threshold = datetime.now(UTC) - timedelta(seconds=settings.starvation_age_threshold)
    jobs = await db.jobs.find(
        {"status": "pending", "created_at": {"$lte": threshold}}
    ).to_list(length=None)
    now = datetime.now(UTC)
    ops = []
    for job in jobs:
        created = job["created_at"]
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        age_min = (now - created).total_seconds() / 60.0
        boost = min(age_min / 10.0, 2.0)
        new = max(0.1, float(job["priority"]) - boost)
        if new < job.get("effective_priority", float(job["priority"])):
            ops.append(UpdateOne(
                {"job_id": job["job_id"]},
                {"$set": {"effective_priority": new, "updated_at": now}}
            ))
    if ops:
        await db.jobs.bulk_write(ops)
        for job in jobs:
            created = job["created_at"]
            if created.tzinfo is None:
                created = created.replace(tzinfo=UTC)
            age_min = (now - created).total_seconds() / 60.0
            boost = min(age_min / 10.0, 2.0)
            new = max(0.1, float(job["priority"]) - boost)
            if new < job.get("effective_priority", float(job["priority"])):
                heap.update_priority(job["job_id"], new)
        _log("starvation_boost", count=len(ops))


async def recover_stuck_jobs(db):
    """Reset jobs stuck in 'processing' state for over 5 minutes back to 'pending'."""
    threshold = datetime.now(UTC) - timedelta(minutes=5)
    stuck = await db.jobs.find(
        {"status": "processing", "updated_at": {"$lte": threshold}}
    ).to_list(length=None)
    now = datetime.now(UTC)
    for job in stuck:
        await db.jobs.update_one(
            {"job_id": job["job_id"]},
            {"$set": {"status": "pending", "updated_at": now}},
        )
        _log("stuck_job_recovered", job["job_id"])
    if stuck:
        _log("stuck_jobs_recovered_count", count=len(stuck))


async def check_dlq_threshold(db):
    """Fire alert if DLQ count exceeds threshold."""
    count = await db.dlq.count_documents({})
    if count >= settings.dlq_threshold:
        _log("dlq_threshold_alert", count=count)
        await SSEManager.publish_worker_event(
            "dlq_threshold", {"count": count}
        )


async def handle_failure(job: dict, error: Exception, db, redis):
    """Handle a failed job: retry with backoff or move to DLQ."""
    job_id = job["job_id"]
    retry_count = job.get("retry_count", 0) + 1
    max_retries = job.get("max_retries", 3)
    error_str = str(error)
    stack = traceback.format_exc()

    if retry_count < max_retries:
        delay = calculate_backoff(retry_count)
        new_scheduled = datetime.now(UTC) + timedelta(seconds=delay)
        await db.jobs.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    "status": "pending",
                    "retry_count": retry_count,
                    "scheduled_at": new_scheduled,
                    "error": error_str,
                    "updated_at": datetime.now(UTC),
                }
            },
        )
        wheel.schedule(job_id, new_scheduled)
        _log("retry_attempted", job_id, attempt=retry_count, max_retries=max_retries, backoff=delay)
        await write_log(db, job_id, "retry_attempted", f"Retry {retry_count}/{max_retries}: {error_str}")
        await SSEManager.publish_worker_event("job_updated", {"job_id": job_id, "status": "pending", "retry_count": retry_count})
    else:
        # Max retries exhausted → DLQ
        await db.jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": "failed", "error": error_str, "updated_at": datetime.now(UTC)}},
        )
        _log("job_failed", job_id, error=error_str)
        await write_log(db, job_id, "job_failed", f"Job failed: {error_str}", {"stack_trace": stack})
        dlq_doc = {
            "job_id": job_id,
            "type": job["type"],
            "priority": job.get("priority", 2),
            "payload": job.get("payload", {}),
            "error": error_str,
            "stack_trace": stack,
            "retry_count": retry_count,
            "failed_at": datetime.now(UTC),
            "created_at": datetime.now(UTC),
        }
        await db.dlq.replace_one({"job_id": job_id}, dlq_doc, upsert=True)
        _log("job_failed_dlq", job_id, error=error_str)
        await write_log(db, job_id, "job_failed_dlq", f"Moved to DLQ: {error_str}", {"stack_trace": stack})
        await SSEManager.publish_worker_event("job_updated", {"job_id": job_id, "status": "failed"})
        await check_dlq_threshold(db)

    await release_lock(job_id, redis)


async def handle_success(job: dict, result: dict, db, redis):
    """Handle successful job completion and schedule recurring if needed."""
    job_id = job["job_id"]
    now = datetime.now(UTC)

    await db.jobs.update_one(
        {"job_id": job_id},
        {"$set": {"status": "completed", "updated_at": now}},
    )
    await release_lock(job_id, redis)
    _log("job_completed", job_id)
    await write_log(db, job_id, "job_completed", "Job completed successfully", result)
    await SSEManager.publish_worker_event("job_updated", {"job_id": job_id, "status": "completed"})

    # Recurring job logic
    interval = job.get("interval")
    if interval and interval in INTERVAL_SECONDS:
        delay = INTERVAL_SECONDS[JobInterval(interval)]
        next_run = now + timedelta(seconds=delay)
        new_job = {
            "job_id": str(uuid.uuid4()),
            "type": job["type"],
            "payload": job.get("payload", {}),
            "priority": job.get("priority", 2),
            "status": "pending",
            "retry_count": 0,
            "max_retries": job.get("max_retries", 3),
            "scheduled_at": next_run,
            "interval": interval,
            "dependencies": job.get("dependencies", []),
            "tags": job.get("tags", []),
            "error": None,
            "cancel_requested": False,
            "created_at": now,
            "updated_at": now,
            "next_run_at": next_run,
            "effective_priority": float(job.get("priority", 2)),
        }
        await db.jobs.insert_one(new_job)
        await SSEManager.publish_worker_event("job_updated", {"job_id": new_job["job_id"], "status": "pending", "type": new_job["type"]})
        if delay <= 3600:
            wheel.schedule(new_job["job_id"], next_run)
        _log("recurring_scheduled", new_job["job_id"], next_run_at=next_run.isoformat(), original_job=job_id)
        await write_log(db, new_job["job_id"], "recurring_scheduled", f"Next run at {next_run.isoformat()}")


async def process_job(job: dict, db, redis):
    """Full lifecycle: dependency check → claim → lock → execute → success/failure."""
    job_id = job["job_id"]

    # a. Dependency check
    if not await dependencies_met(job, db):
        # Re-queue with delay
        retry_at = datetime.now(UTC) + timedelta(seconds=5)
        wheel.schedule(job_id, retry_at)
        return

    # b. Claim job atomically
    claimed = await claim_job(job_id, db)
    if claimed is None:
        return  # already claimed by another worker

    await SSEManager.publish_worker_event("job_updated", {"job_id": claimed["job_id"], "status": "processing"})

    # c. Redis lock
    if not await acquire_lock(job_id, redis):
        # Another worker holds lock, release MongoDB claim
        await db.jobs.update_one(
            {"job_id": job_id, "status": "processing"},
            {"$set": {"status": "pending", "updated_at": datetime.now(UTC)}},
        )
        return

    _log("job_started", job_id)
    await write_log(db, job_id, "job_started", f"Worker {settings.worker_id} processing")

    # d. Cancel check
    job_doc = await db.jobs.find_one({"job_id": job_id})
    if job_doc and job_doc.get("cancel_requested"):
        await db.jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": "cancelled", "updated_at": datetime.now(UTC)}},
        )
        await release_lock(job_id, redis)
        _log("job_cancelled", job_id)
        await write_log(db, job_id, "job_cancelled", "Job cancelled during processing")
        await SSEManager.publish_worker_event("job_updated", {"job_id": job_id, "status": "cancelled"})
        return

    # e. Process
    extender = None
    try:
        handler = get_handler(job["type"])

        # Lock extension background task for long-running jobs
        async def extend_if_needed():
            while True:
                await asyncio.sleep(settings.lock_extend_threshold)
                await extend_lock(job_id, redis)

        extender = asyncio.create_task(extend_if_needed())

        result = await handler(job.get("payload", {}))

        # Cancel extender if job finishes under threshold
        extender.cancel()
        try:
            await extender
        except asyncio.CancelledError:
            pass

        await handle_success(job, result, db, redis)

    except Exception as exc:
        if extender is not None:
            extender.cancel()
            try:
                await extender
            except asyncio.CancelledError:
                pass
        await handle_failure(job, exc, db, redis)


# ── Main worker loop ──────────────────────────────────────────────────────

async def run_worker():
    """Main worker event loop."""
    db = await get_db()
    redis = await get_redis()

    await ensure_indexes(db)

    # Recover stuck jobs on startup
    await recover_stuck_jobs(db)
    last_stuck_recovery = datetime.now(UTC)

    now = datetime.now(UTC)
    existing = await db.jobs.find({
        "status": "pending",
        "scheduled_at": {"$lte": now},
    }).sort([
        ("effective_priority", 1),
        ("scheduled_at", 1),
        ("created_at", 1),
    ]).to_list(500)
    heap.heapify(existing)
    _log("worker_started", heap_size=len(existing))

    while True:
        try:
            tick_start = datetime.now(UTC)

            # 1. Tick timing wheel
            due_job_ids = wheel.tick()
            for jid in due_job_ids:
                doc = await db.jobs.find_one({"job_id": jid, "status": "pending"})
                if doc and await dependencies_met(doc, db):
                    heap.push(doc)

            # 2. Poll MongoDB for pending jobs not in heap
            now = datetime.now(UTC)
            cursor = db.jobs.find({
                "status": "pending",
                "scheduled_at": {"$lte": now},
            }).sort([
                ("effective_priority", 1),
                ("scheduled_at", 1),
                ("created_at", 1),
            ]).limit(50)
            async for doc in cursor:
                heap.push(doc)

            # 3. Starvation check (every 60s)
            global last_starvation_check
            if (now - last_starvation_check).total_seconds() >= settings.starvation_check_interval:
                await starvation_check(db)
                last_starvation_check = now

            # 4. Stuck job recovery (every 5 minutes)
            if (now - last_stuck_recovery).total_seconds() >= 300:
                await recover_stuck_jobs(db)
                last_stuck_recovery = now

            # 5. Process heap
            while heap:
                job = heap.pop()
                if job is None:
                    break
                await process_job(job, db, redis)

            # 6. Heartbeat
            await send_heartbeat(db)

            # 7. Wait for next poll interval
            elapsed = (datetime.now(UTC) - tick_start).total_seconds()
            sleep_time = max(0.1, settings.worker_poll_interval - elapsed)
            await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            _log("worker_shutdown")
            break
        except Exception as exc:
            logger.error("worker_loop_error", error=str(exc), traceback=traceback.format_exc())
            await asyncio.sleep(5)


async def main():
    await run_worker()


if __name__ == "__main__":
    from utils.logger import setup_logging
    setup_logging()
    
    if sys.platform == "win32":
        loop = asyncio.SelectorEventLoop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(main())
    else:
        asyncio.run(main())
