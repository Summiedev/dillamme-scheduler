"""MongoDB index definitions — applied on startup.

All compound indexes are designed for O(log n) lookup on the primary
scheduling paths.  See architecture.md for the full rationale.
"""

import asyncio
import motor.motor_asyncio

INDEXES = {
    "jobs": [
        # 1. Primary scheduling query — the database-layer priority queue.
        {
            "keys": [
                ("status", 1),
                ("effective_priority", 1),
                ("scheduled_at", 1),
                ("created_at", 1),
            ],
            "name": "idx_scheduling_queue",
        },
        # 2. Starvation scan
        {
            "keys": [("status", 1), ("created_at", 1)],
            "name": "idx_starvation_scan",
        },
        # 3. Recurring job check
        {
            "keys": [("interval", 1), ("status", 1), ("next_run_at", 1)],
            "name": "idx_recurring_check",
        },
        # 4. Unique job_id (dependency resolution + by-id lookups)
        {
            "keys": [("job_id", 1)],
            "name": "idx_job_id_unique",
            "unique": True,
        },
        # 5. Type filtering
        {
            "keys": [("type", 1), ("status", 1)],
            "name": "idx_type_status",
        },
        # 6. TTL — auto-delete completed / cancelled jobs after 7 days
        {
            "keys": [("updated_at", 1)],
            "name": "idx_ttl_completed_cancelled",
            "expireAfterSeconds": 604800,
            "partialFilterExpression": {
                "status": {"$in": ["completed", "cancelled"]}
            },
        },
        # 7. Embedded DLQ lookup
        {
            "keys": [("status", 1), ("dlq.active", 1), ("dlq.failed_at", -1)],
            "name": "idx_dlq_active",
        },
    ],
    "job_logs": [
        {
            "keys": [("job_id", 1)],
            "name": "idx_job_logs_job_id",
        },
        {
            "keys": [("timestamp", -1)],
            "name": "idx_job_logs_timestamp",
        },
        # TTL — auto-delete logs after 30 days
        {
            "keys": [("timestamp", 1)],
            "name": "idx_job_logs_ttl",
            "expireAfterSeconds": 2592000,
        },
    ],
    "worker_heartbeats": [
        {
            "keys": [("worker_id", 1)],
            "name": "idx_worker_heartbeats_worker_id",
            "unique": True,
        },
    ],
}


async def ensure_indexes(db: motor.motor_asyncio.AsyncIOMotorDatabase):
    """Create indexes if they don't already exist (idempotent)."""
    for coll_name, indexes in INDEXES.items():
        collection = db[coll_name]
        existing = await collection.index_information()
        existing_names = {v.get("name", k) for k, v in existing.items() if isinstance(v, dict)}
        for idx in indexes:
            if idx["name"] in existing_names:
                continue
            keys = idx.pop("keys")
            await collection.create_index(keys, **idx)
            idx["keys"] = keys  # restore for logging
    # Log once done
    import structlog

    logger = structlog.get_logger()
    logger.info("db_indexes_ensured")
