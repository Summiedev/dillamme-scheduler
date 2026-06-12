"""In-memory timing wheel for scheduling jobs with sub-second precision.

Buckets are 1-second slots.  The wheel is sized for 3600 slots (1 hour).
Jobs beyond 1 hour are picked up by the MongoDB scheduler poll.
"""

from __future__ import annotations

import asyncio
import heapq
import structlog
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, UTC

logger = structlog.get_logger()

MAX_SLOTS = 3600  # 1 hour in seconds


@dataclass(order=True)
class WheelEntry:
    """Entry in a timing wheel slot."""
    scheduled_at: datetime
    job_id: str = field(compare=False)


class TimingWheel:
    """1-second slot timing wheel for scheduling job wakeups.

    Slot index = (scheduled_at.timestamp() // 1) % MAX_SLOTS.
    """

    def __init__(self):
        self.slots: list[list[WheelEntry]] = [[] for _ in range(MAX_SLOTS)]
        self._job_slots: dict[str, int] = {}  # job_id -> slot_index
        self._job_entries: dict[str, WheelEntry] = {}

    def schedule(self, job_id: str, scheduled_at: datetime):
        """Add or update a job in the wheel."""
        now = datetime.now(UTC)
        if scheduled_at <= now:
            # Too late for the wheel, should be picked up by poll
            return

        delay = (scheduled_at - now).total_seconds()
        if delay > MAX_SLOTS:
            # Beyond wheel range, will be picked up by MongoDB poll
            return

        current_slot = self._job_slots.get(job_id)
        entry = self._job_entries.get(job_id)
        if entry is not None and current_slot is not None:
            if current_slot != int(scheduled_at.timestamp()) % MAX_SLOTS:
                self.slots[current_slot] = [e for e in self.slots[current_slot] if e.job_id != job_id]
            entry.scheduled_at = scheduled_at
            entry.job_id = job_id
        else:
            entry = WheelEntry(scheduled_at=scheduled_at, job_id=job_id)
            self._job_entries[job_id] = entry

        slot = int(scheduled_at.timestamp()) % MAX_SLOTS
        if current_slot != slot or entry not in self.slots[slot]:
            self.slots[slot].append(entry)
        self._job_slots[job_id] = slot

    def remove(self, job_id: str):
        """Remove a job from the wheel."""
        slot = self._job_slots.pop(job_id, None)
        self._job_entries.pop(job_id, None)
        if slot is None:
            return
        before = len(self.slots[slot])
        self.slots[slot] = [e for e in self.slots[slot] if e.job_id != job_id]

    def tick(self) -> list[str]:
        """Return due job_ids scheduled for the current second."""
        now = datetime.now(UTC)
        slot = int(now.timestamp()) % MAX_SLOTS
        due = []
        remaining = []
        for entry in self.slots[slot]:
            if entry.scheduled_at <= now:
                due.append(entry.job_id)
            else:
                remaining.append(entry)
        self.slots[slot] = remaining
        job_ids = due
        for jid in job_ids:
            self._job_slots.pop(jid, None)
            self._job_entries.pop(jid, None)
        return job_ids


