# Plan 54 — Skill-First Project Semantics Integration

> Proposal: `docs/proposals/proposal-skill-first-project-semantics.md` (v2 — reviewed)
> Status: Draft
> Priority: HIGH (clarifies product boundary and removes discovery logic from runtime)
> Test strategy: TDD for each stage, target changed-lines coverage >= 80%

---

## Overview

This plan converts project semantics from an internally discovered runtime artifact into an externally authored knowledge contract.

After this plan:

- skills own knowledge discovery
- ArchGuard loads `projectSemantics` from config and/or sidecar
- ArchGuard validates, merges, and consumes semantics
- internal exploration runtime paths are deprecated and then removed

The plan intentionally preserves existing consumption points:

- `src/analysis/test-analyzer.ts`
- `src/mermaid/generator.ts`
- `src/mermaid/ts-module-graph-renderer.ts`
- `src/analysis/fim/fim-analysis.ts`

The main refactor area is the load path:

- `src/types/extensions/project-semantics.ts`
- `src/cli/config-loader.ts`
- `src/cli/analyze/run-analysis.ts`
- `src/cli/commands/analyze.ts`

---

## Phase 1 — Stabilize the authoring contract

**Objective**

Split the external authoring schema from the internal resolved type so that skills and users write a clean, minimal format.

**Dependencies**

- none

**Estimated size**

- <= 350 lines source
- <= 250 lines test

### Stage 1.1 — Introduce `ProjectSemanticsInput` schema

**Files**

- `src/types/extensions/project-semantics.ts`
- `src/types/extensions/index.ts`
- `src/types/config-global.ts`
- `tests/unit/types/project-semantics.test.ts`

**Changes**

- add an explicit `ProjectSemanticsInput` interface/schema
- keep `ProjectSemantics` as the resolved runtime type
- update merge helpers to merge `ProjectSemanticsInput` into resolved semantics
- stop treating discovery metadata as part of the stable authoring contract

**TDD**

Write failing tests first for:

1. valid `ProjectSemanticsInput` with only `architecturalLayers` and `suggestedDepth`
2. invalid path-like values fail validation with targeted messages
3. merge of config input + sidecar input + defaults produces resolved semantics
4. legacy metadata fields are either rejected or explicitly ignored per final proposal wording

**Acceptance criteria**

- changed-lines coverage >= 80%
- `npm run type-check` passes
- authoring schema is separate from resolved schema

### Stage 1.2 — Make config loading strict

**Files**

- `src/cli/config-loader.ts`
- `tests/unit/cli/config-loader.test.ts`

**Changes**

- validate `archguard.config.json.projectSemantics` against `ProjectSemanticsInput`
- fail configuration loading on malformed semantics
- ensure error messages mention `projectSemantics`

**TDD**

Write failing tests first for:

1. valid partial `projectSemantics` loads successfully
2. malformed `projectSemantics` rejects config load
3. unsafe path values reject config load

**Acceptance criteria**

- config load errors are explicit and deterministic
- existing non-semantics config tests still pass

---

## Phase 2 — Replace runtime discovery with load-only semantics resolution

**Objective**

Remove discovery orchestration from the main analysis path and replace it with a load/validate/merge flow using config + sidecar + defaults.

**Dependencies**

- Phase 1

**Estimated size**

- <= 450 lines source
- <= 280 lines test

### Stage 2.1 — Add sidecar semantics loader

**Files**

- `src/analysis/project-semantics-loader.ts` (new)
- `src/cli/analyze/run-analysis.ts`
- `tests/unit/analysis/project-semantics-loader.test.ts` (new)
- `tests/unit/cli/analyze/run-analysis.test.ts`

**Changes**

- add a small loader for `.archguard/project-semantics.json`
- validate the sidecar with `ProjectSemanticsInput`
- merge sidecar semantics with config semantics and built-in defaults
- fail analysis startup if the sidecar file exists but is malformed

**TDD**

Write failing tests first for:

1. missing sidecar returns no sidecar semantics
2. valid sidecar merges into final semantics
3. malformed sidecar fails startup
4. config input overrides sidecar input

**Acceptance criteria**

- `runAnalysis` no longer performs discovery
- `runAnalysis` still injects merged semantics into test analysis and diagram generation

### Stage 2.2 — Stop using the exploration branch in runtime

**Files**

- `src/cli/analyze/run-analysis.ts`
- `tests/unit/cli/analyze/run-analysis.test.ts`

**Changes**

- remove `resolveProjectSemantics()` logic that computes hashes, reads exploration cache, or invokes explorer
- replace it with load-only resolution
- keep defaults merge behavior unchanged where applicable

