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
TERMINAL_DEPENDENCY_FAILURE_STATES = {"failed", "cancelled"}
HEARTBEAT_INTERVAL_SECONDS = 30
HEARTBEAT_STALE_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 2
DEPENDENCY_DEFER_SECONDS = 5
STARVATION_SLA_SECONDS = 30 * 60  # Jobs must cross the queue within 30 minutes.
DLQ_ALERT_COOLDOWN_SECONDS = 3600
last_dlq_count = 0
last_dlq_alert_at: datetime | None = None


# ── Logging helper ────────────────────────────────────────────────────────

def _log(event: str, job_id: str | None = None, **kwargs):
    log = logger.bind(worker_id=settings.worker_id)
    if job_id:
        log = log.bind(job_id=job_id)
    getattr(log, "info")(event, **kwargs)


# ── Helpers ───────────────────────────────────────────────────────────────

async def dependencies_met(job: dict, db) -> tuple[bool, str | None]:
    """Check whether dependencies are satisfied or terminally blocked."""
    deps = job.get("dependencies") or []
    if not deps:
        return True, None
    dep_docs = await db.jobs.find(
        {"job_id": {"$in": deps}}
    ).to_list(length=len(deps))
    dep_map = {d["job_id"]: d for d in dep_docs}

    missing = [dep_id for dep_id in deps if dep_id not in dep_map]
    if missing:
        return False, f"Dependency job(s) no longer exist: {', '.join(missing)}"

    blocking = []
    for dep_id in deps:
        status = dep_map[dep_id]["status"]
        if status == "completed":
            continue
        if status in TERMINAL_DEPENDENCY_FAILURE_STATES:
            return False, f"Dependency job {dep_id} ended in terminal state '{status}'"
        blocking.append(dep_id)

    if blocking:
        _log("dependency_pending", job["job_id"], blocking=blocking)
        return False, None

    return True, None


async def fail_due_to_dependency(job: dict, reason: str, db):
    """Mark a job failed when one of its dependencies cannot resolve."""
    job_id = job["job_id"]
    now = datetime.now(UTC)
    await db.jobs.update_one(
        {"job_id": job_id},
        {"$set": {"status": "failed", "error": reason, "updated_at": now}},
    )
    _log("job_failed_dependency", job_id, reason=reason)
    await write_log(
        db,
        job_id,
        "job_failed_dependency",
        f"Job failed because a dependency could not complete: {reason}",
    )
    await SSEManager.publish_worker_event(
        "job_updated",
        {"job_id": job_id, "status": "failed", "error": reason},
    )


