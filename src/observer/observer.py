"""
Observer — the architectural centrepiece of ShadowLens.

Intercepts EVERY inter-agent message before delivery, runs 3 analysis
passes (classifier + drift + goal checker), logs to MongoDB, and emits
to the WebSocket stream — all without modifying pipeline execution.

Zero pipeline interference: the Observer runs analysis in an asyncio
background task so the main pipeline is never blocked.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import TYPE_CHECKING, Optional
from uuid import uuid4

from src.classifier.inference import InjectionClassifier
from src.observer.drift_detector import SemanticDriftDetector
from src.observer.goal_checker import GoalConsistencyChecker
from src.observer.schemas import ObserverEvent
from src.pipeline.config import RunContext

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class Observer:
    """
    Passive monitoring layer for ShadowLens pipelines.

    Inject into PipelineHarness via harness.set_observer(observer).
    The harness wraps each node to call observer.intercept() after
    every node produces output.
    """

    def __init__(
        self,
        classifier:     InjectionClassifier,
        drift_detector: SemanticDriftDetector,
        goal_checker:   GoalConsistencyChecker,
        db_collection   = None,   # motor AsyncIOMotorCollection or None
        ws_manager      = None,   # ConnectionManager or None
    ):
        self.classifier     = classifier
        self.drift_detector = drift_detector
        self.goal_checker   = goal_checker
        self.db             = db_collection
        self.ws_manager     = ws_manager
        self._events: list[ObserverEvent] = []

    # ── Primary intercept method ───────────────────────────────────────────────

    async def intercept(
        self,
        sender_node:   str,
        receiver_node: str,
        message:       str,
        hop_index:     int,
        run_context:   RunContext,
    ) -> ObserverEvent:
        """
        Full 3-pass analysis of an inter-agent message.
        Logs event to MongoDB and emits to WebSocket.
        Returns the ObserverEvent (also stored in self._events).
        """
        # ── Pass 1: Injection classification ─────────────────────────────────
        clf_result = self.classifier.classify(message)

        # ── Pass 2: Semantic drift ────────────────────────────────────────────
        try:
            drift_result = self.drift_detector.compute_drift(message)
        except RuntimeError:
            # Baseline not set (shouldn't happen, but handle gracefully)
            from src.observer.schemas import DriftLevel, DriftResult
            drift_result = DriftResult(score=0.0, level=DriftLevel.LOW)

        # ── Pass 3: Goal consistency ──────────────────────────────────────────
        goal_result = self.goal_checker.check(
            original_goal   = run_context.original_task,
            current_message = message,
        )

        # ── Build event ───────────────────────────────────────────────────────
        event = ObserverEvent(
            event_id             = str(uuid4()),
            run_id               = run_context.run_id,
            timestamp            = datetime.utcnow(),
            sender_node          = sender_node,
            receiver_node        = receiver_node,
            hop_index            = hop_index,
            raw_message          = message,
            injection_detected   = clf_result.injected,
            injection_technique  = clf_result.technique,
            injection_confidence = clf_result.confidence,
            all_scores           = clf_result.all_scores,
            drift_score          = drift_result.score,
            drift_from_baseline  = drift_result.level.value,
            goal_violated        = goal_result.violated,
            goal_violation_reason= goal_result.reason,
            goal_check_method    = goal_result.method,
        )

        self._events.append(event)
        logger.info(
            "[Observer] hop=%d %s→%s | injected=%s (%s %.2f) | drift=%s | goal_violated=%s",
            hop_index, sender_node, receiver_node,
            event.injection_detected, event.injection_technique, event.injection_confidence,
            event.drift_from_baseline, event.goal_violated,
        )

        # ── Persist and emit (awaited so it completes before intercept returns) ─
        await self._persist_and_emit(event)

        return event

    async def _persist_and_emit(self, event: ObserverEvent):
        """Persist to MongoDB and emit via WebSocket. Runs in background."""
        # Persist to MongoDB
        if self.db is not None:
            try:
                await self.db.insert_one(event.model_dump(mode="json"))
            except Exception as exc:
                logger.warning("MongoDB write failed: %s", exc)

        # Emit to WebSocket clients watching this run
        if self.ws_manager is not None:
            try:
                await self.ws_manager.broadcast_event(
                    event.run_id, event.model_dump(mode="json")
                )
            except Exception as exc:
                logger.warning("WebSocket emit failed: %s", exc)

    # ── Run lifecycle helpers ─────────────────────────────────────────────────

    def start_run(self, run_context: RunContext):
        """Call at start of each pipeline run to reset state and set baseline."""
        self._events.clear()
        self.drift_detector.set_baseline(run_context.original_task)
        logger.info("[Observer] Run started: %s", run_context.run_id)

    def get_events(self) -> list[ObserverEvent]:
        return list(self._events)

    def reset(self):
        self._events.clear()
        self.drift_detector.reset()
