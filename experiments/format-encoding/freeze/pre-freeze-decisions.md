# Pre-Freeze Decisions — Format-Encoding Experiment (Plan 73-81, Proposal v1.1)

Date frozen: 2026-06-12

---

## Q1 — Experiment Scale Decision

**Decision: TRIMMED configuration (not full 13,328 calls).**

Trimmed scope:
- Remove parse-check subtasks (−1,088 calls)
- Reduce rewrite k from 5 to 3 (−816 calls)
- Skip raw source code reference track (−680 calls)

Adjusted total: ~10,744 calls minimum (2 models)

Rationale: Budget constraint; main-set Exp1 + Exp2 core preserved; rewrite variance still measurable with k=3.

---

## Q2 — Perplexity Covariate Decision

**Decision: Option B — DROP perplexity covariate entirely, use pure structural metrics.**

Justification: Both main answer models (claude-haiku-4-5-20251001, glm-4.5-flash) lack logprob API. H-attribution regression equation changes to:

```
accuracy ~ parsing_burden + tokens + local_density_distribution + task_type
```

"Perplexity coefficient" prediction downgrades to exploratory.

---

## Q3 — Task Leakage Decision

**Decision: Option B — Mix in ≥20 new questions.**

New questions: 10 B-type + 10 C-type (aligned with v2.2 finding that method-level matters most for B/C tasks). Old (v2.2) and new questions reported in separate strata. If directions align, RLHF leakage hypothesis weakened.

---

## Q4 — Haskell-ADT Roundtrip

**Decision: Execute smoke test in Phase 76 roundtrip gate.**

Decision tree:
- PASS → keep in main set
- FAIL → redesign format to ensure method details (name, params[], returnType) are fully recoverable, OR move to lossy reference track and remove §3.3 H-dense contrast.

---

## Q5 — Rewrite-CleanProse Roundtrip

**Decision: Option B — Downgrade to manual sampling (10% of instances).**

Conclusion strength explicitly labeled as lower than structural rewrite arms. H-info control for this arm is approximate, reported separately.

---

## Hypothesis Mapping (H-format / H-rewrite / H-info)

| Hypothesis | Label | Experiment | Contrast |
|---|---|---|---|
| Format main effect on accuracy | H-format | Exp1 | Friedman across 8 formats |
| Flatter parse tree improves accuracy | H-parse | Exp1 | JSON-edge-list vs JSON-adjacency |
| Pretrain familiarity beats simplicity | H-pretrain | Exp1 | JSON-edge-list vs Custom-DSL (if DSL simpler) |
| Dense encoding independently effective | H-dense | Exp1 + Exp2 | Haskell-ADT vs JSON-edge-list (token-adjusted) |
| Format × task-class interaction | H-interact | Exp1 | Interaction term in mixed-effects model |
| Structural covariates predict accuracy | H-attribution | Exp1 | Regression: accuracy ~ parsing_burden + tokens + local_density_dist + task_type |
| Rewrite canonicalization improves accuracy | H-rewrite | Exp2 | rewrite arms vs deterministic-Haskell |
| Information content drives accuracy | H-info | Exp2 | rewrite-CleanProse vs baseline(NL-exhaustive) |

---

## Exp 1 Format Set

All 8 formats with operationalization details:

1. **JSON-adjacency**: nested JSON, entities with embedded methods array
2. **JSON-edge-list**: flat JSON, entities[] + relations[] as separate arrays
3. **YAML**: indented, semantically equivalent to JSON-adjacency
4. **Markdown-table**: entities table + relations table
5. **Mermaid**: classDiagram with methods and arrows
6. **Haskell-ADT**: record syntax, data declarations per entity, typed fields for relations; method signature as field `"_method_<name>: (<params>) -> <return>"`
7. **Custom-DSL**: minimal, one relation per line `"A -type-> B"`; entity declarations as `"entity A :: class @ source"`
8. **NL-exhaustive**: fixed prose template `"Entity <name> of type <type> defined in <file>. Methods: <method>(<params>) -> <return>. Relations: <name> <reltype> <target>."`

---

## NL-exhaustive Dual Role

Exp1 NL-exhaustive data = Exp2 baseline arm data (same prompt structure → not re-run).

---

## Custom-DSL "Simpler" Judgment Rule

Pre-registered: `vocabulary_size ≤ JSON-edge-list AND avg_tokens_per_relation ≤ JSON-edge-list × 0.8` → "simpler" confirmed; else label "comparable simplicity".

---

## Exp 2 Arm Design

5 arms:
1. deterministic-Haskell
2. rewrite-Haskell
3. rewrite-JSON
4. rewrite-CleanProse
5. baseline (NL-exhaustive)

---

## Rewrite Model

**Cross-family requirement**: rewrite model must differ from answer models in family.

Candidate: **qwen3-235b-a22b** (Alibaba family; answer models: Claude family + Zhipu family).

Rewrite k=3.

---

## 2×2 Cross Design

