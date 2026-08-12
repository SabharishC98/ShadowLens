"""
PipelineHarness — builds and executes the LangGraph multi-agent pipeline.

Architecture:
    INPUT_VALIDATOR → ORCHESTRATOR → TOOL_CALLER → RESPONDER

The Observer is injected as a wrapper around each node's output so that
every inter-agent message is intercepted without altering the pipeline.
Attack payloads are injected at the configured node index before execution.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Dict, List, Optional

from langgraph.graph import END, START, StateGraph

from src.attacks.engine import AttackEngine, PropagationResult
from src.observer.observer import Observer
from src.observer.schemas import ObserverEvent, RunSummary
from src.pipeline.agents import (
    input_validator_node,
    orchestrator_node,
    responder_node,
    tool_caller_node,
)
from src.pipeline.config import (
    AttackConfig,
    AttackTechnique,
    DEFAULT_PIPELINE_CONFIG,
    PipelineConfig,
    RunContext,
)

logger = logging.getLogger(__name__)

# ── LangGraph state type ───────────────────────────────────────────────────────
# Using plain dict (TypedDict-compatible) to avoid langchain_core dependency.
PipelineState = Dict[str, Any]


class RunResult:
    """Complete result of a single pipeline execution."""

    def __init__(
        self,
        run_id:         str,
        original_task:  str,
        final_output:   str,
        messages:       List[Dict[str, Any]],
        observer_events: List[ObserverEvent],
        propagation:    Optional[PropagationResult],
    ):
        self.run_id          = run_id
        self.original_task   = original_task
        self.final_output    = final_output
        self.messages        = messages
        self.observer_events = observer_events
        self.propagation     = propagation
        self.summary         = self._build_summary()

    def _build_summary(self) -> RunSummary:
        if not self.observer_events:
            return RunSummary()
        events = self.observer_events
        detected = [e for e in events if e.injection_detected]
        return RunSummary(
            total_hops          = len(events),
            injections_detected = len(detected),
            propagation_rate    = round(len(detected) / len(events), 4) if events else 0.0,
            furthest_propagation= max((e.hop_index for e in detected), default=-1),
            goal_violated       = any(e.goal_violated for e in events),
            max_drift_score     = round(max((e.drift_score for e in events), default=0.0), 4),
            terminal_success    = any(
                e.injection_detected and e.receiver_node == "RESPONDER" for e in events
            ),
        )


class PipelineHarness:
    """
    Builds and runs the configurable multi-agent pipeline.

    Usage:
        harness = PipelineHarness(config=DEFAULT_PIPELINE_CONFIG)
        harness.set_observer(observer)
        result = await harness.run(task="Summarize quantum computing", attack_config=cfg)
    """

    def __init__(self, config: PipelineConfig = DEFAULT_PIPELINE_CONFIG):
        self.config        = config
        self.observer: Optional[Observer]      = None
        self.attack_engine = AttackEngine()
        self._node_fns     = [
            input_validator_node,
            orchestrator_node,
            tool_caller_node,
            responder_node,
        ]
        self._node_names   = [n.name for n in config.nodes]

    def set_observer(self, observer: Observer):
        self.observer = observer

    # ── Graph construction ─────────────────────────────────────────────────────

    def _build_graph(self, main_loop: Optional[asyncio.AbstractEventLoop] = None) -> Any:
        """Build the LangGraph StateGraph with observer-wrapped nodes."""
        graph = StateGraph(dict)

        # Wrap each node function with the observer interceptor
        for i, (node_cfg, node_fn) in enumerate(zip(self.config.nodes, self._node_fns)):
            wrapped = self._wrap_node(node_fn, node_cfg.name, i, main_loop)
            graph.add_node(node_cfg.name, wrapped)

        # Linear edges: start → n0 → n1 → n2 → n3 → end
        graph.add_edge(START, self._node_names[0])
        for i in range(len(self._node_names) - 1):
            graph.add_edge(self._node_names[i], self._node_names[i + 1])
        graph.add_edge(self._node_names[-1], END)

        return graph.compile()

    def _wrap_node(self, node_fn, node_name: str, hop_index: int, main_loop: Optional[asyncio.AbstractEventLoop] = None):
        """
        Returns a wrapped version of node_fn that:
        1. Runs the original node.
        2. Feeds the node's output to the Observer and WAITS for it to complete.

        Because the graph runs inside asyncio.to_thread (a worker thread),
        we use run_coroutine_threadsafe to schedule the async observer work
        on the main FastAPI event loop, then .result() to block until it
        finishes — ensuring events are populated before the next node runs.
        """
        observer       = self.observer
        all_names      = self._node_names
        next_node_name = (
            all_names[hop_index + 1] if hop_index + 1 < len(all_names) else "END"
        )

        def wrapped(state: PipelineState) -> PipelineState:
            import time
            time.sleep(2.0)  # Rate-limit spacing between hops
            # Execute original node
            update = node_fn(state)
            # Merge update into state
            merged = {**state, **update}

            # Run observer intercept synchronously from this worker thread
            if observer is not None:
                messages = merged.get("messages", [])
                if messages:
                    content = messages[-1].get("content", "")
                    run_ctx = RunContext(
                        run_id       = state["run_id"],
                        original_task= state["original_task"],
                    )
                    try:
                        coro = observer.intercept(
                            sender_node   = node_name,
                            receiver_node = next_node_name,
                            message       = content,
                            hop_index     = hop_index,
                            run_context   = run_ctx,
                        )
                        if main_loop and main_loop.is_running():
                            # Schedule on main loop and BLOCK until done
                            future = asyncio.run_coroutine_threadsafe(coro, main_loop)
                            future.result(timeout=60)  # wait up to 60s
                        else:
                            # Fallback: create a new loop in this thread
                            loop = asyncio.new_event_loop()
                            try:
                                loop.run_until_complete(coro)
                            finally:
                                loop.close()
                    except Exception as exc:
                        logger.warning("Observer intercept failed: %s", exc)

            return merged

        wrapped.__name__ = f"wrapped_{node_name}"
        return wrapped

    # ── Payload injection ──────────────────────────────────────────────────────

    def _inject_payload(
        self, task: str, attack_config: AttackConfig, stage_payloads: Optional[List[str]] = None
    ) -> str:
        """Prepend the attack payload to the task string for the injection node."""
        technique = attack_config.technique

        if technique == AttackTechnique.ROLE_OVERRIDE:
            payload = self.attack_engine.generate_payload(
                "role_override", target_goal=attack_config.target_goal,
                randomize=attack_config.randomize_payload,
            )
            return f"{task}\n\n{payload}"

        if technique == AttackTechnique.CONTEXT_POISONING:
            payload = self.attack_engine.generate_payload(
                "context_poisoning",
                false_fact=attack_config.false_fact,
                original_context=task,
            )
            return payload

        if technique == AttackTechnique.GOAL_HIJACKING:
            return self.attack_engine.generate_payload(
                "goal_hijacking",
                original_task=task,
                hijacked_goal=attack_config.hijacked_goal,
                randomize=attack_config.randomize_payload,
            )

        if technique == AttackTechnique.TOOL_MANIPULATION:
            inj = self.attack_engine.generate_payload(
                "tool_manipulation",
                legitimate_tool_call={"tool": "web_search", "query": task},
                malicious_params=attack_config.malicious_tool_params,
            )
            from src.attacks.tool_manipulation import ToolManipulationInjector
            return f"{task}\n\n{ToolManipulationInjector().to_prompt_string(inj)}"

        if technique == AttackTechnique.CASCADING_AMPLIFICATION:
            if stage_payloads:
                return f"{task}\n\n{stage_payloads[0]}"

        return task

    # ── Main execution ─────────────────────────────────────────────────────────

    async def run(
        self,
        task:          str,
        attack_config: Optional[AttackConfig] = None,
        run_id:        Optional[str] = None,
    ) -> RunResult:
        """
        Execute the full pipeline. Optionally injects an attack.

        Args:
            task:          The original user task.
            attack_config: If provided, injects payload at the configured node.
            run_id:        Existing run_id (generated if not provided).
        """
        run_id = run_id or str(uuid4())
        run_ctx = RunContext(
            run_id=run_id, original_task=task, attack_config=attack_config
        )

        # Prepare stage payloads for cascading amplification
        stage_payloads: Optional[List[str]] = None
        if attack_config and attack_config.technique == AttackTechnique.CASCADING_AMPLIFICATION:
            stage_payloads = self.attack_engine.generate_payload(
                "cascading_amplification",
                target_goal=attack_config.target_goal,
                num_hops=len(self.config.nodes),
            )

        # Determine initial input (with attack injected if applicable)
        initial_input = task
        if attack_config and attack_config.technique != AttackTechnique.NONE:
            if attack_config.injection_node_index == 0:
                initial_input = self._inject_payload(task, attack_config, stage_payloads)

        # Prepare initial state
        initial_state: PipelineState = {
            "run_id":        run_id,
            "original_task": task,
            "current_input": initial_input,
            "current_hop":   0,
            "messages":      [],
            "final_output":  "",
            "completed":     False,
            "node_configs":  [
                {
                    "name":          n.name,
                    "model":         n.model,
                    "temperature":   n.temperature,
                    "max_tokens":    n.max_tokens,
                    "system_prompt": n.system_prompt_override,
                }
                for n in self.config.nodes
            ],
            "attack_config": attack_config.model_dump() if attack_config else None,
            "stage_payloads": stage_payloads,
        }

        # Start observer
        if self.observer:
            self.observer.start_run(run_ctx)

        # Build and run graph
        try:
            main_loop = asyncio.get_running_loop()
        except RuntimeError:
            main_loop = None

        compiled = self._build_graph(main_loop)
        logger.info("[Harness] Starting run %s | task=%.60s...", run_id, task)

        try:
            final_state = await asyncio.to_thread(compiled.invoke, initial_state)
        except Exception as exc:
            logger.error("[Harness] Pipeline failed: %s", exc)
            raise

        # Allow background observer tasks to flush
        await asyncio.sleep(0.1)

        # Collect results
        observer_events = self.observer.get_events() if self.observer else []
        propagation     = (
            self.attack_engine.evaluate_propagation(observer_events, attack_config.model_dump() if attack_config else None)
            if attack_config and attack_config.technique != AttackTechnique.NONE
            else None
        )

        return RunResult(
            run_id          = run_id,
            original_task   = task,
            final_output    = final_state.get("final_output", ""),
            messages        = final_state.get("messages", []),
            observer_events = observer_events,
            propagation     = propagation,
        )
