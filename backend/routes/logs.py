"""Logs route: GET /api/logs — retrieve job logs."""

from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from db.connection import get_db
from utils.logger import get_logger

router = APIRouter(prefix="/api", tags=["logs"])
logger = get_logger()


async def _serialize(doc: dict) -> dict:
    if doc is None:
        return None
    doc["_id"] = str(doc["_id"])
    return doc


@router.get("/logs")
async def get_logs(
    job_id: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    db = await get_db()
    query = {}
    if job_id:
        job = await db.jobs.find_one({"job_id": job_id})
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        query["job_id"] = job_id
    if level:
        query["event"] = level
    if search:
        if len(search) > 200:
            raise HTTPException(status_code=400, detail="Search string too long")
        query["message"] = {"$regex": re.escape(search), "$options": "i"}

    cursor = (
        db.job_logs.find(query)
        .sort("timestamp", -1)
        .skip(offset)
        .limit(limit)
    )
    entries = []
    async for doc in cursor:
        entries.append(await _serialize(doc))

    total = await db.job_logs.count_documents(query)

    return {"logs": entries, "total": total, "limit": limit, "offset": offset}
