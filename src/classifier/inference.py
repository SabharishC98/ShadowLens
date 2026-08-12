"""
InjectionClassifier — wraps the fine-tuned DistilBERT model.

When CLASSIFIER_MODEL_PATH=stub (or model not found), runs in stub mode
which returns placeholder labels so the backend stays fully functional
before the model is trained.

Training: run src/classifier/train.py on Google Colab T4 (~2 hrs for 15k samples).
Target:   accuracy > 85%, F1 macro > 0.82.
"""

from __future__ import annotations

import src.api.hotfix  # noqa: F401

import logging
import os
import time
from typing import Dict

from src.observer.schemas import ClassificationResult, InjectionLabel, LABELS

logger = logging.getLogger(__name__)

# ── Stub mode config ───────────────────────────────────────────────────────────
STUB_SAFE_RESULT = ClassificationResult(
    injected    = False,
    technique   = InjectionLabel.SAFE.value,
    confidence  = 1.0,
    all_scores  = {label: (1.0 if label == "safe" else 0.0) for label in LABELS},
)


class InjectionClassifier:
    """
    Runs DistilBERT-based 6-class injection classification.

    Modes:
        stub  — no model loaded, returns safe placeholder (backend stays up)
        live  — fine-tuned DistilBERT checkpoint loaded from model_path
    """

    def __init__(self, model_path: str = "stub"):
        self.model_path = model_path
        self._model     = None
        self._tokenizer = None
        self._stub_mode = (model_path == "stub" or not os.path.isdir(model_path))

        if self._stub_mode:
            logger.warning(
                "InjectionClassifier running in STUB mode. "
                "Train the model and set CLASSIFIER_MODEL_PATH in .env to enable real classification."
            )
        else:
            self._load_model()

    def _load_model(self):
        """Load DistilBERT checkpoint from disk."""
        try:
            import torch
            from transformers import DistilBertForSequenceClassification, DistilBertTokenizerFast

            logger.info("Loading DistilBERT classifier from: %s", self.model_path)
            self._tokenizer = DistilBertTokenizerFast.from_pretrained(self.model_path)
            self._model     = DistilBertForSequenceClassification.from_pretrained(self.model_path)
            self._model.eval()
            logger.info("Classifier loaded. Labels: %s", LABELS)
        except Exception as exc:
            logger.error("Failed to load classifier: %s. Falling back to stub mode.", exc)
            self._stub_mode = True

    def classify(self, text: str) -> ClassificationResult:
        """
        Classify a text string. Returns ClassificationResult.
        Runs in <50ms on CPU in live mode.
        """
        if self._stub_mode:
            return STUB_SAFE_RESULT

        import torch

        t0     = time.time()
        inputs = self._tokenizer(
            text, return_tensors="pt", truncation=True, max_length=256, padding=True
        )
        with torch.no_grad():
            logits = self._model(**inputs).logits

        probs     = torch.softmax(logits, dim=-1).squeeze()
        label_idx = int(probs.argmax().item())
        latency   = round((time.time() - t0) * 1000, 1)

        logger.debug("Classified in %.1f ms — %s (%.3f)", latency, LABELS[label_idx], probs[label_idx])

        return ClassificationResult(
            injected   = (label_idx != 0),
            technique  = LABELS[label_idx],
            confidence = round(probs[label_idx].item(), 4),
            all_scores = {LABELS[i]: round(probs[i].item(), 4) for i in range(len(LABELS))},
        )

    @property
    def is_stub(self) -> bool:
        return self._stub_mode