async def claim_job(job_id: str, db):
    """Atomically claim a job using find_one_and_update."""
    now = datetime.now(UTC)
    result = await db.jobs.find_one_and_update(
        {
            "job_id": job_id,
            "status": "pending",
            "$or": [
                {"deferred_until": None},
                {"deferred_until": {"$lte": now}},
            ],
        },
        {
            "$set": {
                "status": "processing",
                "updated_at": now,
                "last_heartbeat": now,
            },
            "$unset": {"deferred_until": ""},
        },
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


async def update_job_heartbeat(db, job_id: str):
    now = datetime.now(UTC)
    await db.jobs.update_one(
        {"job_id": job_id, "status": "processing"},
        {"$set": {"last_heartbeat": now, "updated_at": now}},
    )


async def job_heartbeat_loop(db, job_id: str):
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
        await update_job_heartbeat(db, job_id)


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
        # SLA: a job waiting 30 minutes should be boosted to below priority 1.
        boost_cap = max(float(job["priority"]) - 0.9, 0.0)
        boost = min(boost_cap, boost_cap * ((now - created).total_seconds() / STARVATION_SLA_SECONDS))
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
            boost_cap = max(float(job["priority"]) - 0.9, 0.0)
            boost = min(boost_cap, boost_cap * ((now - created).total_seconds() / STARVATION_SLA_SECONDS))
            new = max(0.1, float(job["priority"]) - boost)
            if new < job.get("effective_priority", float(job["priority"])):
                heap.update_priority(job["job_id"], new)
        _log("starvation_boost", count=len(ops))


async def recover_stuck_jobs(db):
    """Reset jobs whose processing heartbeat has expired back to 'pending'."""
    threshold = datetime.now(UTC) - timedelta(seconds=HEARTBEAT_STALE_SECONDS)
    stuck = await db.jobs.find(
        {
            "status": "processing",
            "$or": [
                {"last_heartbeat": None},
                {"last_heartbeat": {"$lte": threshold}},
            ],
        }
    ).to_list(length=None)
    now = datetime.now(UTC)
    for job in stuck:
        await db.jobs.update_one(
            {"job_id": job["job_id"]},
            {
                "$set": {"status": "pending", "updated_at": now, "deferred_until": None},
                "$unset": {"last_heartbeat": ""},
            },
        )
        _log("stuck_job_recovered", job["job_id"])
    if stuck:
        _log("stuck_jobs_recovered_count", count=len(stuck))


async def check_dlq_threshold(db):
    """Fire alert when DLQ count crosses the threshold."""
    global last_dlq_count, last_dlq_alert_at

    count = await db.jobs.count_documents({"status": "failed", "dlq.active": True})
    crossed_threshold = last_dlq_count < settings.dlq_threshold <= count
    cooldown_elapsed = (
        last_dlq_alert_at is None
        or (datetime.now(UTC) - last_dlq_alert_at).total_seconds() >= DLQ_ALERT_COOLDOWN_SECONDS
    )
    if crossed_threshold and cooldown_elapsed:
        payload = {
            "threshold": settings.dlq_threshold,
            "count": count,
            "worker_id": settings.worker_id,
            "observed_at": datetime.now(UTC).isoformat(),
        }
        await send_dlq_alert_email(payload)
        _log("dlq_threshold_alert", count=count)
        last_dlq_alert_at = datetime.now(UTC)

    last_dlq_count = count


async def send_dlq_alert_email(payload: dict):
    """Mock DLQ alert email sender used by the alert path."""
    logger.info("dlq_alert_email_sent", payload=payload)


def _build_recurring_job(job: dict, now: datetime) -> tuple[dict, datetime] | tuple[None, None]:
    """Build an idempotent next-run document for recurring jobs."""
    interval = job.get("interval")
    if not interval or interval not in INTERVAL_SECONDS:
        return None, None

    delay = INTERVAL_SECONDS[JobInterval(interval)]
    next_run = now + timedelta(seconds=delay)
    recurring_job_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{job['job_id']}:{next_run.isoformat()}"))
    new_job = {
        "job_id": recurring_job_id,
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
        "deferred_until": None,
        "last_heartbeat": None,
        "created_at": now,
        "updated_at": now,
        "next_run_at": next_run,
        "effective_priority": float(job.get("priority", 2)),
        "parent_job_id": job["job_id"],
    }
    return new_job, next_run


async def schedule_recurring_job(job: dict, db):
    """Persist the next recurring run before marking the current job complete."""
    now = datetime.now(UTC)
    new_job, next_run = _build_recurring_job(job, now)
    if new_job is None:
        return None

    await db.jobs.replace_one({"job_id": new_job["job_id"]}, new_job, upsert=True)
    if (next_run - now).total_seconds() <= 3600:
        wheel.schedule(new_job["job_id"], next_run)
    _log("recurring_scheduled", new_job["job_id"], next_run_at=next_run.isoformat(), original_job=job["job_id"])
    await write_log(db, new_job["job_id"], "recurring_scheduled", f"Next run at {next_run.isoformat()}")
    return new_job


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
                    "deferred_until": None,
                    "last_heartbeat": None,
                }
            },
        )
        wheel.schedule(job_id, new_scheduled)
        _log("retry_attempted", job_id, attempt=retry_count, max_retries=max_retries, backoff=delay)
        await write_log(db, job_id, "retry_attempted", f"Retry {retry_count}/{max_retries}: {error_str}")
        await SSEManager.publish_worker_event("job_updated", {"job_id": job_id, "status": "pending", "retry_count": retry_count})
    else:
        # Max retries exhausted → DLQ
        failed_at = datetime.now(UTC)
        dlq_doc = {
            "active": True,
            "failed_at": failed_at,
            "retry_count": retry_count,
            "error": error_str,
            "stack_trace": stack,
        }
        await db.jobs.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    "status": "failed",
                    "error": error_str,
                    "updated_at": failed_at,
                    "dlq": dlq_doc,
                }
            },
        )
        _log("job_failed", job_id, error=error_str)
        await write_log(db, job_id, "job_failed", f"Job failed: {error_str}", {"stack_trace": stack})
        _log("job_failed_dlq", job_id, error=error_str)
        await write_log(db, job_id, "job_failed_dlq", f"Moved to DLQ: {error_str}", {"stack_trace": stack})
        await SSEManager.publish_worker_event(
            "job_updated",
            {"job_id": job_id, "status": "failed", "dlq": {"active": True, "failed_at": failed_at}},
        )
        await check_dlq_threshold(db)

    await release_lock(job_id, redis)


