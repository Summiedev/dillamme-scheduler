"""Async MongoDB and Redis connections via Motor and redis.asyncio."""

import motor.motor_asyncio
import redis.asyncio as redis
from config import settings

_mongo_client: motor.motor_asyncio.AsyncIOMotorClient | None = None
_mongo_db: motor.motor_asyncio.AsyncIOMotorDatabase | None = None
_redis: redis.Redis | None = None


async def get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:
    """Return the async MongoDB database instance."""
    global _mongo_client, _mongo_db
    if _mongo_db is None:
        _mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.mongodb_url)
        _mongo_db = _mongo_client[settings.mongodb_db_name]
    return _mongo_db


async def get_redis() -> redis.Redis:
    """Return the async Redis client."""
    global _redis
    if _redis is None:
        _redis = await redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def close_db_connections():
    """Close all open connections."""
    global _mongo_client, _redis
    if _mongo_client is not None:
        _mongo_client.close()
    if _redis is not None:
        await _redis.close()
