"""Stage 72.1 — v2.2 statistical analysis.

Implements A-series (A1, A2, A3) and B-series (B1–B4) with BH-FDR correction.
Reads from artifacts produced by Stage 70.5 (predictions/dimensions) and
Stage 71.3 (scores). P_oracle is computed here from the scores.

2-sensor design: S-code unavailable (deviation D-70.2); analysis uses
S-lm-real (P_GIT-sem) and S-struct (P_GIT-struct).

B-series 7 tests (BH-FDR q=0.05):
  B1a: P_GIT-sem vs P_random (McNemar)
  B1b: P_GIT-struct vs P_GIT-sem (McNemar)
  B2a: P_GIT-sem vs H0 on discriminative subset (McNemar)
  B2b: P_GIT-struct vs H0 on discriminative subset (McNemar)
  B2c: P_GIT-sem vs P_GIT-struct (McNemar)
  B3:  |d_L(S-lm-real) - d_task| vs accuracy Spearman
  B4:  L3 vs L4 format sensitivity (paired Wilcoxon)

A-series 3 tests (independent α=0.05):
  A1: paired Wilcoxon best_intermediate vs L5 (per task class)
  A2: argmax level non-endpoint (per task class)
  A3: bootstrap CI (B+C class argmax ordinal > A class argmax ordinal)

CLI:
    python analyze_v2.py \\
        --scores artifacts/runs-v2/scores-v2.json \\
        --predictions artifacts/predictions/predictions-v2-latest.json \\
        --dim-lm-real artifacts/embeddings/dim-lm-real-results.json \\
        --dim-struct artifacts/embeddings/dim-struct-results.json \\
        --phase0 artifacts/embeddings/dim-phase0.json \\
        -o artifacts/runs-v2/analysis-v2.json \\
        [--seed 59] [--n-bootstrap 1000]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from scipy import stats

from lib_py.common import write_json_atomic

# --- Frozen protocol constants ---------------------------------------------------
ALPHA = 0.05
FDR_Q = 0.05  # BH-FDR q for B-series 7 tests
EFFECT_THRESHOLD = 0.1  # A1: ΔF1 >= 0.1
DEFAULT_N_BOOTSTRAP = 1000
DEFAULT_SEED = 59
MIN_DISCRIMINATIVE_SUBSET = 8  # §8.3 B2 gate
MIN_K_ANCHORS = 50  # §8.4

LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5"]
LEVEL_INDEX = {name: i for i, name in enumerate(LEVELS)}
MID_LEVELS = ["L1", "L2", "L3", "L4"]


def normalize_level(level: str) -> str:
    """§3 tie rule: L3/L4 are information-equivalent — always normalize L4 → L3."""
    return "L3" if level == "L4" else level


# --- BH-FDR correction ------------------------------------------------------------
def bh_fdr_correction(p_values: list[float], q: float = FDR_Q) -> list[bool]:
    """Benjamini-Hochberg FDR correction. Returns per-test rejection decisions."""
    n = len(p_values)
    if n == 0:
        return []
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    threshold_idx = -1
    for rank, (_orig, p) in enumerate(indexed, start=1):
        if p <= q * rank / n:
            threshold_idx = rank
    rejected = [False] * n
    for rank, (orig_idx, _p) in enumerate(indexed, start=1):
        if rank <= threshold_idx:
            rejected[orig_idx] = True
    return rejected


# --- score-table helpers -----------------------------------------------------------
def build_scores(rows: Sequence[dict[str, Any]]) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """Aggregate score rows → ({task_id: {level: mean score}}, {task_id: class}).

    Averages across models: multiple rows for (task × level) from different
    models are averaged together.
    """
    acc: dict[tuple[str, str], list[float]] = defaultdict(list)
    class_of: dict[str, str] = {}
    for row in rows:
        task = str(row["taskId"])
        level = str(row["level"])
        if level not in LEVEL_INDEX:
            continue
        acc[(task, level)].append(float(row["score"]))
        class_of[task] = str(row["taskClass"])
    by_task: dict[str, dict[str, float]] = defaultdict(dict)
    for (task, level), values in acc.items():
        by_task[task][level] = float(np.mean(values))
    return dict(by_task), class_of


def mean_by_level(
    by_task: dict[str, dict[str, float]], tasks: Sequence[str]
) -> dict[str, float]:
    """Per-level mean score over `tasks`; levels missing from a task are skipped."""
    sums: dict[str, list[float]] = defaultdict(list)
    for task in tasks:
        for level, score in by_task.get(task, {}).items():
            sums[level].append(score)
    return {level: float(np.mean(v)) for level, v in sums.items()}


def argmax_level(means: dict[str, float], candidates: Sequence[str] = LEVELS) -> str:
    """Argmax over levels; ties resolve to the lower ordinal (§3 / P_oracle rule)."""
    best: str | None = None
    best_value = -np.inf
    for level in candidates:  # ordinal order → strict '>' keeps lowest tie
        if level in means and means[level] > best_value:
            best = level
            best_value = means[level]
    if best is None:
        raise ValueError("no scores available for any candidate level")
    return best


def compute_p_oracle(
    by_task: dict[str, dict[str, float]],
) -> dict[str, str]:
    """Compute P_oracle per task: argmax level after §3 normalization."""
    result: dict[str, str] = {}
    for task, level_scores in by_task.items():
        raw = argmax_level(level_scores)
        result[task] = normalize_level(raw)
    return result


# --- A1: paired Wilcoxon (best intermediate vs L5) --------------------------------
def a1_wilcoxon(
    by_task: dict[str, dict[str, float]],
    class_of: dict[str, str],
    task_class: str,
    *,
    alpha: float = ALPHA,
    effect_threshold: float = EFFECT_THRESHOLD,
) -> dict[str, Any]:
    tasks = sorted(t for t, c in class_of.items() if c == task_class)
    if not tasks:
        return {"task_class": task_class, "n_pairs": 0, "p_value": None, "pass": False}
    means = mean_by_level(by_task, tasks)
    if not any(lv in means for lv in MID_LEVELS):
        return {"task_class": task_class, "n_pairs": 0, "p_value": None, "pass": False,
                "reason": "no intermediate level scores"}
    best_mid = argmax_level(means, MID_LEVELS)
    paired = [t for t in tasks if best_mid in by_task.get(t, {}) and "L5" in by_task.get(t, {})]
    mid_scores = np.array([by_task[t][best_mid] for t in paired])
    l5_scores = np.array([by_task[t]["L5"] for t in paired])
    diffs = mid_scores - l5_scores
    if len(paired) == 0:
        p_value = 1.0
    elif np.allclose(diffs, 0.0):
        p_value = 1.0
    else:
        _, p_value = stats.wilcoxon(mid_scores, l5_scores, alternative="greater")
    delta_f1 = float(np.mean(diffs)) if len(paired) else 0.0
    significant = bool(p_value < alpha)
    effect_met = bool(delta_f1 >= effect_threshold)
    return {
        "task_class": task_class,
        "best_mid_level": best_mid,
        "n_pairs": len(paired),
        "p_value": float(p_value),
        "alpha": alpha,
        "delta_f1": delta_f1,
        "effect_threshold": effect_threshold,
        "significant": significant,
        "effect_size_met": effect_met,
        "pass": significant and effect_met,
    }


# --- A2: argmax non-endpoint check ------------------------------------------------
def a2_check(
    by_task: dict[str, dict[str, float]], class_of: dict[str, str], task_class: str
) -> dict[str, Any]:
    tasks = sorted(t for t, c in class_of.items() if c == task_class)
    if not tasks:
        return {"task_class": task_class, "argmax_level": None, "pass": False}
    means = mean_by_level(by_task, tasks)
    if not means:
        return {"task_class": task_class, "argmax_level": None, "pass": False}
    peak = normalize_level(argmax_level(means))
    return {
        "task_class": task_class,
        "argmax_level": peak,
        "level_means": {lv: float(means[lv]) for lv in LEVELS if lv in means},
        "pass": peak not in ("L0", "L5"),
    }


# --- A3: bootstrap CI of argmax ordinal diff (B+C vs A) ---------------------------
def a3_bootstrap(
    by_task: dict[str, dict[str, float]],
    class_of: dict[str, str],
    *,
    n_bootstrap: int = DEFAULT_N_BOOTSTRAP,
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:
    """A3: bootstrap CI of argmax(B+C) − argmax(A) ordinals.

    Resampling unit = tasks (pre-registered §7/A3, plan Stage 72.1).
    B and C classes are pooled as 'fine-grained tasks'.
    """
    a_tasks = sorted(t for t, c in class_of.items() if c == "A")
    bc_tasks = sorted(t for t, c in class_of.items() if c in ("B", "C"))
    if not a_tasks or not bc_tasks:
        return {
            "pass": False,
            "reason": f"need A tasks (n={len(a_tasks)}) and B+C tasks (n={len(bc_tasks)})",
        }
    rng = np.random.default_rng(seed)

    def peak_ordinal(tasks: Sequence[str]) -> int:
        means = mean_by_level(by_task, tasks)
        if not means:
            return 0
        return LEVEL_INDEX[normalize_level(argmax_level(means))]

    observed = peak_ordinal(bc_tasks) - peak_ordinal(a_tasks)
    diffs = np.empty(n_bootstrap, dtype=np.int64)
    for i in range(n_bootstrap):
        ia = rng.integers(0, len(a_tasks), len(a_tasks))
        ibc = rng.integers(0, len(bc_tasks), len(bc_tasks))
        diffs[i] = peak_ordinal([bc_tasks[j] for j in ibc]) - peak_ordinal([a_tasks[j] for j in ia])
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return {
        "observed_diff": int(observed),
        "ci_low": float(lo),
        "ci_high": float(hi),
        "n_bootstrap": n_bootstrap,
        "seed": seed,
        "resampling_unit": "task",
        "n_tasks_a": len(a_tasks),
        "n_tasks_bc": len(bc_tasks),
        "pass": bool(lo > 0),
    }


# --- McNemar (B-series) -----------------------------------------------------------
def mcnemar_exact(
    hits_x: Sequence[bool], hits_y: Sequence[bool]
) -> dict[str, Any]:
    """Exact binomial McNemar. Two-sided, doubled tail, capped at 1."""
    b = sum(1 for x, y in zip(hits_x, hits_y) if x and not y)
    c = sum(1 for x, y in zip(hits_x, hits_y) if (not x) and y)
    n = b + c
    if n == 0:
        p_value = 1.0
    else:
        p_value = min(1.0, 2.0 * float(stats.binom.cdf(min(b, c), n, 0.5)))
    return {
        "b": b, "c": c, "n_discordant": n,
        "p_value": float(p_value),
        "x_better": b > c,
    }


# --- Predictor hit extraction -----------------------------------------------------
def extract_hits(
    preds: Sequence[dict[str, Any]],
    p_oracle: dict[str, str],
) -> dict[str, Any]:
    """For each task in preds, compute hit vector for each predictor."""
    task_ids: list[str] = []
    hit_sem: list[bool] = []
    hit_struct: list[bool] = []
    hit_h0: list[bool] = []
    hit_random: list[bool] = []

    for row in preds:
        tid = str(row["task_id"])
        oracle = p_oracle.get(tid)
        if oracle is None:
            continue  # no score → skip
        task_ids.append(tid)
        hit_sem.append(normalize_level(str(row["P_GIT-sem"])) == oracle)
        hit_struct.append(normalize_level(str(row["P_GIT-struct"])) == oracle)
        hit_h0.append(normalize_level(str(row["H0"])) == oracle)
        hit_random.append(normalize_level(str(row["P_random"])) == oracle)

    return {
        "task_ids": task_ids,
        "hit_sem": hit_sem,
        "hit_struct": hit_struct,
        "hit_h0": hit_h0,
        "hit_random": hit_random,
    }


def discriminative_subset(
    preds: Sequence[dict[str, Any]],
    p_oracle: dict[str, str],
) -> list[dict[str, Any]]:
    """Tasks where H0 ≠ P_oracle (discriminative subset, §B2)."""
    result = []
    for row in preds:
        tid = str(row["task_id"])
        oracle = p_oracle.get(tid)
        if oracle is None:
            continue
        h0 = normalize_level(str(row["H0"]))
        if h0 != oracle:
            result.append(row)
    return result


# --- B4: L3 vs L4 format sensitivity (paired Wilcoxon) ---------------------------
def b4_format_sensitivity(
    by_task: dict[str, dict[str, float]],
    *,
    alpha: float = ALPHA,
) -> dict[str, Any]:
    """B4: paired Wilcoxon on L3 vs L4 scores; tests for format effect."""
    paired = [t for t, scores in by_task.items() if "L3" in scores and "L4" in scores]
    if len(paired) < 3:
        return {"n_pairs": len(paired), "p_value": None, "pass": False,
                "reason": "insufficient paired tasks"}
    l3 = np.array([by_task[t]["L3"] for t in paired])
    l4 = np.array([by_task[t]["L4"] for t in paired])
    diffs = l3 - l4
    if np.allclose(diffs, 0.0):
        p_value = 1.0
    else:
        _, p_value = stats.wilcoxon(l3, l4, alternative="two-sided")
    return {
        "n_pairs": len(paired),
        "mean_l3": float(np.mean(l3)),
        "mean_l4": float(np.mean(l4)),
        "mean_diff_l3_minus_l4": float(np.mean(diffs)),
        "p_value": float(p_value),
        "alpha": alpha,
        "significant": bool(p_value < alpha),
        "pass": bool(p_value < alpha),
        "note": "secondary test — L3/L4 are information-equivalent by design",
    }


# --- B3: Spearman gradient --------------------------------------------------------
def b3_spearman(
    by_task: dict[str, dict[str, float]],
    class_of: dict[str, str],
    lm_real_dims: dict[str, float],
    d_task_per_class: dict[str, float],
    *,
    alpha: float = ALPHA,
) -> dict[str, Any]:
    """B3: Spearman(|d_L(S-lm-real) - d_task|, accuracy) < 0 (one-sided).

    Units = (task × derivable level) cells.
    """
    distances: list[float] = []
    accuracies: list[float] = []
    units: list[dict[str, str]] = []

    for task, scores in by_task.items():
        tc = class_of.get(task, "?")
        d_task = d_task_per_class.get(tc)
        if d_task is None:
            continue
        for level, score in scores.items():
            d_level = lm_real_dims.get(level)
            if d_level is None:
                continue
            distances.append(abs(d_level - d_task))
            accuracies.append(score)
            units.append({"task": task, "level": level})

    if len(distances) < 3:
        return {
            "n_units": len(distances), "rho": None, "p_value": None,
            "pass": False, "reason": "insufficient data",
        }

    rho, p_value = stats.spearmanr(distances, accuracies, alternative="less")
    valid = bool(np.isfinite(rho) and np.isfinite(p_value))
    significant = bool(valid and p_value < alpha)

    return {
        "n_units": len(distances),
        "rho": float(rho) if valid else None,
        "p_value": float(p_value) if valid else None,
        "alpha": alpha,
        "alternative": "less",
        "significant": significant,
        "direction_correct": bool(rho < 0) if valid else False,
        "pass": bool(significant and rho < 0),
    }


# --- §10 decision table -----------------------------------------------------------
def decide_v2(
    *,
    b2a_pass: bool,
    b2b_pass: bool,
    b3_pass: bool,
    b1a_pass: bool,
    discriminative_subset_size: int,
    k_anchors: int | None,
    lm_real_reliable: dict[str, bool],
    phase0_verdict: str,
) -> dict[str, Any]:
    """§10 decision table (v2.2).

    Row 1: Phase 0 — 0 sensors separate → strong negative, B-series stops.
    Row 2: Discriminative subset < 8 / K < 50 / majority unreliable → no verdict.
    Row 3: B2a AND B2b AND B3 → GIT predictive with mechanism.
    Row 4: B2a OR B2b, not B3 → single signal, attribution analysis.
    Row 5: B2a/B2b not pass, B1a pass → heuristic in disguise.
    Row 6: all fail → GIT rejected.
    """
    if "STOP" in phase0_verdict.upper() or "0" in phase0_verdict:
        return {
            "row": 1,
            "label": "phase0_stop",
            "verdict": "Phase 0 门控: 0个传感器分离 → B系列停止，仅报告Experiment A",
        }

    no_power: list[str] = []
    if discriminative_subset_size < MIN_DISCRIMINATIVE_SUBSET:
        no_power.append(f"discriminative_subset={discriminative_subset_size}<{MIN_DISCRIMINATIVE_SUBSET}")
    if k_anchors is not None and k_anchors < MIN_K_ANCHORS:
        no_power.append(f"k_anchors={k_anchors}<{MIN_K_ANCHORS}")
    n_unreliable = sum(1 for ok in lm_real_reliable.values() if not ok)
    if n_unreliable > len(lm_real_reliable) / 2:
        no_power.append(f"majority_unreliable={n_unreliable}/{len(lm_real_reliable)}")

    if no_power:
        return {
            "row": 2,
            "label": "no_verdict",
            "verdict": "Experiment B 无判定力：仅报告Experiment A",
            "reasons": no_power,
        }

    if b2a_pass and b2b_pass and b3_pass:
        return {
            "row": 3,
            "label": "predictive_with_mechanism",
            "verdict": "B2a+B2b+B3 成立：GIT升级为预测性候选",
        }
    if b2a_pass or b2b_pass:
        return {
            "row": 4,
            "label": "single_signal",
            "verdict": f"B2a={'pass' if b2a_pass else 'fail'}/B2b={'pass' if b2b_pass else 'fail'}+B3={'pass' if b3_pass else 'fail'}：单信号有效，归因分析",
        }
    if b1a_pass:
        return {
            "row": 5,
            "label": "heuristic_in_disguise",
            "verdict": "B2失败、B1a成立：维度机器判为换装的启发式，保留H0",
        }
    return {
        "row": 6,
        "label": "git_rejected",
        "verdict": "B1/B2 均不成立：GIT预测性否定，如实报告",
    }


# --- top-level orchestration -------------------------------------------------------
def analyze_v2(
    scores_rows: list[dict[str, Any]],
    preds: list[dict[str, Any]],
    dim_lm_real: dict[str, Any],
    dim_struct: dict[str, Any],
    phase0: dict[str, Any],
    *,
    seed: int = DEFAULT_SEED,
    n_bootstrap: int = DEFAULT_N_BOOTSTRAP,
) -> dict[str, Any]:
    """Run all pre-registered tests and emit decision table."""
    by_task, class_of = build_scores(scores_rows)
    p_oracle = compute_p_oracle(by_task)

    # d_ℓ per level (S-lm-real)
    lm_real_dims: dict[str, float] = {}
    lm_real_reliable: dict[str, bool] = {}
    for lv, info in dim_lm_real.get("levels", {}).items():
        lm_real_dims[lv] = float(info["twonn"])
        lm_real_reliable[lv] = bool(info.get("reliable", True))

    # d_task per class (from predictions file metadata)
    predictions_meta = {p["task_id"]: p for p in preds}
    d_task_per_class: dict[str, float] = {}
    for row in preds:
        tc = str(row.get("task_class", "?"))
        d_task_per_class[tc] = float(row.get("d_task", 0))

    # P_oracle summary
    oracle_by_class: dict[str, list[str]] = defaultdict(list)
    for tid, lvl in p_oracle.items():
        oracle_by_class[class_of.get(tid, "?")].append(lvl)

    # A-series
    all_classes = sorted(set(class_of.values()))
    a1 = {cls: a1_wilcoxon(by_task, class_of, cls) for cls in all_classes}
    a1["pass"] = any(a1[cls].get("pass", False) for cls in all_classes if isinstance(a1[cls], dict))

    a2 = {cls: a2_check(by_task, class_of, cls) for cls in all_classes}
    a2["pass"] = all(a2[cls].get("pass", False) for cls in all_classes if isinstance(a2[cls], dict))

    a3 = a3_bootstrap(by_task, class_of, n_bootstrap=n_bootstrap, seed=seed)

    # B-series: compute hits
    hits = extract_hits(preds, p_oracle)
    disc_subset = discriminative_subset(preds, p_oracle)
    disc_hits = extract_hits(disc_subset, p_oracle)

    # 7 B-series tests (collect raw p-values)
    b1a_mc = mcnemar_exact(hits["hit_sem"], hits["hit_random"])     # B1a
    b1b_mc = mcnemar_exact(hits["hit_struct"], hits["hit_sem"])      # B1b
    b2a_mc = mcnemar_exact(disc_hits["hit_sem"], disc_hits["hit_h0"])   # B2a
    b2b_mc = mcnemar_exact(disc_hits["hit_struct"], disc_hits["hit_h0"])  # B2b
    b2c_mc = mcnemar_exact(hits["hit_sem"], hits["hit_struct"])     # B2c
    b3_result = b3_spearman(by_task, class_of, lm_real_dims, d_task_per_class)
    b4_result = b4_format_sensitivity(by_task)

    raw_p = [
        b1a_mc["p_value"], b1b_mc["p_value"],
        b2a_mc["p_value"] if len(disc_subset) >= MIN_DISCRIMINATIVE_SUBSET else 1.0,
        b2b_mc["p_value"] if len(disc_subset) >= MIN_DISCRIMINATIVE_SUBSET else 1.0,
        b2c_mc["p_value"],
        b3_result.get("p_value") or 1.0,
        b4_result.get("p_value") or 1.0,
    ]
    test_labels = ["B1a", "B1b", "B2a", "B2b", "B2c", "B3", "B4"]
    fdr_rejected = bh_fdr_correction(raw_p, q=FDR_Q)

    b_series = {
        "fdr_q": FDR_Q,
        "n_tests": len(raw_p),
        "raw_p_values": {label: p for label, p in zip(test_labels, raw_p)},
        "fdr_rejected": {label: rej for label, rej in zip(test_labels, fdr_rejected)},
        "B1a": {
            "description": "P_GIT-sem vs P_random (McNemar)",
            "n_tasks": len(hits["task_ids"]),
            "hit_rate_sem": float(np.mean(hits["hit_sem"])) if hits["hit_sem"] else 0.0,
            "hit_rate_random": float(np.mean(hits["hit_random"])) if hits["hit_random"] else 0.0,
            **b1a_mc,
            "fdr_pass": fdr_rejected[0] and b1a_mc["x_better"],
        },
        "B1b": {
            "description": "P_GIT-struct vs P_GIT-sem (McNemar)",
            "n_tasks": len(hits["task_ids"]),
            "hit_rate_struct": float(np.mean(hits["hit_struct"])) if hits["hit_struct"] else 0.0,
            "hit_rate_sem": float(np.mean(hits["hit_sem"])) if hits["hit_sem"] else 0.0,
            **b1b_mc,
            "fdr_pass": fdr_rejected[1] and b1b_mc["x_better"],
        },
        "B2a": {
            "description": "P_GIT-sem vs H0 on discriminative subset (McNemar)",
            "discriminative_subset_size": len(disc_subset),
            "no_verdict": len(disc_subset) < MIN_DISCRIMINATIVE_SUBSET,
            "hit_rate_sem": float(np.mean(disc_hits["hit_sem"])) if disc_hits.get("hit_sem") else 0.0,
            "hit_rate_h0": float(np.mean(disc_hits["hit_h0"])) if disc_hits.get("hit_h0") else 0.0,
            **b2a_mc,
            "fdr_pass": fdr_rejected[2] and b2a_mc["x_better"] and len(disc_subset) >= MIN_DISCRIMINATIVE_SUBSET,
        },
        "B2b": {
            "description": "P_GIT-struct vs H0 on discriminative subset (McNemar)",
            "discriminative_subset_size": len(disc_subset),
            "no_verdict": len(disc_subset) < MIN_DISCRIMINATIVE_SUBSET,
            "hit_rate_struct": float(np.mean(disc_hits["hit_struct"])) if disc_hits.get("hit_struct") else 0.0,
            "hit_rate_h0": float(np.mean(disc_hits["hit_h0"])) if disc_hits.get("hit_h0") else 0.0,
            **b2b_mc,
            "fdr_pass": fdr_rejected[3] and b2b_mc["x_better"] and len(disc_subset) >= MIN_DISCRIMINATIVE_SUBSET,
        },
        "B2c": {
            "description": "P_GIT-sem vs P_GIT-struct (McNemar, ablation)",
            "n_tasks": len(hits["task_ids"]),
            **b2c_mc,
            "fdr_pass": fdr_rejected[4] and b2c_mc["x_better"],
        },
        "B3": {
            **b3_result,
            "description": "|d_L(S-lm-real) - d_task| vs accuracy Spearman",
            "fdr_pass": fdr_rejected[5] and b3_result.get("direction_correct", False),
        },
        "B4": {
            **b4_result,
            "description": "L3 vs L4 format sensitivity (paired Wilcoxon)",
            "fdr_pass": fdr_rejected[6],
            "note": "secondary test — informational only, not in main decision",
        },
    }

    # Hit rate summary
    hit_rates = {
        "P_GIT-sem": float(np.mean(hits["hit_sem"])) if hits["hit_sem"] else 0.0,
        "P_GIT-struct": float(np.mean(hits["hit_struct"])) if hits["hit_struct"] else 0.0,
        "H0": float(np.mean(hits["hit_h0"])) if hits["hit_h0"] else 0.0,
        "P_random": float(np.mean(hits["hit_random"])) if hits["hit_random"] else 0.0,
    }

    phase0_verdict = phase0.get("verdict", "UNKNOWN")

    decision = decide_v2(
        b2a_pass=b_series["B2a"]["fdr_pass"],
        b2b_pass=b_series["B2b"]["fdr_pass"],
        b3_pass=b_series["B3"]["fdr_pass"],
        b1a_pass=b_series["B1a"]["fdr_pass"],
        discriminative_subset_size=len(disc_subset),
        k_anchors=dim_lm_real.get("levels", {}).get("L0", {}).get("k_anchors"),
        lm_real_reliable=lm_real_reliable,
        phase0_verdict=str(phase0_verdict),
    )

    return {
        "version": "v2.2",
        "seed": seed,
        "n_bootstrap": n_bootstrap,
        "alpha": ALPHA,
        "fdr_q": FDR_Q,
        "p_oracle": p_oracle,
        "p_oracle_by_class": {cls: dict(sorted(
            [(lvl, oracle_by_class[cls].count(lvl)) for lvl in LEVELS]
        )) for cls in all_classes},
        "hit_rates": hit_rates,
        "discriminative_subset_size": len(disc_subset),
        "discriminative_subset_ids": [str(r["task_id"]) for r in disc_subset],
        "a1": a1,
        "a2": a2,
        "a3": a3,
        "b_series": b_series,
        "decision": decision,
        "deviations": [
            "D-70.2: S-code sensor unavailable (all fallback models failed); 2-sensor design used",
            "D-70.3: S-struct L1/L2 have zero entity-level edges → d≈32.79 (random walks); documented",
            "D-70.5: P_GIT-sem=L0 for all tasks (d_task < d_L0=12.40); P_GIT-struct=L1 for all tasks",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="v2.2 pre-registered statistical analysis (Stage 72.1)."
    )
    parser.add_argument("--scores", required=True, help="scores-v2.json from score.ts")
    parser.add_argument("--predictions", required=True, help="predictions-v2-*.json")
    parser.add_argument("--dim-lm-real", required=True, help="dim-lm-real-results.json")
    parser.add_argument("--dim-struct", required=True, help="dim-struct-results.json")
    parser.add_argument("--phase0", required=True, help="dim-phase0.json")
    parser.add_argument("-o", "--output", required=True, help="output analysis-v2.json")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--n-bootstrap", type=int, default=DEFAULT_N_BOOTSTRAP)
    args = parser.parse_args(argv)

    def load(path: str) -> Any:
        return json.loads(Path(path).read_text())

    scores_rows = load(args.scores)
    preds_data = load(args.predictions)
    preds = preds_data.get("predictions", preds_data) if isinstance(preds_data, dict) else preds_data
    dim_lm_real = load(args.dim_lm_real)
    dim_struct = load(args.dim_struct)
    phase0 = load(args.phase0)

    result = analyze_v2(
        scores_rows, preds, dim_lm_real, dim_struct, phase0,
        seed=args.seed, n_bootstrap=args.n_bootstrap,
    )
    write_json_atomic(args.output, result)
    print(f"analysis written → {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
