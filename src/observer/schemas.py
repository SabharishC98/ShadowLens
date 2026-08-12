"""
Observer schemas — Pydantic v2 models for every event, result, and
data object produced by the ShadowLens observer layer.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────────────────────────────

class InjectionLabel(str, Enum):
    SAFE                    = "safe"
    ROLE_OVERRIDE           = "role_override"
    GOAL_HIJACKING          = "goal_hijacking"
    CONTEXT_POISONING       = "context_poisoning"
    TOOL_MANIPULATION       = "tool_manipulation"
    CASCADING_AMPLIFICATION = "cascading_amplification"


LABELS: List[str] = [e.value for e in InjectionLabel]


class DriftLevel(str, Enum):
    LOW      = "low"
    MEDIUM   = "medium"
    HIGH     = "high"
    CRITICAL = "critical"


# ── Sub-results ────────────────────────────────────────────────────────────────

class ClassificationResult(BaseModel):
    injected: bool
    technique: str                     # InjectionLabel value
    confidence: float
    all_scores: Dict[str, float]


class DriftResult(BaseModel):
    score: float                       # 0.0 (identical) → 1.0 (fully drifted)
    level: DriftLevel


class GoalCheckResult(BaseModel):
    violated: bool
    reason: Optional[str] = None
    method: str                        # "rule_based" | "llm_judge"


# ── Primary Event ──────────────────────────────────────────────────────────────

class ObserverEvent(BaseModel):
    event_id: str                   = Field(default_factory=lambda: str(uuid4()))
    run_id: str
    timestamp: datetime             = Field(default_factory=datetime.utcnow)
    sender_node: str
    receiver_node: str
    hop_index: int
    raw_message: str

    # Classifier output
    injection_detected: bool        = False
    injection_technique: str        = InjectionLabel.SAFE.value
    injection_confidence: float     = 0.0
    all_scores: Dict[str, float]    = Field(default_factory=dict)

    # Semantic drift
    drift_score: float              = 0.0
    drift_from_baseline: str        = DriftLevel.LOW.value

    # Goal consistency
    goal_violated: bool             = False
    goal_violation_reason: Optional[str]    = None
    goal_check_method: Optional[str]        = None

    # Propagation
    propagation_vector: Optional[str]       = None   # upstream event_id that caused this


# ── Run Summary ───────────────────────────────────────────────────────────────

class RunSummary(BaseModel):
    total_hops: int                 = 0
    injections_detected: int        = 0
    propagation_rate: float         = 0.0
    furthest_propagation: int       = -1
    goal_violated: bool             = False
    max_drift_score: float          = 0.0
    terminal_success: bool          = False   # injection reached RESPONDER output
