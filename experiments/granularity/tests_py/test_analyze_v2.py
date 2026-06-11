"""Unit tests for analyze_v2.py (Stage 72.1).

Uses synthetic data with known outcomes to verify:
- BH-FDR integration with B-series
- P_oracle computation from scores
- A1 Wilcoxon test
- A2 argmax non-endpoint check
- A3 bootstrap CI (B+C vs A)
- McNemar tests for B1a, B2a, etc.
- §10 decision table routing
"""

from __future__ import annotations

import json
from collections import defaultdict

import numpy as np
import pytest

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from analyze_v2 import (
    bh_fdr_correction,
    build_scores,
    compute_p_oracle,
    normalize_level,
    a1_wilcoxon,
    a2_check,
    a3_bootstrap,
    mcnemar_exact,
    extract_hits,
    discriminative_subset,
    b3_spearman,
    b4_format_sensitivity,
    decide_v2,
    LEVELS,
)


# ---------------------------------------------------------------------------
# BH-FDR (already covered in test_analyze_fdr.py; one sanity check here)
# ---------------------------------------------------------------------------

class TestBHFDR:
    def test_seven_tests_all_significant(self):
        """All 7 B-series tests significant → all rejected."""
        p_vals = [1e-10] * 7
        rejected = bh_fdr_correction(p_vals, q=0.05)
        assert all(rejected)

    def test_seven_tests_none_significant(self):
        """All 7 B-series tests insignificant → none rejected."""
        p_vals = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]
        rejected = bh_fdr_correction(p_vals, q=0.05)
        assert not any(rejected)


# ---------------------------------------------------------------------------
# Score building and P_oracle
# ---------------------------------------------------------------------------

def _make_score_rows(task_level_scores: dict) -> list[dict]:
    """Helper: {task_id: {level: score}} → ScoreRow-like dicts."""
    rows = []
    class_map = {
        "taskA": "A", "taskB": "B", "taskC": "C",
        "taskA2": "A", "taskB2": "B",
    }
    for task_id, level_scores in task_level_scores.items():
        tc = class_map.get(task_id, "A")
        for level, score in level_scores.items():
            rows.append({
                "taskId": task_id, "level": level, "model": "test-model",
                "score": score, "taskClass": tc,
            })
    return rows


class TestBuildScores:
    def test_single_task_single_level(self):
        rows = _make_score_rows({"taskA": {"L3": 0.8}})
        by_task, class_of = build_scores(rows)
        assert by_task["taskA"]["L3"] == pytest.approx(0.8)
        assert class_of["taskA"] == "A"

    def test_averages_across_models(self):
        rows = [
            {"taskId": "taskA", "level": "L3", "model": "model1", "score": 0.6, "taskClass": "A"},
            {"taskId": "taskA", "level": "L3", "model": "model2", "score": 0.8, "taskClass": "A"},
        ]
        by_task, _ = build_scores(rows)
        assert by_task["taskA"]["L3"] == pytest.approx(0.7)

    def test_ignores_unknown_levels(self):
        rows = [{"taskId": "taskA", "level": "LUNK", "model": "m", "score": 1.0, "taskClass": "A"}]
        by_task, _ = build_scores(rows)
        assert "taskA" not in by_task


class TestComputePOracle:
    def test_simple_argmax(self):
        by_task = {"taskA": {"L2": 0.5, "L3": 0.8, "L5": 0.6}}
        oracle = compute_p_oracle(by_task)
        assert oracle["taskA"] == "L3"

    def test_l4_normalized_to_l3(self):
        by_task = {"taskA": {"L3": 0.7, "L4": 0.8}}
        oracle = compute_p_oracle(by_task)
        # L4 > L3 → raw argmax = L4 → normalized to L3
        assert oracle["taskA"] == "L3"

    def test_tie_resolves_to_lower_ordinal(self):
        by_task = {"taskA": {"L2": 0.9, "L3": 0.9}}
        oracle = compute_p_oracle(by_task)
        assert oracle["taskA"] == "L2"


# ---------------------------------------------------------------------------
# A1: Wilcoxon
# ---------------------------------------------------------------------------

