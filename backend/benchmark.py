"""Benchmark scheduler primitives and MongoDB query paths.

This benchmark focuses on production-like workloads:
- Priority queue only.
- Timing wheel + priority queue using the same job workload.
- MongoDB indexed vs non-indexed query paths using the same dataset/query.

Each benchmark gets one warm-up pass followed by at least 100 measured
iterations.  Results are printed as a clean table to stdout.
"""

from __future__ import annotations

import asyncio
import contextlib
import math
import random
import statistics
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Iterable

import motor.motor_asyncio

from core.timing_wheel import IndexedPriorityQueue, PriorityQueue, TimingWheel


ITERATIONS = 100
WARMUP_ITERATIONS = 1
HEAP_WORKLOAD_SIZE = 10_000
HEAP_WORKLOAD_HORIZON_SECONDS = 60
MONGO_DATASET_SIZE = 50_000
MONGO_QUERY_LIMIT = 100
MONGO_DB_NAME = "bench_test"
MONGO_COLLECTION_NAME = "bench_jobs"
MONGO_INDEX_KEYS = [
    ("status", 1),
    ("effective_priority", 1),
    ("scheduled_at", 1),
    ("created_at", 1),
]


@dataclass(frozen=True)
class JobSpec:
    job_id: str
    effective_priority: float
    scheduled_at: datetime
    created_at: datetime

    def to_document(self) -> dict:
        return {
            "job_id": self.job_id,
            "effective_priority": self.effective_priority,
            "scheduled_at": self.scheduled_at,
            "created_at": self.created_at,
        }


@dataclass
class FakeClock:
    current: datetime

    def now(self, tz=None):  # matches datetime.now(tz)
        if tz is None:
            return self.current.replace(tzinfo=None)
        return self.current.astimezone(tz)


@contextlib.contextmanager
def patched_timing_clock(clock: FakeClock):
    import core.timing_wheel as timing_wheel_module

    original_datetime = timing_wheel_module.datetime

    class _FakeDateTime:
        @staticmethod
        def now(tz=None):
            return clock.now(tz)

    timing_wheel_module.datetime = _FakeDateTime
    try:
        yield
    finally:
        timing_wheel_module.datetime = original_datetime


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    rank = (len(ordered) - 1) * p
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[int(rank)]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def summarize(samples: list[float]) -> dict[str, float]:
    return {
        "mean": statistics.mean(samples),
        "p50": percentile(samples, 0.50),
        "p95": percentile(samples, 0.95),
        "stddev": statistics.stdev(samples) if len(samples) > 1 else 0.0,
    }


def build_heap_workload(size: int, seed: int = 42) -> list[JobSpec]:
    rng = random.Random(seed)
    base = datetime.now(UTC)
    workload: list[JobSpec] = []
    for i in range(size):
        priority = rng.choice([1.0, 1.5, 2.0, 2.5, 3.0])
        scheduled_offset = rng.randint(1, HEAP_WORKLOAD_HORIZON_SECONDS)
        jitter_ms = rng.randint(0, 900)
        created_at = base - timedelta(seconds=rng.randint(0, 300))
        scheduled_at = base + timedelta(seconds=scheduled_offset, milliseconds=jitter_ms)
        workload.append(
            JobSpec(
                job_id=str(i),
                effective_priority=priority,
                scheduled_at=scheduled_at,
                created_at=created_at,
            )
        )
    return workload


def run_priority_queue_workload(workload: list[JobSpec]) -> None:
    queue = PriorityQueue()
    for spec in workload:
        queue.push(spec.to_document())
    while queue:
        queue.pop()


def run_timing_wheel_workload(workload: list[JobSpec]) -> None:
    base = min(spec.scheduled_at for spec in workload) - timedelta(seconds=1)
    clock = FakeClock(current=base)
    due_by_job_id = {spec.job_id: spec.to_document() for spec in workload}
    max_offset = max(
        max(1, int((spec.scheduled_at - base).total_seconds()))
        for spec in workload
    )

    with patched_timing_clock(clock):
        wheel = TimingWheel()
        queue = IndexedPriorityQueue()

        for spec in workload:
            wheel.schedule(spec.job_id, spec.scheduled_at)

        for second in range(max_offset + 2):
            clock.current = base + timedelta(seconds=second)
            for job_id in wheel.tick():
                queue.push(due_by_job_id[job_id])
            while queue:
                queue.pop()


def time_operation(func, workload: list[JobSpec], warmup: int = WARMUP_ITERATIONS, iterations: int = ITERATIONS) -> list[float]:
    for _ in range(warmup):
        func(workload)

    samples: list[float] = []
    for _ in range(iterations):
        start = time.perf_counter()
        func(workload)
        samples.append((time.perf_counter() - start) * 1000.0)
    return samples


async def prepare_mongo_collection(col):
    await col.drop()
    docs = []
    base = datetime.now(UTC)
    rng = random.Random(1337)
    for i in range(MONGO_DATASET_SIZE):
        docs.append(
            {
                "job_id": str(i),
                "status": "pending",
                "effective_priority": rng.choice([1.0, 1.5, 2.0, 2.5, 3.0]),
                "scheduled_at": base + timedelta(seconds=rng.randint(0, 3600)),
                "created_at": base - timedelta(seconds=rng.randint(0, 86400)),
            }
        )
    await col.insert_many(docs, ordered=False)


