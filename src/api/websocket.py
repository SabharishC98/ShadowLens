"""
WebSocket connection manager — manages live connections per run_id and
broadcasts ObserverEvents to all connected dashboard clients.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Any, Dict, List

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Tracks active WebSocket connections keyed by run_id.
    Multiple dashboard clients can subscribe to the same run.
    """

    def __init__(self):
        self._connections: Dict[str, List[WebSocket]] = defaultdict(list)

    async def connect(self, run_id: str, websocket: WebSocket):
        await websocket.accept()
        self._connections[run_id].append(websocket)
        logger.info("[WS] Client connected to run %s (total: %d)",
                    run_id, len(self._connections[run_id]))

    def disconnect(self, run_id: str, websocket: WebSocket):
        conns = self._connections.get(run_id, [])
        if websocket in conns:
            conns.remove(websocket)
        logger.info("[WS] Client disconnected from run %s (remaining: %d)",
                    run_id, len(conns))

    async def broadcast_event(self, run_id: str, event: Dict[str, Any]):
        """Send an ObserverEvent (as JSON) to all clients watching run_id."""
        payload  = json.dumps(event, default=str)
        dead: List[WebSocket] = []
        for ws in list(self._connections.get(run_id, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        # Clean up dead connections
        for ws in dead:
            self.disconnect(run_id, ws)

    async def broadcast_status(self, run_id: str, status: str, extra: Dict[str, Any] = None):
        """Send a run status update message."""
        msg = {"type": "status_update", "run_id": run_id, "status": status, **(extra or {})}
        await self.broadcast_event(run_id, msg)

    def active_run_ids(self) -> List[str]:
        return [rid for rid, conns in self._connections.items() if conns]


# Singleton instance shared across the application
manager = ConnectionManager()
