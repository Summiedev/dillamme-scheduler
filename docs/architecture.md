# Dilamme Scheduler — Architecture

## Overview

Dilamme Scheduler is a distributed background job scheduler built with Python, FastAPI, MongoDB, and Redis. It provides job queuing, scheduling, retry logic, dependency graphs (DAG workflows), and real-time event streaming via SSE.

## Process Model

Two independent processes managed by PM2:

1. **API process** (`main.py`): FastAPI + Uvicorn. Serves REST API, SSE endpoint, and health checks.
2. **Worker process** (`worker.py`): Standalone async loop. Picks up pending jobs, executes handlers, manages retries and DLQ.

The processes NEVER import each other. They communicate only via MongoDB and Redis.

```
┌─────────────┐     HTTP      ┌──────────────┐
│   Clients   │ ◄───────────► │  FastAPI API  │
└─────────────┘               └──────┬───────┘
                                     │
                            ┌────────▼───────┐
                            │     Redis      │
                            │  (pub/sub +    │
                            │   locks)       │
                            └────────▲───────┘
                                     │
                            ┌────────┴───────┐
                            │    MongoDB     │
                            │ (persistence)  │
                            └────────▲───────┘
                                     │
                            ┌────────┴───────┐
                            │    Worker      │
                            │  (separate     │
                            │   process)     │
                            └────────────────┘
```

## MongoDB Design

MongoDB is chosen deliberately for this system because:

- **Document model**: Job payloads are arbitrary JSON — a natural fit for document storage.
- **Atomic operations**: `find_one_and_update` enables lock-free job claiming with an indexed status filter.
- **Compound indexes**: Priority queue queries on `{ status, effective_priority, scheduled_at, created_at }` are O(log n).
- **TTL indexes**: Auto-expire completed jobs and logs without application-level cleanup.
- **MongoDB atomic operations** replace Redis for some locking needs (e.g., job claiming), though Redis is still used for distributed worker locks.

### Collections

- `jobs` — Primary job storage
- `dlq` — Dead-letter queue
- `job_logs` — Audit log entries
- `worker_heartbeats` — Worker health tracking

### Compound Indexes

| Index | Purpose | Fields |
|-------|---------|--------|
| `idx_scheduling_queue` | Primary scheduling query — the database-layer priority queue | `{ status: 1, effective_priority: 1, scheduled_at: 1, created_at: 1 }` |
| `idx_starvation_scan` | Starvation detection | `{ status: 1, created_at: 1 }` |
| `idx_recurring_check` | Recurring job scheduling | `{ interval: 1, status: 1, next_run_at: 1 }` |
| `idx_job_id_unique` | Dependency resolution + by-id lookups | `{ job_id: 1 }` (unique) |
| `idx_type_status` | Type-filtered queries | `{ type: 1, status: 1 }` |
| `idx_ttl_completed_cancelled` | Auto-delete completed/cancelled jobs after 7 days | `{ updated_at: 1 }` (TTL, partial filter for completed/cancelled) |

## Performance Characteristics

| Operation | Complexity | Mechanism |
|-----------|-----------|-----------|
| Job claim (worker picks next job) | O(log n) | Indexed `find_one_and_update` |
| Job insertion | O(log n) | Compound index |
| Priority queue lookup | O(log n) | Compound index on `{ status, effective_priority, scheduled_at, created_at }` |
| Starvation scan | O(k) where k = pending jobs count | Index scan on status + created_at |
| Dependency check | O(d) where d = dependency count | In-memory check after fetch |
| DLQ insert | O(log n) | Indexed insert |
| Log write | O(1) | Fire-and-forget (non-blocking async task) |

The MongoDB compound index on `{ status, effective_priority, scheduled_at, created_at }` is the database-layer priority queue for the scheduler. Queries against this index are O(log n) and serve the same role as a heap extract-min in the storage layer.

## Duplicate Protection

Two mandatory layers:

### Layer 1 — MongoDB Atomic Claim