async def run_mongo_query(col) -> None:
    cursor = col.find(
        {"status": "pending", "effective_priority": {"$lte": 2.0}},
    ).sort(
        [
            ("effective_priority", 1),
            ("scheduled_at", 1),
            ("created_at", 1),
        ]
    ).limit(MONGO_QUERY_LIMIT)
    await cursor.to_list(length=MONGO_QUERY_LIMIT)


async def benchmark_mongo(collection) -> tuple[list[float], list[float]]:
    await prepare_mongo_collection(collection)

    await collection.create_index(MONGO_INDEX_KEYS, name="idx_benchmark_queue")
    for _ in range(WARMUP_ITERATIONS):
        await run_mongo_query(collection)
    indexed_samples: list[float] = []
    for _ in range(ITERATIONS):
        start = time.perf_counter()
        await run_mongo_query(collection)
        indexed_samples.append((time.perf_counter() - start) * 1000.0)

    await collection.drop_indexes()
    for _ in range(WARMUP_ITERATIONS):
        await run_mongo_query(collection)
    unindexed_samples: list[float] = []
    for _ in range(ITERATIONS):
        start = time.perf_counter()
        await run_mongo_query(collection)
        unindexed_samples.append((time.perf_counter() - start) * 1000.0)

    return indexed_samples, unindexed_samples


def format_table(rows: list[dict[str, str]]) -> str:
    headers = ["Benchmark", "Workload", "Mean (ms)", "P50 (ms)", "P95 (ms)", "Stddev (ms)"]
    widths = {header: len(header) for header in headers}
    for row in rows:
        for header in headers:
            widths[header] = max(widths[header], len(row[header]))

    def render(values: Iterable[str]) -> str:
        return " | ".join(value.ljust(widths[header]) for value, header in zip(values, headers))

    separator = "-+-".join("-" * widths[header] for header in headers)
    lines = [render(headers), separator]
    for row in rows:
        lines.append(render([row[h] for h in headers]))
    return "\n".join(lines)


async def main():
    heap_workload = build_heap_workload(HEAP_WORKLOAD_SIZE)

    heap_samples = time_operation(run_priority_queue_workload, heap_workload)
    wheel_samples = time_operation(run_timing_wheel_workload, heap_workload)

    client = motor.motor_asyncio.AsyncIOMotorClient("mongodb://localhost:27017")
    db = client[MONGO_DB_NAME]
    collection = db[MONGO_COLLECTION_NAME]
    try:
        indexed_samples, unindexed_samples = await benchmark_mongo(collection)
    finally:
        await collection.drop()
        await client.drop_database(MONGO_DB_NAME)
        client.close()

    rows = [
        {
            "Benchmark": "PriorityQueue",
            "Workload": f"insert {HEAP_WORKLOAD_SIZE:,}, drain in order",
            "Mean (ms)": f"{summarize(heap_samples)['mean']:.3f}",
            "P50 (ms)": f"{summarize(heap_samples)['p50']:.3f}",
            "P95 (ms)": f"{summarize(heap_samples)['p95']:.3f}",
            "Stddev (ms)": f"{summarize(heap_samples)['stddev']:.3f}",
        },
        {
            "Benchmark": "TimingWheel + Heap",
            "Workload": f"insert {HEAP_WORKLOAD_SIZE:,}, drain in order",
            "Mean (ms)": f"{summarize(wheel_samples)['mean']:.3f}",
            "P50 (ms)": f"{summarize(wheel_samples)['p50']:.3f}",
            "P95 (ms)": f"{summarize(wheel_samples)['p95']:.3f}",
            "Stddev (ms)": f"{summarize(wheel_samples)['stddev']:.3f}",
        },
        {
            "Benchmark": "Mongo indexed",
            "Workload": f"{MONGO_DATASET_SIZE:,} docs, top {MONGO_QUERY_LIMIT}",
            "Mean (ms)": f"{summarize(indexed_samples)['mean']:.3f}",
            "P50 (ms)": f"{summarize(indexed_samples)['p50']:.3f}",
            "P95 (ms)": f"{summarize(indexed_samples)['p95']:.3f}",
            "Stddev (ms)": f"{summarize(indexed_samples)['stddev']:.3f}",
        },
        {
            "Benchmark": "Mongo no index",
            "Workload": f"{MONGO_DATASET_SIZE:,} docs, top {MONGO_QUERY_LIMIT}",
            "Mean (ms)": f"{summarize(unindexed_samples)['mean']:.3f}",
            "P50 (ms)": f"{summarize(unindexed_samples)['p50']:.3f}",
            "P95 (ms)": f"{summarize(unindexed_samples)['p95']:.3f}",
            "Stddev (ms)": f"{summarize(unindexed_samples)['stddev']:.3f}",
        },
    ]

    print(format_table(rows))


if __name__ == "__main__":
    asyncio.run(main())
