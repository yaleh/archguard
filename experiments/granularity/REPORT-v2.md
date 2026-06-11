# Granularity Experiment v2.2 — Final Report

**Experiment ID**: granularity-v2  
**Plan**: docs/plans/plan-59-66-intrinsic-dimension-granularity-experiment.md  
**Pre-registration freeze**: commit ab8b30b (Phase 59-64)  
**Predictions freeze**: 2026-06-11T14:24:16Z · artifacts/predictions/predictions-v2-20260611T142416Z.json  
**Analysis scripts**: commit c05659b (Phase 71-72)  
**Run completed**: 2026-06-11 18:14 UTC · 2640 calls (68 tasks × levels × 2 models × k=5)

---

## 1. Hypothesis

**H₀**: The level at which intrinsic dimension d(L) is closest to task complexity d_task yields the highest LLM accuracy.

Operationalised via two sensor types (S-lm-real, S-struct) that estimate d(L) at each granularity level. A third sensor (S-code) was unavailable (deviation D-70.2).

---

## 2. Experiment Design

| Dimension | Value |
|-----------|-------|
| Tasks | 68 (A=25 factual extraction, B=22 relational structure, C=21 cross-component synthesis) |
| Levels | L0 file-list · L1 package · L2 class · L3 method · L4 reduced JSON · L5 source |
| Models | claude-sonnet-4-6, deepseek-v4-flash |
| Repetitions | k=5 per (task × level × model) |
| Scoring | Set → median-F1; categorical exact → majority-EM; numeric → median-EM |

---

## 3. Sensors & Phase 0 Gate

| Sensor | Method | Verdict |
|--------|--------|---------|
| S-lm-real | qwen3-embedding:4b TwoNN | Separates levels → ACTIVE |
| S-struct | node2vec TwoNN | Separates levels → ACTIVE |
| S-code | code-embedding TwoNN | UNAVAILABLE (D-70.2) |

**Phase 0 gate**: PROCEED_FULL_B_SERIES (2/2 sensors separate; see dim-phase0.json)

### S-lm-real dimensions (reliable at all levels)

| L0 | L1 | L2 | L3 | L4 | L5 |
|----|----|----|----|----|-----|
| 12.40 | 9.54 | 8.69 | 12.16 | 12.38 | 10.05 |

### S-struct dimensions

| L0 | L1 | L2 | L3 | L4 | L5 |
|----|----|----|----|----|-----|
| N/E | 32.79 | 32.79 | 2.72 | 2.72 | 2.72 |

---

## 4. Pre-registered Predictions (frozen)

| Predictor | Basis | Distribution across 68 tasks |
|-----------|-------|------------------------------|
| H₀ | Nearest d(L) to d_task (domain heuristic) | L0:1 L1:16 L2:29 L3:22 |
| P_GIT-sem | S-lm-real argmin \|d(L)−d_task\| | **L0: all 68** (degenerate) |
| P_GIT-struct | S-struct argmin \|d(L)−d_task\| | **L1: all 68** (degenerate) |
| P_random | Uniform over derivable levels | — |

Both GIT predictors are degenerate constants (logged as D-65.3, D-65.4). This limits B-series discriminative power.

---

## 5. P_oracle (empirical optimum, post-hoc)

The level with the highest mean score per task, with L4→L3 normalisation (same information, different format):

| Level | A-class (25) | B-class (22) | C-class (21) |
|-------|:---:|:---:|:---:|
| L0 | 0 | 0 | 0 |
| L1 | **13** | 0 | 0 |
| L2 | 4 | 0 | 2 |
| L3 | 5 | **18** | **19** |
| L4 | 0 | 0 | 0 |
| L5 | 3 | 4 | 0 |

**Finding**: Task class is a strong predictor of optimal granularity. B+C (relational/synthesis) tasks peak at L3 (method level). A (factual extraction) tasks peak at L1 (package level), with meaningful spread across L1-L3.

---

## 6. Experiment A

### A1: Best intermediate level beats L5 (Wilcoxon signed-rank, one-sided, α=0.05)

| Class | Best-mid | Δ (mid−L5) | p-value | Effect ≥0.1 | Pass |
|-------|----------|------------|---------|------------|------|
| A | L4 | 0.064 | 0.265 | ✗ | ✗ |
| B | L4 | **0.128** | **0.018** | ✓ | ✓ |
| C | L4 | 0.086 | 0.003 | ✗ | ✗ |
| **Overall** | | | | | **✓** (B-class drives pass) |

