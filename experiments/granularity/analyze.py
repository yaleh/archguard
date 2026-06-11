"""Stage 62.3 — pre-registered statistical tests for the granularity experiment.

Implements proposal §7 (A-series) and §8.3/§8.4 (B-series) plus the §9
decision table bits:

  - A1: paired Wilcoxon signed-rank (alpha = 0.05) — acc at the best
    intermediate level (L1–L4) vs acc(L5), one-sided (mid > L5); effect size
    gate ΔF1 >= 0.1 is reported and required jointly.
  - A2: argmax level (after §3 tie normalization) not at an endpoint.
  - A3: bootstrap CI (1000 resamples, RESAMPLING UNIT = TASKS) of the
    difference between B-class and A-class argmax level ordinals; pass when
    the 95% CI lower bound > 0.
  - B1/B2: McNemar (alpha = 0.05), hand-rolled EXACT binomial test on the
    discordant pairs via scipy.stats.binom — always exact, no chi-square
    approximation (statsmodels deliberately NOT used; scipy-only).
  - B3: Spearman correlation between |d_level − d_task| and accuracy,
    one-sided (negative), alpha = 0.05.
  - §9 decision table rows 1–5 (row 5 no-verdict conditions are evaluated as
    a gate first, per §8.3: a discriminative subset < 8 / K < 50 / a majority
    of unreliable d_level estimates voids Experiment B entirely).

Input schemas (frozen; .json = array of objects, .csv = header + rows, see
lib_py.common.load_table for CSV coercion rules):

  scores table (from score.ts):
      task_id: str            — unique task identifier (non-numeric string)
      task_class: "A" | "B"
      level: "L0".."L5"
      score: float in [0, 1]  — aggregated accuracy/F1 for (task × level);
                                multiple rows per (task_id, level) (e.g. per
                                model) are averaged.

  predictions table:
      task_id: str
      derivable: bool         — derivability-matrix gate (§6); non-derivable
                                tasks are excluded from B1/B2.
      p_git / h0 / p_random / p_oracle: "L0".."L5"

  gradient table (B3 units = task_class × derivable level):
      task_class: "A" | "B"
      level: "L0".."L5"
      d_level: float          — TwoNN of the level point cloud
      d_task: float           — TwoNN of the task class entity pool
      accuracy: float in [0, 1]
      derivable: bool

  meta (optional JSON object):
      k_anchors: int                      — anchor count K (§8.4 gate K >= 50)
      levels_reliable: {"L0": bool, ...}  — §8.4 reliability flags per level

CLI:
    python analyze.py <scores> <predictions> <gradient> [--meta META]
                      -o <output.json> [--seed N] [--n-bootstrap N]
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from typing import Any, Sequence

import numpy as np
from scipy import stats

from lib_py.common import load_table, read_json, write_json_atomic

# --- Frozen protocol constants -----------------------------------------------
ALPHA = 0.05
EFFECT_THRESHOLD = 0.1  # A1: ΔF1 >= 0.1
DEFAULT_N_BOOTSTRAP = 1000
DEFAULT_SEED = 42
MIN_DISCRIMINATIVE_SUBSET = 8  # §8.3 B2
MIN_K_ANCHORS = 50  # §8.4 / §13.1

LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5"]
LEVEL_INDEX = {name: i for i, name in enumerate(LEVELS)}
MID_LEVELS = ["L1", "L2", "L3", "L4"]


def normalize_level(level: str) -> str:
    """§3 tie rule: L3/L4 are information-equivalent — always normalize L4 to L3."""
    return "L3" if level == "L4" else level


# --- score-table helpers ------------------------------------------------------
def build_scores(rows: Sequence[dict[str, Any]]) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """Aggregate score rows → ({task_id: {level: mean score}}, {task_id: class})."""
    acc: dict[tuple[str, str], list[float]] = defaultdict(list)
    class_of: dict[str, str] = {}
    for row in rows:
        task = str(row["task_id"])
        level = str(row["level"])
        if level not in LEVEL_INDEX:
            raise ValueError(f"unknown level {level!r} in scores table")
        acc[(task, level)].append(float(row["score"]))
        class_of[task] = str(row["task_class"])
    by_task: dict[str, dict[str, float]] = defaultdict(dict)
    for (task, level), values in acc.items():
        by_task[task][level] = float(np.mean(values))
    return dict(by_task), class_of


def mean_by_level(
    by_task: dict[str, dict[str, float]], tasks: Sequence[str]
) -> dict[str, float]:
    """Per-level mean score over `tasks` (levels missing in a task are skipped)."""
    sums: dict[str, list[float]] = defaultdict(list)
    for task in tasks:
        for level, score in by_task[task].items():
            sums[level].append(score)
    return {level: float(np.mean(v)) for level, v in sums.items()}


def argmax_level(means: dict[str, float], candidates: Sequence[str] = LEVELS) -> str:
    """Argmax over levels; ties resolved to the LOWER ordinal (§3 / P_oracle rule)."""
    best: str | None = None
    best_value = -np.inf
    for level in candidates:  # scanned in ordinal order → strict '>' keeps lowest tie
        if level in means and means[level] > best_value:
            best = level
            best_value = means[level]
    if best is None:
        raise ValueError("no scores available for any candidate level")
    return best


# --- A1: paired Wilcoxon -------------------------------------------------------
def a1_wilcoxon(
    by_task: dict[str, dict[str, float]],
    class_of: dict[str, str],
    task_class: str,
    *,
    alpha: float = ALPHA,
    effect_threshold: float = EFFECT_THRESHOLD,
) -> dict[str, Any]:
    """A1 (§7): acc(L5) significantly below the best intermediate level.

    Best intermediate level = argmax of the per-level mean over L1–L4; the
    paired one-sided Wilcoxon tests mid > L5 across tasks of `task_class`.
    """
    tasks = sorted(t for t, c in class_of.items() if c == task_class)
    if not tasks:
        return {"task_class": task_class, "n_pairs": 0, "p_value": None, "pass": False}
    best_mid = argmax_level(mean_by_level(by_task, tasks), MID_LEVELS)
    paired = [t for t in tasks if best_mid in by_task[t] and "L5" in by_task[t]]
    mid_scores = np.array([by_task[t][best_mid] for t in paired])
    l5_scores = np.array([by_task[t]["L5"] for t in paired])
    diffs = mid_scores - l5_scores
    if len(paired) == 0:
        p_value = 1.0
    elif np.allclose(diffs, 0.0):
        p_value = 1.0  # all-zero differences carry no evidence
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


# --- A2: inverted-U ------------------------------------------------------------
def a2_check(
    by_task: dict[str, dict[str, float]], class_of: dict[str, str], task_class: str
) -> dict[str, Any]:
    tasks = sorted(t for t, c in class_of.items() if c == task_class)
    if not tasks:
        return {"task_class": task_class, "argmax_level": None, "pass": False}
    peak = normalize_level(argmax_level(mean_by_level(by_task, tasks)))
    return {
        "task_class": task_class,
        "argmax_level": peak,
        "pass": peak not in ("L0", "L5"),
    }


# --- A3: bootstrap of argmax ordinal difference ---------------------------------
def a3_bootstrap(
    by_task: dict[str, dict[str, float]],
    class_of: dict[str, str],
    *,
    n_bootstrap: int = DEFAULT_N_BOOTSTRAP,
    seed: int = DEFAULT_SEED,
    rng: Any = None,
) -> dict[str, Any]:
    """A3 (§7): bootstrap CI of argmax(B) − argmax(A) level ordinals.

    RESAMPLING UNIT = TASKS (题目), pre-registered: each iteration draws
    len(tasks) task IDs per class WITH replacement (never individual rows /
    calls), recomputes per-level means and takes the argmax ordinal (after
    §3 L4→L3 normalization, ties to the lower ordinal).
    """
    a_tasks = sorted(t for t, c in class_of.items() if c == "A")
    b_tasks = sorted(t for t, c in class_of.items() if c == "B")
    if not a_tasks or not b_tasks:
        raise ValueError("A3 requires at least one task in each of class A and B")
    if rng is None:
        rng = np.random.default_rng(seed)

    def peak_ordinal(tasks: Sequence[str]) -> int:
        return LEVEL_INDEX[normalize_level(argmax_level(mean_by_level(by_task, tasks)))]

    observed = peak_ordinal(b_tasks) - peak_ordinal(a_tasks)
    diffs = np.empty(n_bootstrap, dtype=np.int64)
    for i in range(n_bootstrap):
        ia = rng.integers(0, len(a_tasks), len(a_tasks))  # resample unit: tasks
        ib = rng.integers(0, len(b_tasks), len(b_tasks))  # resample unit: tasks
        sample_a = [a_tasks[j] for j in ia]
        sample_b = [b_tasks[j] for j in ib]
        diffs[i] = peak_ordinal(sample_b) - peak_ordinal(sample_a)
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return {
        "observed_diff": int(observed),
        "ci_low": float(lo),
        "ci_high": float(hi),
        "n_bootstrap": n_bootstrap,
        "seed": seed,
        "resampling_unit": "task",
        "n_tasks_a": len(a_tasks),
        "n_tasks_b": len(b_tasks),
        "pass": bool(lo > 0),
    }


# --- McNemar (B1/B2) -------------------------------------------------------------
def mcnemar_test(
    hits_x: Sequence[bool], hits_y: Sequence[bool], *, alpha: float = ALPHA
) -> dict[str, Any]:
    """Paired McNemar test that predictor X hits more than predictor Y.

    Hand-rolled EXACT binomial McNemar (two-sided, doubled tail, capped at 1)
    on the discordant pairs, p = min(1, 2·Binom.cdf(min(b,c); b+c, 0.5)) —
    always exact, regardless of b + c (no chi-square approximation).
    `pass` requires significance AND the direction b > c (X better).
    scipy-only — statsmodels intentionally avoided.
    """
    if len(hits_x) != len(hits_y):
        raise ValueError("hits_x and hits_y must be paired (same length)")
    b = sum(1 for x, y in zip(hits_x, hits_y) if x and not y)  # X hit, Y miss
    c = sum(1 for x, y in zip(hits_x, hits_y) if (not x) and y)  # Y hit, X miss
    n = b + c
    method = "exact_binomial"
    if n == 0:
        p_value = 1.0  # no discordant pairs → no evidence either way
    else:
        p_value = min(1.0, 2.0 * float(stats.binom.cdf(min(b, c), n, 0.5)))
    significant = bool(p_value < alpha)
    return {
        "b": b,
        "c": c,
        "n_discordant": n,
        "p_value": float(p_value),
        "method": method,
        "alpha": alpha,
        "significant": significant,
        "x_better": b > c,
        "pass": significant and b > c,
    }


# --- predictor hit extraction ------------------------------------------------------
def predictor_hits(prediction_rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Per-derivable-task hit vectors for each predictor.

    Hit = predicted level equals P_oracle level after §3 normalization
    (L4 → L3). Non-derivable tasks are excluded (derivability-matrix gate, §6).
    """
    task_ids: list[str] = []
    hits: dict[str, list[bool]] = {"p_git": [], "h0": [], "p_random": []}
    for row in prediction_rows:
        if not bool(row["derivable"]):
            continue
        oracle = normalize_level(str(row["p_oracle"]))
        task_ids.append(str(row["task_id"]))
        for predictor in ("p_git", "h0", "p_random"):
            hits[predictor].append(normalize_level(str(row[predictor])) == oracle)
    return {"task_ids": task_ids, **hits}


