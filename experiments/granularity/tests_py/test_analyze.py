"""Stage 62.3 tests — analyze.py (pre-registered statistics, §7/§8.3/§8.4/§9).

Pre-registered coverage (plan Stage 62.3): every test gets one significant and
one non-significant synthetic dataset; A3's resampling unit is asserted to be
TASKS (题目), never individual rows/calls.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

import analyze
from analyze import (
    LEVELS,
    a1_wilcoxon,
    a2_check,
    a3_bootstrap,
    analyze as run_analysis,
    argmax_level,
    b1_test,
    b2_test,
    b3_spearman,
    build_scores,
    decide,
    mcnemar_test,
    mean_by_level,
    normalize_level,
    predictor_hits,
)


# ---------------------------------------------------------------------------
# synthetic-data builders
# ---------------------------------------------------------------------------
def score_rows(task_class, prefix, n_tasks, level_scores_fn, models=1):
    """Long-table rows; level_scores_fn(i) -> {level: score} for task i."""
    rows = []
    for i in range(n_tasks):
        for level, score in level_scores_fn(i).items():
            for _ in range(models):
                rows.append(
                    {
                        "task_id": f"{prefix}{i}",
                        "task_class": task_class,
                        "level": level,
                        "score": score,
                    }
                )
    return rows


def peaked_levels(peak, low=0.2, high=0.9, l5=None):
    """Score profile with a clear single peak at `peak`."""
    scores = {}
    for level in LEVELS:
        scores[level] = high if level == peak else low
    if l5 is not None:
        scores["L5"] = l5
    return scores


# ---------------------------------------------------------------------------
# score-table helpers
# ---------------------------------------------------------------------------
class TestHelpers:
    def test_normalize_level_l4_to_l3(self):
        assert normalize_level("L4") == "L3"
        assert normalize_level("L3") == "L3"
        assert normalize_level("L0") == "L0"

    def test_build_scores_averages_multi_model_rows(self):
        rows = [
            {"task_id": "t1", "task_class": "A", "level": "L2", "score": 0.4},
            {"task_id": "t1", "task_class": "A", "level": "L2", "score": 0.8},
        ]
        by_task, class_of = build_scores(rows)
        assert by_task["t1"]["L2"] == pytest.approx(0.6)
        assert class_of == {"t1": "A"}

    def test_build_scores_rejects_unknown_level(self):
        with pytest.raises(ValueError, match="unknown level"):
            build_scores([{"task_id": "t", "task_class": "A", "level": "L9", "score": 1}])

    def test_argmax_tie_resolves_to_lower_ordinal(self):
        assert argmax_level({"L1": 0.5, "L3": 0.5, "L2": 0.4}) == "L1"

    def test_argmax_no_scores_raises(self):
        with pytest.raises(ValueError):
            argmax_level({})

    def test_mean_by_level_skips_missing_levels(self):
        by_task = {"t1": {"L1": 0.5}, "t2": {"L1": 0.7, "L2": 0.9}}
        means = mean_by_level(by_task, ["t1", "t2"])
        assert means["L1"] == pytest.approx(0.6)
        assert means["L2"] == pytest.approx(0.9)


# ---------------------------------------------------------------------------
# A1 — paired Wilcoxon (significant / non-significant / effect gate)
# ---------------------------------------------------------------------------
class TestA1Wilcoxon:
    def test_significant_with_large_effect_passes(self):
        # 12 tasks: best mid L2 ≈ 0.9 vs L5 = 0.2 (distinct diffs → exact test)
        rows = score_rows(
            "A", "a", 12,
            lambda i: {"L0": 0.1, "L1": 0.5, "L2": 0.9 - 0.005 * i, "L3": 0.6, "L4": 0.6, "L5": 0.2},
        )
        by_task, class_of = build_scores(rows)
        res = a1_wilcoxon(by_task, class_of, "A")
        assert res["best_mid_level"] == "L2"
        assert res["n_pairs"] == 12
        assert res["p_value"] < 0.05
        assert res["delta_f1"] >= 0.1
        assert res["pass"] is True

    def test_too_few_tasks_not_significant(self):
        rows = score_rows("A", "a", 3, lambda i: {"L2": 0.9 - 0.01 * i, "L5": 0.2})
        by_task, class_of = build_scores(rows)
        res = a1_wilcoxon(by_task, class_of, "A")
        assert res["p_value"] > 0.05  # n=3 one-sided exact floor is 0.125
        assert res["pass"] is False

    def test_significant_but_small_effect_fails_gate(self):
        # ΔF1 ≈ 0.05 < 0.1: significance alone must NOT pass A1 (joint gate).
        rows = score_rows("A", "a", 12, lambda i: {"L2": 0.25 + 0.001 * i, "L5": 0.2})
        by_task, class_of = build_scores(rows)
        res = a1_wilcoxon(by_task, class_of, "A")
        assert res["significant"] is True
        assert res["effect_size_met"] is False
        assert res["pass"] is False

    def test_all_zero_diffs_yield_p_one(self):
        rows = score_rows("A", "a", 6, lambda i: {"L2": 0.5, "L5": 0.5})
        by_task, class_of = build_scores(rows)
        res = a1_wilcoxon(by_task, class_of, "A")
        assert res["p_value"] == 1.0
        assert res["pass"] is False

    def test_empty_class_returns_no_pass(self):
        rows = score_rows("A", "a", 2, lambda i: {"L2": 0.5, "L5": 0.1})
        by_task, class_of = build_scores(rows)
        res = a1_wilcoxon(by_task, class_of, "B")
        assert res["n_pairs"] == 0
        assert res["pass"] is False


# ---------------------------------------------------------------------------
# A2 — inverted U
# ---------------------------------------------------------------------------
class TestA2:
    def test_interior_peak_passes(self):
        rows = score_rows("A", "a", 5, lambda i: peaked_levels("L2"))
        by_task, class_of = build_scores(rows)
        assert a2_check(by_task, class_of, "A") == {
            "task_class": "A",
            "argmax_level": "L2",
            "pass": True,
        }

    def test_l5_peak_fails(self):
        rows = score_rows("A", "a", 5, lambda i: peaked_levels("L5"))
        by_task, class_of = build_scores(rows)
        assert a2_check(by_task, class_of, "A")["pass"] is False

    def test_l0_peak_fails(self):
        rows = score_rows("A", "a", 5, lambda i: peaked_levels("L0"))
        by_task, class_of = build_scores(rows)
        assert a2_check(by_task, class_of, "A")["pass"] is False

    def test_l4_peak_normalized_to_l3_passes(self):
        rows = score_rows("A", "a", 5, lambda i: peaked_levels("L4"))
        by_task, class_of = build_scores(rows)
        res = a2_check(by_task, class_of, "A")
        assert res["argmax_level"] == "L3"  # §3 normalization applied
        assert res["pass"] is True

    def test_empty_class(self):
        assert a2_check({}, {}, "A")["pass"] is False


# ---------------------------------------------------------------------------
# A3 — bootstrap of argmax ordinal difference (resampling unit = TASKS)
# ---------------------------------------------------------------------------
class RecordingRNG:
    """Wraps a real Generator and records every integers() call."""

    def __init__(self, seed=0):
        self._rng = np.random.default_rng(seed)
        self.calls: list[tuple] = []

    def integers(self, low, high, size):
        self.calls.append((int(low), int(high), int(size)))
        return self._rng.integers(low, high, size)


class TestA3Bootstrap:
    def make_shifted(self, n_a=10, n_b=10, models=1):
        rows = score_rows("A", "a", n_a, lambda i: peaked_levels("L1"), models=models)
        rows += score_rows("B", "b", n_b, lambda i: peaked_levels("L4"), models=models)
        return build_scores(rows)

    def test_clear_shift_passes(self):
        by_task, class_of = self.make_shifted()
        res = a3_bootstrap(by_task, class_of, n_bootstrap=200, seed=1)
        # B peaks at L4 → normalized L3 (ordinal 3); A peaks at L1 (ordinal 1).
        assert res["observed_diff"] == 2
        assert res["ci_low"] > 0
        assert res["pass"] is True
        assert res["resampling_unit"] == "task"

    def test_no_shift_fails(self):
        rows = score_rows("A", "a", 8, lambda i: peaked_levels("L2"))
        rows += score_rows("B", "b", 8, lambda i: peaked_levels("L2"))
        by_task, class_of = build_scores(rows)
        res = a3_bootstrap(by_task, class_of, n_bootstrap=200, seed=1)
        assert res["observed_diff"] == 0
        assert res["pass"] is False

    def test_resampling_unit_is_tasks_not_rows(self):
        # 3 model-rows per (task × level): row count >> task count. Every
        # bootstrap draw must be over the 7/9 task IDs, never the raw rows.
        n_a, n_b, models = 7, 9, 3
        by_task, class_of = self.make_shifted(n_a=n_a, n_b=n_b, models=models)
        rng = RecordingRNG(seed=2)
        n_bootstrap = 25
        a3_bootstrap(by_task, class_of, n_bootstrap=n_bootstrap, rng=rng)
        assert len(rng.calls) == 2 * n_bootstrap  # one A draw + one B draw per iter
        a_calls = [c for c in rng.calls if c[1] == n_a]
        b_calls = [c for c in rng.calls if c[1] == n_b]
        assert len(a_calls) == n_bootstrap and len(b_calls) == n_bootstrap
        for low, high, size in rng.calls:
            assert low == 0
            assert size == high  # draw len(tasks) task indices, with replacement
            assert high in (n_a, n_b)  # task counts — NOT row counts (7*6*3 etc.)

    def test_missing_class_raises(self):
        rows = score_rows("A", "a", 4, lambda i: peaked_levels("L2"))
        by_task, class_of = build_scores(rows)
        with pytest.raises(ValueError, match="class A and B"):
            a3_bootstrap(by_task, class_of, n_bootstrap=10, seed=0)

    def test_seed_reproducibility(self):
        by_task, class_of = self.make_shifted()
        r1 = a3_bootstrap(by_task, class_of, n_bootstrap=100, seed=9)
        r2 = a3_bootstrap(by_task, class_of, n_bootstrap=100, seed=9)
        assert r1 == r2


# ---------------------------------------------------------------------------
# McNemar — hand-rolled exact binomial (scipy-only, no statsmodels)
# ---------------------------------------------------------------------------
class TestMcNemar:
    def test_significant_one_directional(self):
        # b=10 (X hit, Y miss), c=0 → p = 2·(0.5)^10 ≈ 0.00195
        x = [True] * 10 + [True] * 5
        y = [False] * 10 + [True] * 5
        res = mcnemar_test(x, y)
        assert res["b"] == 10 and res["c"] == 0
        assert res["method"] == "exact_binomial"
        assert res["p_value"] == pytest.approx(2 * 0.5**10)
        assert res["pass"] is True

    def test_not_significant(self):
        x = [True, True, True, False, False, True]
        y = [False, False, True, True, False, True]  # b=2, c=1
        res = mcnemar_test(x, y)
        assert res["p_value"] > 0.05
        assert res["pass"] is False

    def test_no_discordant_pairs_p_one(self):
        res = mcnemar_test([True, False], [True, False])
        assert res["n_discordant"] == 0
        assert res["p_value"] == 1.0
        assert res["pass"] is False

    def test_balanced_discordance_capped_at_one(self):
        x = [True] * 4 + [False] * 4
        y = [False] * 4 + [True] * 4  # b = c = 4
        res = mcnemar_test(x, y)
        assert res["p_value"] == 1.0
        assert res["x_better"] is False

    def test_large_discordant_count_still_exact_binomial(self):
        # b+c = 30 ≥ 25: pre-registered spec demands the EXACT test here too.
        x = [True] * 25 + [False] * 5
        y = [False] * 25 + [True] * 5
        res = mcnemar_test(x, y)
        assert res["method"] == "exact_binomial"
        from scipy import stats

        assert res["p_value"] == pytest.approx(min(1.0, 2 * float(stats.binom.cdf(5, 30, 0.5))))
        assert res["pass"] is True

    def test_significant_wrong_direction_fails(self):
        x = [False] * 10 + [True] * 2
        y = [True] * 10 + [True] * 2  # c=10 > b=0: Y better
        res = mcnemar_test(x, y)
        assert res["significant"] is True
        assert res["x_better"] is False
        assert res["pass"] is False

    def test_unpaired_lengths_rejected(self):
        with pytest.raises(ValueError, match="paired"):
            mcnemar_test([True], [True, False])


# ---------------------------------------------------------------------------
# predictor hits / B1 / B2
# ---------------------------------------------------------------------------
def pred_row(task_id, p_git, h0, p_random, p_oracle, derivable=True):
    return {
        "task_id": task_id,
        "derivable": derivable,
        "p_git": p_git,
        "h0": h0,
        "p_random": p_random,
        "p_oracle": p_oracle,
    }


class TestPredictorHits:
    def test_non_derivable_excluded(self):
        rows = [
            pred_row("t1", "L2", "L2", "L2", "L2"),
            pred_row("t2", "L2", "L2", "L2", "L2", derivable=False),
        ]
        hits = predictor_hits(rows)
        assert hits["task_ids"] == ["t1"]

    def test_l4_prediction_hits_l3_oracle_after_normalization(self):
        rows = [pred_row("t1", "L4", "L0", "L1", "L3")]
        hits = predictor_hits(rows)
        assert hits["p_git"] == [True]  # L4 ≡ L3 (§3)
        assert hits["h0"] == [False]


class TestB1:
    def make_pass_rows(self):
        rows = [pred_row(f"t{i}", "L2", "L2" if i < 7 else "L5", "L5", "L2") for i in range(12)]
        rows += [pred_row("t12", "L2", "L2", "L2", "L2"), pred_row("t13", "L2", "L2", "L2", "L2")]
        rows += [pred_row("x1", "L0", "L0", "L0", "L5", derivable=False)]
        return rows

    def test_significant_passes(self):
        res = b1_test(self.make_pass_rows())
        assert res["n_derivable"] == 14
        assert res["mcnemar_vs_random"]["pass"] is True
        assert res["hit_rates"]["p_git"] == 1.0
        assert res["p_git_not_below_h0"] is True
        assert res["pass"] is True

    def test_not_significant_fails(self):
        # P_GIT and P_random identical → zero discordance → p = 1.
        rows = [pred_row(f"t{i}", "L2", "L2", "L2", "L2") for i in range(10)]
        res = b1_test(rows)
        assert res["mcnemar_vs_random"]["p_value"] == 1.0
        assert res["pass"] is False

    def test_below_h0_rate_fails_even_when_beating_random(self):
        rows = [pred_row(f"t{i}", "L2" if i < 10 else "L5", "L2", "L0", "L2") for i in range(14)]
        res = b1_test(rows)
        assert res["mcnemar_vs_random"]["pass"] is True  # beats random
        assert res["hit_rates"]["h0"] > res["hit_rates"]["p_git"]
        assert res["p_git_not_below_h0"] is False
        assert res["pass"] is False


class TestB2:
    def test_subset_below_8_is_no_verdict(self):
        rows = [pred_row(f"t{i}", "L3", "L1", "L0", "L3") for i in range(5)]  # subset = 5
        rows += [pred_row(f"e{i}", "L2", "L2", "L0", "L2") for i in range(10)]  # h0 == oracle
        res = b2_test(rows)
        assert res["subset_size"] == 5
        assert res["no_verdict"] is True
        assert res["mcnemar_vs_h0"] is None
        assert res["pass"] is False

    def test_h0_l4_vs_oracle_l3_not_discriminative(self):
        # Normalized h0 == normalized oracle → excluded from the subset.
        rows = [pred_row("t1", "L3", "L4", "L0", "L3")]
        assert b2_test(rows)["subset_size"] == 0

    def test_significant_on_subset_passes(self):
        rows = [pred_row(f"d{i}", "L3", "L1", "L0", "L3") for i in range(10)]  # git all hit
        rows += [pred_row(f"e{i}", "L2", "L2", "L0", "L2") for i in range(5)]
        res = b2_test(rows)
        assert res["subset_size"] == 10
        assert res["no_verdict"] is False
        assert res["mcnemar_vs_h0"]["b"] == 10 and res["mcnemar_vs_h0"]["c"] == 0
        assert res["pass"] is True

    def test_not_significant_on_subset_fails(self):
        rows = [pred_row(f"d{i}", "L3" if i < 2 else "L5", "L1", "L0", "L3") for i in range(10)]
        res = b2_test(rows)
        assert res["no_verdict"] is False
        assert res["pass"] is False


# ---------------------------------------------------------------------------
# B3 — Spearman gradient consistency
# ---------------------------------------------------------------------------
def grad_row(task_class, level, d_level, d_task, accuracy, derivable=True):
    return {
        "task_class": task_class,
        "level": level,
        "d_level": d_level,
        "d_task": d_task,
        "accuracy": accuracy,
        "derivable": derivable,
    }


class TestB3:
    def test_monotone_negative_passes(self):
        rows = [grad_row("A", "L2", 2.0 + 0.5 * i, 2.0, 0.95 - 0.06 * i) for i in range(12)]
        res = b3_spearman(rows)
        assert res["rho"] == pytest.approx(-1.0)
        assert res["p_value"] < 0.05
        assert res["pass"] is True

    def test_positive_relation_fails(self):
        rows = [grad_row("A", "L2", 2.0 + 0.5 * i, 2.0, 0.2 + 0.06 * i) for i in range(12)]
        res = b3_spearman(rows)
        assert res["rho"] == pytest.approx(1.0)
        assert res["pass"] is False

    def test_non_derivable_rows_excluded(self):
        rows = [grad_row("A", "L2", 2.0 + 0.5 * i, 2.0, 0.95 - 0.06 * i) for i in range(10)]
        rows += [grad_row("B", "L0", 0.1, 9.0, 1.0, derivable=False)] * 5  # adversarial noise
        res = b3_spearman(rows)
        assert res["n_units"] == 10
        assert res["pass"] is True

    def test_too_few_units_no_pass(self):
        rows = [grad_row("A", "L2", 2.0, 2.0, 0.5), grad_row("A", "L3", 3.0, 2.0, 0.4)]
        res = b3_spearman(rows)
        assert res["rho"] is None
        assert res["pass"] is False


# ---------------------------------------------------------------------------
# §9 decision table
# ---------------------------------------------------------------------------
class TestDecide:
    BASE = dict(p_git_rate=0.8, p_random_rate=0.2, discriminative_subset_size=10, k_anchors=60)

    def test_row1_b2_and_b3(self):
        d = decide(b1_pass=True, b2_pass=True, b3_pass=True, **self.BASE)
        assert d["row"] == 1

    def test_row2_b2_only(self):
        d = decide(b1_pass=True, b2_pass=True, b3_pass=False, **self.BASE)
        assert d["row"] == 2

    def test_row3_b1_only(self):
        d = decide(b1_pass=True, b2_pass=False, b3_pass=False, **self.BASE)
        assert d["row"] == 3

    def test_row4_none(self):
        d = decide(b1_pass=False, b2_pass=False, b3_pass=False, **self.BASE)
        assert d["row"] == 4
        assert d["p_git_above_random"] is True

    def test_row5_small_subset_gates_before_rows_1_to_4(self):
        d = decide(
            b1_pass=True, b2_pass=True, b3_pass=True,
            p_git_rate=0.8, p_random_rate=0.2,
            discriminative_subset_size=7, k_anchors=60,
        )
        assert d["row"] == 5
        assert any("discriminative_subset" in r for r in d["reasons"])

    def test_row5_low_k_anchors(self):
        d = decide(
            b1_pass=True, b2_pass=True, b3_pass=True,
            p_git_rate=0.8, p_random_rate=0.2,
            discriminative_subset_size=10, k_anchors=49,
        )
        assert d["row"] == 5
        assert any("k_anchors" in r for r in d["reasons"])

    def test_row5_majority_unreliable_levels(self):
        d = decide(
            b1_pass=True, b2_pass=True, b3_pass=True,
            p_git_rate=0.8, p_random_rate=0.2,
            discriminative_subset_size=10, k_anchors=60,
            levels_reliable={lvl: lvl in ("L0", "L1") for lvl in LEVELS},  # 4/6 unreliable
        )
        assert d["row"] == 5
        assert any("majority_d_unreliable" in r for r in d["reasons"])

    def test_reliable_majority_does_not_gate(self):
        d = decide(
            b1_pass=True, b2_pass=True, b3_pass=True,
            p_git_rate=0.8, p_random_rate=0.2,
            discriminative_subset_size=10, k_anchors=60,
            levels_reliable={lvl: lvl != "L0" for lvl in LEVELS},  # only 1/6 unreliable
        )
        assert d["row"] == 1


# ---------------------------------------------------------------------------
# end-to-end analyze() + CLI main()
# ---------------------------------------------------------------------------
def full_synthetic_inputs():
    scores = score_rows(
        "A", "a", 12,
        lambda i: {"L0": 0.1, "L1": 0.4, "L2": 0.9 - 0.005 * i, "L3": 0.5, "L4": 0.5, "L5": 0.2},
    )
    scores += score_rows(
        "B", "b", 12,
        lambda i: {"L0": 0.1, "L1": 0.2, "L2": 0.4, "L3": 0.5, "L4": 0.9 - 0.005 * i, "L5": 0.3},
    )
    predictions = [pred_row(f"d{i}", "L3", "L1", "L0", "L3") for i in range(10)]
    predictions += [
        pred_row(f"e{i}", "L2", "L2", "L5" if i < 6 else "L2", "L2") for i in range(8)
    ]
    predictions += [pred_row("nd", "L0", "L0", "L0", "L5", derivable=False)]
    gradient = [grad_row("A", "L2", 2.0 + 0.4 * i, 2.0, 0.95 - 0.05 * i) for i in range(12)]
    meta = {"k_anchors": 61, "levels_reliable": {lvl: True for lvl in LEVELS}}
    return scores, predictions, gradient, meta


class TestAnalyzeEndToEnd:
    def test_full_pipeline_decision_row1(self):
        scores, predictions, gradient, meta = full_synthetic_inputs()
        result = run_analysis(scores, predictions, gradient, meta, n_bootstrap=200, seed=3)
        assert result["a1"]["pass"] is True
        assert result["a2"]["A"]["argmax_level"] == "L2"
        assert result["a2"]["B"]["argmax_level"] == "L3"  # L4 normalized
        assert result["a2"]["pass"] is True
        assert result["a3"]["pass"] is True
        assert result["b1"]["pass"] is True
        assert result["b2"]["pass"] is True
        assert result["b3"]["pass"] is True
        assert result["decision"]["row"] == 1

    def test_meta_gate_overrides_to_row5(self):
        scores, predictions, gradient, _ = full_synthetic_inputs()
        result = run_analysis(
            scores, predictions, gradient, {"k_anchors": 30}, n_bootstrap=50, seed=3
        )
        assert result["decision"]["row"] == 5


class TestMainCli:
    def test_cli_csv_and_json_inputs(self, tmp_path):
        scores, predictions, gradient, meta = full_synthetic_inputs()

        scores_csv = tmp_path / "scores.csv"
        with open(scores_csv, "w", encoding="utf-8") as fh:
            fh.write("task_id,task_class,level,score\n")
            for r in scores:
                fh.write(f"{r['task_id']},{r['task_class']},{r['level']},{r['score']}\n")

        preds_csv = tmp_path / "predictions.csv"
        with open(preds_csv, "w", encoding="utf-8") as fh:
            fh.write("task_id,derivable,p_git,h0,p_random,p_oracle\n")
            for r in predictions:
                fh.write(
                    f"{r['task_id']},{str(r['derivable']).lower()},"
                    f"{r['p_git']},{r['h0']},{r['p_random']},{r['p_oracle']}\n"
                )

        gradient_json = tmp_path / "gradient.json"
        gradient_json.write_text(json.dumps(gradient), encoding="utf-8")
        meta_json = tmp_path / "meta.json"
        meta_json.write_text(json.dumps(meta), encoding="utf-8")
        out = tmp_path / "result.json"

        rc = analyze.main(
            [
                str(scores_csv), str(preds_csv), str(gradient_json),
                "--meta", str(meta_json),
                "-o", str(out),
                "--seed", "3", "--n-bootstrap", "100",
            ]
        )
        assert rc == 0
        result = json.loads(out.read_text(encoding="utf-8"))
        assert result["decision"]["row"] == 1
        assert result["b2"]["mcnemar_vs_h0"]["method"] == "exact_binomial"
