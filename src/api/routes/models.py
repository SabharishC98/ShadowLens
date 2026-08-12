"""
/api/models — list available LLM models and /api/pipelines — config validation.
"""

from __future__ import annotations

from fastapi import APIRouter

router_models   = APIRouter(prefix="/api/models",   tags=["models"])
router_pipelines = APIRouter(prefix="/api/pipelines", tags=["pipelines"])

AVAILABLE_MODELS = [
    # ── Gemini (Free) ─────────────────────────────────────────────────────────
    {"provider": "gemini",  "model": "gemini/gemini-2.0-flash",      "alias": "Gemini 2.0 Flash"},
    {"provider": "gemini",  "model": "gemini/gemini-2.5-flash",      "alias": "Gemini 2.5 Flash"},
    # ── Groq (Free) ──────────────────────────────────────────────────────────
    {"provider": "groq",    "model": "groq/llama-3.3-70b-versatile", "alias": "Llama 3.3 70B (Groq)"},
    {"provider": "groq",    "model": "groq/llama-3.1-8b-instant",    "alias": "Llama 3.1 8B (Groq)"},
    {"provider": "groq",    "model": "groq/gemma2-9b-it",            "alias": "Gemma 2 9B (Groq)"},
]


@router_models.get("")
async def list_models():
    return {"models": AVAILABLE_MODELS}


@router_pipelines.get("/configs")
async def list_pipeline_configs():
    return {
        "configs": [
            {
                "pipeline_id": "default-4-node",
                "description": "Standard 4-node pipeline (INPUT_VALIDATOR → ORCHESTRATOR → TOOL_CALLER → RESPONDER)",
                "nodes": ["INPUT_VALIDATOR", "ORCHESTRATOR", "TOOL_CALLER", "RESPONDER"],
            }
        ]
    }


@router_pipelines.post("/validate")
async def validate_pipeline_config(config: dict):
    """Validate a custom pipeline config before running."""
    nodes = config.get("nodes", [])
    if len(nodes) < 2:
        return {"valid": False, "error": "Pipeline must have at least 2 nodes."}
    if len(nodes) > 6:
        return {"valid": False, "error": "Pipeline supports at most 6 nodes."}
    return {"valid": True, "node_count": len(nodes)}
