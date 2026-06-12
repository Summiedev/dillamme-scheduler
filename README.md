# Dilamme Scheduler

A background job scheduler built with FastAPI, MongoDB, and Redis. Jobs are created via a REST API, queued in a heap-based priority queue, dispatched by an independent worker process, and tracked in real time via Server-Sent Events. The system handles retries, dead-letter queuing, DAG-based dependency chains, recurring schedules, starvation prevention, and duplicate protection without any manual intervention.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [How the Heap Works](#how-the-heap-works)
4. [DAG Workflow](#dag-workflow)
5. [Scheduling Algorithms](#scheduling-algorithms)
6. [Job Lifecycle](#job-lifecycle)
7. [Recurring Jobs](#recurring-jobs)
8. [Duplicate Protection](#duplicate-protection)
9. [Starvation Prevention](#starvation-prevention)
10. [Live Updates (SSE)](#live-updates-sse)
11. [Environment Variables](#environment-variables)
12. [Using the Live Deployment](#using-the-live-deployment)
13. [How to Run Locally](#how-to-run-locally)
14. [Running the Benchmark](#running-the-benchmark)
15. [API Reference](#api-reference)
16. [Architecture Decision Log](#architecture-decision-log)
17. [Known Limitations](#known-limitations)

---

## Architecture Overview

Two independent OS processes managed by PM2. They never import each other. All coordination happens through MongoDB and Redis.

```
┌──────────────┐   HTTPS    ┌─────────────────────────────────────┐
│   Browser    │ ◄────────► │  Nginx (reverse proxy + TLS)        │
└──────────────┘            └──────────────┬──────────────────────┘
                                           │
                            ┌──────────────▼──────────────────────┐
                            │  FastAPI / Uvicorn  (main.py)       │
                            │  • REST API  (CRUD, cancel, retry)  │
                            │  • SSE endpoint  (/api/events)      │
                            │  • Health + metrics                 │
                            └──────────────┬──────────────────────┘
                                           │
                            ┌──────────────▼──────────────────────┐
                            │  Redis                              │
                            │  • pub/sub channel: job_events      │
                            │  • NX locks: job_lock:{job_id}      │
                            └──────────────┬──────────────────────┘
                                           │
                            ┌──────────────▼──────────────────────┐
                            │  MongoDB                            │
                            │  • jobs collection                  │
                            │  • job_logs collection              │
                            │  • worker_heartbeats collection     │
                            └──────────────┬──────────────────────┘
                                           │
                            ┌──────────────▼──────────────────────┐
                            │  Worker process  (worker.py)        │
                            │  • Timing wheel tick                │
                            │  • MongoDB poll                     │
                            │  • IndexedPriorityQueue (heap)      │
                            │  • Starvation check (every 60s)     │
                            │  • Stuck-job recovery (every 5m)    │
                            │  • Heartbeat (every 30s)            │
                            └─────────────────────────────────────┘
```

**Worker loop cadence (every 2 seconds by default):**

1. Tick the timing wheel — collect job IDs due this second, push them onto the heap.
2. Poll MongoDB for any pending jobs with `scheduled_at <= now` not already in the heap.
3. Every 60 s: run starvation check, age-boost long-waiting jobs.
4. Every 5 min: recover stuck jobs whose heartbeat has expired.
5. Drain the heap: for each job, run dependency check → atomic claim → Redis lock → execute handler → success/failure path.
6. Write worker heartbeat to MongoDB.

---

## Tech Stack

* `fastapi` ≥ 0.110
* `uvicorn[standard]` ≥ 0.29
* `motor` ≥ 3.3
* `redis` ≥ 5.0
* `pydantic` ≥ 2.6
* `pydantic-settings` ≥ 2.2
* `structlog` ≥ 24.1
* `python-dotenv` ≥ 1.0
* `aiofiles` ≥ 23.2
* `python-multipart` ≥ 0.0.9
* React + Vite
* TailwindCSS
* TanStack Query
* PM2
* Nginx
* MongoDB
* Redis

---

## How the Heap Works

The worker uses an `IndexedPriorityQueue` — a min-heap with O(log n) in-place priority updates.

### Ordering

Jobs are ordered by a three-field sort key:

```
(effective_priority, scheduled_at, created_at)
```

Lower values are popped first. This means:

- Priority 1 (High) beats Priority 2 (Medium) beats Priority 3 (Low).
- Among equal priorities, the job scheduled earliest runs first.
- Among equal priority and schedule time, the job created earliest runs first.

`effective_priority` starts equal to `priority` and is reduced by the starvation algorithm over time (see [Starvation Prevention](#starvation-prevention)).

### When Jobs Enter the Heap

Scheduled jobs (future `scheduled_at`) do **not** enter the heap until their time is due. They are held in the timing wheel and promoted to the heap when the wheel ticks their slot. Jobs with `scheduled_at <= now` are loaded directly from MongoDB into the heap on startup and on every poll cycle.

Recurring jobs re-enter the heap after their parent completes: a new job document is written to MongoDB and scheduled via the timing wheel.

### Lazy Deletion

When a job's priority changes (starvation boost), the old heap entry is not removed immediately. Instead:

1. The old entry is marked stale by incrementing a serial counter in the index.
2. A new entry with the updated key is pushed onto the heap.
3. On `pop()`, any entry whose serial does not match the current index entry is skipped (lazy deletion).

If dead entries exceed `max(32, live_count)`, the heap is rebuilt from scratch to reclaim memory.

This gives O(log n) priority updates without a full heap rebuild on every starvation tick.

---

## DAG Workflow

Jobs can declare a list of `dependencies` — other job IDs that must reach `completed` status before this job runs.

### Dependency Resolution

Before a job is claimed, the worker calls `dependencies_met()`:

1. Fetch all dependency documents from MongoDB in a single query.
2. If any dependency document is missing → fail the job immediately with reason `"Dependency job(s) no longer exist"`.
3. If any dependency is in a terminal failure state (`failed` or `cancelled`) → fail the job immediately with reason `"Dependency job {id} ended in terminal state '{state}'"`.
4. If any dependency is still `pending` or `processing` → defer the job by 5 seconds (`deferred_until`) and reschedule it on the timing wheel. Log `dependency_pending`.
5. If all dependencies are `completed` → proceed to claim.

### Terminal State Propagation

If a dependency ends in `failed` or `cancelled`, all downstream jobs that depend on it are immediately failed with a descriptive error message. This is checked at claim time, not proactively — see [Known Limitations](#known-limitations) for the gap.

### Cycle Detection

Cycle detection runs at job creation time in the API (`POST /api/jobs`). Before inserting the document, `_validate_dependency_graph()` performs a depth-first traversal of the dependency graph using the existing jobs in MongoDB. If a cycle is detected, the API returns `400` with the cycle path:

```
Circular dependency detected: job-a -> job-b -> job-a
```

### Example DAG

```
Job A: type="generate_report"
  ↓
Job B: type="upload_file",    dependencies=["<job_a_id>"]
  ↓
Job C: type="send_email",     dependencies=["<job_b_id>"]
```

Job C will not run until B completes. B will not run until A completes. If A fails, B is immediately failed. If B fails, C is immediately failed.

---

## Scheduling Algorithms

Two algorithms run side by side in the worker. They are not alternatives — they serve different roles.

### Algorithm 1: IndexedPriorityQueue (Heap)

**What it is:** A min-heap backed by Python's `heapq` module with an index dictionary for O(log n) priority updates and lazy deletion of stale entries.

**When it is used:** Holds all jobs that are currently due and ready to run. Every worker loop iteration drains the heap, processing jobs in priority order.

**Complexity:**
- Push: O(log n)
- Pop: O(log n) amortised (lazy deletion skips stale entries)
- Priority update: O(log n) — push new entry, mark old entry stale

### Algorithm 2: TimingWheel

**What it is:** A circular array of 3,600 slots, one slot per second, covering a 1-hour window. Each slot holds a list of `WheelEntry` objects. Slot index = `int(scheduled_at.timestamp()) % 3600`.

**When it is used:** Holds jobs that are scheduled in the future (up to 1 hour ahead). On each worker tick, the current second's slot is checked. Due jobs are promoted to the heap. Jobs scheduled more than 1 hour ahead are not placed in the wheel — they are picked up by the MongoDB poll when their time arrives.

**Complexity:**
- Schedule: O(1)
- Tick (check current slot): O(k) where k = jobs due this second
- Full rotation: O(n) over 3,600 ticks

### Benchmark Results

Workload: 10,000 jobs, mixed priorities, scheduled within a 60-second window. 100 measured iterations after 1 warm-up pass.

| Benchmark | Workload | Mean (ms) | P50 (ms) | P95 (ms) | Stddev (ms) |
|---|---|---|---|---|---|
| PriorityQueue | insert 10,000 + drain | — | — | — | — |
| TimingWheel + Heap | insert 10,000 + drain | — | — | — | — |
| MongoDB indexed | 50,000 docs, top 100 | — | — | — | — |
| MongoDB no index | 50,000 docs, top 100 | — | — | — | — |

> Run `python benchmark.py` from `backend/` to generate live numbers on your hardware. See [Running the Benchmark](#running-the-benchmark).

**Published reference numbers** (from `docs/benchmark.md`, single-machine run):

Benchmark          | Workload                      | Mean (ms) | P50 (ms) | P95 (ms) | Stddev (ms)
-------------------+-------------------------------+-----------+----------+----------+------------
PriorityQueue      | insert 10,000, drain in order | 64.787    | 61.406   | 93.935   | 14.797
TimingWheel + Heap | insert 10,000, drain in order | 58.859    | 52.317   | 96.654   | 20.088
Mongo indexed      | 50,000 docs, top 100          | 2.033     | 1.807    | 3.464    | 0.899
Mongo no index     | 50,000 docs, top 100          | 222.606   | 224.324  | 257.556  | 27.143

**Tradeoffs:**

- The heap alone is simpler and faster for workloads where all jobs are immediately due. It has no concept of time ,so every job pushed is immediately eligible.
- The timing wheel adds a time dimension. Jobs are not pushed to the heap until their second arrives, which keeps the heap small and avoids processing jobs before their scheduled time. The cost is the overhead of ticking the wheel on every loop iteration and the 1-hour horizon limit.
- The MongoDB indexed query is slower per call than the in-memory structures but is the authoritative source of truth and handles persistence, crash recovery, and multi-worker scenarios.

---

## Job Lifecycle

```
pending ──► processing ──► completed
                │
                ▼
             failed (retry_count < max_retries)
                │
                ▼ (retry with backoff)
             pending ──► processing ──► ...
                │
                ▼ (retry_count >= max_retries)
             failed + dlq.active = true
```

Cancellation can happen from `pending` or `processing`:

```
pending ──► cancelled   (immediate)
processing ──► cancelled (cooperative: cancel_requested flag checked after handler returns)
```

### Retry Backoff Formula

```python
base_delays  = [1, 5, 25]       # seconds
jitter_ranges = [0.2, 1.0, 3.0] # ± seconds

delay = max(0.1, base_delays[attempt-1] + uniform(-jitter_ranges[attempt-1], jitter_ranges[attempt-1]))
```

| Attempt | Base | Jitter | Effective range |
|---|---|---|---|
| 1 | 1 s | ±0.2 s | 0.8 – 1.2 s |
| 2 | 5 s | ±1.0 s | 4.0 – 6.0 s |
| 3 | 25 s | ±3.0 s | 22.0 – 28.0 s |

After attempt 3 (when `retry_count >= max_retries`), the job is marked `failed` and a `dlq` subdocument is embedded in the job document:

```json
{
  "dlq": {
    "active": true,
    "failed_at": "2026-06-12T10:00:00Z",
    "retry_count": 3,
    "error": "...",
    "stack_trace": "..."
  }
}
```

### DLQ Threshold and Alert

The DLQ threshold is **10 jobs**. When the count of `{ status: "failed", "dlq.active": true }` documents crosses this threshold, the worker calls `send_dlq_alert_email()` and logs `dlq_threshold_alert`. The alert has a 1-hour cooldown — it will not fire again within 3,600 seconds of the last alert, regardless of how many more jobs land in the DLQ.

### Cancellation Behaviour

- **Pending jobs:** Cancelled immediately. Status set to `cancelled` in MongoDB. No handler is invoked.
- **Processing jobs:** Cooperative cancellation. `cancel_requested: true` is set in MongoDB. The worker checks this flag after the handler returns. If set, the job is marked `cancelled` even if the handler succeeded. This means the handler's side effects (e.g., an email was sent) may have already occurred. This is documented behaviour — see [Architecture Decision Log](#architecture-decision-log).
- **Completed / failed / cancelled jobs:** `POST /api/jobs/{id}/cancel` returns `409 Conflict`.

---

## Recurring Jobs

When a job with an `interval` field completes successfully, the worker creates a **new** job document before marking the current job `completed`. The original job is not modified.

### Re-scheduling Logic

```python
delay = INTERVAL_SECONDS[interval]   # 60, 300, or 3600
next_run = now + timedelta(seconds=delay)
new_job_id = uuid5(NAMESPACE_URL, f"{original_job_id}:{next_run.isoformat()}")
```

The new job ID is deterministic (UUID v5) — if the worker crashes and restarts between creating the next-run document and marking the current job complete, the `replace_one(..., upsert=True)` call is idempotent.

If `delay <= 3600`, the new job is also placed in the timing wheel for precise wakeup. Otherwise it relies on the MongoDB poll.

| Interval | Delay |
|---|---|
| `every_1_minute` | 60 s |
| `every_5_minutes` | 300 s |
| `every_1_hour` | 3,600 s |

### On Failure

If a recurring job fails and exhausts all retries, it lands in the DLQ like any other job. No next run is scheduled. The recurring chain stops until the DLQ entry is manually retried and succeeds.

---

## Duplicate Protection

Two mandatory layers enforce one-job-one-worker:

### Layer 1 — MongoDB Atomic Claim

```python
result = await db.jobs.find_one_and_update(
    {
        "job_id": job_id,
        "status": "pending",
        "$or": [
            {"deferred_until": None},
            {"deferred_until": {"$lte": now}},
        ],
    },
    {"$set": {"status": "processing", "updated_at": now, "last_heartbeat": now}},
    return_document=True,
)
```

MongoDB's document-level atomic write guarantees that only one caller can transition a job from `pending` to `processing`. If the document was already claimed, the filter does not match and returns `None`. The worker skips the job.

### Layer 2 — Redis NX Lock

```
SET job_lock:{job_id} {worker_id} NX EX 30
```

`NX` means "set only if the key does not exist". If another worker already holds the lock, `SET` returns `None` and the current worker skips the job, leaving it in `processing` for heartbeat-based recovery.

**Why both layers are required:** The MongoDB claim prevents duplicate `processing` transitions at the database level. The Redis lock provides a faster in-memory guard against race conditions in the window between the MongoDB write and the start of actual execution. Together they provide defence-in-depth.

### Lock Extension

For long-running jobs, a background `asyncio` task extends the Redis lock TTL every `LOCK_EXTEND_THRESHOLD` seconds (default: 20 s), extending by `LOCK_EXTEND_BY` seconds (default: 30 s). This prevents the lock from expiring while the job is still processing.

### Stuck Job Recovery

If a worker crashes mid-job, the heartbeat stops updating. Every 5 minutes, the worker scans for jobs in `processing` state whose `last_heartbeat` is older than 60 seconds (2× the 30-second heartbeat interval). These jobs are reset to `pending` so they can be picked up again.

---

## Starvation Prevention

Low-priority jobs cannot wait indefinitely while high-priority jobs keep arriving.

### Threshold

The starvation check runs every **60 seconds** (`STARVATION_CHECK_INTERVAL`). It targets jobs that have been `pending` for more than **300 seconds** (`STARVATION_AGE_THRESHOLD`, 5 minutes).

### Boost Formula

```python
boost_cap = max(priority - 0.9, 0.0)
boost     = min(boost_cap, boost_cap * (age_seconds / SLA_SECONDS))
new_effective_priority = max(0.1, priority - boost)
```

Where `SLA_SECONDS = 1800` (30 minutes).

- A Priority 3 (Low) job that has waited 30 minutes gets `boost_cap = 2.1`, `boost = 2.1`, `new = max(0.1, 3 - 2.1) = 0.9`. It now sorts ahead of all Priority 1 jobs (effective priority 0.9 < 1.0).
- A Priority 2 (Medium) job at 30 minutes gets `boost_cap = 1.1`, `boost = 1.1`, `new = max(0.1, 2 - 1.1) = 0.9`.
- Boost is proportional to age — a job at 15 minutes gets half the maximum boost.

### SLA Guarantee

Any job that has been pending for 30 minutes will have its `effective_priority` reduced to below 1.0, placing it ahead of all unaged Priority 1 jobs. This is the SLA: **no job waits more than 30 minutes without being promoted above the highest base priority**.

The updated `effective_priority` is written to MongoDB and also applied to the in-memory heap via `IndexedPriorityQueue.update_priority()`.

---

## Live Updates (SSE)

The UI uses **Server-Sent Events** (SSE). The endpoint is `GET /api/events`.

### Architecture

The worker is a separate process and cannot write directly to FastAPI's in-memory SSE client list. The bridge is Redis pub/sub:

1. Worker publishes to Redis channel `job_events` after every status change.
2. FastAPI subscribes to `job_events` during its lifespan startup (`sse_manager.start()`).
3. The Redis subscriber task fans out each message to all connected SSE clients via per-client `asyncio.Queue` objects (max size 256).
4. Each SSE client stream reads from its queue and yields `text/event-stream` formatted chunks.

### Event Types

| Event | Trigger |
|---|---|
| `job_updated` | Job created, status changed, retry scheduled, cancelled, completed |
| `job_deleted` | Job permanently deleted |
| `dlq_threshold` | DLQ count crosses the threshold |
| `connected` | Sent immediately on SSE connection |

### Reconnect Behaviour

The frontend uses a custom `sseManager` class. On disconnect, it reconnects with exponential backoff. On reconnect, it calls `queryClient.refetchQueries({ type: 'active' })` to re-sync all active queries, ensuring no updates are missed during the disconnection window.

### Nginx Configuration

The SSE endpoint requires a dedicated Nginx location block with buffering disabled:

```nginx
location /api/events {
    proxy_pass         http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header   Connection '';
    proxy_buffering    off;
    proxy_cache        off;
    proxy_read_timeout 86400s;
    chunked_transfer_encoding on;
    add_header         X-Accel-Buffering no;
}
```

Without `proxy_buffering off`, Nginx buffers the response and the browser never receives events.

---

## Environment Variables

All variables are read from `backend/.env`. Copy `backend/.env.example` to `backend/.env` and fill in the values.


---

## Using the Live Deployment

**Live URL:** [https://dillema.duckdns.org](https://dillema.duckdns.org)

**API base URL:** `https://dillema.duckdns.org/api`

**Swagger UI:** [https://dillema.duckdns.org/docs](https://dillema.duckdns.org/docs)

No authentication is required. No API keys or headers are needed beyond `Content-Type: application/json` for POST requests.
MONGODB_URL=
MONGODB_DB_NAME=dillame_scheduler
REDIS_URL=
WORKER_ID=worker-01
ENVIRONMENT=production
ALLOWED_ORIGINS=["[https://dilamme.duckdns.org](https://dillema.duckdns.org)"]
---

### UI Walkthrough

#### Dashboard

Open [https://dillema.duckdns.org](https://dillema.duckdns.org). The dashboard shows live job counts by status: pending, processing, completed, failed, cancelled. Counts update in real time via SSE — no page refresh needed.

#### Jobs Table

The Jobs page shows all jobs with columns: ID, type, priority, status, retry count, scheduled time, interval, created time. The table updates live as jobs move through statuses.

#### Creating a Job

Click **Create Job** to open the form. Fields:

| Field | What it does | Valid values / examples |
|---|---|---|
| **Type** | The handler that will execute this job | `send_email`, `webhook`, `log_processing`, `generate_report`, `upload_file` |
| **Priority** | Execution order relative to other jobs | `1` = High, `2` = Medium, `3` = Low. Click the button for the level you want |
| **Scheduled At** | When the job becomes eligible to run. Leave blank to run immediately | `datetime-local` input. Example: `2026-06-15T14:30` — the job will not run until that local time |
| **Interval** | Makes the job recurring. After each successful run, the next run is scheduled automatically | `every_1_minute` (60 s), `every_5_minutes` (300 s), `every_1_hour` (3600 s). Leave blank for a one-time job |
| **Max Retries** | How many times to retry on failure before moving to DLQ | Integer 0–10. Default: 3 |
| **Dependencies** | Other jobs that must complete before this job runs | Search by job ID or type in the dropdown. Select one or more jobs |
| **Payload** | JSON object passed to the handler | Must be valid JSON. The form pre-fills an example payload for each job type |

**Payload examples by type:**

`send_email`:
```json
{
  "to": "user@example.com",
  "subject": "Your weekly report is ready",
  "body": "Hi there, your report has been generated."
}
```
Required fields: `to` (valid email), `subject` (non-empty string).

`webhook`:
```json
{
  "url": "https://webhook.site/test",
  "method": "POST",
  "body": { "event": "job.completed" }
}
```
Required fields: `url` (must start with `http://` or `https://`).

`log_processing`:
```json
{
  "message": "User login event detected",
  "level": "info",
  "source": "auth-service"
}
```
Required fields: `message` (non-empty string).

`generate_report`:
```json
{
  "report_type": "sales",
  "format": "pdf",
  "filters": { "date_from": "2026-06-01", "date_to": "2026-06-12" }
}
```

`upload_file`:
```json
{
  "file_name": "monthly_report.pdf",
  "destination": "https://storage.example.com/reports/"
}
```

#### Creating a DAG Workflow

To create a three-job chain (generate → upload → email):

1. Create Job A: type `generate_report`, no dependencies. Note the job ID from the response or the jobs table.
2. Create Job B: type `upload_file`. In the Dependencies field, search for Job A's ID and select it.
3. Create Job C: type `send_email`. In the Dependencies field, search for Job B's ID and select it.

Job B will stay `pending` until Job A reaches `completed`. Job C will stay `pending` until Job B reaches `completed`. Watch the statuses update live on the dashboard.

#### Creating a Recurring Job

Create a job with any type and set the **Interval** field to one of the three options. After the job completes, a new job document appears in the jobs table automatically with the same type, payload, and priority, scheduled for the next interval. The chain continues indefinitely until a run fails and exhausts retries.

#### Scheduling a Future Job

Set the **Scheduled At** field to any future datetime. The job will be created with `status: pending` but will not be picked up by the worker until `scheduled_at <= now`. Jobs scheduled within the next hour are placed in the timing wheel for precise wakeup. Jobs scheduled further ahead are picked up by the MongoDB poll when their time arrives.

Format: the form uses a `datetime-local` input, which produces a local datetime string. The frontend converts it to ISO 8601 UTC before sending to the API. You can also send UTC directly via the API: `"scheduled_at": "2026-06-15T14:30:00Z"`.

#### Watching a Job Move Through Statuses

After creating a job, stay on the Dashboard or Jobs page. Within 2 seconds (the worker poll interval), the job's status will change from `pending` to `processing`, then to `completed`. The status badge updates in place without a page refresh. The dashboard counters update simultaneously.

#### Triggering a Failure and Watching Retries

To trigger a failure, create a `webhook` job with an unreachable URL:

```json
{
  "url": "https://this-host-does-not-exist.invalid/hook",
  "method": "POST",
  "body": {}
}
```

The handler will throw a connection error. Watch the jobs table:

1. Status changes to `processing`.
2. Status returns to `pending` with `retry_count: 1`. The job is rescheduled ~1 second later.
3. Status changes to `processing` again.
4. Status returns to `pending` with `retry_count: 2`. Rescheduled ~5 seconds later.
5. Status changes to `processing` again.
6. Status changes to `failed` with `retry_count: 3`. The job appears in the DLQ view.

All transitions are visible live without refreshing.

#### Using the DLQ View

Navigate to the **DLQ** page. Each entry shows:

- Job ID, type, priority
- Error message (the exception string from the handler)
- Stack trace (expandable)
- Retry count and failed timestamp

To manually retry a DLQ entry, click the **Retry** button on that row. The job is moved back to `pending` with `retry_count: 0` and `scheduled_at: now`. If it fails all retries again, it returns to the DLQ.

#### Cancelling a Job

From the Jobs table, click the **Cancel** button on any `pending` or `processing` job.

- **Pending:** Status changes to `cancelled` immediately. The job will not be processed.
- **Processing:** `cancel_requested` is set to `true`. The worker checks this flag after the handler returns and marks the job `cancelled`. The handler may have already executed and produced side effects (e.g., an email may have been sent). This is a known tradeoff — see [Architecture Decision Log](#architecture-decision-log).
- **Completed / failed / cancelled:** The cancel button is disabled. The API returns `409` if you attempt it directly.

#### Hitting the API Directly

**Create a job:**
```bash
curl -X POST https://dillema.duckdns.org/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send_email",
    "priority": 1,
    "payload": {
      "to": "test@example.com",
      "subject": "Hello from the scheduler"
    }
  }'
```

**Check job status:**
```bash
curl https://dillema.duckdns.org/api/jobs/<job_id>
```

Replace `<job_id>` with the `job_id` field from the create response.

**Manually retry a DLQ entry:**
```bash
curl -X POST https://dillema.duckdns.org/api/dlq/<job_id>/retry
```

**List all DLQ entries:**
```bash
curl https://dillema.duckdns.org/api/dlq
```

**Cancel a job:**
```bash
curl -X POST https://dillema.duckdns.org/api/jobs/<job_id>/cancel
```

**Check system health:**
```bash
curl https://dillema.duckdns.org/api/health
```

---

## How to Run Locally

### Prerequisites

- Python 3.11+
- Node.js 18+
- MongoDB running on `localhost:27017`
- Redis running on `localhost:6379`

### 1. Clone the repository

```bash
git clone https://github.com/Summiedev/dillamme-scheduler.git
cd dillamme-scheduler
```

### 2. Set up the backend

```bash
cd backend
python -m venv .venv

# Linux / macOS
source .venv/bin/activate

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=dillame_scheduler
REDIS_URL=redis://localhost:6379/0
WORKER_ID=worker-01
ENVIRONMENT=development
ALLOWED_ORIGINS=["http://localhost:5173"]
```

### 4. Start the API

```bash
# From backend/
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API is now available at `http://localhost:8000`. Swagger UI at `http://localhost:8000/docs`.

### 5. Start the worker (separate terminal)

```bash
# From backend/, with the venv activated
python worker.py
```

The worker will log `worker_started` and begin polling.

### 6. Set up the frontend

```bash
cd ../frontend
npm install
```

Create `frontend/.env.local`:

```env
VITE_API_URL=http://localhost:8000/api
```

### 7. Start the frontend

```bash
npm run dev
```

The UI is available at `http://localhost:5173`.

### 8. Verify everything is running

```bash
curl http://localhost:8000/api/health
```

Expected response:
```json
{
  "status": "ok",
  "mongodb": "ok",
  "redis": "ok",
  "worker": "ok",
  "timestamp": "2026-06-12T..."
}
```

If `worker` is `unknown`, the worker process has not sent its first heartbeat yet. Wait 30 seconds and retry.

---

## Running the Benchmark

The benchmark requires a running MongoDB instance on `localhost:27017`. It creates and drops a temporary database (`bench_test`) automatically.

```bash
cd backend
# With venv activated
python benchmark.py
```

The script runs four benchmarks:

1. **PriorityQueue** — insert 10,000 jobs, drain in priority order. Measures pure heap performance.
2. **TimingWheel + Heap** — schedule 10,000 jobs on the wheel, tick forward second by second, promote due jobs to the heap, drain. Measures the combined scheduling pipeline.
3. **MongoDB indexed** — query 50,000 documents with a compound index on `(status, effective_priority, scheduled_at, created_at)`, return top 100.
4. **MongoDB no index** — same query without the index (full collection scan).

Each benchmark runs 1 warm-up iteration followed by 100 measured iterations. Output is a table printed to stdout:

```
Benchmark          | Workload                          | Mean (ms) | P50 (ms) | P95 (ms) | Stddev (ms)
-------------------+-----------------------------------+-----------+----------+----------+------------
PriorityQueue      | insert 10,000, drain in order     | ...       | ...      | ...      | ...
TimingWheel + Heap | insert 10,000, drain in order     | ...       | ...      | ...      | ...
Mongo indexed      | 50,000 docs, top 100              | ...       | ...      | ...      | ...
Mongo no index     | 50,000 docs, top 100              | ...       | ...      | ...      | ...
```

**Reading the output:**

- **Mean** is the average wall-clock time per iteration in milliseconds.
- **P50** is the median — half of iterations were faster than this.
- **P95** is the 95th percentile — 95% of iterations were faster than this. High P95 relative to P50 indicates occasional slow outliers.
- **Stddev** measures consistency. Low stddev means predictable performance.

The MongoDB benchmark creates and drops a real collection. It requires write access to the local MongoDB instance. The benchmark database (`bench_test`) is dropped on completion.

---

## API Reference

All routes are prefixed with `/api`. The full interactive spec is at `/docs` (Swagger UI) or `/openapi.json`.

### Jobs

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/jobs` | Create a new job |
| `GET` | `/api/jobs` | List jobs. Query params: `status`, `type`, `priority`, `limit` (max 500), `offset` |
| `GET` | `/api/jobs/{job_id}` | Get a single job by `job_id` |
| `DELETE` | `/api/jobs/{job_id}` | Permanently delete a job. Returns `409` if status is `processing` |
| `POST` | `/api/jobs/{job_id}/cancel` | Cancel a pending or processing job |
| `POST` | `/api/jobs/{job_id}/retry` | Re-queue a failed job (resets `retry_count` to 0, clears DLQ flag) |

### DLQ

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/dlq` | List DLQ entries (`status: failed, dlq.active: true`). Query params: `limit`, `offset` |
| `POST` | `/api/dlq/{job_id}/retry` | Move a DLQ entry back to `pending` with `retry_count: 0` |

### Metrics

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/metrics` | Job counts by status, total jobs, DLQ size |

### Logs

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/logs` | List structured log entries. Query params: `job_id`, `event`, `limit`, `offset` |

### Events

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/events` | SSE stream. Events: `connected`, `job_updated`, `job_deleted`, `dlq_threshold` |

### Health

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/health` | Returns MongoDB, Redis, and worker health status |

### Job Create Request Body

```json
{
  "type": "send_email",
  "payload": { "to": "user@example.com", "subject": "Hello" },
  "priority": 1,
  "max_retries": 3,
  "scheduled_at": "2026-06-15T10:00:00Z",
  "interval": "every_1_hour",
  "dependencies": ["<job_id_1>", "<job_id_2>"],
  "tags": ["email", "transactional"]
}
```

All fields except `type` and `payload` are optional. `priority` defaults to `2` (Medium). `max_retries` defaults to `3`.

---

## Architecture Decision Log

### 1. Two separate processes instead of background threads

**Decision:** The API (`main.py`) and worker (`worker.py`) are separate OS processes managed by PM2. They communicate only via MongoDB and Redis.

**Why:** A single process with background threads would couple the worker's lifecycle to the API's. A crash in the worker would take down the API and vice versa. Separate processes allow independent restarts, independent scaling, and independent deployment. PM2 handles crash recovery for both.

**Tradeoff:** Requires a message-passing layer (Redis pub/sub) for SSE events. Direct in-process function calls are not possible.

### 2. MongoDB atomic claim instead of a separate lock table

**Decision:** Job claiming uses `find_one_and_update` with a `status: "pending"` filter. The status transition to `processing` is the lock.

**Why:** MongoDB's document-level atomic writes make this safe without a separate lock collection. The compound index on `(status, effective_priority, scheduled_at, created_at)` makes the claim query O(log n). Adding a separate lock table would add a round trip and a new failure mode.

**Tradeoff:** The Redis NX lock is still required as a second layer because the MongoDB claim and the start of actual execution are not atomic — there is a window where the job is `processing` in MongoDB but the handler has not started yet.

### 3. Cooperative cancellation for processing jobs

**Decision:** Cancelling a processing job sets `cancel_requested: true` in MongoDB. The worker checks this flag after the handler returns and marks the job `cancelled`.

**Why:** Forcibly killing a running coroutine risks leaving external systems in an inconsistent state (e.g., a partially sent email, a half-written file). Cooperative cancellation lets the handler complete its current unit of work cleanly before honouring the cancellation.

**Tradeoff:** The handler's side effects may have already occurred by the time the cancellation is honoured. This is documented and accepted. Users who need pre-execution cancellation should cancel the job while it is still `pending`.

### 4. Timing wheel for future scheduling, heap for execution order

**Decision:** Jobs scheduled in the future are held in a timing wheel (1-second slots, 1-hour horizon). When their slot arrives, they are promoted to the heap. The heap handles execution ordering.

**Why:** Putting all future jobs directly in the heap would work but wastes heap operations on jobs that cannot run yet. The timing wheel is O(1) to schedule and O(k) to tick, where k is the number of jobs due in the current second. This keeps the heap small and focused on jobs that are actually ready.

**Tradeoff:** The timing wheel has a 1-hour horizon. Jobs scheduled more than 1 hour ahead are not in the wheel — they rely on the MongoDB poll. This is acceptable because the poll runs every 2 seconds and will pick them up when their time arrives.

### 5. Embedded DLQ subdocument instead of a separate collection

**Decision:** DLQ state is stored as a `dlq` subdocument embedded in the job document (`dlq.active`, `dlq.failed_at`, `dlq.error`, `dlq.stack_trace`). There is no separate `dlq` collection.

**Why:** Keeping the DLQ state in the same document as the job avoids cross-collection joins and makes the retry operation a single atomic update (`$unset: { dlq: "" }, $set: { status: "pending" }`). The full job history (payload, priority, retry count, error) is always co-located.

**Tradeoff:** The `jobs` collection contains both active and dead-letter jobs. DLQ queries require a filter on `{ status: "failed", "dlq.active": true }`. This is indexed and fast, but the collection is not cleanly separated by concern.

---

## Known Limitations

**DAG failure propagation is not proactive.** If a dependency job fails, downstream jobs that depend on it remain `pending` until the worker attempts to claim them. At claim time, the dependency check detects the terminal state and fails the downstream job. However, if the downstream job is deferred (e.g., waiting for a different dependency), it may sit in `pending` for up to `DEPENDENCY_DEFER_SECONDS` (5 s) before the failure is detected. There is no background scan that proactively cascades failures through the DAG. The intended fix is a periodic scan alongside the starvation check.

**Timing wheel horizon is 1 hour.** Jobs scheduled more than 3,600 seconds in the future are not placed in the timing wheel. They are picked up by the MongoDB poll when their time arrives. The poll runs every 2 seconds, so the maximum latency for a far-future job is 2 seconds past its scheduled time.

**Single worker by default.** The system supports multiple workers (each with a distinct `WORKER_ID`), but the default configuration runs one. The duplicate protection layers (MongoDB atomic claim + Redis NX lock) are designed for multi-worker operation, but this has not been load-tested at scale.

**Cooperative cancellation does not interrupt running handlers.** A handler that is mid-execution when a cancel request arrives will complete before the cancellation is honoured. For handlers with long execution times (e.g., a slow webhook), this means the job may continue processing for the full handler duration after the cancel request.

**No job priority update API.** Once a job is created, its base `priority` cannot be changed via the API. `effective_priority` is managed internally by the starvation algorithm. A `PUT /api/jobs/{id}` endpoint exists in the codebase but is not fully wired to the heap's `update_priority` method.

**DLQ alert is a mock.** `send_dlq_alert_email()` logs the alert payload but does not send a real email. Integrating an SMTP client or email service (e.g., SendGrid, SES) is left as an operational concern.

**No authentication.** The API has no authentication or authorisation layer. All endpoints are publicly accessible. This is intentional for the current deployment scope but must be addressed before any production use with sensitive data.

**TTL index cleanup.** Completed and cancelled jobs are auto-deleted after 7 days via a MongoDB TTL index. There is no manual purge endpoint. If the TTL index is not created (e.g., `ensure_indexes()` was not run), old jobs accumulate indefinitely.
