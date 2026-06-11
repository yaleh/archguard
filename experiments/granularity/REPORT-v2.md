# Granularity Experiment v2.2 — Final Report

**Experiment ID**: granularity-v2  
**Plan**: docs/plans/plan-59-66-intrinsic-dimension-granularity-experiment.md  
**Pre-registration freeze**: commit ab8b30b (Phase 59-64)  
**Predictions freeze**: commit 64b1e53 + artifacts/predictions/predictions-v2-20260611T142416Z.json  
**Analysis scripts**: commit c05659b (Phase 71-72)  

---

## 1. Overview

This experiment tests whether intrinsic dimension (TwoNN, Facco-Laio 2017) measured on two sensor types can predict the optimal representation granularity for LLM architecture understanding tasks.

**Hypothesis H₀**: The level at which task-matched intrinsic dimension d(L) is closest to task complexity d_task yields the highest LLM accuracy.

**Task set**: 68 tasks (A=25 factual extraction, B=22 relational structure, C=21 cross-component synthesis)  
**Levels**: L0 (file list) → L1 (package) → L2 (class) → L3 (method) → L4 (reduced JSON) → L5 (source)  
**Models**: claude-sonnet-4-6, deepseek-v4-flash  
**k=5** repetitions per (task × level × model)

---

## 2. Sensors

| Sensor | Method | Status |
|--------|--------|--------|
| S-lm-real | qwen3-embedding:4b TwoNN | ACTIVE (2/2 sensors gate: PASSED) |
| S-struct | node2vec TwoNN | ACTIVE |
| S-code | code-embedding TwoNN | UNAVAILABLE (D-70.2: service offline) |

**Phase 0 gate result**: `PROCEED_FULL_B_SERIES` (both sensors separate; details in dim-phase0.json)

### S-lm-real dimensions by level

| Level | TwoNN d | Reliable |
|-------|---------|---------|
| L0 | 12.40 | ✓ |
| L1 | 9.54 | ✓ |
| L2 | 8.69 | ✓ |
| L3 | 12.16 | ✓ |
| L4 | 12.38 | ✓ |
| L5 | 10.05 | ✓ |

### S-struct dimensions by level

| Level | TwoNN d | Note |
|-------|---------|------|
| L0 | not_estimable | No graph structure |
| L1 | 32.79 | Package/class graph |
| L2 | 32.79 | (same as L1) |
| L3 | 2.72 | Method graph (low dim) |
| L4 | 2.72 | (same as L3) |
| L5 | 2.72 | (same as L3) |

---

## 3. Pre-registered Predictions

**Frozen at**: 2026-06-11T14:24:16Z

| Predictor | Basis | Distribution |
|-----------|-------|-------------|
| H₀ | d_task nearest d(L) | L0:1 L1:16 L2:29 L3:22 |
| P_GIT-sem | S-lm-real argmin |d(L)-d_task| | L0: ALL 68 tasks |
| P_GIT-struct | S-struct argmin |d(L)-d_task| | L1: ALL 68 tasks |
| P_random | Uniform random over derivable levels | — |

**Note**: Both P_GIT-sem and P_GIT-struct are degenerate (constant), which limits B-series discriminative power. This is a pre-registered deviation (D-65.3, D-65.4).

---

## 4. Deviations Log

| ID | Stage | Description | Resolution |
|----|-------|-------------|------------|
| D-70.2 | 70 | S-code service offline; cannot compute code embedding sensor | Two-sensor design: S-lm-real + S-struct only |
| D-71.2 | 71 | deepseek-v4-flash empty content with max_tokens=1024 at L3-L5 (reasoning exhausts budget) | Increased max_tokens=8192; 19 files deleted and rerun; 1 additional instance at max_tokens=8192 accepted as parse_error (k=4/5 votes usable) |

---

## 5. Experiment A Results

*(Populated by analyze_v2.py Stage 72.1)*

### A1: Best intermediate level vs L5 (Wilcoxon signed-rank)
<!-- AUTO-FILL from analysis-v2.json: a1 -->

### A2: Mean accuracy peaks at non-endpoint level
<!-- AUTO-FILL from analysis-v2.json: a2 -->

### A3: B+C tasks peak at finer granularity than A tasks (bootstrap CI)
<!-- AUTO-FILL from analysis-v2.json: a3 -->

---

## 6. Experiment B Results (B-series, BH-FDR q=0.05)

*(Populated by analyze_v2.py Stage 72.1)*

| Test | Description | p-value | FDR reject | Pass |
|------|-------------|---------|------------|------|
| B1a | H₀ > P_random (McNemar) | AUTO | — | — |
| B1b | H₀ > P_GIT-sem (McNemar) | AUTO | — | — |
| B2a | P_GIT-sem > P_random on discriminative subset | AUTO | — | — |
| B2b | P_GIT-struct > P_random on discriminative subset | AUTO | — | — |
| B2c | P_GIT-sem > P_GIT-struct (McNemar) | AUTO | — | — |
| B3 | Spearman ρ(|d(L)-d_task|, accuracy) < 0 | AUTO | — | — |
| B4 | L3 vs L4 format sensitivity (Wilcoxon) | AUTO | — | — |

<!-- AUTO-FILL from analysis-v2.json: b_series -->

---

## 7. §10 Decision Table Outcome

*(Populated by analyze_v2.py)*

<!-- AUTO-FILL from analysis-v2.json: decision -->

---

## 8. Post-hoc Diagnostics

### Linear Probe (P_probe) — Stage 72.2

*(Post-hoc, NOT used in §10 decision table)*

<!-- AUTO-FILL from p-probe-v2.json -->

---

## 9. P_oracle Distribution

*(From score.ts --oracle-out)*

<!-- AUTO-FILL from p-oracle-v2.json: histogram by level -->

---

## 10. Conclusion

<!-- AUTO-FILL after analysis completes -->

---

## Appendix: Raw Outputs

- `artifacts/runs-v2/scores-v2.json` — (task × level × model) score table
- `artifacts/runs-v2/p-oracle-v2.json` — per-task optimal level
- `artifacts/runs-v2/analysis-v2.json` — full statistical analysis
- `artifacts/runs-v2/p-probe-v2.json` — linear probe diagnostic
- `artifacts/predictions/predictions-v2-20260611T142416Z.json` — frozen predictions
- `artifacts/embeddings/dim-lm-real-results.json` — S-lm-real TwoNN results
- `artifacts/embeddings/dim-struct-results.json` — S-struct TwoNN results