**TDD**

Write failing tests first for:

1. no config + no sidecar still yields default semantics
2. sidecar semantics affect Mermaid/test/FIM consumers
3. no discovery path is invoked during runtime analysis

**Acceptance criteria**

- main runtime path no longer depends on `project-semantics-explorer.ts`
- all semantics consumers still receive merged semantics

---

## Phase 3 — Deprecate and remove discovery-oriented surface area

**Objective**

Remove product-owned discovery entry points and obsolete implementation files.

**Dependencies**

- Phase 2

**Estimated size**

- <= 400 lines source
- <= 220 lines test

### Stage 3.1 — Deprecate/remove exploration CLI flags

**Files**

- `src/cli/commands/analyze.ts`
- `tests/unit/cli/commands/analyze.test.ts`
- `README.md`
- `docs/user-guide/cli-usage.md`
- `docs/user-guide/configuration.md`

**Changes**

- remove or deprecate `--explore` and `--no-explore`
- update help text and user docs to describe skill-managed semantics instead
- keep unrelated CLI config untouched

**TDD**

Write failing tests first for:

1. analyze command help no longer advertises exploration flags, or clearly marks them deprecated
2. docs examples no longer describe runtime discovery

**Acceptance criteria**

- no supported CLI path implies built-in semantics discovery

### Stage 3.2 — Delete obsolete discovery implementation

**Files**

- `src/analysis/project-semantics-explorer.ts`
- `src/analysis/project-semantics-cache.ts`
- their associated unit tests
- any now-unused imports in runtime code

**Changes**

- remove obsolete runtime discovery implementation files
- remove dead tests
- ensure no production path imports them

**TDD**

Write failing tests first for:

1. no runtime module imports the old discovery files
2. replacement loader tests fully cover the new behavior

**Acceptance criteria**

- obsolete discovery modules are gone from the supported product path
- unit test suite remains green after deletion

---

## Phase 4 — Migration polish and end-to-end verification

**Objective**

Document the skill-first contract and prove that the remaining semantics consumption chain still works end to end.

**Dependencies**

- Phase 3

**Estimated size**

- <= 250 lines source/doc adjustments
- <= 180 lines test

### Stage 4.1 — Add migration and authoring documentation

**Files**

- `README.md`
- `docs/user-guide/configuration.md`
- `docs/user-guide/cli-usage.md`
- optional new reference doc under `docs/`

**Changes**

- document the authoritative semantics locations
- document merge priority
- document malformed semantics failure behavior
- provide a minimal example for skill-written sidecar semantics

**TDD / verification**

- doc-focused assertions where existing doc tests exist
- manual verification that examples match actual schema

**Acceptance criteria**

- user-facing docs describe ArchGuard as a semantics consumer, not a discoverer

### Stage 4.2 — End-to-end validation on real project semantics

**Files**

- `tests/integration/...` as needed
- no broad feature expansion

**Changes**

- add or update one integration test showing sidecar semantics affect:
  - Mermaid package grouping, and/or
  - test analysis pattern injection, and/or
  - FIM package filtering

**TDD**

Write failing integration test first.

**Acceptance criteria**

- at least one real consumption chain is validated end to end using sidecar or config semantics
- no internal discovery step is required for the test to pass

---

## Cross-Phase Constraints

- Every stage must start with failing tests
- Each stage should stay within ~200 lines of source change where practical
- Each phase should stay within ~500 lines total change where practical
- No new discovery-specific ArchGuard tools may be added
- No model-specific runtime discovery entry point may be introduced
- Keep `barrelFiles` as consumption-time verification only

---

## Final Acceptance Criteria

The plan is complete when all of the following are true:

- ArchGuard exposes a stable `ProjectSemanticsInput` authoring contract
- `archguard.config.json` and `.archguard/project-semantics.json` use the same semantics shape
- runtime analysis loads, validates, merges, and consumes semantics without internal discovery
- malformed semantics inputs fail clearly
- test analysis, Mermaid grouping, and FIM semantics injection still work
- old discovery implementation and its entry points are deprecated or removed

---

## Verification Commands

```bash
npm run type-check
npm test -- --reporter=verbose tests/unit/types/project-semantics.test.ts
npm test -- --reporter=verbose tests/unit/cli/config-loader.test.ts
npm test -- --reporter=verbose tests/unit/cli/analyze/run-analysis.test.ts
npm test -- --reporter=verbose tests/unit/analysis/test-analyzer.test.ts
npm test -- --reporter=verbose tests/unit/mermaid/generator.test.ts
npm test -- --reporter=verbose tests/unit/analysis/fim/fim-integration.test.ts
npm test
```
