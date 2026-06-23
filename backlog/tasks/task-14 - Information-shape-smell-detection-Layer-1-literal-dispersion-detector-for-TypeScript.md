---
id: TASK-14
title: >-
  Information shape smell detection: Layer 1 literal dispersion detector for
  TypeScript
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 06:29'
updated_date: '2026-06-23 06:31'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Detect literal dispersion where enum/discriminator values are compared across multiple TypeScript modules, indicating missing structured abstractions. Implement Layer 1 static analysis with two MCP tools: archguard_detect_shape_smells and archguard_get_literal_dispersion. Layers 2-3 (co-change, git history) deferred.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Information Shape Smell Detection — Layer 1 Literal Dispersion (TypeScript)

## Background

ArchGuard provides structural analysis (cycles, fan-in/out) and evolutionary analysis
(co-change, change risk), but neither layer reliably detects a common design defect:
a scalar discriminator value (enum, string literal union) compared across multiple
modules in ways that indicate a missing structured abstraction.

This pattern — literal dispersion — is the root cause of a specific form of Shotgun
Surgery where adding a new enum value forces simultaneous changes in N unrelated files.
The coupling is invisible to dependency-graph analysis because modules share a type
definition, not an import edge between each other.

The motivating case is viewlint's `appKind` string union (`"public-site" | "map-workbench"
| ...`) that spread across capture.ts, query-engine.ts, and rules.ts as independent
conditional branches before being refactored into a capability-pack registry. ArchGuard's
co-change tool detected the symptom but could not name the cause or locate the enum values
at the root.

Layer 1 addresses this gap with purely static, AST-based analysis requiring no git history.

## Goals

1. Detect all TypeScript enum declarations and string literal union types in a scanned
   project and produce a `DiscriminatorType` inventory.
2. For each discriminator value, count how many distinct source files contain a comparison
   (`=== "value"`, `"value" ===`, `switch/case` branch) — the dispersion score.
3. Report smells where dispersion >= threshold (default 2) as `LiteralDispersionSmell`
   records with file paths and source locations.
4. Expose results through two MCP tools: `archguard_detect_shape_smells` (Layer 1 slice)
   and `archguard_get_literal_dispersion`, both following ADR-006 conventions.
5. Persist detection results under `.archguard/query/shape-smells/` alongside existing
   query artifacts so results are queryable without re-running analysis.

## Proposed Approach

**LiteralDispersionDetector** (`src/analysis/shape-smells/literal-dispersion.ts`):

1. Read source files from the project (TypeScript only in Layer 1).
2. Extract discriminator types via regex extraction of `type X = "a" | "b" | ...` and
   `enum X { A = "a", ... }` patterns (full AST resolution deferred to v2).
3. For each discriminator value `vi`, scan all source files for comparison patterns
   (`=== "vi"`, `"vi" ===`, `case "vi":`, `case X.Vi:`).
4. Build a dispersion map: value → Set<filePath> with per-file source locations.
5. Filter to entries where `|Set| >= threshold` and emit `LiteralDispersionSmell[]`.

**Shared types** (`src/analysis/shape-smells/types.ts`): `LiteralDispersionSmell`,
`DiscriminatorType`, `SourceLocation` (aligned with existing ArchGuard types).

**MCP tools** (`src/cli/mcp/tools/shape-smell-tools.ts`): Two tools registered following
the same pattern as `test-analysis-tools.ts` — `registerShapeSmellTools(server, defaultRoot)`.

**MCP server** (`src/cli/mcp/mcp-server.ts`): Import and call `registerShapeSmellTools`.

## Trade-offs and Risks

**Layers 2-3 deferred**: Hidden coupling and enum extension impact are excluded from this
task. Requesting those layers returns empty results with a diagnostic message.

**Regex-based extraction**: Full AST resolution is deferred to v2.

**False positives at low dispersion**: Severity is "info" at dispersion 2, "warning" at
3+. No automatic verdict is emitted.

**Go, Java, Python**: Out of scope. Architecture uses `IDiscriminatorExtractor` interface
for future extensibility.

---

# Plan: Information Shape Smell Detection — Layer 1 Literal Dispersion (TypeScript)

Proposal: docs/proposals/proposal-information-shape-smell-detection.md

## Phase A: LiteralDispersionDetector — type extraction and dispersion mapping

### Tests (write first)

File: `tests/unit/analysis/shape-smells/literal-dispersion.test.ts`

Test cases:
- `extractDiscriminatorTypes`: returns empty array for a file with no enums or unions
- `extractDiscriminatorTypes`: extracts string literal union type `type X = "a" | "b"` → values `["a","b"]`
- `extractDiscriminatorTypes`: extracts enum `enum X { A = "a", B = "b" }` → values `["a","b"]`
- `extractDiscriminatorTypes`: extracts enum with bare members `enum X { A, B }` → values `["A","B"]`
- `extractDiscriminatorTypes`: ignores non-discriminator types (interfaces, classes)
- `scanFileForComparisons`: finds `=== "map-workbench"` at correct line number
- `scanFileForComparisons`: finds `"map-workbench" ===` (reversed equality)
- `scanFileForComparisons`: finds `case "map-workbench":` in a switch
- `scanFileForComparisons`: finds `case X.MapWorkbench:` (enum member reference)
- `scanFileForComparisons`: returns empty array when no matches
- `detectDispersion`: returns empty when all values appear in only 1 file
- `detectDispersion`: returns smell with dispersion=2 when value appears in 2 files
- `detectDispersion`: severity is "info" for dispersion=2, "warning" for dispersion>=3
- `detectDispersion`: multiple values of same type are reported independently
- `detectDispersion`: threshold=3 suppresses dispersion=2 results
- `detectDispersion`: each smell includes file paths and per-file line locations

File: `tests/unit/analysis/shape-smells/types.test.ts`
- TypeScript type-check test: `LiteralDispersionSmell` and `DiscriminatorType` conform to their interfaces

### Implementation

New files:
- `src/analysis/shape-smells/types.ts` — `DiscriminatorType`, `SourceLocation`, `LiteralDispersionSmell`, `ShapeSmellManifest`
- `src/analysis/shape-smells/literal-dispersion.ts` — `LiteralDispersionDetector` class
- `src/analysis/shape-smells/index.ts` — barrel export

### DoD
- [ ] `npm test -- --run tests/unit/analysis/shape-smells/`
- [ ] `npm run type-check`

---

## Phase B: Cross-module scope filter — boundary-crossing detection

### Tests (write first)

File: `tests/unit/analysis/shape-smells/scope-filter.test.ts`

Test cases:
- `filterCrossModule`: returns all smells unchanged when no scope boundary is defined
- `filterCrossModule`: removes smells where all dispersion files are in the same module directory
- `filterCrossModule`: keeps smells where dispersion files span two or more module directories
- `filterCrossModule`: correctly identifies module boundary by first path segment under `src/`
- `filterCrossModule`: does not filter smells where files live at root source level
- `computeModuleSpan`: returns `{ modules: string[], crossesBoundary: boolean }` for a smell
- `computeModuleSpan`: `crossesBoundary=false` when all files in one module
- `computeModuleSpan`: `crossesBoundary=true` when files span multiple modules

### Implementation

New file:
- `src/analysis/shape-smells/scope-filter.ts` — `filterCrossModule(smells, srcRoot)` and `computeModuleSpan(smell, srcRoot)`

Modified file:
- `src/analysis/shape-smells/literal-dispersion.ts` — add optional `srcRoot` parameter to `detectDispersion`; apply `filterCrossModule` when provided

### DoD
- [ ] `npm test -- --run tests/unit/analysis/shape-smells/`
- [ ] `npm run type-check`

---

## Phase C: MCP tools — archguard_detect_shape_smells and archguard_get_literal_dispersion

### Tests (write first)

File: `tests/unit/cli/mcp/shape-smell-tools.test.ts`

Test cases (all mock `LiteralDispersionDetector` and filesystem):
- `archguard_detect_shape_smells`: returns `{ literalDispersion: [], summary: {...} }` when project has no smells
- `archguard_detect_shape_smells`: with `layers: ["literal-dispersion"]` returns dispersion results
- `archguard_detect_shape_smells`: with no `layers` param defaults to literal-dispersion only
- `archguard_detect_shape_smells`: requesting `layers: ["hidden-coupling"]` returns empty array and diagnostic message noting layer not yet implemented
- `archguard_detect_shape_smells`: requesting `layers: ["enum-extension-impact"]` returns empty array and diagnostic
- `archguard_detect_shape_smells`: `dispersionThreshold` param is forwarded to detector (default 2)
- `archguard_detect_shape_smells`: summary counts total smells, by-severity breakdown
- `archguard_get_literal_dispersion`: returns all dispersion results when no filter params
- `archguard_get_literal_dispersion`: `typeName` filter returns only smells for that discriminator type
- `archguard_get_literal_dispersion`: `value` filter returns only smells for that specific value
- `archguard_get_literal_dispersion`: `minDispersion` filter excludes results below threshold
- `archguard_get_literal_dispersion`: combined `typeName` + `value` filter narrows results
- tool descriptions include limitation note about Layers 2-3

File: `tests/unit/analysis/shape-smells/persistence.test.ts`
- `persistResults`: writes `manifest.json` and `literal-dispersion.json` under `.archguard/query/shape-smells/`
- `loadResults`: reads back the persisted files; returns null when files absent
- `loadResults`: throws descriptive error when manifest is malformed JSON

### Implementation

New files:
- `src/cli/mcp/tools/shape-smell-tools.ts` — `registerShapeSmellTools(server, defaultRoot)`
- `src/analysis/shape-smells/persistence.ts` — `persistResults(root, smells)` and `loadResults(root)`

Modified files:
- `src/cli/mcp/mcp-server.ts` — add `registerShapeSmellTools` import and call

### DoD
- [ ] `npm test -- --run tests/unit/analysis/shape-smells/`
- [ ] `npm test -- --run tests/unit/cli/mcp/shape-smell-tools.test.ts`
- [ ] `npm run type-check`
- [ ] `npm run lint`

---

## Constraints

- Layers 2 (hidden coupling) and 3 (enum extension impact) are deferred; MCP tool must return empty results with diagnostic, never throw.
- TypeScript only for discriminator extraction in Layer 1.
- Regex-based extraction only; TypeScript compiler API deferred to v2.
- All new files use `@/analysis` path alias where applicable.
- Do not modify existing MCP tools or their registered schemas.
- Results stored in `.archguard/query/shape-smells/`; do not modify other `.archguard/query/` subdirectories.

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal approved. Starting plan draft.

Plan review iteration 1: APPROVED
premise-ledger:
[E] goal coverage: 5 goals mapped to Phase A (goals 1-3), Phase B (goal 3 scope), Phase C (goals 4-5)
[E] TDD structure: every Phase has ### Tests then ### Implementation, DoD[0] uses npm test -- --run
[E] acceptance gate: first item is npm test (testAll)
[E] file paths: all new files verified absent from codebase (ls src/analysis/shape-smells/ returns nothing, shape-smell-tools.ts does not exist)
[C] DoD executability: all items are shell commands; natural-language constraints moved to ## Constraints
[H] sufficiency of regex-based approach: adequacy judged from background knowledge of TypeScript literal union patterns
GCL-self-report: E=4 C=1 H=1
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/analysis/shape-smells/
- [ ] #2 npm test -- --run tests/unit/cli/mcp/shape-smell-tools.test.ts
- [ ] #3 npm run type-check
- [ ] #4 npm run lint
- [ ] #5 npm test
<!-- DOD:END -->
