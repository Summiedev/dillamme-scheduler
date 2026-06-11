"""Dilamme Scheduler — FastAPI Application Entry Point.

Runs as a standalone Uvicorn process managed by PM2.
Worker (worker.py) is a completely separate process — never imported here.
Communicates with worker only via MongoDB and Redis.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.connection import get_db, close_db_connections
from db.indexes import ensure_indexes
from routes import (
    jobs_router,
    dlq_router,
    metrics_router,
    logs_router,
    events_router,
    health_router,
)
from core.sse_manager import sse_manager
from utils.logger import setup_logging

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup/shutdown."""
    setup_logging()

    # Ensure indexes exist
    db = await get_db()
    await ensure_indexes(db)

    # Start SSE Redis subscriber
    await sse_manager.start()

    logger.info("api_started", environment=settings.environment)
    yield
    logger.info("api_shutdown")
    await sse_manager.stop()
    await close_db_connections()


app = FastAPI(
    title="Dilamme Scheduler",
    version="1.0.0",
    description="Background job scheduler with MongoDB, Redis, and FastAPI",
    lifespan=lifespan,
    docs_url="/docs",
)

# CORS — allow all origins in development
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(jobs_router)
app.include_router(dlq_router)
app.include_router(metrics_router)
app.include_router(logs_router)
app.include_router(events_router)
app.include_router(health_router)


@app.get("/")
async def root():
    return {"service": "Dilamme Scheduler", "status": "running", "docs": "/docs"}