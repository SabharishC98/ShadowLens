"""
SemanticDriftDetector — measures how far the current agent message has
semantically diverged from the original task intent.

This catches goal hijacking and cascading amplification attacks that
produce no explicit injection keywords. Key contribution for Claim 3
in the ShadowLens paper.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from src.observer.schemas import DriftLevel, DriftResult

logger = logging.getLogger(__name__)


class SemanticDriftDetector:
    """
    Computes cosine similarity between each agent message and the
    original task baseline embedding. Drift score = 1 - similarity.

    Thresholds (tuned on internal test set):
        low      < 0.35
        medium   0.35 – 0.55
        high     0.55 – 0.72
        critical > 0.72
    """

    THRESHOLD_MEDIUM   = 0.35
    THRESHOLD_HIGH     = 0.55
    THRESHOLD_CRITICAL = 0.72
    MODEL_NAME         = "all-MiniLM-L6-v2"  # 384-dim, fast CPU inference

    def __init__(self):
        self._model            = None   # lazy-loaded on first use
        self.baseline_embedding = None

    def _load_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            logger.info("Loading SentenceTransformer model: %s", self.MODEL_NAME)
            self._model = SentenceTransformer(self.MODEL_NAME)

    def set_baseline(self, original_task: str) -> None:
        """
        Must be called once at the start of each pipeline run with the
        original user task. Encodes and caches the baseline embedding.
        """
        self._load_model()
        self.baseline_embedding = self._model.encode([original_task])
        logger.debug("Baseline embedding set for task: %.60s...", original_task)

    def compute_drift(self, message: str) -> DriftResult:
        """
        Measure semantic drift of message from the baseline task.

        Returns DriftResult with score (0.0 = identical, 1.0 = fully drifted)
        and a categorical level label.

        Raises RuntimeError if set_baseline() hasn't been called.
        """
        if self.baseline_embedding is None:
            raise RuntimeError(
                "Baseline not set. Call set_baseline(original_task) before compute_drift()."
            )

        self._load_model()

        from sklearn.metrics.pairwise import cosine_similarity
        msg_embedding = self._model.encode([message])
        similarity    = float(cosine_similarity(self.baseline_embedding, msg_embedding)[0][0])
        drift_score   = round(1.0 - similarity, 4)

        if drift_score > self.THRESHOLD_CRITICAL:
            level = DriftLevel.CRITICAL
        elif drift_score > self.THRESHOLD_HIGH:
            level = DriftLevel.HIGH
        elif drift_score > self.THRESHOLD_MEDIUM:
            level = DriftLevel.MEDIUM
        else:
            level = DriftLevel.LOW

        return DriftResult(score=drift_score, level=level)

    def reset(self) -> None:
        """Clear baseline. Call between pipeline runs."""
        self.baseline_embedding = None
