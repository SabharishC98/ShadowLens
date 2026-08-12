"""
MongoDB connection and collection helpers using Motor (async driver).
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase]   = None


async def connect_db():
    global _client, _db
    uri    = os.getenv("MONGODB_URI", "mongodb://localhost:27017/shadowlens")
    db_name= os.getenv("MONGODB_DB",  "shadowlens")
    _client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=5000)
    _db     = _client[db_name]
    # Create indexes
    await _db["observer_events"].create_index("run_id")
    await _db["observer_events"].create_index("timestamp")
    await _db["pipeline_runs"].create_index("run_id", unique=True)
    await _db["pipeline_runs"].create_index("created_at")
    logger.info("MongoDB connected: %s / %s", uri, db_name)


async def disconnect_db():
    global _client
    if _client:
        _client.close()
        logger.info("MongoDB disconnected.")


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not connected. Call connect_db() first.")
    return _db


def get_runs_collection() -> AsyncIOMotorCollection:
    return get_db()["pipeline_runs"]


def get_events_collection() -> AsyncIOMotorCollection:
    return get_db()["observer_events"]