async def handle_success(job: dict, result: dict, db, redis):
    """Handle successful job completion and schedule recurring if needed."""
    job_id = job["job_id"]
    now = datetime.now(UTC)

    try:
        current = await db.jobs.find_one({"job_id": job_id}, {"cancel_requested": 1})
        if current and current.get("cancel_requested"):
            # "Cancelled while processing" means the handler already ran and may have caused side effects, but the persisted state must be cancelled.
            await db.jobs.update_one(
                {"job_id": job_id},
                {"$set": {"status": "cancelled", "updated_at": now}},
            )
            _log("job_cancelled", job_id)
            await write_log(db, job_id, "job_cancelled", "Job cancelled during processing")
            await SSEManager.publish_worker_event("job_updated", {"job_id": job_id, "status": "cancelled"})
            return

        completion = await db.jobs.update_one(
            {"job_id": job_id, "status": "processing", "cancel_requested": {"$ne": True}},
            {"$set": {"status": "completed", "updated_at": now}},
        )
        if completion.matched_count == 0:
            await db.jobs.update_one(
                {"job_id": job_id},
                {"$set": {"status": "cancelled", "updated_at": now}},
            )
            _log("job_cancelled", job_id)
            await write_log(db, job_id, "job_cancelled", "Job cancelled during processing")
            await SSEManager.publish_worker_event("job_updated", {"job_id": job_id, "status": "cancelled"})
            return
    except Exception as exc:
        logger.error("job_complete_update_failed", job_id=job_id, error=str(exc))
        await write_log(db, job_id, "job_complete_update_failed", f"Failed to mark job completed: {exc}")
        return
    finally:
        try:
            await release_lock(job_id, redis)
        except Exception as exc:
            logger.error("job_lock_release_failed", job_id=job_id, error=str(exc))

    scheduled_next_run = None
    try:
        scheduled_next_run = await schedule_recurring_job(job, db)
    except Exception as exc:
        logger.error("recurring_schedule_failed", job_id=job_id, error=str(exc))
        await write_log(
            db,
            job_id,
            "recurring_schedule_failed",
            f"Failed to schedule next recurring run: {exc}",
        )

    _log("job_completed", job_id)
    await write_log(db, job_id, "job_completed", "Job completed successfully", result)
    try:
        await SSEManager.publish_worker_event("job_updated", {"job_id": job_id, "status": "completed"})
    except Exception as exc:
        logger.error("job_completed_event_failed", job_id=job_id, error=str(exc))

    if scheduled_next_run is not None:
        try:
            await SSEManager.publish_worker_event(
                "job_updated",
                {"job_id": scheduled_next_run["job_id"], "status": "pending", "type": scheduled_next_run["type"]},
            )
        except Exception as exc:
            logger.error("recurring_job_event_failed", job_id=scheduled_next_run["job_id"], error=str(exc))