class PriorityQueue:
    """Min-heap based priority queue for job processing order.

    Ordering: (effective_priority, scheduled_at, created_at)
    Lower values = higher priority = popped first.
    """

    @staticmethod
    def _sort_key(job: dict) -> tuple:
        return (
            job.get("effective_priority", 2.0),
            job.get("scheduled_at", datetime.now(UTC)),
            job.get("created_at", datetime.now(UTC)),
            job["job_id"],
        )

    def __init__(self):
        self._heap: list[tuple] = []
        self._job_ids: set[str] = set()  # dedup

    def push(self, job: dict):
        """Push a job onto the heap if not already present."""
        jid = job["job_id"]
        if jid in self._job_ids:
            return
        key = self._sort_key(job)
        heapq.heappush(self._heap, (key, job))
        self._job_ids.add(jid)

    def pop(self) -> dict | None:
        """Jobs removed via remove() are evicted lazily on next pop."""
        while self._heap:
            _, job = heapq.heappop(self._heap)
            jid = job["job_id"]
            if jid not in self._job_ids:
                continue
            self._job_ids.discard(jid)
            return job
        return None

    def heapify(self, jobs: list[dict]):
        self._heap = []
        self._job_ids = set()
        for job in jobs:
            jid = job["job_id"]
            self._heap.append((self._sort_key(job), job))
            self._job_ids.add(jid)
        heapq.heapify(self._heap)

    def peek(self) -> dict | None:
        while self._heap:
            _, job = self._heap[0]
            if job["job_id"] in self._job_ids:
                return job
            heapq.heappop(self._heap)
        return None

    def remove(self, job_id: str):
        self._job_ids.discard(job_id)

    def __len__(self) -> int:
        return len(self._heap)

    def __bool__(self) -> bool:
        return len(self._heap) > 0


_REMOVED = object()


class IndexedPriorityQueue:
    """O(log n) in-place priority updates via lazy deletion + index tracking.

    Uses heapq for the underlying heap.  When a job's priority changes
    the old entry is marked REMOVED and a new entry is pushed.
    Pop skips REMOVED entries.
    """

    @staticmethod
    def _sort_key(job: dict) -> tuple:
        return (
            job.get("effective_priority", 2.0),
            job.get("scheduled_at", datetime.now(UTC)),
            job.get("created_at", datetime.now(UTC)),
            job["job_id"],
        )

    def __init__(self):
        self._heap: list[list] = []
        self._index: dict[str, int] = {}
        self._entries: dict[str, list] = {}
        self._count: int = 0
        self._dead_entries: int = 0

    def push(self, job: dict):
        jid = job["job_id"]
        if jid in self._entries:
            return
        key = self._sort_key(job)
        serial = 0
        entry = [key, serial, jid, job]
        self._entries[jid] = entry
        self._index[jid] = serial
        heapq.heappush(self._heap, entry)
        self._count += 1

    def pop(self) -> dict | None:
        while self._heap:
            entry = heapq.heappop(self._heap)
            _, serial, jid, job = entry
            if self._entries.get(jid) is not entry or self._index.get(jid) != serial:
                if self._dead_entries > 0:
                    self._dead_entries -= 1
                continue
            self._entries.pop(jid, None)
            self._index.pop(jid, None)
            self._count -= 1
            return job
        return None

    def update_priority(self, job_id: str, new_effective_priority: float):
        entry = self._entries.get(job_id)
        if entry is None:
            return
        _, _, jid, job = entry
        job["effective_priority"] = new_effective_priority
        key = self._sort_key(job)
        serial = self._index.get(job_id, 0) + 1
        new_entry = [key, serial, jid, job]
        self._entries[job_id] = new_entry
        self._index[job_id] = serial
        heapq.heappush(self._heap, new_entry)
        self._dead_entries += 1
        if self._dead_entries > max(32, self._count):
            self.heapify([entry[3] for entry in self._entries.values()])

    def remove(self, job_id: str):
        entry = self._entries.get(job_id)
        if entry is None:
            return
        self._entries.pop(job_id, None)
        self._index.pop(job_id, None)
        self._count -= 1
        self._dead_entries += 1

    def heapify(self, jobs: list[dict]):
        self._heap = []
        self._entries = {}
        self._index = {}
        self._count = 0
        self._dead_entries = 0
        for job in jobs:
            jid = job["job_id"]
            key = self._sort_key(job)
            entry = [key, 0, jid, job]
            self._heap.append(entry)
            self._entries[jid] = entry
            self._index[jid] = 0
            self._count += 1
        heapq.heapify(self._heap)

    def __len__(self) -> int:
        return self._count

    def __bool__(self) -> bool:
        return self._count > 0