def hit_rate(hits: Sequence[bool]) -> float:
    return float(np.mean(hits)) if len(hits) else 0.0


def b1_test(prediction_rows: Sequence[dict[str, Any]], *, alpha: float = ALPHA) -> dict[str, Any]:
    """B1 (§8.3): on all derivable tasks, P_GIT > P_random (McNemar) and >= H0 rate."""
    hits = predictor_hits(prediction_rows)
    mc = mcnemar_test(hits["p_git"], hits["p_random"], alpha=alpha)
    rates = {p: hit_rate(hits[p]) for p in ("p_git", "h0", "p_random")}
    not_below_h0 = rates["p_git"] >= rates["h0"]
    return {
        "n_derivable": len(hits["task_ids"]),
        "mcnemar_vs_random": mc,
        "hit_rates": rates,
        "p_git_not_below_h0": not_below_h0,
        "pass": bool(mc["pass"] and not_below_h0),
    }


def b2_test(
    prediction_rows: Sequence[dict[str, Any]],
    *,
    alpha: float = ALPHA,
    min_subset: int = MIN_DISCRIMINATIVE_SUBSET,
) -> dict[str, Any]:
    """B2 (§8.3, main criterion): P_GIT > H0 (McNemar) on the discriminative subset.

    Discriminative subset = derivable tasks where H0 != P_oracle (after §3
    normalization). Subset < `min_subset` → 'no verdict' (§9 row 5 trigger).
    """
    subset = [
        row
        for row in prediction_rows
        if bool(row["derivable"])
        and normalize_level(str(row["h0"])) != normalize_level(str(row["p_oracle"]))
    ]
    result: dict[str, Any] = {
        "subset_size": len(subset),
        "min_subset": min_subset,
        "no_verdict": len(subset) < min_subset,
    }
    if result["no_verdict"]:
        result.update({"mcnemar_vs_h0": None, "pass": False})
        return result
    hits = predictor_hits(subset)
    mc = mcnemar_test(hits["p_git"], hits["h0"], alpha=alpha)
    result.update({"mcnemar_vs_h0": mc, "pass": bool(mc["pass"])})
    return result


