"""
/api/health — system health check endpoint.
"""

from __future__ import annotations

import os

from fastapi import APIRouter

from src.api.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthResponse)
async def health_check():
    """Returns classifier status, DB connectivity, and LLM provider status."""
    # DB check
    db_connected = False
    try:
        from src.api.db import get_db
        await get_db().command("ping")
        db_connected = True
    except Exception:
        pass

    # Classifier mode
    model_path   = os.getenv("CLASSIFIER_MODEL_PATH", "stub")
    clf_mode     = "live" if (model_path != "stub" and os.path.isdir(model_path)) else "stub"

    # LLM providers — check for free-tier keys (Gemini + Groq)
    providers = []
    if os.getenv("GEMINI_API_KEY"):     providers.append("gemini")
    if os.getenv("GROQ_API_KEY"):       providers.append("groq")
    # Also check paid providers if user adds them later
    if os.getenv("OPENAI_API_KEY"):     providers.append("openai")
    if os.getenv("ANTHROPIC_API_KEY"):  providers.append("anthropic")

    return HealthResponse(
        status          = "ok",
        classifier_mode = clf_mode,
        db_connected    = db_connected,
        llm_providers   = providers,
    )