B-class tasks benefit significantly from intermediate representation over raw source. A-class and C-class do not meet the pre-registered effect threshold (Δ ≥ 0.1).

### A2: Mean accuracy peaks at non-endpoint level

| Class | Argmax level | Non-endpoint | Pass |
|-------|-------------|-------------|------|
| A | **L0** | ✗ (endpoint) | ✗ |
| B | L3 | ✓ | ✓ |
| C | L3 | ✓ | ✓ |
| **Overall** | | | **✗** (A-class fails) |

A-class tasks are best served by L0 (file list) — minimal context suffices for factual extraction. B+C tasks peak at L3 (method-level mermaid).

### A3: B+C tasks peak at finer granularity than A tasks (bootstrap CI, n=1000)

- Observed ordinal difference: **+3 levels** (B+C vs A argmax)
- 95% bootstrap CI: [−2, +3]
- **Pass: ✗** (CI includes 0)

The point estimate is in the expected direction but the CI is too wide for the pre-registered threshold (CI_low > 0).

---

## 7. Experiment B (B-series, BH-FDR q=0.05, 7 tests)

### Hit rates

| Predictor | Hit rate |
|-----------|---------|
| H₀ (domain heuristic) | **54.4%** |
| P_random | 47.1% |
| P_GIT-struct | 19.1% |
| P_GIT-sem | **0.0%** |

**Key observation**: P_GIT-sem (L0 for all tasks) predicts wrong for every task. P_random at 47% dramatically outperforms the GIT predictor. H₀ at 54% is the best predictor of the four.

### B-series results

| Test | Description | p-value | FDR-reject | Interpretation |
|------|-------------|---------|-----------|----------------|
| B1a | P_GIT-sem vs P_random | 4.66×10⁻¹⁰ | ✗ | P_random **beats** P_GIT-sem (wrong direction) |
| B1b | P_GIT-struct vs P_GIT-sem | 2.44×10⁻⁴ | **✓** | P_GIT-struct better (19% vs 0%, b=13, c=0) |
| B2a | P_GIT-sem vs H₀ on disc. subset (n=31) | 1.0 | ✗ | Tied at 0% on hard subset |
| B2b | P_GIT-struct vs H₀ on disc. subset | 1.0 | ✗ | Tied at 0% on hard subset |
| B2c | P_GIT-sem vs P_GIT-struct | 2.44×10⁻⁴ | ✗ | P_GIT-struct better but FDR-corrected insignificant |
| B3 | Spearman ρ(dim-distance, accuracy) | 1.0 | ✗ | ρ=**+0.32** (positive, opposite direction) |
| B4 | L3 vs L4 format sensitivity | 7.61×10⁻⁸ | **✓** | L4 >> L3 (mean 0.66 vs 0.28, Δ=0.384) |

FDR-rejected (supporting GIT): B1b only (P_GIT-struct > P_GIT-sem — but this tests between two failing predictors).

B4 (format sensitivity, informational): **L4 significantly outperforms L3** despite representing the same architectural information. Compressed JSON (L4) is far more accessible to LLMs than method-level mermaid (L3) for the same task. This is the most actionable finding.

### B3 note
ρ = +0.32 (positive). The GIT hypothesis predicts ρ < 0 (smaller dimension gap → higher accuracy). The observed positive correlation suggests that tasks where the model dimension is *further* from the probe dimension actually score higher — the opposite of the mechanism. This may reflect that S-lm-real dimension is insensitive to task-specific information content.

---

## 8. §10 Decision Table

**Inputs**: B2a_pass=False, B2b_pass=False, B3_pass=False, B1a_pass=False  
**Discriminative subset size**: 31 (≥8 threshold ✓)  
**K-anchors**: 102 (≥50 threshold ✓)  
**S-lm-real reliability**: all 6 levels reliable ✓

| Condition | Status |
|-----------|--------|
| Phase 0 gate | PROCEED_FULL_B_SERIES |
| Power check (disc. subset ≥8, k≥50) | ✓ sufficient |
| B2a AND B2b AND B3 | ✗ |
| B2a OR B2b | ✗ |
| B1a | ✗ |

**Outcome: Row 6 — git_rejected**