```
result = db.jobs.find_one_and_update(
    { job_id: "...", status: "pending" },
    { $set: { status: "processing" } }
)
```

If the document was already claimed by another worker, the filter will not match and returns `None`. This prevents duplicate transitions into `processing` status.

### Layer 2 — Redis NX Lock

```
SET job_lock:{job_id} {worker_id} NX EX 30
```

NX means only set if the key does not exist. If it returns `None`, another worker holds the lock. Skip.

**Why both layers are required**: MongoDB's atomic claim prevents two workers from processing the same job simultaneously at the database level. The Redis NX lock provides a faster, in-memory distributed lock that protects against race conditions during the window between the MongoDB claim and actual processing. Together they provide defense-in-depth against duplicate execution.

## Worker Loop

The worker loop runs every 2 seconds (configurable via `WORKER_POLL_INTERVAL`):

1. **Tick the timing wheel** — collect jobs due this second
2. **Poll MongoDB** — find pending jobs with `scheduled_at <= now`
3. **Starvation check** (every 60s) — age-boost stuck jobs
4. **Process heap** — for each job: dependency check → claim → lock → execute → success/failure
5. **Heartbeat** — update `worker_heartbeats` in MongoDB

### Lock Extension

If a job takes longer than 20 seconds to process, a background asyncio task extends the Redis lock TTL by 30 seconds. This prevents the lock from expiring while the job is still processing.

## Retry + Backoff

Failed jobs retry up to 3 times with exponential backoff + jitter:

| Attempt | Base Delay | Jitter Range |
|---------|-----------|--------------|
| 1 | 1s | ±0.2s |
| 2 | 5s | ±1.0s |
| 3 | 25s | ±3.0s |

Formula: `max(0.1, base_delay[attempt-1] + uniform(-jitter[attempt-1], jitter[attempt-1]))`

## Dead-Letter Queue (DLQ)

When `retry_count >= max_retries` and the job fails:

1. Job status updated to `failed` in `jobs` collection
2. Document inserted into `dlq` collection with error details and stack trace
3. DLQ count checked — if >= 10, fires `dlq_threshold` alert via SSE

### DLQ Threshold

The DLQ threshold is set at **10 jobs**. When the DLQ count reaches this threshold, the system fires a `dlq_threshold_alert` event via SSE and logs `dlq_threshold_alert`.

### Manual Retry

`POST /api/dlq/:id/retry` moves a DLQ entry back to the `jobs` collection with `status: pending`, `retry_count: 0`, and `scheduled_at: now`. If it fails all retries again, it returns to DLQ.

## DAG Workflow (Dependencies)

Jobs can declare dependencies as a list of `job_ids`. A job will not run until all its dependencies have `status: completed`.

The dependency check logic:
```python
async def dependencies_met(job, db) -> bool:
    if not job.dependencies:
        return True
    dep_docs = await db.jobs.find({"job_id": {"$in": job.dependencies}}).to_list()
    if len(dep_docs) != len(job.dependencies):
        return False  # some dependencies don't exist
    return all(d["status"] == "completed" for d in dep_docs)
```

If dependencies are not met, the job is removed from the heap and re-queued on the next poll cycle with a 5-second delay. A `dependency_pending` log event is emitted listing which dependencies are blocking.

### Example DAG Workflow

- **Job A**: `type="generate_report"`
- **Job B**: `type="upload_file"` with `dependencies=["<job_a_id>"]`
- **Job C**: `type="send_email"` with `dependencies=["<job_b_id>"]`

Job C will not run until B completes. B will not run until A completes.

### Known Limitations

**DAG Failure Propagation**
Currently, if a dependency job fails, downstream jobs that depend on it will remain in "pending" state indefinitely. There is no automatic failure cascading. This is a known gap.

The intended fix (not yet implemented) is a periodic check that scans pending jobs whose dependencies are in "failed" status and automatically transitions them to "cancelled" with a reason of "dependency_failed". This would run alongside the starvation check every 60 seconds.

For now, failed DAG chains require manual intervention: either retry the failed dependency job or manually cancel the downstream jobs.

