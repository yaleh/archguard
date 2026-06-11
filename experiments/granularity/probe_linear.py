"""Stage 72.2 — Post-hoc linear probe diagnostic.

IMPORTANT: This is a POST-HOC diagnostic tool. It uses P_oracle labels
derived from Stage 71.3 (p-oracle-v2.json), which are unavailable until
after Phase 71 completes — i.e., after the prediction freeze timestamp.
P_probe results MUST NOT be used in the §10 decision table; they answer
only "can the embedding space linearly distinguish optimal level?" and
cannot replace the pre-registered predictors P_GIT-sem / P_GIT-struct.

Method:
- Input: S-lm-real embeddings per level (from embed.py output) + P_oracle
- Train a multinomial logistic regression (5-fold CV, L2 regularization)
  to predict P_oracle level label from anchor embedding at each level.
- Report per-level classification accuracy + confusion matrix.
- Label source: Stage 71.3 p-oracle-v2.json (produced after prediction freeze).

CLI:
    python probe_linear.py \\
        --embeddings artifacts/embeddings/dim-input.json \\
        --p-oracle artifacts/runs-v2/p-oracle-v2.json \\
        -o artifacts/runs-v2/p-probe-v2.json \\
        [--seed 59]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import LabelEncoder

from lib_py.common import write_json_atomic

IS_POST_HOC = True
LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5"]
DEFAULT_SEED = 59
CV_FOLDS = 5
MAX_ITER = 1000


def normalize_level(level: str) -> str:
    return "L3" if level == "L4" else level


def load_embeddings(path: str) -> dict[str, dict[str, list[float]]]:
    """Load embeddings: {level: {anchor_key: vector}}.

    Supports the embed.py output format:
      - Top-level keys: level names (L0..L5)
      - Each value: dict {anchor_key: embedding_list}
    """
    data = json.loads(Path(path).read_text())
    # Handle v2 format: data may be {level: {anchor_key: vector}} directly
    # or wrapped in some metadata
    if isinstance(data, dict) and any(k in data for k in LEVELS):
        return data
    # Try nested 'embeddings' key
    if "embeddings" in data:
        return data["embeddings"]
    raise ValueError(f"Unrecognized embedding file format at {path}")


def load_p_oracle(path: str) -> dict[str, str]:
    """Load p-oracle: {task_id: level}."""
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        return {str(k): normalize_level(str(v)) for k, v in data.items()}
    raise ValueError(f"Expected dict format for p-oracle at {path}")


def run_probe(
    embeddings_by_level: dict[str, dict[str, list[float]]],
    p_oracle: dict[str, str],
    *,
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:
    """Train logistic regression probes and return per-level accuracy."""
    # Use P_oracle labels as target
    # For each level, build (X, y) matrix where X = anchor embeddings at that level
    # and y = p_oracle label for that anchor (matching by anchor key)

    results_by_level: dict[str, Any] = {}

    # Collect all anchor keys and their P_oracle labels
    all_oracle_by_anchor: dict[str, str] = {}
    for level_embeds in embeddings_by_level.values():
        for anchor_key in level_embeds:
            # anchor_key may map to a task id via the entity name
            # For v2 probes, anchor keys are entity names matching task entities
            # P_oracle is per task_id; we need to map anchor → task → oracle
            # If anchor_key is in p_oracle directly, use it
            if anchor_key in p_oracle:
                all_oracle_by_anchor[anchor_key] = p_oracle[anchor_key]

    if not all_oracle_by_anchor:
        return {
            "is_post_hoc": IS_POST_HOC,
            "error": "No anchor keys matched P_oracle task ids; cannot run probe",
            "note": "P_probe requires anchor keys to match task IDs from p-oracle-v2.json",
        }

    le = LabelEncoder()
    all_labels = sorted(set(all_oracle_by_anchor.values()))
    le.fit(all_labels)

    for level in LEVELS:
        level_embeds = embeddings_by_level.get(level, {})
        # Build (X, y) for anchors with both embeddings and oracle labels
        X_rows: list[list[float]] = []
        y_rows: list[str] = []
        for anchor_key, oracle_lvl in all_oracle_by_anchor.items():
            if anchor_key in level_embeds:
                X_rows.append(level_embeds[anchor_key])
                y_rows.append(oracle_lvl)

        if len(X_rows) < CV_FOLDS or len(set(y_rows)) < 2:
            results_by_level[level] = {
                "n_anchors": len(X_rows),
                "n_classes": len(set(y_rows)),
                "cv_accuracy": None,
                "skip_reason": f"n={len(X_rows)}<{CV_FOLDS} folds or <2 classes",
            }
            continue

        X = np.array(X_rows)
        y = le.transform(y_rows)

        clf = LogisticRegression(
            multi_class="multinomial",
            max_iter=MAX_ITER,
            random_state=seed,
            C=1.0,
        )
        cv_scores = cross_val_score(clf, X, y, cv=CV_FOLDS, scoring="accuracy")

        # Confusion matrix (full fit on all data for reporting)
        clf.fit(X, y)
        y_pred = clf.predict(X)
        n_classes = len(all_labels)
        conf_matrix = np.zeros((n_classes, n_classes), dtype=int)
        for true_i, pred_i in zip(y, y_pred):
            conf_matrix[true_i][pred_i] += 1

        results_by_level[level] = {
            "n_anchors": len(X_rows),
            "n_classes": len(set(y_rows)),
            "cv_accuracy_mean": float(cv_scores.mean()),
            "cv_accuracy_std": float(cv_scores.std()),
            "cv_folds": CV_FOLDS,
            "train_accuracy": float(np.mean(y == y_pred)),
            "confusion_matrix": conf_matrix.tolist(),
            "label_order": list(le.classes_),
        }

    return {
        "is_post_hoc": IS_POST_HOC,
        "post_hoc_note": (
            "P_probe uses P_oracle labels from Stage 71.3 (produced after prediction freeze). "
            "P_probe answers 'can S-lm-real embeddings linearly separate optimal level labels?' "
            "and CANNOT replace P_GIT-sem/P_GIT-struct in the §10 decision table."
        ),
        "seed": seed,
        "cv_folds": CV_FOLDS,
        "n_anchors_with_oracle": len(all_oracle_by_anchor),
        "oracle_label_counts": {lv: sum(1 for v in all_oracle_by_anchor.values() if v == lv)
                                 for lv in LEVELS},
        "probe_by_level": results_by_level,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Post-hoc linear probe diagnostic (Stage 72.2). NOT for decision table."
    )
    parser.add_argument("--embeddings", required=True,
                        help="S-lm-real embeddings (dim-input.json or dim-lm-real.json)")
    parser.add_argument("--p-oracle", required=True,
                        help="p-oracle-v2.json from Stage 71.3 (POST-HOC)")
    parser.add_argument("-o", "--output", required=True, help="output p-probe-v2.json")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args(argv)

    print(
        "WARNING: probe_linear.py is a POST-HOC diagnostic. "
        "Results cannot be used in the §10 decision table.",
        file=sys.stderr,
    )

    embeddings_by_level = load_embeddings(args.embeddings)
    p_oracle = load_p_oracle(args.p_oracle)

    result = run_probe(embeddings_by_level, p_oracle, seed=args.seed)
    write_json_atomic(args.output, result)
    print(f"p-probe written → {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
