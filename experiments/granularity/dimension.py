"""Stage 62.2 — intrinsic dimension estimation (TwoNN main, MLE secondary).

Implements proposal §8.1 / §8.4 (frozen hyperparameters):

  - `skdim.id.TwoNN(discard_fraction=0.1)` (library default, Facco–Laio) is
    the PRIMARY estimator; `skdim.id.MLE` (Levina–Bickel) with K_MLE = 10 is
    the SECONDARY estimator, with a runtime assertion K_MLE < K/3.
  - Before estimating, the point cloud is deduplicated with
    `np.unique(axis=0)` (skdim does not handle duplicates; r1 = 0 makes the
    mu ratio diverge). The number of removed points is recorded.
  - If the deduplicated count < 0.8·K, the level is flagged UNRELIABLE (§8.4).
  - Bootstrap 95% CI: 1000 anchor resamples WITH replacement; each resample is
    re-deduplicated before estimation. If CI width > the point estimate, the
    level is flagged UNRELIABLE (§8.4). The random seed is a recorded
    parameter.
  - The skdim version and ALL hyperparameters are persisted with each result.

CLI:
    python dimension.py <input.json> <output.json> [--seed N] [--n-bootstrap N]

  where input.json is {"levels": {name: [[float,...], ...]}, "expected_k": int?}
  and output.json receives {"levels": {name: result}, "skdim_version": str}.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any, Sequence

import numpy as np
import skdim

from lib_py.common import read_json, write_json_atomic

# --- Frozen protocol constants (§8.1 / §8.4) ---------------------------------
DISCARD_FRACTION = 0.1  # skdim TwoNN library default (Facco–Laio top-10% cut)
K_MLE = 10
MIN_UNIQUE_FRACTION = 0.8
DEFAULT_N_BOOTSTRAP = 1000
CONFIDENCE_LEVEL = 0.95
DEFAULT_SEED = 42
MIN_POINTS_FOR_ESTIMATE = 3


def dedupe_points(points: Any) -> tuple[np.ndarray, int]:
    """Deduplicate rows with np.unique(axis=0); return (unique, n_removed)."""
    pts = np.asarray(points, dtype=np.float64)
    if pts.ndim != 2:
        raise ValueError(f"expected a 2-D point cloud, got shape {pts.shape}")
    unique = np.unique(pts, axis=0)
    return unique, int(len(pts) - len(unique))


def estimate_twonn(points: Any, discard_fraction: float = DISCARD_FRACTION) -> float:
    """Primary estimator: TwoNN (Facco–Laio) on an already-deduplicated cloud."""
    pts = np.asarray(points, dtype=np.float64)
    est = skdim.id.TwoNN(discard_fraction=discard_fraction).fit(pts)
    return float(est.dimension_)


def estimate_mle(points: Any, k_mle: int = K_MLE) -> float:
    """Secondary estimator: Levina–Bickel MLE with the frozen K_MLE < K/3 guard."""
    pts = np.asarray(points, dtype=np.float64)
    n = len(pts)
    if not (k_mle < n / 3):
        raise ValueError(
            f"K_MLE={k_mle} violates the frozen runtime assertion K_MLE < K/3 (K={n})"
        )
    est = skdim.id.MLE(K=k_mle).fit(pts)
    return float(est.dimension_)


def bootstrap_ci(
    points: Any,
    *,
    seed: int,
    n_bootstrap: int = DEFAULT_N_BOOTSTRAP,
    discard_fraction: float = DISCARD_FRACTION,
    confidence: float = CONFIDENCE_LEVEL,
) -> dict[str, Any]:
    """Bootstrap CI of the TwoNN estimate.

    Resampling unit = anchors (points), WITH replacement; every resample is
    re-deduplicated before estimation (frozen protocol). Resamples that
    collapse below MIN_POINTS_FOR_ESTIMATE points (or where the estimator
    fails) are skipped and counted.
    """
    pts = np.asarray(points, dtype=np.float64)
    n = len(pts)
    rng = np.random.default_rng(seed)
    estimates: list[float] = []
    n_skipped = 0
    for _ in range(n_bootstrap):
        idx = rng.integers(0, n, n)
        unique = np.unique(pts[idx], axis=0)
        if len(unique) < MIN_POINTS_FOR_ESTIMATE:
            n_skipped += 1
            continue
        try:
            estimates.append(estimate_twonn(unique, discard_fraction))
        except Exception:  # estimator failure on a degenerate resample
            n_skipped += 1
    if not estimates:
        raise ValueError("all bootstrap resamples failed; point cloud is degenerate")
    tail = (1.0 - confidence) / 2.0 * 100.0
    lo, hi = np.percentile(estimates, [tail, 100.0 - tail])
    return {
        "ci_low": float(lo),
        "ci_high": float(hi),
        "ci_width": float(hi - lo),
        "confidence": confidence,
        "n_resamples": n_bootstrap,
        "n_effective": len(estimates),
        "n_skipped": n_skipped,
        "seed": seed,
        "resampling_unit": "anchor",
    }


def estimate_level_dimension(
    points: Any,
    *,
    seed: int = DEFAULT_SEED,
    level: str | None = None,
    expected_k: int | None = None,
    n_bootstrap: int = DEFAULT_N_BOOTSTRAP,
    k_mle: int = K_MLE,
    discard_fraction: float = DISCARD_FRACTION,
    min_unique_fraction: float = MIN_UNIQUE_FRACTION,
) -> dict[str, Any]:
    """Full per-level pipeline: dedupe → TwoNN + MLE → bootstrap CI → reliability.

    `expected_k` is the anchor count K (defaults to len(points)); the §8.4
    reliability rules are evaluated against it.
    """
    pts = np.asarray(points, dtype=np.float64)
    k_anchors = int(expected_k) if expected_k is not None else len(pts)
    unique, n_removed = dedupe_points(pts)

    unreliable_reasons: list[str] = []
    if len(unique) < min_unique_fraction * k_anchors:
        unreliable_reasons.append(
            f"unique_points_{len(unique)}_below_{min_unique_fraction}*K_{k_anchors}"
        )

    twonn = estimate_twonn(unique, discard_fraction)
    mle = estimate_mle(unique, k_mle)  # raises if K_MLE >= K/3 (frozen assertion)
    boot = bootstrap_ci(
        pts,
        seed=seed,
        n_bootstrap=n_bootstrap,
        discard_fraction=discard_fraction,
    )
    if boot["ci_width"] > twonn:
        unreliable_reasons.append("ci_width_exceeds_estimate")

    return {
        "level": level,
        "twonn": twonn,
        "mle": mle,
        "n_points": int(len(pts)),
        "n_unique": int(len(unique)),
        "n_duplicates_removed": n_removed,
        "k_anchors": k_anchors,
        "bootstrap": boot,
        "reliable": not unreliable_reasons,
        "unreliable_reasons": unreliable_reasons,
        "skdim_version": skdim.__version__,
        "hyperparameters": {
            "primary_estimator": "TwoNN",
            "secondary_estimator": "MLE",
            "discard_fraction": discard_fraction,
            "k_mle": k_mle,
            "n_bootstrap": n_bootstrap,
            "confidence": CONFIDENCE_LEVEL,
            "min_unique_fraction": min_unique_fraction,
            "seed": seed,
        },
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Estimate per-level intrinsic dimension (frozen §8.1/§8.4 spec)."
    )
    parser.add_argument("input", help='JSON: {"levels": {name: [[...], ...]}, "expected_k": int?}')
    parser.add_argument("output", help="output JSON path")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--n-bootstrap", type=int, default=DEFAULT_N_BOOTSTRAP)
    args = parser.parse_args(argv)

    payload = read_json(args.input)
    expected_k = payload.get("expected_k")
    results: dict[str, Any] = {}
    for name, matrix in payload["levels"].items():
        results[name] = estimate_level_dimension(
            matrix,
            seed=args.seed,
            level=name,
            expected_k=expected_k,
            n_bootstrap=args.n_bootstrap,
        )
    write_json_atomic(args.output, {"levels": results, "skdim_version": skdim.__version__})
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
