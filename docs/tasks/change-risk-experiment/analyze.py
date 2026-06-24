#!/usr/bin/env python3
"""
Phase 4 + 5 analysis:
- Load risk scores CSV + ground truth
- Compute Spearman ρ for each factor vs bug-fix count
- Verify hypotheses H-W1 through H-W4
- Weight sensitivity scan
- Output results.json and weight-sensitivity.json
"""

import csv
import json
import math
import os
import re
import sys
from collections import defaultdict
from itertools import product

RISK_WEIGHTS = {
    "churn": 0.25,
    "authorCount": 0.20,
    "ownerConcentration": 0.20,
    "cochangeBreadth": 0.15,
    "recency": 0.20,
}

FACTORS = ["churn", "authorCount", "ownerConcentration", "cochangeBreadth", "recency"]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
# Spearman ρ (manual implementation — no scipy required)
# ---------------------------------------------------------------------------

def rank_data(data):
    """Return fractional ranks for a list of values."""
    indexed = sorted(enumerate(data), key=lambda x: x[1])
    ranks = [0.0] * len(data)
    n = len(data)
    i = 0
    while i < n:
        j = i
        while j < n - 1 and indexed[j + 1][1] == indexed[j][1]:
            j += 1
        avg_rank = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[indexed[k][0]] = avg_rank
        i = j + 1
    return ranks


def spearman(x, y):
    """Compute Spearman ρ and approximate p-value."""
    n = len(x)
    if n < 3:
        return 0.0, 1.0
    rx = rank_data(x)
    ry = rank_data(y)
    # Pearson on ranks
    mx = sum(rx) / n
    my = sum(ry) / n
    num = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    dx = math.sqrt(sum((rx[i] - mx) ** 2 for i in range(n)))
    dy = math.sqrt(sum((ry[i] - my) ** 2 for i in range(n)))
    if dx == 0 or dy == 0:
        return 0.0, 1.0
    rho = num / (dx * dy)
    # t-statistic approximation
    if abs(rho) >= 1.0:
        return rho, 0.0
    t = rho * math.sqrt((n - 2) / (1 - rho ** 2))
    # Two-tailed p-value via normal approximation (valid for n > 30)
    # Use Student t with df=n-2; approximate with normal for large n
    # For small n, this is a rough approximation
    z = abs(t) / math.sqrt((n - 2) / (n - 2))  # normalized
    # Use simple normal CDF approximation
    p = 2 * (1 - _norm_cdf(abs(t) * math.sqrt(1 / (1 + t * t / (n - 2)))))
    return round(rho, 4), round(max(0.0, min(1.0, p)), 4)


def _norm_cdf(z):
    """Approximation of standard normal CDF."""
    # Abramowitz and Stegun approximation
    t = 1.0 / (1.0 + 0.2316419 * abs(z))
    poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
    p = 1.0 - (1.0 / math.sqrt(2 * math.pi)) * math.exp(-0.5 * z * z) * poly
    return p if z >= 0 else 1.0 - p


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_risk_scores(csv_path):
    """Load risk scores CSV. Returns list of dicts."""
    rows = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "file": row["file"],
                "churn": float(row["churn"]),
                "authorCount": float(row["authorCount"]),
                "ownerConcentration": float(row["ownerConcentration"]),
                "cochangeBreadth": float(row["cochangeBreadth"]),
                "recency": float(row["recency"]),
                "primaryOwnerShare": float(row["primaryOwnerShare"]),
                "riskScore": float(row["riskScore"]),
            })
    return rows