> "B1/B2均不成立：GIT预测性否定，如实报告"

The intrinsic dimension matching hypothesis (GIT) is rejected. TwoNN-based dimension sensors do not predict optimal representation granularity for LLM architecture understanding tasks.

---

## 9. Post-hoc Diagnostics

### Linear probe (P_probe)

Skipped: embedding files store anonymous level-level arrays (for TwoNN), not per-task embeddings keyed by task_id. No matching possible against p-oracle-v2.json.

This diagnostic was flagged IS_POST_HOC=True and is not part of the §10 decision.

---

## 10. Deviations Log

| ID | Stage | Description | Resolution |
|----|-------|-------------|------------|
| D-65.3 | 65 | P_GIT-sem degenerate: L0 for all 68 tasks | Logged pre-experiment; limits B2a discriminative power |
| D-65.4 | 65 | P_GIT-struct degenerate: L1 for all 68 tasks | Logged pre-experiment; limits B2b discriminative power |
| D-70.2 | 70 | S-code service offline | Two-sensor design: S-lm-real + S-struct only |
| D-71.2 | 71 | deepseek-v4-flash empty content with max_tokens=1024 at L3-L5 (extended thinking exhausts budget) | Increased max_tokens=8192; 19 files deleted and rerun; 1 additional instance at 8192 accepted as parse_error (k=4/5 usable) |
| D-72.1 | 72 | B3 ρ=+0.32 (positive, opposite direction from hypothesis) | Reported as is; constitutes negative evidence |

---

## 11. Conclusion

### What we found

1. **GIT hypothesis rejected** (Row 6): Intrinsic dimension matching via TwoNN sensors does not predict optimal granularity.

2. **P_GIT-sem fails completely** (0% hit rate): Predicting L0 for all tasks is the worst possible strategy for most tasks, especially B+C.

3. **H₀ outperforms all GIT predictors** (54% vs 19% for P_GIT-struct): The domain-based heuristic (nearest-level to d_task) is a better predictor than the geometry-based sensors.

4. **Task class predicts optimal granularity** (post-hoc, strong signal):
   - A tasks (factual extraction) → L1 optimal (package level)
   - B+C tasks (relational/synthesis) → L3 optimal (method level)

5. **Format matters enormously** (B4, p=7.6×10⁻⁸): L4 (compact JSON) scores 38 points higher than L3 (method-level mermaid), despite representing the same structural information. LLMs process compact JSON representation far better than mermaid diagrams for architectural tasks.

6. **B-class benefits from abstraction** (A1-B: Δ=12.8%, p=0.018): For relational tasks, method-level intermediate representation significantly beats raw source. No such benefit observed for A-class or C-class.

### What this means for ArchGuard

- For **factual extraction tasks** (e.g. "list packages"), package-level output (L1) is optimal — more detail is noise.
- For **relational and synthesis tasks** (e.g. "find callers", "trace cross-component paths"), method-level (L3) is optimal — but compact JSON format (L4) is dramatically more effective than mermaid.
- **Intrinsic dimension** (TwoNN) is not a reliable signal for granularity selection with current sensor designs. The geometric structure of embedding space does not track task-relevant information content.

### Open questions

1. Why does S-lm-real TwoNN assign d=12.4 to L0 (barely any information)? The TwoNN estimate may be dominated by embedding model artifacts rather than content geometry.
2. Can a classifier trained on task *type* (factual/relational/synthesis) route to the correct level? The P_oracle distribution is strongly class-structured, suggesting this is feasible.
3. Why does compact JSON (L4) dominate mermaid (L3)? Hypothesis: mermaid syntax adds parsing overhead; JSON aligns with LLM pre-training distribution.

---

## Appendix

### Raw outputs

- `artifacts/runs-v2/scores-v2.json` — 528 (task × level × model) score rows
- `artifacts/runs-v2/p-oracle-v2.json` — 68 per-task optimal levels
- `artifacts/runs-v2/analysis-v2.json` — full statistical analysis
- `artifacts/runs-v2/p-probe-v2.json` — linear probe diagnostic (skipped)
- `artifacts/predictions/predictions-v2-20260611T142416Z.json` — frozen predictions
- `artifacts/embeddings/dim-lm-real-results.json` — S-lm-real TwoNN per level
- `artifacts/embeddings/dim-struct-results.json` — S-struct TwoNN per level
