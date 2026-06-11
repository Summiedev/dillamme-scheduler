"""Job CRUD routes: POST /api/jobs, GET /api/jobs, GET /api/jobs/:id, DELETE /api/jobs/:id."""
from __future__ import annotations
import json

from datetime import datetime, UTC
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from models.job import JobCreate, JobDocument, JobStatus
from db.connection import get_db
from core.sse_manager import sse_manager, SSEManager
from utils.logger import get_logger

router = APIRouter(prefix="/api", tags=["jobs"])
logger = get_logger()


async def _serialize(doc: dict) -> dict:
    """Convert ObjectId to string for JSON serialization."""
    if doc is None:
        return None
    doc["_id"] = str(doc["_id"])
    return doc
def _json_serial(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")

@router.post("/jobs", status_code=201)
async def create_job(body: JobCreate):
    """Create a new job."""
    db = await get_db()
    now = datetime.now(UTC)
    doc = {
        "job_id": str(uuid4()),
        "type": body.type,
        "payload": body.payload,
        "priority": body.priority.value,
        "status": JobStatus.pending.value,
        "retry_count": 0,
        "max_retries": body.max_retries,
        "scheduled_at": body.scheduled_at or now,
        "interval": body.interval.value if body.interval else None,
        "dependencies": body.dependencies,
        "tags": body.tags,
        "error": None,
        "cancel_requested": False,
        "created_at": now,
        "updated_at": now,
        "next_run_at": body.scheduled_at or now,
        "effective_priority": float(body.priority.value),
    }
    result = await db.jobs.insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    logger.info("job_created", job_id=doc["job_id"], type=body.type)
    await db.job_logs.insert_one({
        "job_id": doc["job_id"],
        "event": "job_created",
        "message": f"Job {body.type} created",
        "timestamp": now,
    })

    # Broadcast event
    await SSEManager.publish_worker_event("job_updated", json.loads(json.dumps(doc, default=_json_serial)))

    return doc


@router.get("/jobs")
async def list_jobs(
    status: str | None = Query(None),
    type: str | None = Query(None),
    priority: int | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    db = await get_db()
    match: dict = {}
    if status:
        match["status"] = status
    if type:
        match["type"] = type
    if priority:
        match["priority"] = priority

    pipeline = [
        {"$match": match},
        {"$facet": {
            "data": [
                {"$sort": {"created_at": -1}},
                {"$skip": offset},
                {"$limit": limit},
            ],
            "total": [{"$count": "count"}],
        }},
    ]
    result = await db.jobs.aggregate(pipeline).to_list(length=1)
    row = result[0] if result else {"data": [], "total": []}
    jobs = [await _serialize(d) for d in row["data"]]
    total = row["total"][0]["count"] if row["total"] else 0
    return {"jobs": jobs, "total": total, "limit": limit, "offset": offset}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Get a single job by job_id."""
    db = await get_db()
    doc = await db.jobs.find_one({"job_id": job_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return await _serialize(doc)


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    """Delete a job permanently by job_id."""
    db = await get_db()
    doc = await db.jobs.find_one({"job_id": job_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if doc.get("status") == "processing":
        raise HTTPException(status_code=409, detail="Job is currently being processed. Wait for it to complete or fail before deleting, or cancel it first.")

    await db.jobs.delete_one({"job_id": job_id})

    logger.info("job_deleted", job_id=job_id)
    await SSEManager.publish_worker_event("job_deleted", {"job_id": job_id})

    return {"deleted": True, "job_id": job_id}


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a job. Sets cancel_requested for processing jobs, cancels pending jobs immediately."""
    db = await get_db()
    doc = await db.jobs.find_one({"job_id": job_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if doc["status"] in ("completed", "failed", "cancelled"):
        raise HTTPException(status_code=409, detail="Job cannot be cancelled in its current state")

    now = datetime.now(UTC)

    if doc["status"] == "processing":
        await db.jobs.update_one(
            {"job_id": job_id},
            {"$set": {"cancel_requested": True, "updated_at": now}},
        )
    else:  # pending
        await db.jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": "cancelled", "cancel_requested": True, "updated_at": now}},
        )

    updated = await db.jobs.find_one({"job_id": job_id})

    logger.info("job_cancelled", job_id=job_id)
    await db.job_logs.insert_one({
        "job_id": job_id,
        "event": "job_cancelled",
        "message": f"Job cancelled (was {doc['status']})",
        "timestamp": now,
    })

    await SSEManager.publish_worker_event("job_updated", await _serialize(updated))
    return await _serialize(updated)


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: str):
    db = await get_db()
    doc = await db.jobs.find_one({"job_id": job_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if doc["status"] != "failed":
        raise HTTPException(status_code=409, detail="Only failed jobs can be retried.")
    now = datetime.now(UTC)
    await db.jobs.update_one(
        {"job_id": job_id},
        {"$set": {"status": "pending", "retry_count": 0, "error": None, "updated_at": now}},
    )
    updated = await db.jobs.find_one({"job_id": job_id})
    await db.job_logs.insert_one({
        "job_id": job_id,
        "event": "job_retry_requested",
        "message": "Job manually retried",
        "timestamp": now,
    })
    await SSEManager.publish_worker_event("job_updated", await _serialize(updated))
    return await _serialize(updated)
