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
        client = await sse_manager.connect()
        try:
            # Send initial keepalive
            yield f"event: connected\ndata: {json.dumps({'status': 'connected'})}\n\n"
            while True:
                try:
                    message_task = asyncio.create_task(client.queue.get())
                    close_task = asyncio.create_task(client.close_event.wait())
                    done, pending = await asyncio.wait(
                        {message_task, close_task},
                        timeout=30.0,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if not done:
                        for task in pending:
                            task.cancel()
                        await asyncio.gather(*pending, return_exceptions=True)
                        yield ": keepalive\n\n"
                        continue
                    if close_task in done and client.close_event.is_set():
                        if not message_task.done():
                            message_task.cancel()
                        await asyncio.gather(message_task, close_task, return_exceptions=True)
                        break
                    message = message_task.result()
                    close_task.cancel()
                    await asyncio.gather(close_task, return_exceptions=True)
                    yield message
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await sse_manager.disconnect(client)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