# --- B3: Spearman gradient consistency ----------------------------------------------
def b3_spearman(
    gradient_rows: Sequence[dict[str, Any]], *, alpha: float = ALPHA
) -> dict[str, Any]:
    """B3 (§8.3): Spearman(|d_level − d_task|, accuracy) significantly negative.

    One-sided (alternative='less'). Units = derivable (task_class × level)
    cells.
    """
    rows = [r for r in gradient_rows if bool(r["derivable"])]
    distances = np.array([abs(float(r["d_level"]) - float(r["d_task"])) for r in rows])
    accuracies = np.array([float(r["accuracy"]) for r in rows])
    if len(rows) < 3:
        rho, p_value = float("nan"), float("nan")
    else:
        rho, p_value = stats.spearmanr(distances, accuracies, alternative="less")
    valid = bool(np.isfinite(rho) and np.isfinite(p_value))
    significant = bool(valid and p_value < alpha)
    return {
        "n_units": len(rows),
        "rho": float(rho) if valid else None,
        "p_value": float(p_value) if valid else None,
        "alpha": alpha,
        "significant": significant,
        "pass": bool(significant and rho < 0),
    }


# --- §9 decision table -----------------------------------------------------------------
def decide(
    *,
    b1_pass: bool,
    b2_pass: bool,
    b3_pass: bool,
    p_git_rate: float,
    p_random_rate: float,
    discriminative_subset_size: int,
    k_anchors: int | None = None,
    levels_reliable: dict[str, bool] | None = None,
) -> dict[str, Any]:
    """§9 decision table (rows 1–5).

    Row 5 (no judgement power: subset < 8, K < 50, or a majority of d_level
    estimates unreliable) is evaluated as a GATE before rows 1–4, per §8.3:
    those conditions void Experiment B entirely, so rows that depend on B1/B2
    must not fire.
    """
    no_power: list[str] = []
    if discriminative_subset_size < MIN_DISCRIMINATIVE_SUBSET:
        no_power.append(f"discriminative_subset_{discriminative_subset_size}_lt_{MIN_DISCRIMINATIVE_SUBSET}")
    if k_anchors is not None and k_anchors < MIN_K_ANCHORS:
        no_power.append(f"k_anchors_{k_anchors}_lt_{MIN_K_ANCHORS}")
    if levels_reliable:
        n_unreliable = sum(1 for ok in levels_reliable.values() if not ok)
        if n_unreliable > len(levels_reliable) / 2:
            no_power.append(f"majority_d_unreliable_{n_unreliable}_of_{len(levels_reliable)}")
    if no_power:
        return {
            "row": 5,
            "label": "no_verdict_experiment_b",
            "verdict": "Experiment B 无判定力:仅报告 Experiment A,不作 GIT 方向性结论",
            "reasons": no_power,
        }
    if b2_pass and b3_pass:
        return {"row": 1, "label": "predictive_with_mechanism", "verdict": "B2+B3 成立:GIT 升级为预测性候选,进入跨仓库复制实验", "reasons": []}
    if b2_pass:
        return {"row": 2, "label": "predictive_mechanism_unclear", "verdict": "B2 成立、B3 不成立:谨慎接受,限定为 P_GIT 在 H0 失效处有增益", "reasons": []}
    if b1_pass:
        return {"row": 3, "label": "heuristic_in_disguise", "verdict": "B2 不成立、B1 成立:维度机器判为换装的启发式,保留 H0", "reasons": []}
    return {
        "row": 4,
        "label": "p_git_rejected",
        "verdict": "B1 不成立:GIT 的可预测版本被否定,如实报告",
        "reasons": [],
        "p_git_above_random": bool(p_git_rate > p_random_rate),
    }


