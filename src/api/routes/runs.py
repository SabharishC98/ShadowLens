"""
/api/runs — CRUD endpoints for pipeline runs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pymongo import DESCENDING

from src.api.db import get_events_collection, get_runs_collection
from src.api.schemas import RunDetailResponse, RunRequest, RunSummaryResponse
from src.api.websocket import manager
from src.attacks.engine import AttackEngine
from src.classifier.inference import InjectionClassifier
from src.observer.drift_detector import SemanticDriftDetector
from src.observer.goal_checker import GoalConsistencyChecker
from src.observer.observer import Observer
from src.pipeline.config import (
    AttackConfig,
    AttackTechnique,
    DEFAULT_PIPELINE_CONFIG,
    NodeConfig,
    PipelineConfig,
)
from src.pipeline.harness import PipelineHarness

router = APIRouter(prefix="/api/runs", tags=["runs"])
logger = logging.getLogger(__name__)

# Shared in-memory abort flags (run_id → bool)
_abort_flags: dict[str, bool] = {}


def _build_harness(model: str) -> PipelineHarness:
    """Construct a fresh harness with observer wired in."""
    from src.pipeline.config import AgentRole
    nodes = [
        NodeConfig(name="INPUT_VALIDATOR", role=AgentRole.INPUT_VALIDATOR, model=model),
        NodeConfig(name="ORCHESTRATOR",    role=AgentRole.ORCHESTRATOR,    model=model),
        NodeConfig(name="TOOL_CALLER",     role=AgentRole.TOOL_CALLER,     model=model),
        NodeConfig(name="RESPONDER",       role=AgentRole.RESPONDER,       model=model),
    ]
    config  = PipelineConfig(nodes=nodes)
    harness = PipelineHarness(config=config)

    classifier    = InjectionClassifier(os.getenv("CLASSIFIER_MODEL_PATH", "stub"))
    drift_det     = SemanticDriftDetector()
    goal_checker  = GoalConsistencyChecker()
    observer      = Observer(
        classifier     = classifier,
        drift_detector = drift_det,
        goal_checker   = goal_checker,
        db_collection  = get_events_collection(),
        ws_manager     = manager,
    )
    harness.set_observer(observer)
    return harness


async def _execute_run(run_id: str, req: RunRequest):
    """Background task: executes pipeline and updates run doc in MongoDB."""
    runs_col = get_runs_collection()
    try:
        attack_cfg = None
        if req.technique != "none":
            attack_cfg = AttackConfig(
                technique              = AttackTechnique(req.technique),
                injection_node_index   = req.injection_node_index,
                target_goal            = req.target_goal,
                false_fact             = req.false_fact,
                hijacked_goal          = req.hijacked_goal,
                malicious_tool_params  = req.malicious_tool_params,
                randomize_payload      = req.randomize_payload,
            )

        harness = _build_harness(req.model)
        result  = await harness.run(
            task=req.task, attack_config=attack_cfg, run_id=run_id
        )

        await runs_col.update_one(
            {"run_id": run_id},
            {"$set": {
                "status":       "completed",
                "completed_at": datetime.utcnow(),
                "final_output": result.final_output,
                "messages":     result.messages,
                "summary":      result.summary.model_dump(),
                "propagation":  result.propagation.to_dict() if result.propagation else None,
            }},
        )
        await manager.broadcast_status(run_id, "completed",
                                        {"summary": result.summary.model_dump()})

    except Exception as exc:
        logger.error("[Run %s] Failed: %s", run_id, exc)
        await runs_col.update_one(
            {"run_id": run_id},
            {"$set": {"status": "failed", "error": str(exc)}},
        )
        await manager.broadcast_status(run_id, "failed", {"error": str(exc)})


# ── GET /api/runs ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[RunSummaryResponse])
async def list_runs(
    page:  int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    technique: Optional[str] = None,
    model:     Optional[str] = None,
):
    """List all pipeline runs with summary stats, newest first."""
    runs_col = get_runs_collection()
    query: dict = {}
    if technique:
        query["attack_config.technique"] = technique
    if model:
        query["model"] = model

    skip   = (page - 1) * limit
    cursor = runs_col.find(query, {"_id": 0}).sort("created_at", DESCENDING).skip(skip).limit(limit)
    docs   = await cursor.to_list(length=limit)

    results = []
    for d in docs:
        summary = d.get("summary", {})
        results.append(RunSummaryResponse(
            run_id               = d["run_id"],
            created_at           = d.get("created_at", datetime.utcnow()),
            status               = d.get("status", "unknown"),
            technique            = d.get("attack_config", {}).get("technique", "none"),
            model                = d.get("model", "unknown"),
            task_preview         = d.get("original_task", "")[:80],
            total_hops           = summary.get("total_hops", 0),
            injections_detected  = summary.get("injections_detected", 0),
            propagation_rate     = summary.get("propagation_rate", 0.0),
            goal_violated        = summary.get("goal_violated", False),
            furthest_propagation = summary.get("furthest_propagation", -1),
            max_drift_score      = summary.get("max_drift_score", 0.0),
            terminal_success     = summary.get("terminal_success", False),
        ))
    return results


# ── GET /api/runs/{run_id} ─────────────────────────────────────────────────────

@router.get("/{run_id}", response_model=RunDetailResponse)
async def get_run(run_id: str):
    """Full run detail including all ObserverEvents (for D3 graph data)."""
    runs_col   = get_runs_collection()
    events_col = get_events_collection()

    run = await runs_col.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, f"Run {run_id} not found.")

    events_cursor = events_col.find({"run_id": run_id}, {"_id": 0}).sort("hop_index", 1)
    events        = await events_cursor.to_list(length=1000)

    return RunDetailResponse(
        run_id          = run["run_id"],
        created_at      = run.get("created_at", datetime.utcnow()),
        status          = run.get("status", "unknown"),
        original_task   = run.get("original_task", ""),
        technique       = run.get("attack_config", {}).get("technique", "none"),
        model           = run.get("model", "unknown"),
        pipeline_config = run.get("pipeline_config", {}),
        attack_config   = run.get("attack_config"),
        summary         = run.get("summary", {}),
        final_output    = run.get("final_output", ""),
        messages        = run.get("messages", []),
        observer_events = events,
    )


# ── POST /api/runs ─────────────────────────────────────────────────────────────

@router.post("", status_code=202)
async def create_run(req: RunRequest, background_tasks: BackgroundTasks):
    """
    Start a new pipeline run. Returns run_id immediately.
    Pipeline executes asynchronously; connect to /ws/runs/{run_id} for live events.
    """
    run_id   = str(uuid.uuid4())
    runs_col = get_runs_collection()

    await runs_col.insert_one({
        "run_id":          run_id,
        "created_at":      datetime.utcnow(),
        "status":          "running",
        "original_task":   req.task,
        "model":           req.model,
        "attack_config":   {
            "technique":           req.technique,
            "injection_node_index": req.injection_node_index,
            "target_goal":         req.target_goal,
        },
        "pipeline_config": {"pipeline_id": req.pipeline_id},
        "summary":         {},
        "final_output":    "",
        "messages":        [],
    })

    background_tasks.add_task(_execute_run, run_id, req)
    return {"run_id": run_id, "status": "running", "message": "Pipeline started."}


# ── POST /api/runs/{run_id}/stop ───────────────────────────────────────────────

@router.post("/{run_id}/stop")
async def stop_run(run_id: str):
    """Signal a running pipeline to abort."""
    _abort_flags[run_id] = True
    runs_col = get_runs_collection()
    await runs_col.update_one({"run_id": run_id}, {"$set": {"status": "aborted"}})
    await manager.broadcast_status(run_id, "aborted")
    return {"run_id": run_id, "status": "aborted"}
