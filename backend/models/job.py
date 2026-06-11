"""Pydantic v2 models for jobs, DLQ, logs, heartbeats, and API responses."""

from __future__ import annotations

from datetime import datetime, UTC
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


# ── Enums ────────────────────────────────────────────────────────────────

class JobStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class JobPriority(int, Enum):
    HIGH = 1
    MEDIUM = 2
    LOW = 3


class JobInterval(str, Enum):
    every_1_minute = "every_1_minute"
    every_5_minutes = "every_5_minutes"
    every_1_hour = "every_1_hour"


INTERVAL_SECONDS: dict[JobInterval, int] = {
    JobInterval.every_1_minute: 60,
    JobInterval.every_5_minutes: 300,
    JobInterval.every_1_hour: 3600,
}


# ── Request / Create ─────────────────────────────────────────────────────

class JobCreate(BaseModel):
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    priority: JobPriority = JobPriority.MEDIUM
    max_retries: int = Field(default=3, ge=0, le=10)
    scheduled_at: Optional[datetime] = None
    interval: Optional[JobInterval] = None
    dependencies: list[str] = Field(default_factory=list)
    tags: list[str] = []


# ── Database Documents ───────────────────────────────────────────────────

class JobDocument(BaseModel):
    """Full shape of a document in the `jobs` collection."""
    job_id: str = Field(default_factory=lambda: str(uuid4()))
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    priority: int = 2
    status: JobStatus = JobStatus.pending
    retry_count: int = 0
    max_retries: int = 3
    scheduled_at: Optional[datetime] = None
    interval: Optional[JobInterval] = None
    dependencies: list[str] = Field(default_factory=list)
    tags: list[str] = []
    error: Optional[str] = None
    cancel_requested: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    next_run_at: Optional[datetime] = None
    effective_priority: float = 2.0  # modified by aging algorithm


class JobInDB(JobDocument):
    """Job as read from MongoDB (has _id)."""
    id: Optional[str] = Field(default=None, alias="_id")

    model_config = {"populate_by_name": True}


class JobUpdate(BaseModel):
    """Allowed fields for updating a job."""
    priority: Optional[JobPriority] = None
    max_retries: Optional[int] = None
    payload: Optional[dict[str, Any]] = None


class DLQDocument(BaseModel):
    job_id: str
    type: str
    priority: int
    payload: dict[str, Any] = Field(default_factory=dict)
    error: str
    stack_trace: Optional[str] = None
    retry_count: int
    failed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class DLQEntry(DLQDocument):
    id: Optional[str] = Field(default=None, alias="_id")
    model_config = {"populate_by_name": True}


class JobLogDocument(BaseModel):
    job_id: str
    event: str
    message: str
    metadata: Optional[dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))


class JobLogEntry(JobLogDocument):
    id: Optional[str] = Field(default=None, alias="_id")
    model_config = {"populate_by_name": True}


class WorkerHeartbeat(BaseModel):
    worker_id: str
    last_seen: datetime = Field(default_factory=lambda: datetime.now(UTC))


# ── API Response Models ──────────────────────────────────────────────────

class MetricsResponse(BaseModel):
    by_status: dict[str, int]
    total_jobs: int
    dlq_size: int


class HealthResponse(BaseModel):
    status: str
    mongodb: str
    redis: str
    worker: str
    timestamp: str
