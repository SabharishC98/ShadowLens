"""
Classifier evaluation script — generates metrics report and confusion matrix.

Run after training:
    python src/classifier/evaluate.py --model-path models/shadowlens-classifier
"""

from __future__ import annotations

import src.api.hotfix  # noqa: F401

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import evaluate as ev
from sklearn.metrics import confusion_matrix, classification_report

from src.observer.schemas import LABELS

logger = logging.getLogger(__name__)


def evaluate_model(model_path: str, output_dir: str = "models/"):
    import torch
    from transformers import DistilBertForSequenceClassification, DistilBertTokenizerFast
    from datasets import load_dataset, Dataset

    logger.info("Loading model from %s", model_path)
    tokenizer = DistilBertTokenizerFast.from_pretrained(model_path)
    model     = DistilBertForSequenceClassification.from_pretrained(model_path)
    model.eval()

    # Load test split (same seed as training to get the same held-out set)
    from src.classifier.train import load_and_prepare_datasets, tokenize
    split     = load_and_prepare_datasets()
    test_ds   = split["test"].map(
        lambda b: tokenizer(b["text"], truncation=True, padding="max_length", max_length=256),
        batched=True,
    )
    test_ds.set_format("torch", columns=["input_ids", "attention_mask", "label"])

    all_preds, all_labels = [], []
    with torch.no_grad():
        for i in range(0, len(test_ds), 64):
            batch = test_ds[i:i+64]
            out   = model(
                input_ids      = batch["input_ids"],
                attention_mask = batch["attention_mask"],
            )
            preds = out.logits.argmax(dim=-1).tolist()
            all_preds.extend(preds)
            all_labels.extend(batch["label"].tolist())

    acc_metric = ev.load("accuracy")
    f1_metric  = ev.load("f1")
    accuracy   = acc_metric.compute(predictions=all_preds, references=all_labels)["accuracy"]
    f1_macro   = f1_metric.compute(predictions=all_preds,  references=all_labels, average="macro")["f1"]

    report = classification_report(all_labels, all_preds, target_names=LABELS, digits=4)
    cm     = confusion_matrix(all_labels, all_preds).tolist()

    print(f"\nAccuracy : {accuracy:.4f}")
    print(f"F1 Macro : {f1_macro:.4f}")
    print(f"\n{report}")

    # Save JSON report
    output = {
        "accuracy":  round(accuracy, 4),
        "f1_macro":  round(f1_macro, 4),
        "confusion_matrix": cm,
        "labels":    LABELS,
        "per_class_report": report,
    }
    out_path = Path(output_dir) / "evaluation_report.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)
    logger.info("Report saved to %s", out_path)

    # Optional: confusion matrix plot
    try:
        import matplotlib.pyplot as plt
        import seaborn as sns
        fig, ax = plt.subplots(figsize=(8, 6))
        sns.heatmap(cm, annot=True, fmt="d", xticklabels=LABELS, yticklabels=LABELS,
                    cmap="Blues", ax=ax)
        ax.set_xlabel("Predicted")
        ax.set_ylabel("True")
        ax.set_title(f"Confusion Matrix (Acc={accuracy:.3f}, F1={f1_macro:.3f})")
        plt.tight_layout()
        plt.savefig(Path(output_dir) / "confusion_matrix.png", dpi=150)
        plt.close()
        logger.info("Confusion matrix saved.")
    except ImportError:
        logger.warning("matplotlib/seaborn not installed — skipping confusion matrix plot.")

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--output-dir", default="models/")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    evaluate_model(args.model_path, args.output_dir)
