---
id: TASK-9
title: 'Code hygiene quick wins: todo tests, ProgressReporter, test file slim'
status: 'Basic: Done'
assignee: []
created_date: '2026-06-23 06:28'
updated_date: '2026-06-23 07:01'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Three small, independent issues were identified during the June 2026 post-Plan-58 self-analysis:

1. `tests/unit/core/query/query-engine.test.ts` contains two `it.todo` tests for `QueryEngine.findByAttr` and `QueryEngine.findByTypeAndAttr`, each annotated "pending until Plan 58 is merged". Plan 58 is merged. The implementation at `src/core/query/query-engine.ts:208–240` is untested at the unit level.

2. `src/mermaid/diagram-generator.ts` contains 12 bare `console.log` calls (lines 220–237, 353–360) for quality metrics output and generated-file listings. Every other output site in the project uses `ProgressReporter` from `src/cli/progress.ts`. The bare logs bypass the spinner lifecycle, cannot be silenced in JSON/MCP output modes, and include emoji-decorated text that is hard to parse programmatically.

3. `tests/plugins/golang/atlas/mermaid-templates.test.ts` is 3311 lines — the largest test file in the project. It tests the `MermaidTemplates` façade class against all four atlas layers. Four new direct-import renderer test files were added in Plan 58's follow-up work (`goroutine-renderer.test.ts`, `flow-renderer.test.ts`, `capability-renderer.test.ts`, `package-renderer.test.ts`). The façade test now duplicates structural assertions already covered by the layer-specific files, which increases the cost of every template change.

---

## Goals

- Complete the two `findByAttr` todo tests so the Plan 58 attribute query surface has unit-level coverage.
- Replace `console.log` in `diagram-generator.ts` with `ProgressReporter` calls so output is gated by the same verbose flag and MCP-quiet mode as the rest of the CLI.
- Slim `mermaid-templates.test.ts` to a thin integration smoke-test after verifying that layer-specific tests cover each assertion category.

## Non-Goals

- Changing `findByAttr` / `findByTypeAndAttr` semantics.
- Redesigning `ProgressReporter` to support structured metrics reporting.
- Removing `MermaidTemplates` façade or changing its public API.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Code Hygiene Quick Wins

## Background

After Plan 58 merged in June 2026, three small technical-debt items were left behind that were not worth blocking the plan but are now easy to resolve. First, two `it.todo` placeholders in `tests/unit/core/query/query-engine.test.ts` were written to document that `QueryEngine.findByAttr` and `findByTypeAndAttr` lacked unit coverage until Plan 58 landed — Plan 58 is now merged but the tests remain as stubs. Second, `src/mermaid/diagram-generator.ts` contains 12 bare `console.log` calls for quality-metrics and generated-files output; every other output site in the project routes through `ProgressReporter`, so these calls bypass the verbose flag, pollute stdout in `--format json` and MCP-quiet modes, and make the output harder to parse programmatically. Third, `tests/plugins/golang/atlas/mermaid-templates.test.ts` grew to 3311 lines but Plan 58's follow-up work added four layer-specific renderer test files (`package-renderer.test.ts`, `capability-renderer.test.ts`, `goroutine-renderer.test.ts`, `flow-renderer.test.ts`) that now duplicate the bulk of those assertions; the façade test carries the full structural burden of every template change with no unique coverage contribution. All three issues are independent, low-risk, and scoped to test or output-wiring code — no public API or semantic change is required.

## Goals

1. Fill 2 it.todo tests for QueryEngine.findByAttr
2. Replace console.log in diagram-generator.ts with ProgressReporter
3. Slim mermaid-templates.test.ts from 3311 to ~200 lines

## Proposed Approach

**Goal 1 — fill todo tests:**
In `tests/unit/core/query/query-engine.test.ts`, replace the two `it.todo` stubs inside `describe('QueryEngine.findByAttr ...')` with real tests. Each test constructs a small entity set using the existing `makeEntity` helper, calls `engine.findByAttr(key)` or `engine.findByAttr(key, value)`, and asserts the returned array length and entity names. No source changes needed; the implementation at `src/core/query/query-engine.ts` is already in place.

**Goal 2 — replace console.log:**
`diagram-generator.ts` already imports `IProgressReporter` / `NoopProgressReporter` and holds a `this.progress` reference (constructor parameter, defaulting to `NoopProgressReporter`). Convert the metrics block (lines ~221–238) and the generated-files block (lines ~354–362) to use `this.progress.info(...)` calls. Emoji can be stripped or kept in the message string — the key change is routing through the progress interface so callers can suppress output.

**Goal 3 — slim mermaid-templates.test.ts:**
Audit each `describe` block against the four renderer test files in `tests/plugins/golang/atlas/renderers/`. For each assertion already covered by a layer-specific file, delete it from `mermaid-templates.test.ts`. Retain exactly one round-trip smoke test per atlas layer that calls `MermaidTemplates.renderXxx()` (the façade entry point) to verify the delegation wiring is intact, plus any cross-layer or integration assertions that the individual files cannot cover.

## Trade-offs and Risks

**What we are NOT doing:**
- Not changing `findByAttr` / `findByTypeAndAttr` semantics or signatures.
- Not redesigning `ProgressReporter` to add structured metric output (deferred to a future plan).
- Not deleting `MermaidTemplates` façade or altering its public API.