class TestA1Wilcoxon:
    def test_best_mid_clearly_above_l5(self):
        """When L3 consistently beats L5, A1 should pass."""
        # 20 A-class tasks: L3=0.9, L5=0.3 for all
        rows = []
        for i in range(20):
            for lv, sc in [("L3", 0.9), ("L5", 0.3)]:
                rows.append({"taskId": f"a{i}", "level": lv, "model": "m", "score": sc, "taskClass": "A"})
        by_task, class_of = build_scores(rows)
        result = a1_wilcoxon(by_task, class_of, "A")
        assert result["pass"], f"Expected A1 pass: {result}"
        assert result["delta_f1"] == pytest.approx(0.6, abs=0.01)

    def test_best_mid_equal_l5(self):
        """When all scores are equal, A1 should fail."""
        rows = []
        for i in range(10):
            for lv in ["L3", "L5"]:
                rows.append({"taskId": f"a{i}", "level": lv, "model": "m", "score": 0.5, "taskClass": "A"})
        by_task, class_of = build_scores(rows)
        result = a1_wilcoxon(by_task, class_of, "A")
        assert not result["pass"]

    def test_empty_class(self):
        by_task, class_of = build_scores([])
        result = a1_wilcoxon(by_task, class_of, "A")
        assert not result["pass"]


# ---------------------------------------------------------------------------
# A2: argmax non-endpoint
# ---------------------------------------------------------------------------

class TestA2Check:
    def test_peak_at_l3_passes(self):
        rows = []
        for i in range(5):
            for lv, sc in [("L2", 0.4), ("L3", 0.9), ("L5", 0.3)]:
                rows.append({"taskId": f"a{i}", "level": lv, "model": "m", "score": sc, "taskClass": "A"})
        by_task, class_of = build_scores(rows)
        result = a2_check(by_task, class_of, "A")
        assert result["argmax_level"] == "L3"
        assert result["pass"]

    def test_peak_at_l0_fails(self):
        rows = []
        for i in range(5):
            for lv, sc in [("L0", 0.9), ("L1", 0.4), ("L5", 0.3)]:
                rows.append({"taskId": f"a{i}", "level": lv, "model": "m", "score": sc, "taskClass": "A"})
        by_task, class_of = build_scores(rows)
        result = a2_check(by_task, class_of, "A")
        assert result["argmax_level"] == "L0"
        assert not result["pass"]

    def test_peak_at_l4_normalizes_to_l3(self):
        rows = []
        for i in range(5):
            for lv, sc in [("L3", 0.7), ("L4", 0.8)]:
                rows.append({"taskId": f"a{i}", "level": lv, "model": "m", "score": sc, "taskClass": "A"})
        by_task, class_of = build_scores(rows)
        result = a2_check(by_task, class_of, "A")
        # L4 wins raw → normalized to L3 → non-endpoint → pass
        assert result["argmax_level"] == "L3"
        assert result["pass"]


# ---------------------------------------------------------------------------
# A3: bootstrap CI
# ---------------------------------------------------------------------------

class TestA3Bootstrap:
    def test_bc_at_l3_a_at_l1_positive_diff(self):
        """B+C tasks peak at L3, A tasks peak at L1 → diff > 0 → should pass."""
        rows = []
        # A tasks: peak at L1
        for i in range(10):
            rows.append({"taskId": f"ta{i}", "level": "L1", "model": "m", "score": 0.9, "taskClass": "A"})
            rows.append({"taskId": f"ta{i}", "level": "L3", "model": "m", "score": 0.3, "taskClass": "A"})
        # B tasks: peak at L3
        for i in range(10):
            rows.append({"taskId": f"tb{i}", "level": "L1", "model": "m", "score": 0.2, "taskClass": "B"})
            rows.append({"taskId": f"tb{i}", "level": "L3", "model": "m", "score": 0.9, "taskClass": "B"})
        # C tasks: peak at L3
        for i in range(5):
            rows.append({"taskId": f"tc{i}", "level": "L3", "model": "m", "score": 0.8, "taskClass": "C"})
            rows.append({"taskId": f"tc{i}", "level": "L1", "model": "m", "score": 0.1, "taskClass": "C"})
        by_task, class_of = build_scores(rows)
        result = a3_bootstrap(by_task, class_of, n_bootstrap=100, seed=59)
        assert result["observed_diff"] > 0
        assert result["ci_low"] > 0
        assert result["pass"]

    def test_same_peak_zero_diff(self):
        """Both A and B+C peak at same level → diff = 0 → should fail."""
        rows = []
        for i in range(10):
            rows.append({"taskId": f"ta{i}", "level": "L3", "model": "m", "score": 0.9, "taskClass": "A"})
        for i in range(10):
            rows.append({"taskId": f"tb{i}", "level": "L3", "model": "m", "score": 0.9, "taskClass": "B"})
        by_task, class_of = build_scores(rows)
        result = a3_bootstrap(by_task, class_of, n_bootstrap=100, seed=59)
        assert result["observed_diff"] == 0
        assert not result["pass"]