async def process_job(job: dict, db, redis):
    """Full lifecycle: dependency check → claim → lock → execute → success/failure."""
    job_id = job["job_id"]

    # a. Dependency check
    ready, dependency_failure = await dependencies_met(job, db)
    if not ready:
        if dependency_failure:
            await fail_due_to_dependency(job, dependency_failure, db)
        else:
            # Defer the job in Mongo so the poller does not hot-loop on it.
            now = datetime.now(UTC)
            retry_at = now + timedelta(seconds=DEPENDENCY_DEFER_SECONDS)
            await db.jobs.update_one(
                {"job_id": job_id, "status": "pending"},
                {"$set": {"deferred_until": retry_at, "updated_at": now}},
            )
            wheel.schedule(job_id, retry_at)
        return

    # b. Claim job atomically
    claimed = await claim_job(job_id, db)
    if claimed is None:
        return  # already claimed by another worker

    await SSEManager.publish_worker_event("job_updated", {"job_id": claimed["job_id"], "status": "processing"})

    # c. Redis lock
    if not await acquire_lock(job_id, redis):
        logger.warning("job_lock_acquire_failed", job_id=job_id, worker_id=settings.worker_id)
        await write_log(
            db,
            job_id,
            "job_lock_acquire_failed",
            "Redis lock acquisition failed; leaving job in processing for heartbeat-based recovery",
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
    heartbeat_task = None
    try:
        handler = get_handler(job["type"])

        await update_job_heartbeat(db, job_id)

        # Lock extension background task for long-running jobs
        async def extend_if_needed():
            while True:
                await asyncio.sleep(settings.lock_extend_threshold)
                await extend_lock(job_id, redis)

        extender = asyncio.create_task(extend_if_needed())
        heartbeat_task = asyncio.create_task(job_heartbeat_loop(db, job_id))

        result = await handler(job.get("payload", {}))

        # Cancel extender if job finishes under threshold
        extender.cancel()
        try:
            await extender
        except asyncio.CancelledError:
            pass

        if heartbeat_task is not None:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
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
        if heartbeat_task is not None:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
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
        "$or": [
            {"deferred_until": None},
            {"deferred_until": {"$lte": now}},
        ],
    }).sort([
        ("effective_priority", 1),
        ("scheduled_at", 1),
        ("created_at", 1),
    ]).to_list(500)
    heap.heapify(existing)
    _log("worker_started", heap_size=len(existing))

    while True:
        try:
            now = datetime.now(UTC)
            tick_start = datetime.now(UTC)

            # 1. Tick timing wheel
            due_job_ids = wheel.tick()
            for jid in due_job_ids:
                doc = await db.jobs.find_one({
                    "job_id": jid,
                    "status": "pending",
                    "$or": [
                        {"deferred_until": None},
                        {"deferred_until": {"$lte": now}},
                    ],
                })
                if doc:
                    ready, dependency_failure = await dependencies_met(doc, db)
                    if ready:
                        heap.push(doc)
                    elif dependency_failure:
                        await fail_due_to_dependency(doc, dependency_failure, db)
                    else:
                        retry_at = datetime.now(UTC) + timedelta(seconds=DEPENDENCY_DEFER_SECONDS)
                        await db.jobs.update_one(
                            {"job_id": jid, "status": "pending"},
                            {"$set": {"deferred_until": retry_at, "updated_at": datetime.now(UTC)}},
                        )
                        wheel.schedule(jid, retry_at)

            # 2. Poll MongoDB for pending jobs not in heap
            now = datetime.now(UTC)
            cursor = db.jobs.find({
                "status": "pending",
                "scheduled_at": {"$lte": now},
                "$or": [
                    {"deferred_until": None},
                    {"deferred_until": {"$lte": now}},
                ],
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
