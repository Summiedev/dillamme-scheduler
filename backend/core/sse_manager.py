"""SSE manager with Redis pub/sub bridge for worker -> API event streaming."""

from __future__ import annotations

import asyncio
from asyncio import QueueFull
import json
from dataclasses import dataclass, field
import structlog
from config import settings
from db.connection import get_redis

logger = structlog.get_logger()

SSE_CHANNEL = "job_events"


@dataclass
class SSEClient:
    queue: asyncio.Queue[str] = field(default_factory=lambda: asyncio.Queue(maxsize=256))
    close_event: asyncio.Event = field(default_factory=asyncio.Event)


class SSEManager:
    """Manages SSE client connections and broadcasts via Redis pub/sub.

    Since the worker is a separate process from FastAPI, Redis pub/sub
    is the bridge: worker publishes to 'job_events', FastAPI subscribes
    and fans out to all connected SSE clients.
    """

    def __init__(self):
        self.clients: list[SSEClient] = []
        self._subscriber_task: asyncio.Task | None = None

    async def start(self):
        """Start the Redis subscriber that fans out to SSE clients."""
        self._subscriber_task = asyncio.create_task(self._subscribe_redis())

    async def stop(self):
        if self._subscriber_task:
            self._subscriber_task.cancel()
            try:
                await self._subscriber_task
            except asyncio.CancelledError:
                pass

    async def _subscribe_redis(self):
        while True:
            try:
                redis = await get_redis()
                pubsub = redis.pubsub()
                await pubsub.subscribe(SSE_CHANNEL)
                logger.info("sse_redis_subscriber_started", channel=SSE_CHANNEL)
                try:
                    async for message in pubsub.listen():
                        if message["type"] == "message":
                            data = message["data"]
                            dead: list[SSEClient] = []
                            for client in list(self.clients):
                                try:
                                    client.queue.put_nowait(data)
                                except QueueFull:
                                    dead.append(client)
                            for client in dead:
                                await self.disconnect(client)
                except asyncio.CancelledError:
                    await pubsub.unsubscribe(SSE_CHANNEL)
                    raise
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("sse_subscriber_error", error=str(exc), channel=SSE_CHANNEL)
                await asyncio.sleep(5)

    async def connect(self) -> SSEClient:
        """Register a new SSE client. Returns a client handle the stream reads from."""
        client = SSEClient()
        self.clients.append(client)
        logger.info("sse_client_connected", total_clients=len(self.clients))
        return client

    async def disconnect(self, client: SSEClient):
        """Remove an SSE client."""
        try:
            self.clients.remove(client)
        except ValueError:
            pass
        client.close_event.set()
        logger.info("sse_client_disconnected", total_clients=len(self.clients))

    # ── Used by the API process (FastAPI broadcasts to SSE clients directly) ──
    async def broadcast(self, event: str, data: dict):
        message = f"event: {event}\ndata: {json.dumps(data)}\n\n"
        dead: list[SSEClient] = []
        for client in list(self.clients):
            try:
                client.queue.put_nowait(message)
            except QueueFull:
                dead.append(client)
        for client in dead:
            await self.disconnect(client)
        logger.info("sse_event_broadcast", event=event)

    # ── Used by the worker process (publishes to Redis) ──
    @staticmethod
    async def publish_worker_event(event: str, data: dict):
        """Publish an event from the worker via Redis pub/sub."""
        redis = await get_redis()
        payload = f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
        await redis.publish(SSE_CHANNEL, payload)
        logger.info(
    "sse_event_published",
    payload_event=event
)


# Singleton
sse_manager = SSEManager()