# --- top-level orchestration ----------------------------------------------------------
def analyze(
    scores_rows: Sequence[dict[str, Any]],
    prediction_rows: Sequence[dict[str, Any]],
    gradient_rows: Sequence[dict[str, Any]],
    meta: dict[str, Any] | None = None,
    *,
    seed: int = DEFAULT_SEED,
    n_bootstrap: int = DEFAULT_N_BOOTSTRAP,
    alpha: float = ALPHA,
) -> dict[str, Any]:
    """Run every pre-registered test and emit all §9 decision-table bits."""
    meta = meta or {}
    by_task, class_of = build_scores(scores_rows)

    a1 = {cls: a1_wilcoxon(by_task, class_of, cls, alpha=alpha) for cls in ("A", "B")}
    a1["pass"] = any(a1[cls]["pass"] for cls in ("A", "B"))
    a2 = {cls: a2_check(by_task, class_of, cls) for cls in ("A", "B")}
    a2["pass"] = all(a2[cls]["pass"] for cls in ("A", "B"))
    a3 = a3_bootstrap(by_task, class_of, n_bootstrap=n_bootstrap, seed=seed)

    b1 = b1_test(prediction_rows, alpha=alpha)
    b2 = b2_test(prediction_rows, alpha=alpha)
    b3 = b3_spearman(gradient_rows, alpha=alpha)

    decision = decide(
        b1_pass=b1["pass"],
        b2_pass=b2["pass"],
        b3_pass=b3["pass"],
        p_git_rate=b1["hit_rates"]["p_git"],
        p_random_rate=b1["hit_rates"]["p_random"],
        discriminative_subset_size=b2["subset_size"],
        k_anchors=meta.get("k_anchors"),
        levels_reliable=meta.get("levels_reliable"),
    )
    return {
        "alpha": alpha,
        "seed": seed,
        "n_bootstrap": n_bootstrap,
        "a1": a1,
        "a2": a2,
        "a3": a3,
        "b1": b1,
        "b2": b2,
        "b3": b3,
        "decision": decision,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Pre-registered statistical analysis (§7/§8.3/§8.4/§9)."
    )
    parser.add_argument("scores", help="scores long table (.json or .csv)")
    parser.add_argument("predictions", help="predictions table (.json or .csv)")
    parser.add_argument("gradient", help="B3 gradient table (.json or .csv)")
    parser.add_argument("--meta", help="optional meta JSON (k_anchors, levels_reliable)")
    parser.add_argument("-o", "--output", required=True, help="output JSON path")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--n-bootstrap", type=int, default=DEFAULT_N_BOOTSTRAP)
    args = parser.parse_args(argv)

    result = analyze(
        load_table(args.scores),
        load_table(args.predictions),
        load_table(args.gradient),
        meta=read_json(args.meta) if args.meta else None,
        seed=args.seed,
        n_bootstrap=args.n_bootstrap,
    )
    write_json_atomic(args.output, result)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
