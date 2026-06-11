import asyncio
import time
import random
import heapq
from core.timing_wheel import TimingWheel, PriorityQueue, IndexedPriorityQueue
from datetime import datetime, timedelta, UTC
import motor.motor_asyncio

N = 10_000

heap = PriorityQueue()
start = time.perf_counter()
for i in range(N):
    heap.push({"job_id": str(i), "effective_priority": i % 3 + 1,
               "scheduled_at": datetime.now(UTC), "created_at": datetime.now(UTC)})
insert_time = time.perf_counter() - start

start = time.perf_counter()
for _ in range(N):
    heap.pop()
extract_time = time.perf_counter() - start

# ── IndexedPriorityQueue update_priority benchmark ──
N_UPDATES = 1000
HEAP_SIZE = 10000

idx_heap = IndexedPriorityQueue()
for i in range(HEAP_SIZE):
    idx_heap.push({"job_id": str(i), "effective_priority": i % 3 + 1,
                   "scheduled_at": datetime.now(UTC), "created_at": datetime.now(UTC)})

start = time.perf_counter()
for _ in range(N_UPDATES):
    jid = str(random.randint(0, HEAP_SIZE - 1))
    new_pri = random.uniform(0.1, 3.0)
    idx_heap.update_priority(jid, new_pri)
update_priority_time = time.perf_counter() - start
# ──────────────────────────────────────────────────────

wheel = TimingWheel()
base = datetime.now(UTC)
start = time.perf_counter()
for i in range(N):
    wheel.schedule(str(i), base + timedelta(seconds=(i % 3600) + 1))
wheel_schedule_time = time.perf_counter() - start

start = time.perf_counter()
for _ in range(3600):
    wheel.tick()
wheel_tick_time = time.perf_counter() - start


async def mongo_benchmark():
    client = motor.motor_asyncio.AsyncIOMotorClient("mongodb://localhost:27017")
    db = client["bench_test"]
    col = db["bench_jobs"]
    await col.drop()

    docs = [{"job_id": str(i), "status": "pending",
              "effective_priority": i % 3 + 1,
              "scheduled_at": datetime.now(UTC),
              "created_at": datetime.now(UTC)} for i in range(100_000)]
    await col.insert_many(docs)
    await col.create_index([("status", 1), ("effective_priority", 1),
                            ("scheduled_at", 1), ("created_at", 1)])

    start = time.perf_counter()
    await col.find({"status": "pending", "effective_priority": {"$lte": 2}}).to_list(100)
    indexed_time = time.perf_counter() - start

    start = time.perf_counter()
    await col.find({"status": "pending", "effective_priority": {"$lte": 2}},
                   hint=[("$natural", 1)]).to_list(100)
    no_index_time = time.perf_counter() - start

    await client.drop_database("bench_test")
    client.close()
    return indexed_time, no_index_time


indexed_t, no_index_t = asyncio.run(mongo_benchmark())

print(f"heap_insert: {insert_time:.6f}s")
print(f"heap_extract: {extract_time:.6f}s")
print(f"wheel_schedule: {wheel_schedule_time:.6f}s")
print(f"wheel_tick: {wheel_tick_time:.6f}s")
print(f"mongo_indexed: {indexed_t:.6f}s")
print(f"mongo_no_index: {no_index_t:.6f}s")

with open("docs/benchmark.md", "w") as f:
    f.write("# Dilamme Scheduler — Benchmark Results\n\n")
    f.write("| Operation | Operations | Time (s) | Op/s |\n")
    f.write("|---|---|---|---|\n")
    f.write(f"| Heap insert | {N} | {insert_time:.6f} | {N / insert_time:.0f} |\n")
    f.write(f"| Heap extract | {N} | {extract_time:.6f} | {N / extract_time:.0f} |\n")
    f.write(f"| Wheel schedule | {N} | {wheel_schedule_time:.6f} | {N / wheel_schedule_time:.0f} |\n")
    f.write(f"| Wheel tick (full rotation) | 3600 | {wheel_tick_time:.6f} | {3600 / wheel_tick_time:.0f} |\n")
    f.write(f"| IndexedPriorityQueue update_priority | {N_UPDATES} (on {HEAP_SIZE} heap) | {update_priority_time:.6f} | {N_UPDATES / update_priority_time:.0f} |\n")
    f.write(f"| MongoDB query (indexed) | 100k docs, top 100 | {indexed_t:.6f} | {1/indexed_t:.0f} ops/s |\n")
    f.write(f"| MongoDB query (no index) | 100k docs, top 100 | {no_index_t:.6f} | {1/no_index_t:.0f} ops/s |\n")
