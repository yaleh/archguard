---
id: TASK-50
title: Information shape smell detection — Layer 1 literal dispersion detector
  for TypeScript
status: done
labels:
  - analysis
  - typescript
  - mcp
  - follow-up
parent: null
children: []
extra: {}
---
## Proposal

ArchGuard's structural analysis (cycles, fan-in/out) and evolutionary analysis
(co-change, change risk) both miss a common design defect: a scalar
discriminator value (enum, string literal union) compared across multiple
TypeScript modules in ways that indicate a missing structured abstraction
("literal dispersion"). Adding a new enum value then forces simultaneous
changes across N unrelated files (Shotgun Surgery) — invisible to
dependency-graph analysis because the modules share a type definition, not an
import edge.

Motivating case: a viewlint-style `appKind` string union spread across
capture/query-engine/rules files as independent conditional branches before
being refactored into a capability-pack registry. ArchGuard's co-change tool
detects the symptom (files change together) but can't name the cause or
locate the discriminator values at the root.

This closes that gap with purely static, AST-adjacent analysis (regex-based
extraction in v1, no git history required). Layers 2-3 (hidden coupling via
co-change, enum-extension impact) are explicitly deferred.

Carried over from backlog/tasks/task-14 (filed 2026-06-23, proposal + plan
already reviewed and approved there — ported here as the project's live task
queue moved to quay). No code for this exists in `src/` as of 2026-07-31.

## Plan

### Phase A: LiteralDispersionDetector — type extraction and dispersion mapping

TDD, tests first, in `tests/unit/analysis/shape-smells/literal-dispersion.test.ts`:
- `extractDiscriminatorTypes`: empty for no enums/unions; extracts string
  literal unions (`type X = "a" | "b"`); extracts enums with string values
  and bare members; ignores interfaces/classes.
- `scanFileForComparisons`: finds `=== "v"`, `"v" ===`, `case "v":`,
  `case X.V:` with correct line numbers; empty when no matches.
- `detectDispersion`: empty when all values appear in 1 file; smell with
  dispersion=2 when a value spans 2 files; severity "info" at 2, "warning"
  at >=3; independent reporting per value; threshold param suppresses below
  threshold; smells carry per-file line locations.
- Type-check test for `LiteralDispersionSmell`/`DiscriminatorType` shape
  (`tests/unit/analysis/shape-smells/types.test.ts`).

New files: `src/analysis/shape-smells/types.ts` (`DiscriminatorType`,
`SourceLocation`, `LiteralDispersionSmell`, `ShapeSmellManifest`),
`src/analysis/shape-smells/literal-dispersion.ts` (`LiteralDispersionDetector`),
`src/analysis/shape-smells/index.ts` (barrel export).

DoD: `npm test -- --run tests/unit/analysis/shape-smells/`, `npm run type-check`.

### Phase B: Cross-module scope filter

TDD in `tests/unit/analysis/shape-smells/scope-filter.test.ts`:
`filterCrossModule` passes through unchanged with no scope boundary; drops
smells confined to one module directory under `src/`; keeps smells spanning
2+ modules; doesn't filter root-level files. `computeModuleSpan` returns
`{modules, crossesBoundary}` correctly for both cases.

New file: `src/analysis/shape-smells/scope-filter.ts`. Modify
`literal-dispersion.ts` to accept optional `srcRoot` and apply the filter
when provided.

DoD: same as Phase A.

### Phase C: MCP tools

TDD in `tests/unit/cli/mcp/shape-smell-tools.test.ts` (mock detector + fs):
`archguard_detect_shape_smells` — empty result shape when no smells;
`layers: ["literal-dispersion"]` returns dispersion results; no `layers`
param defaults to literal-dispersion only; `layers: ["hidden-coupling"]` /
`["enum-extension-impact"]` return empty array + diagnostic (never throw);
`dispersionThreshold` forwarded to detector (default 2); summary counts
total + by-severity. `archguard_get_literal_dispersion` — no-filter returns
all; `typeName`/`value`/`minDispersion` filters, combined filters; tool
descriptions note the Layer 2-3 limitation.

