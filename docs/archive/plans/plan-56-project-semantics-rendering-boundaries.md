# Plan 56 — Project Semantics Rendering Boundaries

> Proposal: `docs/proposals/proposal-project-semantics-rendering-boundaries.md`
> Status: Draft
> Priority: HIGH
> Test strategy: TDD per stage, plus real-project validation and architect review at each phase boundary

---

## Overview

This plan fixes the confirmed Mermaid rendering defect where `architecturalLayers` can create a false extra hierarchy level when the semantic layer label matches the real root package/module name.

The defect is currently confirmed in the TypeScript module graph renderer used by the ArchGuard repository’s package overview output. The plan also protects the package-level Mermaid generator so that the rendering boundary stays aligned across both `architecturalLayers` consumers.

After this plan:

- TypeScript module graph Mermaid output will still honor `architecturalLayers`
- same-name layer/root collisions such as `src/cli -> cli` will no longer render a misleading nested `cli` inside `cli`
- package-level Mermaid rendering in `src/mermaid/generator.ts` will remain stable and regression-protected
- analysis consumers of `nonProductionPatterns`, `barrelFiles`, `suggestedDepth`, `additionalTestPatterns`, and `customAssertionPatterns` will remain unchanged

---

## Phase 1 — Reproduce and pin the rendering boundary defect

**Objective**

Add failing tests that describe the exact boundary we want: semantic layer grouping must not invent an extra same-name hierarchy level.

**Dependencies**

- approved proposal

### Stage 1.1 — Add a failing unit test for same-name collisions in the TS module graph renderer

**Files**

- `tests/unit/mermaid/ts-module-graph-renderer.test.ts`
- `src/mermaid/ts-module-graph-renderer.ts`

**TDD**

Write a failing test first for a graph with:

- `analysis`
- `analysis/fim`
- `cli`
- `cli/analyze`

and `architecturalLayers`:

- `src/analysis -> analysis`
- `src/cli -> cli`

The test must assert:

1. `subgraph layer_analysis["analysis"]` exists
2. `subgraph layer_cli["cli"]` exists
3. `subgraph analysis_group["analysis"]` is absent
4. `subgraph cli_group["cli"]` is absent
5. `analysis["analysis"]` and `cli["cli"]` remain present
6. nested real children such as `analysis/fim` and `cli/analyze` remain present

**Acceptance criteria**

- the new test fails before implementation
- the failure is structural, not just snapshot noise

### Stage 1.2 — Add a package-level generator regression test

**Files**

- `tests/unit/mermaid/generator.test.ts`
- `src/mermaid/generator.ts`

**TDD**

Add a focused test that proves `ValidatedMermaidGenerator` still groups layered package nodes correctly for non-conflicting labels, for example:

- `src/domain -> Domain`
- `src/infra -> Infrastructure`

The intent is not to change package-level rendering semantics now, but to pin the boundary so the TS module graph fix does not accidentally broaden into unrelated package-level behavior changes.

**Acceptance criteria**

- the existing package-level layering behavior is explicitly covered
- no package-level behavior change is required to satisfy the defect reproduction

### Phase 1 acceptance criteria

- a failing TS module graph regression test exists for same-name layer/root collisions
- a package-level regression test exists to guard current non-conflicting layered rendering behavior
- the failure points to the renderer boundary described in the proposal

### Phase 1 validation

- run only the affected unit test files
- confirm at least one new TS module graph assertion fails before implementation

### Phase 1 architect check

Review from a strict architect perspective and confirm:

- the tests encode a renderer-boundary defect, not a schema or discovery defect
- the package-level regression test protects current behavior without inventing new requirements

---

## Phase 2 — Implement the TS module graph collision collapse

**Objective**

Change `renderTsModuleGraph()` so same-name layer/root collisions collapse the redundant wrapper while preserving semantic grouping and real nested structure.

**Dependencies**

- Phase 1

### Stage 2.1 — Implement minimal renderer changes to satisfy the failing test

**Files**

- `src/mermaid/ts-module-graph-renderer.ts`

**Implementation constraints**

