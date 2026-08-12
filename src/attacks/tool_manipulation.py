"""
Tool Manipulation Injection Technique.

Merges malicious parameters into legitimate tool call dictionaries
to trick downstream tool executors or database connectors.
"""

from __future__ import annotations

import json
from typing import Any, Dict


class ToolManipulationInjector:
    """
    Generates payloads that attempt to hijack tool call execution parameters.
    """

    def generate_payload(
        self,
        legitimate_tool_call: Dict[str, Any],
        malicious_params: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Merge malicious parameters into a legitimate tool call.
        """
        # Create a deep copy of the legitimate tool call
        payload = dict(legitimate_tool_call)

        # Merge malicious params
        if "params" in payload and isinstance(payload["params"], dict):
            payload["params"] = {**payload["params"], **malicious_params}
        else:
            payload = {**payload, **malicious_params}

        return payload

    def to_prompt_string(self, payload: Dict[str, Any]) -> str:
        """
        Convert the tool call payload to a string formatting that can be injected.
        """
        return f"[TOOL REQUEST OVERRIDE]: {json.dumps(payload)}"