Persistence tests in `tests/unit/analysis/shape-smells/persistence.test.ts`:
`persistResults` writes `manifest.json` + `literal-dispersion.json` under
`.archguard/query/shape-smells/`; `loadResults` reads back, returns null when
absent, throws a descriptive error on malformed JSON.

New files: `src/cli/mcp/tools/shape-smell-tools.ts`
(`registerShapeSmellTools(server, defaultRoot)`, following the same pattern
as `registerGIMTools`/`registerMetricTrendTools`), `src/analysis/shape-smells/persistence.ts`.

Modified: `src/cli/mcp/mcp-server.ts` — import + call `registerShapeSmellTools`
alongside the other `register*Tools(server, defaultRoot)` calls (~line 114).

DoD: `npm test -- --run tests/unit/analysis/shape-smells/`,
`npm test -- --run tests/unit/cli/mcp/shape-smell-tools.test.ts`,
`npm run type-check`, `npm run lint`.

## Touches

- src/analysis/shape-smells/types.ts (new)
- src/analysis/shape-smells/literal-dispersion.ts (new)
- src/analysis/shape-smells/scope-filter.ts (new)
- src/analysis/shape-smells/persistence.ts (new)
- src/analysis/shape-smells/index.ts (new)
- src/cli/mcp/tools/shape-smell-tools.ts (new)
- src/cli/mcp/mcp-server.ts (add registration call only)
- tests/unit/analysis/shape-smells/*.test.ts (new)
- tests/unit/cli/mcp/shape-smell-tools.test.ts (new)
- tasks/TASK-50.md

Do NOT touch existing MCP tool registrations/schemas, or any
`.archguard/query/` subdirectory other than `shape-smells/`.

## Acceptance Criteria

- [x] `LiteralDispersionDetector` extracts discriminator types (string
      literal unions + enums) and computes per-value dispersion across files
      with configurable threshold (default 2) and info/warning severity.
- [x] Cross-module scope filter correctly identifies boundary-crossing
      smells using the first path segment under `src/`.
- [x] `archguard_detect_shape_smells` and `archguard_get_literal_dispersion`
      MCP tools registered in `mcp-server.ts`, following ADR-006 (business
      logic in `src/analysis/`, tool file is a thin adapter); Layer 2-3
      requests return empty + diagnostic, never throw.
- [x] Results persisted under `.archguard/query/shape-smells/` and
      round-trip via `loadResults`.
- [x] Full test suite green; `npm run type-check` and `npm run lint` clean.

## Definition of Done

- [ ] #1 npm test -- --run tests/unit/analysis/shape-smells/
- [ ] #2 npm test -- --run tests/unit/cli/mcp/shape-smell-tools.test.ts
- [ ] #3 npm run type-check
- [ ] #4 npm run lint
- [ ] #5 npm test

## Coordination

Independent of TASK-46/47/48/49 (different subsystem: TypeScript analysis,
not Go/gopls). No touches overlap.

## Verification (2026-08-05, inner cold-start bookkeeping)

Closed-without-work drift check re-verified. AC boxes now checked against master evidence:

- Fix landed on master via `f1f4305` (feat: add shape-smell analysis for literal dispersion
  detection) — all Touches present: `src/analysis/shape-smells/{types,literal-dispersion,
  scope-filter,persistence,index}.ts`, `src/cli/mcp/tools/shape-smell-tools.ts`,
  `mcp-server.ts` registration, 5 test files.
- Tests on master: `npx vitest run tests/unit/analysis/shape-smells/ tests/unit/cli/mcp/
  shape-smell-tools.test.ts` → **69 passed** (2026-08-05), covering AC1–AC4.
- AC5 (full suite green / type-check / lint clean): historically green — CI round 6 success
  (goals-and-ac.md AC4) and tick #50 "CI green" on master.
