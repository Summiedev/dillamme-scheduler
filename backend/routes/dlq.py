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
        {"$match": {}},
        {"$facet": {
            "data": [
                {"$sort": {"failed_at": -1}},
                {"$skip": offset},
                {"$limit": limit},
            ],
            "total": [{"$count": "count"}],
        }},
    ]
    result = await db.dlq.aggregate(pipeline).to_list(length=1)
    row = result[0] if result else {"data": [], "total": []}
    entries = [await _serialize(d) for d in row["data"]]
    total = row["total"][0]["count"] if row["total"] else 0
    return {"dlq": entries, "total": total}


@router.post("/dlq/{job_id}/retry")
async def retry_dlq_entry(job_id: str):
    """Move a DLQ entry back to the jobs collection for retry."""
    db = await get_db()

    dlq_doc = await db.dlq.find_one({"job_id": job_id})
    if dlq_doc is None:
        raise HTTPException(status_code=404, detail="DLQ entry not found")

    now = datetime.now(UTC)
    new_job = {
        "job_id": dlq_doc["job_id"],
        "type": dlq_doc["type"],
        "payload": dlq_doc.get("payload", {}),
        "priority": dlq_doc.get("priority", 2),
        "status": "pending",
        "retry_count": 0,
        "max_retries": 3,
        "scheduled_at": now,
        "interval": dlq_doc.get("interval"),
        "dependencies": dlq_doc.get("dependencies", []),
        "tags": dlq_doc.get("tags", []),
        "error": None,
        "cancel_requested": False,
        "created_at": now,
        "updated_at": now,
        "next_run_at": now,
        "effective_priority": float(dlq_doc.get("priority", 2)),
    }

    await db.jobs.replace_one({"job_id": job_id}, new_job, upsert=True)
    await db.dlq.delete_one({"job_id": job_id})

    logger.info("dlq_retry", job_id=job_id)
    await db.job_logs.insert_one({
        "job_id": job_id,
        "event": "dlq_retry",
        "message": "Manually retried from DLQ",
        "timestamp": now,
    })

    await SSEManager.publish_worker_event("job_updated", new_job)

    return {"job_id": job_id, "status": "pending", "message": "Re-queued from DLQ"}