# ---------------------------------------------------------------------------
# McNemar
# ---------------------------------------------------------------------------

class TestMcNemar:
    def test_x_always_better(self):
        """X hits all, Y hits none → large discordant → significant X better."""
        hits_x = [True] * 20
        hits_y = [False] * 20
        result = mcnemar_exact(hits_x, hits_y)
        assert result["b"] == 20
        assert result["c"] == 0
        assert result["p_value"] < 0.001
        assert result["x_better"]

    def test_no_discordant(self):
        """Both same → no discordant → p=1."""
        hits = [True, False, True, True, False]
        result = mcnemar_exact(hits, hits)
        assert result["n_discordant"] == 0
        assert result["p_value"] == 1.0

    def test_y_better(self):
        """Y hits more than X → x_better=False."""
        hits_x = [False] * 10
        hits_y = [True] * 10
        result = mcnemar_exact(hits_x, hits_y)
        assert not result["x_better"]


# ---------------------------------------------------------------------------
# Extract hits and discriminative subset
# ---------------------------------------------------------------------------

class TestExtractHits:
    def setup_method(self):
        self.preds = [
            {"task_id": "t1", "task_class": "A", "P_GIT-sem": "L0", "P_GIT-struct": "L1",
             "H0": "L1", "P_random": "L2", "d_task": 5.0, "derivable_levels": ["L1","L2","L3"]},
            {"task_id": "t2", "task_class": "B", "P_GIT-sem": "L0", "P_GIT-struct": "L1",
             "H0": "L2", "P_random": "L3", "d_task": 3.0, "derivable_levels": ["L2","L3"]},
        ]
        self.p_oracle = {"t1": "L1", "t2": "L3"}

    def test_hit_sem(self):
        """P_GIT-sem=L0; oracle(t1)=L1, oracle(t2)=L3. Both miss."""
        hits = extract_hits(self.preds, self.p_oracle)
        # t1: sem=L0 vs oracle=L1 → miss; t2: sem=L0 vs oracle=L3 → miss
        assert hits["hit_sem"] == [False, False]

    def test_hit_h0(self):
        """H0(t1)=L1; oracle(t1)=L1 → hit. H0(t2)=L2; oracle(t2)=L3 → miss."""
        hits = extract_hits(self.preds, self.p_oracle)
        assert hits["hit_h0"] == [True, False]

    def test_discriminative_subset(self):
        """t1: H0=L1, oracle=L1 → same → NOT discriminative.
           t2: H0=L2, oracle=L3 → different → discriminative."""
        disc = discriminative_subset(self.preds, self.p_oracle)
        assert len(disc) == 1
        assert disc[0]["task_id"] == "t2"


# ---------------------------------------------------------------------------
# B3 Spearman
# ---------------------------------------------------------------------------