## Recurring Jobs

When a recurring job completes, a **new** job document is created with the same `type`, `payload`, `priority`, and `interval`. The original completed job is not modified.

| Interval | Delay |
|----------|-------|
| `every_1_minute` | 60s |
| `every_5_minutes` | 300s |
| `every_1_hour` | 3600s |

If the interval delay <= 3600 seconds, the new job is scheduled via the timing wheel. Otherwise, it relies on the MongoDB scheduler poll.

## Cancellation

- **Pending jobs**: Cancelled immediately by updating status to `cancelled`, removed from heap and timing wheel.
- **Processing jobs**: Cooperative cancellation model. The job is marked as `cancel_requested: true` in MongoDB. The worker checks this flag after each processing step and stops processing if set.
- **Completed/failed/cancelled jobs**: Return 409 Conflict — cannot be cancelled.

### Cooperative Cancellation Tradeoffs

Cooperative cancellation means that a running job is not forcibly terminated. Instead, a flag is set that the worker checks. This design avoids the complexity and potential corruption of forcefully interrupting job execution, but it means that a long-running job may continue processing for some time after the cancellation request. The worker checks the flag after the handler completes, so jobs that are actively processing will finish their current execution before honouring the cancellation.

## Job Deletion

Hard deletion of jobs is supported via DELETE /api/jobs/{job_id}. Jobs in "processing" state cannot be deleted — the endpoint returns 409. This prevents orphaned Redis locks and ensures the worker can complete its current execution cleanly. To delete a processing job, cancel it first and wait for the worker to transition it to "cancelled", then delete.

## SSE (Server-Sent Events)

`GET /api/events` returns a `StreamingResponse` with `text/event-stream` content type.

Since the worker is a separate process:
- Worker publishes events to Redis pub/sub channel `job_events`
- FastAPI subscribes to `job_events` during its lifespan and fans out to all connected SSE clients
- Events include: `job_updated`, `dlq_threshold`, `connected`

### Nginx Configuration

```nginx
location /api/events {
    proxy_pass http://backend;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    chunked_transfer_encoding on;
}
```

## Metrics

`GET /api/metrics` uses a single MongoDB aggregation pipeline with `$facet`:

```python
pipeline = [
    {
        "$facet": {
            "by_status": [
                {"$group": {"_id": "$status", "count": {"$sum": 1}}}
            ]
        }
    }
]
```

This is one database round-trip for all counts — no separate count queries.

## Health Check

`GET /api/health` returns:

```json
{
    "status": "ok|degraded|error",
    "mongodb": "ok|error",
    "redis": "ok|error",
    "worker": "ok|stale|unknown",
    "timestamp": "ISO8601"
}
```

Worker health logic:
- **alive**: `last_seen` within the last 15 seconds
- **stale**: `last_seen` older than 15 seconds
- **ok**: at least one worker is alive
- **stale**: all known workers are stale
- **unknown**: no workers registered in `worker_heartbeats`

A dead worker does not mask a live one — each worker is evaluated individually.

## Logging

All logging uses `structlog` with JSON output to stdout AND `logs/app.jsonl`. The event names used throughout the system are:

- `job_created`
- `job_started`
- `job_completed`
- `job_failed`
- `retry_attempted`
- `job_cancelled`
- `job_failed_dlq`
- `recurring_scheduled`
- `dependency_pending`
- `starvation_boost`
- `dlq_threshold_alert`
- `sse_client_connected`
- `sse_event_broadcast`
- `api_started`
- `api_shutdown`
- `worker_heartbeat`

Never use `print()` or `console.log()`. Never log raw passwords, tokens, or full payloads in production mode.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URL` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGODB_DB_NAME` | `dillame_scheduler` | MongoDB database name |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection string |
| `API_PORT` | `8000` | FastAPI port |
| `WORKER_ID` | `worker-01` | Unique worker identifier |
| `LOG_LEVEL` | `INFO` | Logging level |
| `ENVIRONMENT` | `development` | Runtime environment |