2×2: {rewrite_family: Qwen} × {answer_model: haiku, glm-4.5-flash}

Interaction test: two-way mixed-effects ANOVA interaction term `rewriter_family × answer_model`.

Judgment order: interaction first (α=0.05 BH-FDR); if significant → report per-cell; if not → merge across rewriter.

Degradation: if 2×2 not feasible → 1×2 (Qwen rewrite, both answer models); declared here, not mid-execution.

---

## Rewrite Prompt Drafts (placeholder refs)

- `freeze/rewrite-prompts/rewrite-haskell.md`
- `freeze/rewrite-prompts/rewrite-json.md`
- `freeze/rewrite-prompts/rewrite-clean-prose.md`

---

## Prior Predictions (§3.6)

| ID | Prediction | Direction | Test |
|---|---|---|---|
| H1 | Format main effect significant | Friedman p < 0.05/BH-FDR | Exp1 Friedman |
| H-parse | JSON-edge-list > JSON-adjacency | Same familiarity, flatter parse tree | Exp1 pairwise |
| H-pretrain | JSON-edge-list > Custom-DSL | Familiarity over simplicity if DSL is simpler yet loses | Exp1 pairwise (conditional on Q8 DSL-simpler confirmed) |
| H-dense | Haskell-ADT > JSON-edge-list after token adjustment | Dense encoding independently effective | Exp1 pairwise + Exp2 det-Haskell arm |
| H-interact | Format × task-class interaction significant | Mermaid/Haskell advantage concentrated in C-type tasks | Exp1 interaction term |
| H-attribution | accuracy ~ parsing_burden + tokens + local_density_dist + task_type; both parsing_burden and local_density coefficients significant | Both structural covariates predict accuracy | Exp1 regression |

---

## Decision Tables §3.8 and §4.4

### §3.8 — Exp1 Decision Outcomes

| Outcome | Condition | Action |
|---|---|---|
| H-format confirmed | Friedman p < 0.05 (BH-FDR) | Proceed to pairwise decomposition |
| H-format not confirmed | p ≥ 0.05 | Report null; check power; note n limitation |
| H-parse confirmed | JSON-edge-list > JSON-adjacency (p < 0.05) | Support flat-parse hypothesis |
| H-parse not confirmed | No significant difference | Familiarity effect dominates or ceiling/floor |
| H-pretrain testable | Custom-DSL confirmed simpler (Q8 judgment rule) | Run pairwise JSON-edge-list vs Custom-DSL |
| H-pretrain not testable | Custom-DSL not confirmed simpler | Label H-pretrain "indeterminate — DSL not simpler" |
| H-dense confirmed | Haskell-ADT > JSON-edge-list (token-adjusted, p < 0.05) | Support dense encoding hypothesis |
| H-interact confirmed | Interaction term significant (p < 0.05) | Report per-task-class breakdown |
| Haskell-ADT roundtrip FAIL | Phase 76 gate | Redesign or move to lossy track; remove §3.3 H-dense contrast |

### §4.4 — Exp2 Decision Outcomes

| Outcome | Condition | Action |
|---|---|---|
| H-rewrite confirmed | Any rewrite arm > deterministic-Haskell (p < 0.05) | Support canonicalization benefit |
| H-rewrite not confirmed | No arm beats deterministic | Rewrite overhead not worth cost |
| 2×2 interaction significant | rewriter_family × answer_model p < 0.05 | Report per-cell; do not merge |
| 2×2 interaction not significant | p ≥ 0.05 | Merge across rewriter family |
| 2×2 not feasible | API/budget failure | Fall back to 1×2 (Qwen × both answer models) |
| H-info (CleanProse) confirmed | rewrite-CleanProse > baseline (p < 0.05, manual 10% sample) | Report as exploratory; lower confidence label |
| H-info not confirmed | No difference | NL-exhaustive already near information ceiling |

---

## Power Analysis

v2.2 observed Δ=38.4% (n=68, k=5, p=7.6e-8).

For 8-format Friedman with 28 pairwise (BH-FDR q=0.05): detectable MDE ~15–20% at 80% power with n=68.

For Δ~10%: likely underpowered.

Decision: Accept current n=68+20=88 new questions, note power limitation in report.

---

## Model logprob Availability

| Model | logprob available | API |
|---|---|---|
| claude-haiku-4-5-20251001 | NO | Anthropic API |
| glm-4.5-flash | NO | Zhipu API via LiteLLM |

Consequence: H-attribution regression uses structural metrics only (Q2 Option B).

---

## Deviation Log Schema

Fields for each deviation record:

| Field | Type | Notes |
|---|---|---|
| id | string | Format: D-\<phase\>.\<seq\> (e.g. D-76.1) |
| stage | int | Phase number where deviation occurred |
| type | enum | roundtrip_fail / schema_drift / api_unavailable / model_substitution / sample_insufficient / other |
| description | string | What happened |
| impact | enum | excludes_instances / downgrades_conclusion / no_impact |
| resolution | string | How it was handled |

Initial log: empty at freeze time.
