"""Metrics route: GET /api/metrics — single aggregation pipeline."""

from fastapi import APIRouter
from db.connection import get_db

router = APIRouter(prefix="/api", tags=["metrics"])


@router.get("/metrics")
async def get_metrics():
    """Return aggregated job metrics using a single $facet pipeline.

    One database round-trip for all counts — documented in architecture.md.
    """
    db = await get_db()

    pipeline = [
        {
            "$facet": {
                "by_status": [
                    {"$group": {"_id": "$status", "count": {"$sum": 1}}}
                ]
            }
        }
    ]

    results = []
    async for doc in db.jobs.aggregate(pipeline):
        results.append(doc)

    by_status = {}
    if results:
        for item in results[0].get("by_status", []):
            by_status[item["_id"]] = item["count"]

    total_jobs = sum(by_status.values())
    dlq_size = await db.dlq.count_documents({})

    return {
        "by_status": by_status,
        "total_jobs": total_jobs,
        "dlq_size": dlq_size,
    }
