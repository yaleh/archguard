#!/usr/bin/env python3
"""
Phase 80 — Statistical Analysis for Exp 1.

Reads artifacts/analysis/exp1-accuracy.json (from score.ts),
runs pre-registered statistical tests, writes verdict to exp1-results.json.

Tests (per pre-registered-predictions.json):
  H1:       Friedman test across 8 formats; BH-FDR correction
  H-parse:  Wilcoxon signed-rank: json-edge-list vs json-adjacency (one-tailed)
  H-pretrain: Wilcoxon: json-edge-list vs custom-dsl (one-tailed)
  H-dense:  Wilcoxon: haskell-adt vs json-edge-list (one-tailed, token-adjusted rank)
  H-interact: Chi-squared / Kruskal on format × task-class interaction
  H-attribution: Spearman correlation of accuracy with covariates (if covariates available)

Usage:
  python3 scripts/statistical-analysis.py
    [--accuracy artifacts/analysis/exp1-accuracy.json]
    [--covariates artifacts/covariates/structural-metrics.json]
    [--out artifacts/analysis/exp1-results.json]
"""

import json
import sys
import argparse
import os
from typing import Optional

try:
    from scipy import stats
    import numpy as np
except ImportError:
    print("ERROR: scipy and numpy required. pip install scipy numpy", file=sys.stderr)
    sys.exit(1)


def bh_fdr(p_values: list[float], q: float = 0.05) -> list[bool]:
    """Benjamini-Hochberg FDR correction. Returns list of rejected nulls."""
    n = len(p_values)
    if n == 0:
        return []
    sorted_idx = sorted(range(n), key=lambda i: p_values[i])
    sorted_p = [p_values[i] for i in sorted_idx]
    reject = [False] * n
    for k in range(n - 1, -1, -1):
        if sorted_p[k] <= q * (k + 1) / n:
            for j in range(k + 1):
                reject[sorted_idx[j]] = True
            break
    return reject


def wilcoxon_signed_rank(x: list[float], y: list[float], alternative: str = 'two-sided') -> tuple[float, float]:
    """Wilcoxon signed-rank test. Returns (statistic, p-value)."""
    if len(x) != len(y) or len(x) < 3:
        return (float('nan'), float('nan'))
    diffs = [a - b for a, b in zip(x, y)]
    diffs = [d for d in diffs if d != 0]
    if len(diffs) < 3:
        return (float('nan'), float('nan'))
    result = stats.wilcoxon(diffs, alternative=alternative)
    return (float(result.statistic), float(result.pvalue))


def friedman_test(groups: dict[str, list[float]]) -> tuple[float, float]:
    """Friedman test across groups. Returns (statistic, p-value)."""
    if len(groups) < 2:
        return (float('nan'), float('nan'))
    arrays = list(groups.values())
    min_len = min(len(a) for a in arrays)
    if min_len < 3:
        return (float('nan'), float('nan'))
    trimmed = [a[:min_len] for a in arrays]
    result = stats.friedmanchisquare(*trimmed)
    return (float(result.statistic), float(result.pvalue))


def kruskal_test(groups: dict[str, list[float]]) -> tuple[float, float]:
    """Kruskal-Wallis test. Returns (statistic, p-value)."""
    arrays = list(groups.values())
    if len(arrays) < 2 or any(len(a) < 2 for a in arrays):
        return (float('nan'), float('nan'))
    result = stats.kruskal(*arrays)
    return (float(result.statistic), float(result.pvalue))