- preserve current behavior when `architecturalLayers` is absent
- preserve current behavior when `layer label !== root label`
- only collapse the redundant wrapper when the matched root label equals the layer label
- keep existing edge rendering, cycle styling, legend behavior, and external dependency grouping intact

**Acceptance criteria**

- the new same-name collision unit test passes
- pre-existing TS module graph tests still pass
- no package-level generator test is broken

### Stage 2.2 — Verify the real ArchGuard repository output

**Validation**

After rebuilding the CLI from current `src/`, run analysis against the real repository to generate:

- `.archguard/output/src/overview/package.mmd`

Confirm:

1. `subgraph layer_cli["cli"]` exists
2. `subgraph cli_group["cli"]` does not exist
3. `subgraph layer_analysis["analysis"]` exists
4. `subgraph analysis_group["analysis"]` does not exist
5. unmatched groups such as `core_group`, `plugins_group`, and `types_group` still render

**Acceptance criteria**

- the real repository output reflects the intended collapse behavior
- the output still carries the discovered semantics rather than hiding them
- the validation uses freshly built runtime code rather than stale `dist/` artifacts

### Phase 2 acceptance criteria

- the confirmed module graph defect is fixed
- real-project Mermaid output is no longer misleading for same-name collisions
- no existing TS module graph or package generator regressions are introduced

### Phase 2 architect check

Review from a strict architect perspective and confirm:

- the implementation preserves `architecturalLayers` as semantic grouping
- no extra hierarchy is fabricated
- the fix is localized to rendering behavior and does not weaken semantics consumers elsewhere

---

## Phase 3 — Regression protection and final system validation

**Objective**

Prove the change is complete at repository scale and does not spill into unrelated semantics consumers.

**Dependencies**

- Phase 2

### Stage 3.1 — Validate analysis consumers remain unchanged

**Files / areas**

- `src/analysis/test-analyzer.ts`
- `src/analysis/fim/fim-analysis.ts`
- existing tests covering project semantics loading and sidecar behavior

**Validation**

Run targeted tests to confirm:

1. sidecar `architecturalLayers` still reach Mermaid rendering
2. project semantics schema/loading behavior is unchanged
3. FIM and test-analysis semantics-related tests still pass

**Acceptance criteria**

- no regression appears in sidecar integration tests
- no regression appears in project semantics loading/typing tests

### Stage 3.2 — Final build and full verification sweep

**Validation**

Run:

- targeted Mermaid and project semantics unit/integration tests
- `npm run build`
- rebuilt CLI real-project analysis for `.archguard/output/src/overview/package.mmd`

If targeted validation exposes broader regressions, expand to the minimum additional test set needed before declaring the phase complete.

**Acceptance criteria**

- build succeeds
- targeted validation succeeds
- generated real-project `package.mmd` remains architecturally readable

### Phase 3 architect check

Review against the proposal and confirm:

- the implemented behavior matches the documented boundary
- the change did not silently redefine the meaning of discovered knowledge
- the repository can keep using natural labels like `cli` and `analysis` without diagram ambiguity

---

## Final Acceptance Criteria

This plan is complete when all of the following are true:

- a TDD-first regression test captures same-name layer/root collisions in `renderTsModuleGraph()`
- the TS module graph renderer collapses redundant same-name root wrappers while preserving layer grouping
- package-level generator behavior remains covered and unchanged for non-conflicting labels
- real ArchGuard repository output in `.archguard/output/src/overview/package.mmd` no longer shows duplicate `analysis` or `cli` hierarchy introduced by rendering
- targeted project semantics tests and Mermaid tests pass
- `npm run build` passes

---

## Verification Commands

```bash
npx vitest run tests/unit/mermaid/ts-module-graph-renderer.test.ts tests/unit/mermaid/generator.test.ts
npx vitest run tests/integration/project-semantics-sidecar.test.ts tests/unit/analysis/project-semantics-loader.test.ts tests/unit/types/project-semantics.test.ts
npm run build
node dist/cli/index.js analyze -s src --lang typescript -f mermaid --work-dir ./.archguard --output-dir ./.archguard/output
```
