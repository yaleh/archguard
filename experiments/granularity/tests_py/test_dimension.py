"""Stage 62.2 tests — dimension.py (TwoNN/MLE wrappers, dedupe, bootstrap).

Pre-registered coverage (plan Stage 62.2):
  - known-manifold sanity: uniform 2-D plane embedded in 10-D → d̂ ≈ 2; 5-D
    hypercube → d̂ ≈ 5 (fixed seeds — the gold standard for wrapper correctness);
  - duplicate injection → deduplicated with correct removal count;
  - unique count < 0.8·K → UNRELIABLE flag;
  - bootstrap CI structure + reproducibility under a fixed seed;
  - K_MLE < K/3 frozen assertion raises when violated.
"""

from __future__ import annotations

import json

import numpy as np
import pytest
import skdim

import dimension
from dimension import (
    DEFAULT_N_BOOTSTRAP,
    DISCARD_FRACTION,
    K_MLE,
    MIN_UNIQUE_FRACTION,
    bootstrap_ci,
    dedupe_points,
    estimate_level_dimension,
    estimate_mle,
    estimate_twonn,
)


def plane_2d_in_10d(n: int = 1200, seed: int = 7) -> np.ndarray:
    """Uniform 2-D plane linearly embedded in 10-D ambient space (intrinsic d = 2)."""
    rng = np.random.default_rng(seed)
    latent = rng.uniform(size=(n, 2))
    basis = rng.normal(size=(2, 10))
    return latent @ basis


def hypercube_5d(n: int = 2500, seed: int = 11) -> np.ndarray:
    """Uniform 5-D hypercube (intrinsic d = 5)."""
    rng = np.random.default_rng(seed)
    return rng.uniform(size=(n, 5))


class TestFrozenConstants:
    def test_protocol_constants(self):
        assert DISCARD_FRACTION == 0.1
        assert K_MLE == 10
        assert MIN_UNIQUE_FRACTION == 0.8
        assert DEFAULT_N_BOOTSTRAP == 1000


class TestKnownManifoldSanity:
    def test_twonn_2d_plane_embedded_in_10d(self):
        d_hat = estimate_twonn(plane_2d_in_10d())
        assert 1.6 < d_hat < 2.4, f"TwoNN on a 2-D plane gave {d_hat}"

    def test_twonn_5d_hypercube(self):
        d_hat = estimate_twonn(hypercube_5d())
        assert 4.0 < d_hat < 6.0, f"TwoNN on a 5-D hypercube gave {d_hat}"

    def test_mle_2d_plane(self):
        d_hat = estimate_mle(plane_2d_in_10d())
        assert 1.5 < d_hat < 2.5, f"MLE on a 2-D plane gave {d_hat}"

    def test_mle_5d_hypercube(self):
        d_hat = estimate_mle(hypercube_5d())
        assert 4.0 < d_hat < 6.0, f"MLE on a 5-D hypercube gave {d_hat}"


class TestDedupe:
    def test_no_duplicates_removes_nothing(self):
        pts = plane_2d_in_10d(n=50)
        unique, removed = dedupe_points(pts)
        assert removed == 0
        assert len(unique) == 50

    def test_injected_duplicates_are_removed_and_counted(self):
        base = plane_2d_in_10d(n=60)
        stacked = np.vstack([base, base[:25]])  # inject 25 exact duplicates
        unique, removed = dedupe_points(stacked)
        assert removed == 25
        assert len(unique) == 60

    def test_non_2d_input_rejected(self):
        with pytest.raises(ValueError, match="2-D"):
            dedupe_points(np.zeros(5))


class TestKMleAssertion:
    def test_violation_raises(self):
        # K = 20 → K/3 ≈ 6.67, K_MLE = 10 violates the frozen assertion.
        pts = plane_2d_in_10d(n=20)
        with pytest.raises(ValueError, match="K_MLE"):
            estimate_mle(pts)

    def test_boundary_exactly_k_over_3_raises(self):
        pts = plane_2d_in_10d(n=30)  # 10 < 30/3 == 10 is False
        with pytest.raises(ValueError, match="K_MLE"):
            estimate_mle(pts)

    def test_violation_propagates_through_level_pipeline(self):
        pts = plane_2d_in_10d(n=25)
        with pytest.raises(ValueError, match="K_MLE"):
            estimate_level_dimension(pts, n_bootstrap=5)


class TestBootstrap:
    def test_seed_reproducibility(self):
        pts = plane_2d_in_10d(n=80)
        b1 = bootstrap_ci(pts, seed=123, n_bootstrap=60)
        b2 = bootstrap_ci(pts, seed=123, n_bootstrap=60)
        assert b1 == b2  # exact dict equality under the same seed

    def test_different_seed_changes_resamples(self):
        pts = plane_2d_in_10d(n=80)
        b1 = bootstrap_ci(pts, seed=123, n_bootstrap=60)
        b2 = bootstrap_ci(pts, seed=124, n_bootstrap=60)
        assert (b1["ci_low"], b1["ci_high"]) != (b2["ci_low"], b2["ci_high"])

    def test_output_structure(self):
        pts = plane_2d_in_10d(n=80)
        boot = bootstrap_ci(pts, seed=1, n_bootstrap=40)
        assert boot["ci_low"] <= boot["ci_high"]
        assert boot["ci_width"] == pytest.approx(boot["ci_high"] - boot["ci_low"])
        assert boot["confidence"] == 0.95
        assert boot["n_resamples"] == 40
        assert boot["n_effective"] + boot["n_skipped"] == 40
        assert boot["resampling_unit"] == "anchor"
        assert boot["seed"] == 1

    def test_ci_brackets_true_dimension_on_clean_manifold(self):
        boot = bootstrap_ci(plane_2d_in_10d(n=400), seed=5, n_bootstrap=50)
        assert boot["ci_low"] < 2.0 < boot["ci_high"] + 0.5  # loose sanity bracket

    def test_degenerate_cloud_raises(self):
        pts = np.zeros((30, 4))  # every resample collapses to a single point
        with pytest.raises(ValueError, match="degenerate"):
            bootstrap_ci(pts, seed=0, n_bootstrap=10)


