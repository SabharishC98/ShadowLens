"""
Pipeline configuration dataclasses.
All pipeline behaviour (node count, model assignments, timeouts) is
driven by these objects — never hardcoded inside harness or agent logic.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────────────────────────────

class AgentRole(str, Enum):
    INPUT_VALIDATOR = "INPUT_VALIDATOR"
    ORCHESTRATOR    = "ORCHESTRATOR"
    TOOL_CALLER     = "TOOL_CALLER"
    RESPONDER       = "RESPONDER"
    CUSTOM          = "CUSTOM"


class AttackTechnique(str, Enum):
    ROLE_OVERRIDE             = "role_override"
    CONTEXT_POISONING         = "context_poisoning"
    GOAL_HIJACKING            = "goal_hijacking"
    TOOL_MANIPULATION         = "tool_manipulation"
    CASCADING_AMPLIFICATION   = "cascading_amplification"
    NONE                      = "none"


# ── Node Config ────────────────────────────────────────────────────────────────

class NodeConfig(BaseModel):
    name: str
    role: AgentRole
    model: str = "gemini/gemini-2.5-flash"
    temperature: float = 0.7
    max_tokens: int = 1024
    system_prompt_override: Optional[str] = None


# ── Attack Config ──────────────────────────────────────────────────────────────

class AttackConfig(BaseModel):
    technique: AttackTechnique = AttackTechnique.NONE
    injection_node_index: int = 0          # 0 = first node (INPUT_VALIDATOR)
    target_goal: str = ""                  # what the attack tries to achieve
    false_fact: str = ""                   # for context_poisoning
    hijacked_goal: str = ""               # for goal_hijacking
    malicious_tool_params: Dict[str, Any] = Field(default_factory=dict)
    randomize_payload: bool = True


# ── Pipeline Config ────────────────────────────────────────────────────────────

class PipelineConfig(BaseModel):
    pipeline_id: str = "default-4-node"
    nodes: List[NodeConfig] = Field(default_factory=list)
    timeout_seconds: int = 120
    enable_observer: bool = True

    model_config = {"arbitrary_types_allowed": True}


# ── Run Context (passed to Observer per-hop) ────────────────────────────────────

class RunContext(BaseModel):
    run_id: str
    original_task: str
    attack_config: Optional[AttackConfig] = None


# ── Defaults ───────────────────────────────────────────────────────────────────

DEFAULT_PIPELINE_CONFIG = PipelineConfig(
    pipeline_id="default-4-node",
    nodes=[
        NodeConfig(name="INPUT_VALIDATOR", role=AgentRole.INPUT_VALIDATOR, model="gemini/gemini-2.5-flash"),
        NodeConfig(name="ORCHESTRATOR",    role=AgentRole.ORCHESTRATOR,    model="gemini/gemini-2.5-flash"),
        NodeConfig(name="TOOL_CALLER",     role=AgentRole.TOOL_CALLER,     model="gemini/gemini-2.5-flash"),
        NodeConfig(name="RESPONDER",       role=AgentRole.RESPONDER,       model="gemini/gemini-2.5-flash"),
    ],
)
