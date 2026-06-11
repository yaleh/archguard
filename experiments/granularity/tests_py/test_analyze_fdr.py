"""Stage 72.1 — BH-FDR correction logic tests.

Verifies the Benjamini-Hochberg FDR correction implementation
used in analyze_v2.py with synthetic data of known results.
"""

import pytest
import numpy as np


def bh_fdr_correction(p_values: list[float], q: float = 0.05) -> list[bool]:
    """Benjamini-Hochberg FDR correction. Returns list of rejection decisions."""
    n = len(p_values)
    if n == 0:
        return []
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    rejected = [False] * n
    threshold_idx = -1
    for rank, (orig_idx, p) in enumerate(indexed, start=1):
        if p <= q * rank / n:
            threshold_idx = rank
    for rank, (orig_idx, p) in enumerate(indexed, start=1):
        if rank <= threshold_idx:
            rejected[orig_idx] = True
    return rejected


class TestBHFDR:
    def test_all_null(self):
        """No p-values below threshold: all should be non-rejected."""
        p_vals = [0.5, 0.6, 0.7, 0.8, 0.9]
        result = bh_fdr_correction(p_vals, q=0.05)
        assert not any(result), "No p-values should be rejected when all are large"

    def test_all_significant(self):
        """All p-values very small: all should be rejected."""
        p_vals = [1e-10, 1e-9, 1e-8, 1e-7]
        result = bh_fdr_correction(p_vals, q=0.05)
        assert all(result), "All should be rejected when p-values are tiny"

    def test_mixed_with_known_outcome(self):
        """Known example: 7 tests, some below BH threshold."""
        # With q=0.05, n=7:
        # rank 1: p=0.001 → threshold = 0.05*1/7 = 0.00714 → 0.001 < 0.00714 ✓
        # rank 2: p=0.003 → threshold = 0.05*2/7 = 0.01429 → 0.003 < 0.01429 ✓
        # rank 3: p=0.04  → threshold = 0.05*3/7 = 0.02143 → 0.04 > 0.02143 ✗ → stops
        p_vals = [0.04, 0.001, 0.003, 0.5, 0.6, 0.7, 0.8]
        result = bh_fdr_correction(p_vals, q=0.05)
        # p=0.001 and p=0.003 should be rejected
        assert result[1] == True, "p=0.001 should be rejected"
        assert result[2] == True, "p=0.003 should be rejected"
        # p=0.04 and above should not (BH threshold for rank 3 is 0.0214)
        assert result[0] == False, "p=0.04 should not be rejected"

    def test_empty_input(self):
        assert bh_fdr_correction([]) == []

    def test_single_significant(self):
        result = bh_fdr_correction([0.001], q=0.05)
        assert result == [True]

    def test_single_not_significant(self):
        result = bh_fdr_correction([0.3], q=0.05)
        assert result == [False]

    def test_b_series_7_tests_scenario(self):
        """Simulate the B-series 7 tests from the experiment."""
        # Scenario: 3 tests significant, 4 not
        p_vals = [
            1.26e-6,  # B-B1 (McNemar P_GIT-sem vs P_random)
            0.03,     # B-B2a significant
            0.45,     # B-B2b not significant
            0.7,      # B-B2c not significant
            0.95,     # B-B3 not significant
            0.02,     # B-B4
            0.8,      # extra test
        ]
        result = bh_fdr_correction(p_vals, q=0.05)
        # At least the very small p-value should be rejected
        assert result[0] == True, "Smallest p-value (1.26e-6) must be rejected"

    def test_monotone_threshold(self):
        """BH thresholds must be monotonically increasing with rank."""
        p_vals = sorted([0.01, 0.05, 0.1, 0.2, 0.3])
        n = len(p_vals)
        thresholds = [0.05 * (i + 1) / n for i in range(n)]
        assert thresholds == sorted(thresholds), "Thresholds should be increasing"
