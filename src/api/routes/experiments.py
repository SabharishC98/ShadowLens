"""
/api/experiments — batch run endpoint for the 300-run paper experiment matrix.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse

from src.api.db import get_runs_collection
from src.api.schemas import ExperimentRequest, ExperimentStatusResponse
from src.api.websocket import manager

router = APIRouter(prefix="/api/experiments", tags=["experiments"])
logger = logging.getLogger(__name__)

# In-memory experiment state (keyed by experiment_id)
_experiments: Dict[str, Dict[str, Any]] = {}


async def _run_experiment_matrix(experiment_id: str, req: ExperimentRequest):
    """
    Executes the full (technique × model × runs_per_cell) matrix.
    Updates _experiments[experiment_id] in real time.
    """
    from src.api.routes.runs import _execute_run, _build_harness
    from src.pipeline.config import AttackConfig, AttackTechnique
    from src.api.schemas import RunRequest

    state    = _experiments[experiment_id]
    runs_col = get_runs_collection()

    cells = [
        (tech, model)
        for tech  in req.techniques
        for model in req.models
    ]
    total = len(cells) * req.runs_per_cell
    state["total_runs"] = total

    sem = asyncio.Semaphore(req.concurrency)

    async def run_one(technique: str, model: str, run_index: int):
        async with sem:
            if state.get("aborted"):
                return
            run_req = RunRequest(
                task              = req.base_task,
                technique         = technique,
                model             = model,
                target_goal       = req.target_goal,
                hijacked_goal     = req.hijacked_goal,
                false_fact        = req.false_fact,
                randomize_payload = True,
            )
            run_id = str(uuid.uuid4())
            await runs_col.insert_one({
                "run_id":        run_id,
                "created_at":    datetime.utcnow(),
                "status":        "running",
                "original_task": req.base_task,
                "model":         model,
                "experiment_id": experiment_id,
                "attack_config": {"technique": technique},
                "pipeline_config": {},
                "summary": {},
                "final_output": "",
                "messages": [],
            })
            try:
                await _execute_run(run_id, run_req)
                
                # Retrieve the run doc to check if it actually completed successfully
                run_doc = await runs_col.find_one(
                    {"run_id": run_id}, 
                    {"_id": 0, "status": 1, "summary": 1, "model": 1, "attack_config": 1, "error": 1}
                )
                
                if run_doc and run_doc.get("status") == "completed":
                    state["completed_runs"] += 1
                    # store result preview
                    state["results"].append({
                        "run_id":   run_id,
                        "technique": technique,
                        "model":    model,
                        **run_doc.get("summary", {}),
                    })
                else:
                    state["failed_runs"] += 1
                    err_msg = run_doc.get("error") if run_doc else "Unknown error"
                    logger.error("Experiment run %s failed: %s", run_id, err_msg)
            except Exception as exc:
                state["failed_runs"] += 1
                logger.error("Experiment run failed: %s", exc)

            pct = round((state["completed_runs"] + state["failed_runs"]) / total * 100, 1)
            state["progress_pct"] = pct
            await manager.broadcast_event(experiment_id, {
                "type": "experiment_progress",
                "experiment_id": experiment_id,
                "completed": state["completed_runs"],
                "total": total,
                "progress_pct": pct,
            })

    tasks = [
        run_one(tech, model, i)
        for tech, model in cells
        for i in range(req.runs_per_cell)
    ]
    await asyncio.gather(*tasks)
    state["status"] = "completed"
    await manager.broadcast_event(experiment_id, {"type": "experiment_done", "experiment_id": experiment_id})


# ── POST /api/experiments ──────────────────────────────────────────────────────

@router.post("", status_code=202)
async def start_experiment(req: ExperimentRequest, background_tasks: BackgroundTasks):
    """Start a batch experiment matrix run."""
    exp_id = str(uuid.uuid4())
    _experiments[exp_id] = {
        "experiment_id":  exp_id,
        "status":         "running",
        "total_runs":     0,
        "completed_runs": 0,
        "failed_runs":    0,
        "progress_pct":   0.0,
        "results":        [],
        "created_at":     datetime.utcnow().isoformat(),
        "request":        req.model_dump(),
    }
    background_tasks.add_task(_run_experiment_matrix, exp_id, req)
    return {"experiment_id": exp_id, "status": "running"}


# ── GET /api/experiments/{id} ──────────────────────────────────────────────────

@router.get("/{experiment_id}", response_model=ExperimentStatusResponse)
async def get_experiment_status(experiment_id: str):
    state = _experiments.get(experiment_id)
    if not state:
        raise HTTPException(404, f"Experiment {experiment_id} not found.")
    return ExperimentStatusResponse(
        experiment_id    = experiment_id,
        status           = state["status"],
        total_runs       = state["total_runs"],
        completed_runs   = state["completed_runs"],
        failed_runs      = state["failed_runs"],
        progress_pct     = state["progress_pct"],
        results_preview  = state["results"][-20:],  # last 20
    )


# ── GET /api/experiments/{id}/export ──────────────────────────────────────────

@router.get("/{experiment_id}/export")
async def export_experiment_csv(experiment_id: str):
    """Stream experiment results as CSV for paper tables."""
    state = _experiments.get(experiment_id)
    if not state:
        # Fall back to MongoDB
        runs_col = get_runs_collection()
        cursor   = runs_col.find({"experiment_id": experiment_id}, {"_id": 0})
        docs     = await cursor.to_list(length=10000)
        results  = [
            {
                "run_id":            d["run_id"],
                "technique":         d.get("attack_config", {}).get("technique", ""),
                "model":             d.get("model", ""),
                **d.get("summary", {}),
            }
            for d in docs
        ]
    else:
        results = state["results"]

    if not results:
        raise HTTPException(404, "No results available yet.")

    output = io.StringIO()
    fieldnames = [
        "run_id", "technique", "model", "total_hops", "injections_detected",
        "propagation_rate", "furthest_propagation", "goal_violated",
        "max_drift_score", "terminal_success",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(results)

    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=experiment_{experiment_id}.csv"},
    )


# ── POST /api/experiments/{id}/stop ───────────────────────────────────────────

@router.post("/{experiment_id}/stop")
async def stop_experiment(experiment_id: str):
    state = _experiments.get(experiment_id)
    if not state:
        raise HTTPException(404, "Experiment not found.")
    state["aborted"] = True
    state["status"]  = "aborted"
    return {"experiment_id": experiment_id, "status": "aborted"}