class TestEstimateLevelDimension:
    def test_reliable_clean_cloud(self):
        pts = plane_2d_in_10d(n=300)
        res = estimate_level_dimension(pts, seed=3, level="L2", n_bootstrap=50)
        assert res["level"] == "L2"
        assert 1.5 < res["twonn"] < 2.5
        assert res["n_points"] == 300
        assert res["n_unique"] == 300
        assert res["n_duplicates_removed"] == 0
        assert res["reliable"] is True
        assert res["unreliable_reasons"] == []
        assert res["skdim_version"] == skdim.__version__

    def test_below_0_8k_unique_flags_unreliable(self):
        base = plane_2d_in_10d(n=60)
        stacked = np.vstack([base, base[:40]])  # K = 100, unique = 60 < 80
        res = estimate_level_dimension(stacked, seed=3, n_bootstrap=30)
        assert res["n_points"] == 100
        assert res["n_unique"] == 60
        assert res["n_duplicates_removed"] == 40
        assert res["reliable"] is False
        assert any("0.8" in r and "K_100" in r for r in res["unreliable_reasons"])

    def test_exactly_0_8k_unique_is_still_reliable(self):
        base = plane_2d_in_10d(n=80)
        stacked = np.vstack([base, base[:20]])  # K = 100, unique = 80 == 0.8K
        res = estimate_level_dimension(stacked, seed=3, n_bootstrap=30)
        assert not any("0.8" in r for r in res["unreliable_reasons"])

    def test_expected_k_overrides_point_count(self):
        # 50 unique points but K (anchor count) declared as 100 → 50 < 80 → unreliable
        pts = plane_2d_in_10d(n=50)
        res = estimate_level_dimension(pts, seed=3, expected_k=100, n_bootstrap=30)
        assert res["k_anchors"] == 100
        assert res["reliable"] is False

    def test_wide_ci_flags_unreliable(self, monkeypatch):
        pts = plane_2d_in_10d(n=200)

        def fake_boot(points, **kwargs):
            return {
                "ci_low": 0.5,
                "ci_high": 50.0,
                "ci_width": 49.5,  # >> any plausible TwoNN estimate here
                "confidence": 0.95,
                "n_resamples": kwargs.get("n_bootstrap", 0),
                "n_effective": 1,
                "n_skipped": 0,
                "seed": kwargs.get("seed"),
                "resampling_unit": "anchor",
            }

        monkeypatch.setattr(dimension, "bootstrap_ci", fake_boot)
        res = estimate_level_dimension(pts, seed=3, n_bootstrap=10)
        assert res["reliable"] is False
        assert "ci_width_exceeds_estimate" in res["unreliable_reasons"]

    def test_hyperparameters_and_metadata_persisted(self):
        res = estimate_level_dimension(plane_2d_in_10d(n=120), seed=9, n_bootstrap=20)
        hp = res["hyperparameters"]
        assert hp["primary_estimator"] == "TwoNN"
        assert hp["secondary_estimator"] == "MLE"
        assert hp["discard_fraction"] == 0.1
        assert hp["k_mle"] == 10
        assert hp["confidence"] == 0.95
        assert hp["min_unique_fraction"] == 0.8
        assert hp["seed"] == 9

    def test_full_pipeline_reproducible_under_fixed_seed(self):
        pts = plane_2d_in_10d(n=150)
        r1 = estimate_level_dimension(pts, seed=42, n_bootstrap=30)
        r2 = estimate_level_dimension(pts, seed=42, n_bootstrap=30)
        assert r1 == r2


class TestMain:
    def test_cli_writes_per_level_results(self, tmp_path):
        payload = {
            "levels": {
                "L2": plane_2d_in_10d(n=100, seed=1).tolist(),
                "L5": hypercube_5d(n=120, seed=2).tolist(),
            }
        }
        inp = tmp_path / "in.json"
        inp.write_text(json.dumps(payload), encoding="utf-8")
        out = tmp_path / "out.json"

        rc = dimension.main([str(inp), str(out), "--seed", "7", "--n-bootstrap", "20"])
        assert rc == 0
        result = json.loads(out.read_text(encoding="utf-8"))
        assert set(result["levels"].keys()) == {"L2", "L5"}
        assert result["skdim_version"] == skdim.__version__
        assert 1.5 < result["levels"]["L2"]["twonn"] < 2.5
        assert result["levels"]["L5"]["bootstrap"]["seed"] == 7
