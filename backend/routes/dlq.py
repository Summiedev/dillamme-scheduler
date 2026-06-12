"""DLQ routes: GET /api/dlq, POST /api/dlq/:id/retry."""

from __future__ import annotations

from datetime import datetime, UTC
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from db.connection import get_db
from core.sse_manager import SSEManager
from utils.logger import get_logger

router = APIRouter(prefix="/api", tags=["dlq"])
logger = get_logger()


async def _serialize(doc: dict) -> dict:
    if doc is None:
        return None
    doc["_id"] = str(doc["_id"])
    return doc


@router.get("/dlq")
async def list_dlq(limit: int = 50, offset: int = 0):
    db = await get_db()
    pipeline = [
        {"$match": {"status": "failed", "dlq.active": True}},
        {"$facet": {
            "data": [
                {"$sort": {"dlq.failed_at": -1}},
                {"$skip": offset},
                {"$limit": limit},
            ],
            "total": [{"$count": "count"}],
        }},
    ]
    result = await db.jobs.aggregate(pipeline).to_list(length=1)
    row = result[0] if result else {"data": [], "total": []}
    entries = [await _serialize(d) for d in row["data"]]
    total = row["total"][0]["count"] if row["total"] else 0
    return {"dlq": entries, "total": total}


@router.post("/dlq/{job_id}/retry")
async def retry_dlq_entry(job_id: str):
    """Move a DLQ entry back to the jobs collection for retry."""
    db = await get_db()
    now = datetime.now(UTC)
    current = await db.jobs.find_one({"job_id": job_id})
    if current is None:
        raise HTTPException(status_code=404, detail="DLQ entry not found")

    dlq_state = current.get("dlq") or {}
    if current.get("status") == "pending" and not dlq_state.get("active"):
        return {"job_id": job_id, "status": "pending", "message": "Re-queued from DLQ"}
    if current.get("status") != "failed" or not dlq_state.get("active"):
        raise HTTPException(status_code=409, detail="DLQ entry is no longer available")

    retry_update = await db.jobs.update_one(
        {"job_id": job_id, "status": "failed", "dlq.active": True},
        {
            "$set": {
                "status": "pending",
                "retry_count": 0,
                "scheduled_at": now,
                "error": None,
                "cancel_requested": False,
                "deferred_until": None,
                "last_heartbeat": None,
                "updated_at": now,
                "next_run_at": now,
                "effective_priority": float(current.get("priority", 2)),
            },
            "$unset": {"dlq": ""},
        },
    )

    if retry_update.matched_count == 0:
        current = await db.jobs.find_one({"job_id": job_id})
        if current is not None and current.get("status") == "pending" and not (current.get("dlq") or {}).get("active"):
            return {"job_id": job_id, "status": "pending", "message": "Re-queued from DLQ"}
        raise HTTPException(status_code=409, detail="DLQ entry is no longer available")

    logger.info("dlq_retry", job_id=job_id)
    await db.job_logs.insert_one({
        "job_id": job_id,
        "event": "dlq_retry",
        "message": "Manually retried from DLQ",
        "timestamp": now,
    })

    updated = await db.jobs.find_one({"job_id": job_id})
    await SSEManager.publish_worker_event("job_updated", await _serialize(updated))

    return {"job_id": job_id, "status": "pending", "message": "Re-queued from DLQ"}
