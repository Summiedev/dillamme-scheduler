"""SSE endpoint: GET /api/events — Server-Sent Events stream.

Uses Redis pub/sub to bridge events from the worker process to SSE clients.
The SSEManager subscribes to Redis channel 'job_events' in the background
(started during FastAPI lifespan) and fans out messages to all connected clients.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from core.sse_manager import sse_manager
from utils.logger import get_logger

router = APIRouter(prefix="/api", tags=["events"])
logger = get_logger()


@router.get("/events")
async def event_stream():
    """Server-Sent Events endpoint.

    Clients connect via EventSource or similar.
    Nginx config requires:
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        chunked_transfer_encoding on;
    """

    async def generate():
        queue = await sse_manager.connect()
        try:
            # Send initial keepalive
            yield f"event: connected\ndata: {json.dumps({'status': 'connected'})}\n\n"
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield message
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await sse_manager.disconnect(queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )