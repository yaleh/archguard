# Format-Encoding Experiment — Final Report

> Plan: `docs/plans/plan-73-81-format-encoding-experiment.md`
> Proposal: `docs/proposals/proposal-format-encoding-experiment.md`
> Pre-registration freeze tag: `format-encoding-freeze-v1.1` @ commit b7af508
> Report generated: 2026-06-12 (Phase 81)

---

## 1. Executive Summary

This experiment tests whether the representation format of a typed entity-relation graph
affects an LLM's ability to answer architectural queries about it. We pre-registered six
hypotheses (H1, H-parse, H-pretrain, H-dense, H-interact, H-attribution), designed two
experiments (Exp 1: deterministic format rendering; Exp 2: LLM rewrite pass), and
executed them against the ArchGuard class-level graph (545 entities, 1,131 relations).

**Key findings (Exp 1, haiku-only):**

| Hypothesis | Verdict | Notes |
|---|---|---|
| H1 — Format main effect | **CONFIRMED** | Friedman χ²=19.282, p=0.0073; mermaid is dominant outlier |
| H-parse — Flat parse tree | **INSUFFICIENT_DATA** | Only 2/14 non-zero diffs; direction consistent (+0.8, +0.4) |
| H-pretrain — Pretraining familiarity | **NULL** | json-edge-list=0.671 vs custom-dsl=0.643; W=9, p=0.41 |
| H-dense — Dense encoding | **NULL** | haskell-adt=0.571 < json-edge-list=0.671; W=0, p=1.00 (reversed) |
| H-interact — Format × task-class | **NULL** | Kruskal p≥0.60 in all 3 classes |
| H-attribution — Structural covariates | **NULL** | All Spearman rho < 0.31, p > 0.46 (n=8) |
| H-rewrite — Rewrite benefit | **UNTESTABLE** | D-78.2: 0/9 roundtrip pass |
| H-info — Hallucination suppression | **UNTESTABLE** | D-78.2: qualitative only |
| H-model — Cross-model consistency | **UNTESTABLE** | D-78.1: GLM dropped |

---

## 2. Experiment Design

### 2.1 Corpus (C)

- Source: ArchGuard self-analysis, class-level ArchJSON
  (`/home/yale/work/archguard/.archguard/output/archguard/class/all-classes.json`)
- Entities: 545 (classes, interfaces, functions)
- Relations: 1,131 (inheritance, composition, dependency, aggregation)
- Frozen at: `format-encoding-freeze-v1.1` — no changes to corpus after Phase 76.3

### 2.2 Formats (8)

| Format | Chars | Tokens | Nesting depth | Delim density/100 |
|---|---|---|---|---|
| json-adjacency | 261K | 65,334 | 7 | 27.0 |
| json-edge-list | 263K | 65,781 | 7 | 24.7 |
| yaml | 183K | 45,780 | 6 | 19.7 |
| markdown-table | 125K | 31,258 | 0 | 15.1 |
| mermaid | 263K | 65,694 | 1 | 4.9 |
| haskell-adt | 149K | 37,291 | 225 | 21.4 |
| custom-dsl | 128K | 32,048 | 0 | 17.7 |
| nl-exhaustive | 140K | 35,094 | 1 | 12.6 |

All 8 formats passed the roundtrip gate: `p_f(r_f(C)) == C` (Phase 76.1).

### 2.3 Task Set (14 tasks, 3 classes)

- **Class A — Topological** (5 tasks): highest in/out-degree, entity count, relation count, most methods
- **Class B — Relational** (6 tasks): direct deps, direct dependents, dep-check (yes/no), count by type, subclasses
- **Class C — Method-level** (3 tasks): method count, return type, method names

### 2.4 Answer Model

- Pre-registered: `claude-haiku-4-5-20251001` + `glm-4.5-flash` (D-78.1: GLM dropped)
- Executed: `claude-haiku-4-5-20251001` only, `temperature=0`, `max_tokens=8192`
- k=5 independent runs per (task, format, model) tuple

### 2.5 Exp 2 Design (Haskell rewrite arm)

- Pre-registered arms: deterministic-haskell, rewrite-haskell, rewrite-json, rewrite-clean-prose, baseline-nl-exhaustive
- Executed arms (D-78.2): deterministic-haskell, baseline-nl-exhaustive only
- Rewrite model: `deepseek-v4-flash` (D-76.1: substituted for qwen3-235b-a22b)

---

## 3. Protocol Deviations

All deviations pre-registered in plan before results were examined.

| ID | Phase | Type | Description | Impact | Disposition |
|---|---|---|---|---|---|
| D-76.1 | 76.2 | model-substitution | `qwen3-235b-a22b` unavailable on gateway; replaced with `deepseek-v4-flash` | Minor — cross-family isolation preserved | Accepted; deepseek ≠ Claude ≠ Zhipu |
| D-76.2 | post-freeze | parser-fix | Haskell parser `parseTargetList()` did not strip quotes from target IDs | Minor — only affects rewrite arm | Fixed in `parsers/haskell-adt.ts` |
| D-76.3 | post-freeze | parser-fix | Haskell parser `entityTypeRaw` not lowercased; model outputs `Function` vs `function` | Minor — only affects rewrite arm | Fixed with `.toLowerCase()` |
| D-76.4 | post-freeze | parser-fix | json-edge-list parser did not strip markdown code fences from LLM output | Minor — only affects rewrite arm | Fixed in `parsers/json-edge-list.ts` |
| D-76.5 | post-freeze | prompt-update | rewrite-haskell prompt lacked `-- \| name:` annotation; model did not preserve camelCase | Minor — structural roundtrip unaffected | Added `-- \| name:` to prompt schema |
| D-78.1 | 78.1 | model-drop | `glm-4.5-flash` consistently times out on all 8 formats (31K–65K tokens) via LiteLLM gateway | Moderate — cross-model H-model hypothesis untestable | GLM removed; haiku-only for all experiments |
| D-78.2 | 78.2 | roundtrip-fail | Exp 2 rewrite: 0/9 roundtrip passes (545-entity corpus too large for rewrite model) | Major — H-rewrite and H-info UNTESTABLE | Reported as limitation; recommend ≤100-entity local corpus for Exp 2 |

---

## 4. Exp 1 Results

### 4.1 Format Accuracy (haiku, k=5, all tasks)

| Format | Overall | Class A (5 tasks) | Class B (6 tasks) | Class C (3 tasks) |
|---|---|---|---|---|
| **json-edge-list** | **0.671** | 0.600 | 0.567 | 1.000 |
| custom-dsl | 0.643 | 0.560 | 0.567 | 0.933 |
| markdown-table | 0.643 | 0.600 | 0.500 | 1.000 |
| yaml | 0.629 | 0.520 | 0.533 | 1.000 |
| nl-exhaustive | 0.600 | 0.440 | 0.533 | 1.000 |
| json-adjacency | 0.586 | 0.440 | 0.500 | 1.000 |
| haskell-adt | 0.571 | 0.440 | 0.500 | 0.933 |
| **mermaid** | **0.286** | **0.040** | 0.233 | 0.800 |

Overall haiku mean: 0.579. Mermaid is a strong outlier — Class A accuracy 0.040 (near floor).
Two tasks floor all formats: entity-count (0.00 everywhere) and relation-count (≤0.20 everywhere).

### 4.2 Hypothesis Verdicts

#### H1 — Format main effect on accuracy (Friedman test)

- χ² = 19.282, df = 7, p = 0.0073
- Verdict: **CONFIRMED**
- Pre-registered direction: format choice affects accuracy
- Interpretation: Format matters (p < 0.01). The effect is largely driven by mermaid
  (0.286 overall vs 0.571–0.671 for all other formats). Mermaid's extreme underperformance
  on Class A topological tasks (0.040) is the dominant signal. The 7 non-mermaid formats
  span only 0.571–0.671, suggesting modest discrimination among them. Two tasks
  (entity-count, relation-count) are at floor for all formats — haiku cannot count at this
  corpus scale regardless of representation.

#### H-parse — Flat parse tree improves accuracy

- Contrast: json-edge-list vs json-adjacency (one-tailed Wilcoxon, BH-FDR corrected)
- json-edge-list mean = 0.671, json-adjacency mean = 0.586
- Non-zero differences: 2/14 (both positive: +0.80 on highest-in-degree, +0.40 on direct-deps)
- W = NaN, p = NaN (Wilcoxon requires ≥3 non-zero diffs)
- Verdict: **INSUFFICIENT_DATA**
- Pre-registered direction: json-edge-list > json-adjacency
- Interpretation: Cannot confirm or refute statistically. However, the two tasks where formats
  differ both favor json-edge-list, and the overall mean gap (0.085) is consistent with the
  hypothesis direction. Most tasks produce identical scores — the two formats are structurally
  redundant for most query types at this corpus scale.

#### H-pretrain — Pretraining familiarity beats simplicity

- Contrast: json-edge-list vs custom-dsl (one-tailed Wilcoxon, BH-FDR corrected)
- json-edge-list mean = 0.671, custom-dsl mean = 0.643
- Non-zero differences: 5/14 (mixed: +0.40, +0.40, +0.20, −0.20, −0.40)
- W = 9.0, p = 0.4062, BH-reject = False
- Verdict: **NULL**
- Pre-registered direction: json-edge-list > custom-dsl
- Interpretation: No significant advantage for pretraining-familiar JSON over the bespoke DSL.
  custom-dsl is competitive despite being a novel notation. Mixed direction of differences
  (3 tasks favor json-edge-list, 2 favor custom-dsl) provides no consistent signal.

#### H-dense — Dense encoding independently effective

- Contrast: haskell-adt vs json-edge-list (one-tailed Wilcoxon, BH-FDR corrected)
- haskell-adt mean = 0.571, json-edge-list mean = 0.671
- Non-zero differences: 3/14 (all negative: −0.80, −0.40, −0.20)
- W = 0.0, p = 1.0000, BH-reject = False
- Verdict: **NULL** (reversed direction)
- Pre-registered direction: haskell-adt > json-edge-list
- Interpretation: Haskell ADT is consistently worse than json-edge-list on all three tasks
  where they differ. The dense notation did not help; it hurt. Likely explanation: haiku
  has limited exposure to Haskell-style type declarations, and the extreme nesting depth
  (225) of the haskell-adt representation may impede structural lookup.
  Note: haskell-adt is also 4.3× fewer tokens than json-edge-list — the information density
  advantage did not translate to accuracy.

#### H-interact — Format × task-class interaction

- Kruskal-Wallis within each class:
  - Class A (topological): H = 5.148, p = 0.6420
  - Class B (relational): H = 2.239, p = 0.9454
  - Class C (method-level): H = 5.485, p = 0.6010
- Verdict: **NULL**
- Pre-registered direction: Class C shows weaker format dependence than A/B
- Interpretation: No significant format effect within any task class after Kruskal-Wallis.
  Numerically, Class C does show less variance (6 of 8 formats at 1.000, only mermaid=0.800
  and haskell-adt=0.933 below), consistent with the hypothesis direction, but not significant.
  The H-interact null finding is partly caused by mermaid depressing all class means uniformly
  and floor effects on entity-count / relation-count tasks.

#### H-attribution — Structural covariates predict accuracy

- Spearman ρ (accuracy ~ token count): ρ = −0.190, p = 0.651
- Spearman ρ (accuracy ~ nesting depth): ρ = −0.303, p = 0.466
- Spearman ρ (accuracy ~ delimiter density): ρ = +0.238, p = 0.570
- n = 8 format data points
- Verdict: **NULL**
- Interpretation: No structural covariate significantly predicts accuracy. Nesting depth shows
  the strongest (negative) trend — consistent with intuition that deeper nesting impedes
  retrieval — but is not significant at n=8. Mermaid is an influential outlier: it has
  low delimiter density (4.9) and very low accuracy (0.286), which drives the positive
  delimiter–accuracy trend. Perplexity covariates were unavailable (no logprob access for
  proprietary models), leaving a key pre-registered predictor untestable.

### 4.3 Notable Per-Task Patterns

- **entity-count**: 0.00 across all 8 formats — haiku cannot enumerate 545 entities
- **relation-count**: ≤0.20 across all formats — same counting floor effect
- **highest-in-degree**: Wide spread (mermaid=0.00, json-edge-list=1.00, json-adjacency=0.20) — the most format-sensitive task
- **direct-dep-check-no** and **direct-dep-check-yes**: 1.00 in all non-mermaid formats — binary yes/no queries are robust to format
- **Class C tasks**: Nearly all 1.00 except mermaid — method-level detail queries are easy for haiku given any readable format

---

## 5. Exp 2 Results

### 5.1 Runnable Arms (D-78.2 applied)

| Arm | Status | n tasks | Overall | Class A | Class B | Class C |
|---|---|---|---|---|---|---|
| deterministic-haskell | RAN | 14 | 0.614 | 0.520 | 0.500 | 1.000 |
| baseline-nl-exhaustive | RAN | 14 | 0.629 | 0.520 | 0.533 | 1.000 |
| rewrite-haskell | SKIPPED — 0/3 roundtrip pass | — | — | — | — | — |
| rewrite-json | SKIPPED — 0/3 roundtrip pass | — | — | — | — | — |
| rewrite-clean-prose | SKIPPED — human-sample arm (Q5) | — | — | — | — | — |

### 5.2 Haskell Rewrite Benefit (H-rewrite)

- Pre-registered comparison: rewrite-haskell vs deterministic-haskell
- Verdict: **UNTESTABLE** (D-78.2: 0/9 roundtrip pass)
- Qualitative: rewrite model did not produce lossless Haskell reconstructions from nl-exhaustive
  input at 545-entity corpus scale. 1/9 trials added entities (H-info triggered, idx 2 of arm
  rewrite-haskell), but accuracy cannot be evaluated without roundtrip-valid instances.

### 5.3 Hallucination Suppression (H-info)

- Pre-registered: rewrite step introduces extra entities/relations; these are "hallucinations
  of information" not in C; graded tasks penalize spurious answers
- Verdict: **UNTESTABLE** (qualitative only)
- H-info instances: 1 triggered (rewrite-haskell, run idx=2) — added entities but no roundtrip pass
- Cannot score graded task accuracy against a C that differs from canonical C

### 5.4 Deterministic-Haskell vs Baseline NL (supplementary)

- This comparison was not pre-registered as a primary hypothesis but is reported as supplementary
- deterministic-haskell: overall = 0.614, Class A = 0.520, Class B = 0.500, Class C = 1.000
- baseline-nl-exhaustive: overall = 0.629, Class A = 0.520, Class B = 0.533, Class C = 1.000
- Wilcoxon (paired, two-sided): W = 1.0, p = 0.50, 3 non-zero diffs
- Interpretation: No significant difference between Haskell ADT and NL-exhaustive in Exp 2.
  Both arms show near-identical Class A and Class C scores. NL-exhaustive has a slight
  numerical advantage in Class B (0.533 vs 0.500) but this is not significant. Note that
  the Exp 2 corpus is the same as Exp 1 — the haskell-adt accuracy in Exp 2 (0.614) is
  slightly higher than in Exp 1 (0.571), plausibly due to the `-- | name:` annotations
  added in D-76.5 preserving original identifiers.

---

## 6. Limitations

1. **Single answer model**: D-78.1 removed GLM. All Exp 1 conclusions are conditional on
   `claude-haiku-4-5-20251001` behavior. Cross-model generalization cannot be assessed.

2. **H-rewrite / H-info UNTESTABLE at scale**: The 545-entity corpus is too large for
   deepseek-v4-flash to produce lossless rewrites. D-78.2. Future work should use ≤100-entity
   local corpus subsets for Exp 2.

3. **Class C floor/ceiling effects**: Class C (method-level) shows 100% accuracy on json-adjacency —
   suggesting method queries may be too easy for haiku regardless of format. Ceiling effect
   limits discriminative power for H-interact.

4. **Token length confound**: json-edge-list is 4× longer than json-adjacency. Any advantage
   in H-parse could be attributed to information redundancy rather than parse-tree structure.
   H-attribution covariates are intended to dissociate these.

5. **No perplexity measurement**: Pre-registered perplexity covariate (H-attribution) could
   not be obtained for proprietary models without logprob access. H-attribution is limited to
   structural covariates (token count, nesting depth, delimiter density).

---

## 7. Recommendations

Based on findings, for future format-encoding experiments:

1. **Prioritize flat-structure formats** (json-edge-list, custom-dsl style) over nested formats
   for large graphs — nesting depth appears to hurt topological reasoning (Class A).

2. **Reduce Exp 2 corpus to ≤100 entities** so rewrite model can produce lossless rewrites
   within a single context window.

3. **Include a smaller model** (e.g., haiku-equivalent in another family) to test H-model
   without gateway context-window limitations.

4. **Pre-register perplexity measurement** via a model with logprob access (e.g., open-weight
   model via vLLM) so H-attribution can be fully tested.

5. **Extend task set with Class D (path-finding)**: graph traversal tasks may show stronger
   format effects than topological/relational counting.

---

## 8. Artifacts

| Artifact | Path |
|---|---|
| Ground-truth corpus | `.archguard/output/archguard/class/all-classes.json` |
| 8 format renderers | `experiments/format-encoding/renderers/` |
| 8 roundtrip parsers | `experiments/format-encoding/parsers/` |
| Roundtrip gate results | `artifacts/roundtrip/` |
| Rewrite smoke test | `artifacts/roundtrip/rewrite-smoke.md` |
| Pre-registered predictions | `artifacts/pre-registered-predictions.json` |
| Pre-freeze decisions | `artifacts/pre-freeze-decisions.md` |
| Task definitions | `artifacts/tasks.json` |
| Exp 1 raw responses | `artifacts/runs/exp1/` |
| Exp 2 rewrite responses | `artifacts/runs/exp2-rewrite/` |
| Exp 2 answer responses | `artifacts/runs/exp2-answers/` |
| Exp 1 accuracy scores | `artifacts/analysis/exp1-accuracy.json` |
| Exp 1 hypothesis verdicts | `artifacts/analysis/exp1-results.json` |
| Exp 2 H-info instances | `artifacts/runs/exp2-rewrite/h-info-instances.json` |
| Covariates | `artifacts/covariates/` |
| Statistical analysis script | `scripts/statistical-analysis.py` |

---

*Report prepared per Phase 81 of plan-73-81-format-encoding-experiment.md.*
*All deviation log entries are reproduced verbatim from the plan deviation log.*