class TestB3Spearman:
    def test_negative_correlation_passes(self):
        """When small |d_L - d_task| → high accuracy, correlation < 0."""
        rows = {}
        class_of = {}
        # 5 tasks, each at L3 and L5
        # d_task = 5 (all A-class)
        # L3: d=5 (|5-5|=0) → score=0.9 (close match → high acc)
        # L5: d=15 (|15-5|=10) → score=0.2 (far match → low acc)
        for i in range(20):
            rows[f"t{i}"] = {"L3": 0.9, "L5": 0.2}
            class_of[f"t{i}"] = "A"
        lm_dims = {"L3": 5.0, "L5": 15.0}
        d_task = {"A": 5.0}
        result = b3_spearman(rows, class_of, lm_dims, d_task)
        assert result["rho"] is not None
        assert result["rho"] < 0

    def test_insufficient_data(self):
        rows = {"t1": {"L3": 0.8}}
        class_of = {"t1": "A"}
        lm_dims = {"L3": 5.0}
        d_task = {"A": 5.0}
        result = b3_spearman(rows, class_of, lm_dims, d_task)
        # 1 unit < 3 → no rho
        assert result["rho"] is None


# ---------------------------------------------------------------------------
# B4 format sensitivity
# ---------------------------------------------------------------------------

class TestB4Format:
    def test_l3_equals_l4(self):
        """Same scores at L3 and L4 → no format effect → p=1."""
        rows = {}
        for i in range(10):
            rows[f"t{i}"] = {"L3": 0.7, "L4": 0.7}
        result = b4_format_sensitivity(rows)
        # All zeros diff → p_value = 1.0
        assert result["p_value"] == 1.0
        assert not result["pass"]


# ---------------------------------------------------------------------------
# §10 decision table
# ---------------------------------------------------------------------------

class TestDecideV2:
    def _reliable(self):
        return {lv: True for lv in ["L0","L1","L2","L3","L4","L5"]}

    def test_b2a_b2b_b3_all_pass(self):
        result = decide_v2(
            b2a_pass=True, b2b_pass=True, b3_pass=True, b1a_pass=True,
            discriminative_subset_size=20, k_anchors=102,
            lm_real_reliable=self._reliable(), phase0_verdict="PROCEED_FULL_B_SERIES"
        )
        assert result["row"] == 3
        assert result["label"] == "predictive_with_mechanism"

    def test_b2a_only(self):
        result = decide_v2(
            b2a_pass=True, b2b_pass=False, b3_pass=False, b1a_pass=False,
            discriminative_subset_size=10, k_anchors=102,
            lm_real_reliable=self._reliable(), phase0_verdict="PROCEED_FULL_B_SERIES"
        )
        assert result["row"] == 4
        assert result["label"] == "single_signal"

    def test_b1a_only(self):
        result = decide_v2(
            b2a_pass=False, b2b_pass=False, b3_pass=False, b1a_pass=True,
            discriminative_subset_size=10, k_anchors=102,
            lm_real_reliable=self._reliable(), phase0_verdict="PROCEED"
        )
        assert result["row"] == 5
        assert result["label"] == "heuristic_in_disguise"

    def test_all_fail(self):
        result = decide_v2(
            b2a_pass=False, b2b_pass=False, b3_pass=False, b1a_pass=False,
            discriminative_subset_size=15, k_anchors=102,
            lm_real_reliable=self._reliable(), phase0_verdict="PROCEED"
        )
        assert result["row"] == 6
        assert result["label"] == "git_rejected"

    def test_small_discriminative_subset(self):
        result = decide_v2(
            b2a_pass=True, b2b_pass=True, b3_pass=True, b1a_pass=True,
            discriminative_subset_size=5,  # < MIN=8
            k_anchors=102,
            lm_real_reliable=self._reliable(), phase0_verdict="PROCEED"
        )
        assert result["row"] == 2
        assert result["label"] == "no_verdict"

    def test_phase0_stop(self):
        result = decide_v2(
            b2a_pass=True, b2b_pass=True, b3_pass=True, b1a_pass=True,
            discriminative_subset_size=20, k_anchors=102,
            lm_real_reliable=self._reliable(), phase0_verdict="STOP_B_SERIES_0_SENSORS"
        )
        assert result["row"] == 1
        assert result["label"] == "phase0_stop"

    def test_low_k_anchors(self):
        result = decide_v2(
            b2a_pass=True, b2b_pass=True, b3_pass=True, b1a_pass=True,
            discriminative_subset_size=20, k_anchors=40,  # < MIN=50
            lm_real_reliable=self._reliable(), phase0_verdict="PROCEED"
        )
        assert result["row"] == 2  # no verdict due to k_anchors < 50