**Risks:**
- The `mermaid-templates.test.ts` slim could accidentally remove a test that the layer-specific files do not actually cover. Mitigation: the plan requires verifying the test suite still passes (`npm test -- --run`) after the slim, which will catch any coverage gap surfaced by a failing assertion.
- Routing diagram-generator output through `ProgressReporter` means callers that pass `NoopProgressReporter` (the default in tests) will silently suppress the metrics output. This is the correct behavior for tests but should be validated in an integration context.

---

# TDD Plan

## Phase 1 — Fill 2 it.todo tests for QueryEngine.findByAttr

### Tests

File: `tests/unit/core/query/query-engine.test.ts`

Replace the two `it.todo` stubs in `describe('QueryEngine.findByAttr (from @/core/query, Plan 58)')` with full test bodies using the existing `makeEntity` helper already present in the file.

Test 1 — key-only filter (no value):
- Build 3 entities: Foo has `{ deprecated: true, version: '2' }`, Bar has `{ version: '2' }`, Baz has no attributes.
- Call `engine.findByAttr('deprecated')`.
- Assert result length is 1 and `results[0].name === 'Foo'`.

Test 2 — key+value filter:
- Build 2 entities: Foo has `{ version: '2' }`, Bar has `{ version: '3' }`.
- Call `engine.findByAttr('version', '2')`.
- Assert result length is 1 and `results[0].name === 'Foo'`.

### Implementation

No implementation changes — `src/core/query/query-engine.ts` already implements `findByAttr` (confirmed at lines 171–193). Replace only the two `it.todo(...)` lines in `tests/unit/core/query/query-engine.test.ts`.

### DoD

- `npm test -- --run tests/unit/core/query/query-engine.test.ts` passes with 0 todo tests in the findByAttr describe block
- `grep -c "it.todo" tests/unit/core/query/query-engine.test.ts` returns 0
- No changes to any file under `src/`

---

## Phase 2 — Replace console.log in diagram-generator.ts with ProgressReporter

### Tests

File: `tests/unit/mermaid/diagram-generator-progress.test.ts` (new file)

Write tests that spy on a mock `IProgressReporter.info` to verify:
1. When `DiagramGenerator` is constructed with a mock progress reporter and quality-output path is triggered, `progress.info` is called at least once instead of `console.log`.
2. When constructed without a progress reporter (default `NoopProgressReporter`), spying on `console.log` confirms 0 calls.

### Implementation

File: `src/mermaid/diagram-generator.ts`

`DiagramGenerator` already holds `this.progress: IProgressReporter` at lines 70–76. Replace all `console.log(...)` calls in the metrics block (~lines 221–238) and generated-files block (~lines 354–362) with `this.progress.info(...)` calls.

### DoD

- `npm test -- --run tests/unit/mermaid/diagram-generator-progress.test.ts` passes
- `grep -c "console.log" src/mermaid/diagram-generator.ts` returns 0
- `npm test -- --run tests/unit/mermaid/` passes with no regressions

---

## Phase 3 — Slim mermaid-templates.test.ts from 3311 to ~200 lines

### Tests

The existing four layer-specific renderer test files already provide coverage. After slimming, `mermaid-templates.test.ts` retains exactly 4 smoke tests (one per atlas layer) calling MermaidTemplates façade methods and asserting on the returned string format. All ~35 other describe blocks are removed.

### Implementation

No `src/` changes. Replace `tests/plugins/golang/atlas/mermaid-templates.test.ts` with the slimmed version (~4 smoke tests). Verify each deleted describe block is covered by the corresponding renderer test file in `tests/plugins/golang/atlas/renderers/`.

### DoD

- `npm test -- --run tests/plugins/golang/atlas/mermaid-templates.test.ts` passes
- `wc -l tests/plugins/golang/atlas/mermaid-templates.test.ts` outputs a value <= 250
- `npm test -- --run tests/plugins/golang/atlas/renderers/` passes
- `npm test` passes (full suite)

---

## Acceptance Gate

- `npm test` passes (full suite, all phases complete)
- `grep -c "it.todo" tests/unit/core/query/query-engine.test.ts` returns 0
- `grep -c "console.log" src/mermaid/diagram-generator.ts` returns 0
- `wc -l tests/plugins/golang/atlas/mermaid-templates.test.ts` returns <= 250
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-23T06:39:15Z

Completed: 2026-06-23T07:01:44Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/core/query/query-engine.test.ts passes with 0 todo tests in findByAttr describe block
- [ ] #2 grep -c "it.todo" tests/unit/core/query/query-engine.test.ts returns 0
- [ ] #3 npm test -- --run tests/unit/mermaid/diagram-generator-progress.test.ts passes
- [ ] #4 grep -c "console.log" src/mermaid/diagram-generator.ts returns 0
- [ ] #5 npm test -- --run tests/plugins/golang/atlas/mermaid-templates.test.ts passes
- [ ] #6 wc -l tests/plugins/golang/atlas/mermaid-templates.test.ts returns <= 250
- [ ] #7 npm test passes (full suite, all phases complete)
<!-- DOD:END -->