def spearman_corr(x: list[float], y: list[float]) -> tuple[float, float]:
    """Spearman correlation. Returns (rho, p-value)."""
    if len(x) < 5:
        return (float('nan'), float('nan'))
    result = stats.spearmanr(x, y)
    return (float(result.statistic), float(result.pvalue))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--accuracy', default='artifacts/analysis/exp1-accuracy.json')
    parser.add_argument('--covariates', default='artifacts/covariates/structural-metrics.json')
    parser.add_argument('--out', default='artifacts/analysis/exp1-results.json')
    args = parser.parse_args()

    if not os.path.exists(args.accuracy):
        print(f"ERROR: {args.accuracy} not found. Run score.ts first.", file=sys.stderr)
        sys.exit(1)

    with open(args.accuracy) as f:
        accuracy_data = json.load(f)

    details = accuracy_data.get('details', [])
    if not details:
        print("ERROR: no detail records in accuracy file", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded {len(details)} (task, format, model) records")

    # Build per-task accuracy matrix: format -> list of mean scores per task
    format_task_scores: dict[str, dict[str, float]] = {}
    format_class_scores: dict[str, dict[str, list[float]]] = {}
    class_format_scores: dict[str, dict[str, list[float]]] = {}

    for d in details:
        fmt = d['format']
        task_id = d['taskId']
        task_class = d['taskClass']
        score = d['meanScore']

        if fmt not in format_task_scores:
            format_task_scores[fmt] = {}
        format_task_scores[fmt][task_id] = score

        if fmt not in format_class_scores:
            format_class_scores[fmt] = {}
        if task_class not in format_class_scores[fmt]:
            format_class_scores[fmt][task_class] = []
        format_class_scores[fmt][task_class].append(score)

        if task_class not in class_format_scores:
            class_format_scores[task_class] = {}
        if fmt not in class_format_scores[task_class]:
            class_format_scores[task_class][fmt] = []
        class_format_scores[task_class][fmt].append(score)

    formats = sorted(format_task_scores.keys())
    task_ids = sorted(set(tid for scores in format_task_scores.values() for tid in scores))

    print(f"Formats: {formats}")
    print(f"Tasks: {len(task_ids)}")

    # Build cross-format per-task score arrays (only tasks present in all formats)
    common_tasks = task_ids
    if len(formats) > 1:
        common_tasks = sorted(set.intersection(*[set(format_task_scores[f].keys()) for f in formats]))
    print(f"Common tasks (all formats): {len(common_tasks)}")

    format_scores_common: dict[str, list[float]] = {
        f: [format_task_scores[f].get(t, 0.0) for t in common_tasks]
        for f in formats
    }

    verdicts: dict = {}

    # ── H1: Friedman test across all formats ─────────────────────────────────
    friedman_stat, friedman_p = friedman_test(format_scores_common)
    h1_verdict = 'INSUFFICIENT_DATA' if np.isnan(friedman_stat) else (
        'CONFIRMED' if friedman_p < 0.05 else 'NULL'
    )
    verdicts['H1'] = {
        'label': 'Format main effect on accuracy',
        'test': 'Friedman',
        'statistic': friedman_stat,
        'p_value': friedman_p,
        'verdict': h1_verdict,
        'n_formats': len(formats),
        'n_common_tasks': len(common_tasks),
    }
    print(f"\nH1 (Friedman): χ²={friedman_stat:.3f}, p={friedman_p:.4f} → {h1_verdict}")

    # ── Pairwise comparisons (H-parse, H-pretrain, H-dense) ──────────────────
    PAIRS = [
        ('H-parse',    'json-edge-list', 'json-adjacency',  'greater', 'Flat parse tree improves accuracy'),
        ('H-pretrain', 'json-edge-list', 'custom-dsl',      'greater', 'Pretraining familiarity beats simplicity'),
        ('H-dense',    'haskell-adt',    'json-edge-list',  'greater', 'Dense encoding independently effective'),
    ]

    pair_p_values = []
    pair_info = []

    for hyp_id, fmt_a, fmt_b, alternative, label in PAIRS:
        if fmt_a not in format_scores_common or fmt_b not in format_scores_common:
            pair_p_values.append(1.0)
            pair_info.append((hyp_id, fmt_a, fmt_b, alternative, label, float('nan'), float('nan')))
            continue
        x = format_scores_common[fmt_a]
        y = format_scores_common[fmt_b]
        stat, p = wilcoxon_signed_rank(x, y, alternative)
        pair_p_values.append(p if not np.isnan(p) else 1.0)
        pair_info.append((hyp_id, fmt_a, fmt_b, alternative, label, stat, p))

    bh_rejected = bh_fdr(pair_p_values, q=0.05)

    for i, (hyp_id, fmt_a, fmt_b, alternative, label, stat, p) in enumerate(pair_info):
        verdict = 'INSUFFICIENT_DATA' if np.isnan(stat) else (
            'CONFIRMED' if bh_rejected[i] and p < 0.05 else 'NULL'
        )
        verdicts[hyp_id] = {
            'label': label,
            'test': f'Wilcoxon signed-rank ({alternative}) + BH-FDR',
            'contrast': f'{fmt_a} vs {fmt_b}',
            'statistic': stat,
            'p_value': p,
            'bh_adjusted_reject': bh_rejected[i],
            'verdict': verdict,
        }
        mean_a = np.mean(format_scores_common.get(fmt_a, [])) if format_scores_common.get(fmt_a) else float('nan')
        mean_b = np.mean(format_scores_common.get(fmt_b, [])) if format_scores_common.get(fmt_b) else float('nan')
        print(f"{hyp_id}: {fmt_a}={mean_a:.3f} vs {fmt_b}={mean_b:.3f}, p={p:.4f}, BH-reject={bh_rejected[i]} → {verdict}")

    # ── H-interact: Format × task class interaction ───────────────────────────
    # Kruskal-Wallis within each task class, compare ranks across formats
    interact_results = {}
    for tc in sorted(class_format_scores.keys()):
        kw_stat, kw_p = kruskal_test(class_format_scores[tc])
        interact_results[tc] = {
            'kruskal_stat': kw_stat,
            'kruskal_p': kw_p,
            'n_formats': len(class_format_scores[tc]),
            'format_means': {f: float(np.mean(s)) for f, s in class_format_scores[tc].items()},
        }

    # Interaction verdict: format effect differs across task classes
    class_p_values = [r['kruskal_p'] for r in interact_results.values() if not np.isnan(r['kruskal_p'])]
    h_interact_verdict = 'INSUFFICIENT_DATA'
    if class_p_values:
        # Interaction confirmed if format effect is significant in at least one class but not all
        sig_classes = [tc for tc, r in interact_results.items()
                       if not np.isnan(r['kruskal_p']) and r['kruskal_p'] < 0.05]
        if len(sig_classes) > 0 and len(sig_classes) < len(interact_results):
            h_interact_verdict = 'CONFIRMED'
        elif len(sig_classes) == 0:
            h_interact_verdict = 'NULL'
        else:
            h_interact_verdict = 'NULL'  # Uniform across classes

    verdicts['H-interact'] = {
        'label': 'Format × task-class interaction',
        'test': 'Kruskal-Wallis within each task class',
        'per_class': interact_results,
        'verdict': h_interact_verdict,
        'significant_classes': sig_classes if class_p_values else [],
    }
    print(f"\nH-interact: format effect by class:")
    for tc, r in sorted(interact_results.items()):
        print(f"  class {tc}: Kruskal p={r['kruskal_p']:.4f}, format means={r['format_means']}")
    print(f"  → {h_interact_verdict}")

    # ── H-attribution: Structural covariate correlation ───────────────────────
    covariates_available = False
    covariate_results: dict = {}

    if os.path.exists(args.covariates):
        with open(args.covariates) as f:
            cov_data = json.load(f)
        covariates_available = True

        # Build covariate × accuracy arrays (per format, averaged over tasks)
        format_accuracy_list = []
        token_list = []
        nesting_list = []
        delimiter_density_list = []

        for fmt in formats:
            acc = np.mean(format_scores_common.get(fmt, [0]))
            format_accuracy_list.append(acc)
            # Try to get covariates (averaged over instances)
            fmt_covs = cov_data.get(fmt, {})
            tokens = [v.get('total_tokens', float('nan')) for v in fmt_covs.values() if isinstance(v, dict)]
            nesting = [v.get('nesting_depth', float('nan')) for v in fmt_covs.values() if isinstance(v, dict)]
            delim = [v.get('delimiter_density', float('nan')) for v in fmt_covs.values() if isinstance(v, dict)]
            token_list.append(np.nanmean(tokens) if tokens else float('nan'))
            nesting_list.append(np.nanmean(nesting) if nesting else float('nan'))
            delimiter_density_list.append(np.nanmean(delim) if delim else float('nan'))

        acc_arr = format_accuracy_list
        if not any(np.isnan(t) for t in token_list):
            rho_tokens, p_tokens = spearman_corr(acc_arr, token_list)
            covariate_results['tokens'] = {'rho': rho_tokens, 'p': p_tokens}
        if not any(np.isnan(n) for n in nesting_list):
            rho_nesting, p_nesting = spearman_corr(acc_arr, nesting_list)
            covariate_results['nesting_depth'] = {'rho': rho_nesting, 'p': p_nesting}
        if not any(np.isnan(d) for d in delimiter_density_list):
            rho_delim, p_delim = spearman_corr(acc_arr, delimiter_density_list)
            covariate_results['delimiter_density'] = {'rho': rho_delim, 'p': p_delim}

    verdicts['H-attribution'] = {
        'label': 'Structural covariates predict accuracy',
        'test': 'Spearman correlation',
        'covariates_available': covariates_available,
        'covariate_results': covariate_results,
        'verdict': 'PENDING' if not covariates_available else (
            'PARTIAL' if covariate_results else 'INSUFFICIENT_DATA'
        ),
    }

    # ── Format accuracy ranking ───────────────────────────────────────────────
    format_ranking = sorted(
        [(f, float(np.mean(scores))) for f, scores in format_scores_common.items()],
        key=lambda x: x[1],
        reverse=True,
    )

    print("\nFormat accuracy ranking:")
    for fmt, acc in format_ranking:
        print(f"  {fmt:25s}: {acc:.3f}")

    # ── Write output ──────────────────────────────────────────────────────────
    result = {
        'generated': __import__('datetime').datetime.now().isoformat(),
        'n_records': len(details),
        'n_formats': len(formats),
        'n_tasks': len(task_ids),
        'n_common_tasks': len(common_tasks),
        'format_ranking': [{'format': f, 'accuracy': acc} for f, acc in format_ranking],
        'verdicts': verdicts,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(result, f, indent=2, default=lambda x: None if (hasattr(x, '__float__') and __import__('math').isnan(float(x))) else float(x))
    print(f"\nWritten: {args.out}")


if __name__ == '__main__':
    main()