def load_ground_truth(txt_path):
    """
    Load ground truth file (format: '  N filename' from uniq -c).
    Returns dict: filename -> bug_fix_count
    """
    result = {}
    with open(txt_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split(None, 1)
            if len(parts) == 2:
                count = int(parts[0])
                filename = parts[1].strip()
                result[filename] = count
    return result


def normalize_path(p):
    """Get basename without extension for fuzzy matching."""
    return os.path.splitext(os.path.basename(p))[0]


def join_datasets(risk_rows, ground_truth):
    """
    Inner join risk scores with ground truth on file path.
    Strategy: try exact match first, then basename match.
    All files in risk_scores without a match get bug_fix_count=0 (outer left join).
    """
    # Build lookup by full path and by basename
    gt_by_full = {}
    gt_by_base = defaultdict(list)
    for fname, count in ground_truth.items():
        gt_by_full[fname] = count
        gt_by_base[normalize_path(fname)].append((fname, count))

    joined = []
    for row in risk_rows:
        file_path = row["file"]
        # Try exact match
        if file_path in gt_by_full:
            bug_count = gt_by_full[file_path]
        else:
            # Try basename match
            base = normalize_path(file_path)
            candidates = gt_by_base.get(base, [])
            if len(candidates) == 1:
                bug_count = candidates[0][1]
            else:
                bug_count = 0  # Not in ground truth = 0 bug-fix commits
        joined.append({**row, "bug_fix_count": bug_count})

    return joined


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

def compute_correlations(joined):
    """Compute Spearman ρ for each factor and composite riskScore."""
    bug_counts = [r["bug_fix_count"] for r in joined]
    results = {}
    for factor in FACTORS:
        vals = [r[factor] for r in joined]
        rho, pval = spearman(vals, bug_counts)
        results[factor] = {"spearman_rho": rho, "p_value": pval}
    # Composite
    rho, pval = spearman([r["riskScore"] for r in joined], bug_counts)
    results["riskScore"] = {"spearman_rho": rho, "p_value": pval}
    return results


def verify_hypotheses(correlations, n):
    """Verify H-W1 through H-W4."""
    THRESHOLD_N = 10
    verdicts = []

    churn_rho = correlations["churn"]["spearman_rho"]
    recency_rho = correlations["recency"]["spearman_rho"]
    owner_rho = correlations["ownerConcentration"]["spearman_rho"]
    composite_rho = correlations["riskScore"]["spearman_rho"]

    other_factors = ["authorCount", "ownerConcentration", "cochangeBreadth", "recency"]
    other_rhos = [correlations[f]["spearman_rho"] for f in other_factors]

    # H-W1: churn ρ > all other factors
    if n < THRESHOLD_N:
        h1_verdict = "INSUFFICIENT_DATA"
        h1_evidence = f"Only {n} samples (< {THRESHOLD_N})"
    elif churn_rho > max(other_rhos):
        h1_verdict = "CONFIRMED"
        h1_evidence = f"churn ρ={churn_rho} > max(others)={max(other_rhos):.4f}"
    else:
        h1_verdict = "REFUTED"
        best_factor = max(other_factors, key=lambda f: correlations[f]["spearman_rho"])
        h1_evidence = f"churn ρ={churn_rho} NOT > {best_factor} ρ={correlations[best_factor]['spearman_rho']}"

    verdicts.append({
        "id": "H-W1",
        "claim": "churn 因子与 bug-fix 提交数的 Spearman ρ 在两项目上均 > 其余四因子",
        "verdict": h1_verdict,
        "evidence": h1_evidence,
    })

    # H-W2: recency ρ < churn ρ
    if n < THRESHOLD_N:
        h2_verdict = "INSUFFICIENT_DATA"
        h2_evidence = f"Only {n} samples"
    elif recency_rho < churn_rho:
        h2_verdict = "CONFIRMED"
        h2_evidence = f"recency ρ={recency_rho} < churn ρ={churn_rho}"
    else:
        h2_verdict = "REFUTED"
        h2_evidence = f"recency ρ={recency_rho} >= churn ρ={churn_rho}"

    verdicts.append({
        "id": "H-W2",
        "claim": "recency 因子的 Spearman ρ < churn 因子的 ρ（recency 被高估）",
        "verdict": h2_verdict,
        "evidence": h2_evidence,
    })

    # H-W3: ownerConcentration negatively correlated with bug count
    # ownerConcentration = 1 - primaryOwnerShare, so HIGH ownerConc → HIGH risk → positive correlation expected
    # But hypothesis says "primaryOwnerShare 高 → riskFactor 低", which means ownerConcentration (1-share) is positively correlated
    # Verify: ownerConcentration ρ should be positive (or at least the direction is correct: high concentration = more bug fixes)
    if n < THRESHOLD_N:
        h3_verdict = "INSUFFICIENT_DATA"
        h3_evidence = f"Only {n} samples"
    elif owner_rho > 0:
        h3_verdict = "CONFIRMED"
        h3_evidence = f"ownerConcentration ρ={owner_rho} > 0 (high owner risk → more bugs, direction correct)"
    else:
        h3_verdict = "REFUTED"
        h3_evidence = f"ownerConcentration ρ={owner_rho} <= 0 (direction incorrect)"

    verdicts.append({
        "id": "H-W3",
        "claim": "ownerConcentration 方向正确：primaryOwnerShare 高 → riskFactor 低（负相关于 bug 数）",
        "verdict": h3_verdict,
        "evidence": h3_evidence,
    })

    # H-W4: composite riskScore ρ > 0.40
    if n < THRESHOLD_N:
        h4_verdict = "INSUFFICIENT_DATA"
        h4_evidence = f"Only {n} samples"
    elif composite_rho > 0.40:
        h4_verdict = "CONFIRMED"
        h4_evidence = f"riskScore ρ={composite_rho} > 0.40"
    else:
        h4_verdict = "REFUTED"
        h4_evidence = f"riskScore ρ={composite_rho} <= 0.40"

    verdicts.append({
        "id": "H-W4",
        "claim": "综合 riskScore 与 bug-fix 提交数的 Spearman ρ > 0.40",
        "verdict": h4_verdict,
        "evidence": h4_evidence,
    })

    return verdicts


# ---------------------------------------------------------------------------
# Weight sensitivity analysis
# ---------------------------------------------------------------------------

def weight_sensitivity_scan(joined):
    """
    Scan churn weight from 0.10 to 0.40 (step 0.05).
    Other 4 weights scaled proportionally (sum=1).
    Returns sensitivity data and optimal weights.
    """
    bug_counts = [r["bug_fix_count"] for r in joined]

    # Current weights (excluding churn)
    other_names = ["authorCount", "ownerConcentration", "cochangeBreadth", "recency"]
    other_base = sum(RISK_WEIGHTS[k] for k in other_names)  # 0.75

    # Current rho
    current_rho, _ = spearman([r["riskScore"] for r in joined], bug_counts)

    sensitivity = []
    best_rho = -999
    best_weights = None
    churn_values = [round(0.10 + i * 0.05, 2) for i in range(7)]  # 0.10 to 0.40

    for churn_w in churn_values:
        remaining = 1.0 - churn_w
        scale = remaining / other_base
        weights = {
            "churn": churn_w,
            "authorCount": round(RISK_WEIGHTS["authorCount"] * scale, 4),
            "ownerConcentration": round(RISK_WEIGHTS["ownerConcentration"] * scale, 4),
            "cochangeBreadth": round(RISK_WEIGHTS["cochangeBreadth"] * scale, 4),
            "recency": round(RISK_WEIGHTS["recency"] * scale, 4),
        }
        # Ensure sum = 1.0 (fix rounding)
        total = sum(weights.values())
        weights["recency"] += round(1.0 - total, 4)

        # Compute risk scores with these weights
        scores = [
            r["churn"] * weights["churn"] +
            r["authorCount"] * weights["authorCount"] +
            r["ownerConcentration"] * weights["ownerConcentration"] +
            r["cochangeBreadth"] * weights["cochangeBreadth"] +
            r["recency"] * weights["recency"]
            for r in joined
        ]
        rho, pval = spearman(scores, bug_counts)

        sensitivity.append({
            "churn_weight": churn_w,
            "weights": weights,
            "spearman_rho": rho,
            "p_value": pval,
        })

        if rho > best_rho:
            best_rho = rho
            best_weights = weights

    return current_rho, best_rho, best_weights, sensitivity


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def analyze_project(project_name, csv_path, gt_path, ext):
    """Full analysis pipeline for one project."""
    print(f"\n=== Analyzing {project_name} ===", file=sys.stderr)

    risk_rows = load_risk_scores(csv_path)
    ground_truth = load_ground_truth(gt_path)
    joined = join_datasets(risk_rows, ground_truth)

    n = len(joined)
    files_with_bugs = sum(1 for r in joined if r["bug_fix_count"] > 0)
    print(f"  {n} files total, {files_with_bugs} with bug-fix commits", file=sys.stderr)

    correlations = compute_correlations(joined)
    hypotheses = verify_hypotheses(correlations, n)

    print(f"  Factor correlations with bug-fix count:", file=sys.stderr)
    for factor, vals in correlations.items():
        print(f"    {factor}: ρ={vals['spearman_rho']}, p={vals['p_value']}", file=sys.stderr)

    return {
        "project": project_name,
        "data_source": "measured",
        "file_extension": ext,
        "sample_n": n,
        "files_with_bug_fixes": files_with_bugs,
        "factor_correlations": correlations,
        "composite_riskScore": correlations.pop("riskScore"),
        "hypotheses": hypotheses,
        "joined_data": joined,  # keep for sensitivity scan (combined)
    }


def main():
    base = SCRIPT_DIR

    archguard_result = analyze_project(
        "archguard",
        os.path.join(base, "risk-scores-archguard.csv"),
        os.path.join(base, "ground-truth-archguard.txt"),
        "ts",
    )

    meta_cc_result = analyze_project(
        "meta-cc",
        os.path.join(base, "risk-scores-meta-cc.csv"),
        os.path.join(base, "ground-truth-meta-cc.txt"),
        "go",
    )

    # Combined analysis (merge datasets for cross-project hypotheses check)
    combined_joined = archguard_result["joined_data"] + meta_cc_result["joined_data"]
    combined_n = len(combined_joined)

    # Cross-project H-W1 check: is churn ρ > other factors in BOTH projects?
    ag_churn = archguard_result["factor_correlations"]["churn"]["spearman_rho"]
    mc_churn = meta_cc_result["factor_correlations"]["churn"]["spearman_rho"]
    ag_others = [archguard_result["factor_correlations"][f]["spearman_rho"]
                 for f in ["authorCount", "ownerConcentration", "cochangeBreadth", "recency"]]
    mc_others = [meta_cc_result["factor_correlations"][f]["spearman_rho"]
                 for f in ["authorCount", "ownerConcentration", "cochangeBreadth", "recency"]]

    hw1_both_confirmed = ag_churn > max(ag_others) and mc_churn > max(mc_others)

    # Update H-W1 verdict in both results with cross-project check
    for result in [archguard_result, meta_cc_result]:
        for h in result["hypotheses"]:
            if h["id"] == "H-W1":
                if h["verdict"] == "CONFIRMED" and not hw1_both_confirmed:
                    h["verdict"] = "REFUTED"
                    h["evidence"] += f" | Cross-project: churn not > others in both projects (ag={ag_churn} vs {max(ag_others):.4f}, mc={mc_churn} vs {max(mc_others):.4f})"

    # Remove joined_data from output
    archguard_out = {k: v for k, v in archguard_result.items() if k != "joined_data"}
    meta_cc_out = {k: v for k, v in meta_cc_result.items() if k != "joined_data"}

    results = {
        "data_source": "measured",
        "analysis_date": "2026-06-24",
        "projects": [archguard_out, meta_cc_out],
        "cross_project_notes": {
            "h_w1_both_confirmed": hw1_both_confirmed,
            "archguard_churn_rho": ag_churn,
            "meta_cc_churn_rho": mc_churn,
        },
    }

    out_path = os.path.join(base, "results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults written to {out_path}", file=sys.stderr)

    # Phase 5: Weight sensitivity scan
    print("\n=== Weight Sensitivity Scan ===", file=sys.stderr)

    # Run sensitivity on combined dataset
    ag_current_rho, ag_optimal_rho, ag_optimal_weights, ag_sensitivity = weight_sensitivity_scan(
        archguard_result["joined_data"]
    )
    mc_current_rho, mc_optimal_rho, mc_optimal_weights, mc_sensitivity = weight_sensitivity_scan(
        meta_cc_result["joined_data"]
    )

    print(f"  archguard: current ρ={ag_current_rho}, optimal ρ={ag_optimal_rho}", file=sys.stderr)
    print(f"  meta-cc:   current ρ={mc_current_rho}, optimal ρ={mc_optimal_rho}", file=sys.stderr)

    weight_sensitivity = {
        "data_source": "measured",
        "current_weights": RISK_WEIGHTS,
        "archguard": {
            "current_rho": ag_current_rho,
            "optimal_rho": ag_optimal_rho,
            "optimal_weights": ag_optimal_weights,
            "delta_rho": round(ag_optimal_rho - ag_current_rho, 4),
            "sensitivity_data": ag_sensitivity,
        },
        "meta_cc": {
            "current_rho": mc_current_rho,
            "optimal_rho": mc_optimal_rho,
            "optimal_weights": mc_optimal_weights,
            "delta_rho": round(mc_optimal_rho - mc_current_rho, 4),
            "sensitivity_data": mc_sensitivity,
        },
        "recommendation": (
            "maintain_current"
            if abs(ag_optimal_rho - ag_current_rho) < 0.05
            and abs(mc_optimal_rho - mc_current_rho) < 0.05
            else "consider_adjusting"
        ),
    }

    ws_path = os.path.join(base, "weight-sensitivity.json")
    with open(ws_path, "w") as f:
        json.dump(weight_sensitivity, f, indent=2)
    print(f"Weight sensitivity written to {ws_path}", file=sys.stderr)

    print("\nDone!", file=sys.stderr)


if __name__ == "__main__":
    main()
