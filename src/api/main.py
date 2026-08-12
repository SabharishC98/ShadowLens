"""
FastAPI application entry point.

Initialises all components on startup:
  - MongoDB connection
  - InjectionClassifier (stub or live)
  - Mounts all routers
  - WebSocket endpoint for real-time dashboard
"""

from __future__ import annotations

import src.api.hotfix  # noqa: F401

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(override=True)

logging.basicConfig(
    level  = logging.INFO,
    format = "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("ShadowLens API starting up...")
    from src.api.db import connect_db
    try:
        await connect_db()
    except Exception as exc:
        logger.warning("MongoDB connection failed: %s — running without DB.", exc)

    yield

    # Shutdown
    from src.api.db import disconnect_db
    await disconnect_db()
    logger.info("ShadowLens API shut down.")


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "ShadowLens API",
    description = "Multi-Agent Trust Boundary Attack Framework",
    version     = "1.0.0",
    lifespan    = lifespan,
)

# CORS — allow React dev server
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins     = cors_origins,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────

from src.api.routes.runs        import router as runs_router
from src.api.routes.experiments import router as experiments_router
from src.api.routes.models      import router_models, router_pipelines
from src.api.routes.health      import router as health_router

app.include_router(runs_router)
app.include_router(experiments_router)
app.include_router(router_models)
app.include_router(router_pipelines)
app.include_router(health_router)


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

from src.api.websocket import manager


@app.websocket("/ws/runs/{run_id}")
async def websocket_run_stream(websocket: WebSocket, run_id: str):
    """
    Real-time ObserverEvent stream for a running pipeline.
    Dashboard connects here and receives JSON events as they arrive.
    """
    await manager.connect(run_id, websocket)
    try:
        while True:
            # Keep connection alive; server pushes events via manager.broadcast_event()
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(run_id, websocket)


@app.websocket("/ws/experiments/{experiment_id}")
async def websocket_experiment_stream(websocket: WebSocket, experiment_id: str):
    await manager.connect(experiment_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(experiment_id, websocket)


# ── Root ───────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "name":    "ShadowLens",
        "version": "1.0.0",
        "docs":    "/docs",
        "health":  "/api/health",
    }
