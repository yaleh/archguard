---
id: TASK-10
title: >-
  GIM methodology integration: direction-hint, loss rules, MCP tool,
  system-prompt (Plans 53-56)
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 06:28'
updated_date: '2026-06-23 06:33'
labels:
  - 'kind:basic'
dependencies: []
references:
  - docs/plans/plan-53-56-gim-methodology.md
  - docs/proposals/proposal-gim-methodology-integration.md
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integrate GIM (Geometric Information Methodology) concepts into ArchGuard's analysis output and MCP toolchain. This adds an interpretation layer on top of existing MetricVector and snapshot infrastructure: direction hints from 2-point snapshot comparison, loss function proxy rules in the fitness system, a single MCP tool for LLM context, and a system prompt template generator.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: GIM Methodology Integration — MetricVector Interpretation Layer and LLM Toolchain Support

## Background

ArchGuard's A/B/C experiment (`docs/experiments/git-methodology-ab-test.md`) validated GIM
(Geometric Information Methodology) as a differentiated system-prompt methodology for LLM
development tools. Group A (GIM-prompted agents) uniquely identified tree-sitter bridge
pillarization opportunities and expansion-phase signals that Groups B and C missed entirely.

The MetricVector infrastructure (`src/types/metric-vector.ts`, `src/analysis/snapshot-store.ts`,
`src/analysis/snapshot-diff.ts`) already captures the raw data needed for GIM interpretation,
but there is no layer that maps those signals to GIM vocabulary: expansion/contraction direction,
loss function proxy values, or structured LLM prompts. This gap means LLM agents relying on
ArchGuard output must reconstruct GIM reasoning from raw numbers, with inconsistent results.

The proposal adds a minimal (~300 LOC) interpretation layer that is additive and does not
modify any existing analysis paths.

## Goals

1. `archguard analyze --gim` outputs an evolution direction hint (expansion/contraction/stable)
   derived from the two most recent MetricVector snapshots, written to `.archguard/gim/direction.json`.
2. The fitness rule system (`src/analysis/fitness/rule-types.ts`) accepts `GimLossRule` entries
   for the four single-snapshot loss function proxies (feasibility, consistency, description-length,
   generation-alignment), validated by the existing Zod schema in `config-loader.ts`.
3. A single MCP tool `archguard_get_gim_context` returns direction hint + loss statuses +
   high-influence entities as structured JSON for LLM consumption.
4. `archguard analyze --gim` writes `.archguard/gim/system-prompt.md` — a ready-to-use
   markdown template populated with current analysis values.

## Proposed Approach

Four additive phases that build on existing infrastructure (no existing file changed by more than
20 lines):

**Phase A — Direction Hint** (new `src/analysis/gim/direction-hint.ts`): Pure function
`computeDirectionHint(snapshots)` calls existing `diffSnapshots()` on the two most recent
snapshots, maps 5 metric deltas to expansion/contraction signals via majority vote, and
returns a `DirectionHint` with confidence level and mandatory caveat. CLI `--gim` flag wired
in `analyze.ts` to print and write the result.

**Phase B — GIM Loss Rules** (new `src/analysis/gim/gim-loss-evaluator.ts` + 3 file edits):
Adds `GimLossRule` to the `FitnessRule` union and a corresponding `evaluateGimLossRule()`
pure function that maps 4 losses to MetricVector proxies (sccCount, inferredRelationRatio,
totalEntities+totalRelations, giniInDegree). Wired into `rule-evaluator.ts` with a 5-line
branch, and into `config-loader.ts` Zod schema. Phase A and B are independent and can run
in parallel.

**Phase C — MCP Tool** (new `src/cli/mcp/tools/gim-tools.ts`): Follows the existing
`ccb-tool.ts` pattern. Registers one tool that composes direction hint + loss computation
+ top-5 high-influence entities from `loadEngine()`. Registered in `mcp-server.ts` with 2 lines.
Depends on A and B.

**Phase D — System Prompt Generator** (new `src/analysis/gim/gim-prompt-generator.ts`):
Pure function `generateGimPrompt(hint, losses)` returns markdown string. `analyze.ts --gim`
handler extended by 5 lines to call it and write `system-prompt.md`. Depends on A and B.

## Trade-offs and Risks

**Not doing**: Trend detection or change-point detection (requires 10+ snapshots per literature;
2-point comparison is honest about its limitations). Full MDL computation (L(X) = L(G) + L(R|G)
requires a complete information-theoretic encoding scheme). Stability loss rule (ℒ_S requires
multi-snapshot variance, incompatible with `evaluateAllRules(rules, vector, relations)` signature).
Multiple MCP tools (original design had 3; merged to 1 for coherence, following ccb-tool.ts pattern).

**Known risks**: Direction may flip between two consecutive snapshots (mitigated by `confidence: 'low'`
and mandatory caveat field). Loss values are proxy approximations not comparable across projects
(mitigated by `proxy: true` markers and `detail` fields on every output). GIM terminology may
confuse non-GIM users (mitigated by `--gim` opt-in and natural-language recommendations in output).

---

# Plan: GIM methodology integration: direction-hint, loss rules, MCP tool, system-prompt (Plans 53-56)

Proposal: docs/proposals/proposal-gim-methodology-integration.md

## Phase A — Direction Hint + CLI `--gim` flag (Plan 53)

**Depends on**: Nothing (uses existing `snapshot-store.ts`, `snapshot-diff.ts`)

### Tests (write first)

File: `tests/unit/analysis/gim/direction-hint.test.ts` (new, ~10 test cases)

Test cases:
1. `snapshots.length < 2` → returns direction `'insufficient_data'`, empty signals array
2. Two snapshots with totalEntities +25%, totalRelations +20%, packageCount +1 → `'expansion'`, confidence `'low'`
3. Two snapshots with totalEntities -10%, totalRelations -8%, packageCount -1 → `'contraction'`, confidence `'low'`
4. Mixed signals (2 expansion, 2 contraction, 1 neutral) → `'stable'`
5. Three snapshots → confidence `'medium'` (uses latest 2 for comparison; older snapshot ignored)
6. Small deltas below 5% threshold on totalEntities/totalRelations → treated as neutral, not expansion
7. `caveat` field always non-empty in all direction types
8. `recommendation` string matches direction type (expansion → contraction suggestion)
9. `DirectionHint` serializes to valid JSON (no circular refs, no undefined values)
10. Two snapshots with sccCount rising from 0 to 3 and giniInDegree rising → contributes expansion signals

### Implementation

Files to create/modify:

- `src/analysis/gim/direction-hint.ts` (new, ~80 lines)
  - Export types: `DirectionType`, `DirectionSignal`, `DirectionHint`
  - Export pure function `computeDirectionHint(snapshots: MetricSnapshot[]): DirectionHint`
  - If `snapshots.length < 2` → return `insufficient_data` with empty signals
  - Take 2 most recent: `snapshots[0]` (newest) and `snapshots[1]` (older)
  - Call `diffSnapshots(snapshots[1], snapshots[0])` (from = older [1], to = newer [0])
  - Map 5 metrics to direction signals with thresholds per proposal table
  - Simple unweighted majority vote → direction; no majority → `stable`
  - `confidence`: 2 snapshots → `'low'`, 3-9 → `'medium'`
  - `caveat`: always non-empty string describing 2-point limitation
  - `recommendation`: template string per direction type

- `src/cli/commands/analyze.ts` (modify, ~15 lines)
  - Add `--gim` boolean flag to command options
  - After analysis completes: load snapshots via `loadSnapshots(outputDir)`
  - Call `computeDirectionHint(snapshots)`, print summary to console
  - Write result to `.archguard/gim/direction.json` (ensure dir created with `fs.mkdirSync`)
  - No GIM output produced when `--gim` is absent

### DoD
- [ ] `npm test -- --run tests/unit/analysis/gim/direction-hint.test.ts`
- [ ] `npm run type-check`
- [ ] `node dist/cli/index.js analyze --help | grep -q '\-\-gim'`

---

## Phase B — GimLossRule + Evaluator + Config Zod Schema (Plan 54)

**Depends on**: Nothing (parallel with Phase A)

### Tests (write first)

File: `tests/unit/analysis/gim/gim-loss-evaluator.test.ts` (new, ~9 test cases)

Test cases:
1. feasibility: sccCount=0, op `'=='`, value 0 → RuleResult.passed=true, actual=0
2. feasibility: sccCount=3, op `'=='`, value 0 → RuleResult.passed=false, actual=3
3. consistency: inferredRelationRatio=0.12, op `'<='`, value 0.3 → passed=true
4. consistency: inferredRelationRatio=0.5, op `'<='`, value 0.3 → passed=false
5. description-length: 514+370=884, op `'<='`, value 1500 → passed=true
6. generation-alignment: giniInDegree=0.776, op `'<='`, value 0.5 → passed=false, actual=0.776
7. `computeAllLosses` with healthy vector → all statuses healthy/info, all have `proxy: true`
8. `computeAllLosses` with sccCount=5 and giniInDegree=0.8 → feasibility/alignment warnings
9. Unknown loss type → RuleResult.passed=false with detail message about unknown type

File: `tests/unit/analysis/fitness/rule-evaluator.test.ts` (extend, ~4 new test cases)

Test cases (append to existing file):
1. `evaluateAllRules` with array of [metric-rule, no-dependency-rule, gim-loss-rule] evaluates all three
2. gim-loss rule dispatches to `evaluateGimLossRule` correctly (feasibility branch)
3. Config loader (via `loadConfig`) accepts valid gim-loss rule JSON without throwing
4. Config loader rejects gim-loss rule with invalid `loss` value (e.g. `'stability'`)

### Implementation

Files to create/modify:

- `src/analysis/gim/gim-loss-evaluator.ts` (new, ~80 lines)
  - Export interface `LossStatus` with fields: `value`, `status`, `detail`, `proxy: true`
  - Export pure function `evaluateGimLossRule(rule: GimLossRule, vector: MetricVector): RuleResult`
  - Loss proxy mapping: feasibility→sccCount, consistency→inferredRelationRatio,
    description-length→totalEntities+totalRelations, generation-alignment→giniInDegree
  - Compare proxy value against `rule.value` using `rule.op`
  - Export `computeAllLosses(vector: MetricVector): Record<string, LossStatus>`
  - Status thresholds: feasibility 0=healthy/>0=warning, consistency <=0.3=healthy/>0.3=warning,
    description-length always info, generation-alignment <=0.5=healthy/>0.5=warning

- `src/analysis/fitness/rule-types.ts` (modify, ~10 lines)
  - Add `GimLossRule` interface with fields: `type: 'gim-loss'`, `loss`, `op: ComparisonOp`, `value`, `message`
  - `loss` enum: `'feasibility' | 'consistency' | 'description-length' | 'generation-alignment'`
  - Extend `FitnessRule` union: `MetricThresholdRule | DependencyConstraintRule | GimLossRule`

- `src/analysis/fitness/rule-evaluator.ts` (modify, ~5 lines)
  - Import `evaluateGimLossRule` from `@/analysis/gim/gim-loss-evaluator.js`
  - In `evaluateAllRules`, add branch before final return:
    `if (rule.type === 'gim-loss') return evaluateGimLossRule(rule, vector);`

- `src/cli/config-loader.ts` (modify, ~7 lines)
  - In `fitness.rules` Zod union (around line 201-215), add third branch after `no-dependency`:
    `z.object({ type: z.literal('gim-loss'), loss: z.enum([...]), op: z.enum([...]), value: z.number(), message: z.string() })`

### DoD
- [ ] `npm test -- --run tests/unit/analysis/gim/gim-loss-evaluator.test.ts`
- [ ] `npm test -- --run tests/unit/analysis/fitness/rule-evaluator.test.ts`
- [ ] `npm run type-check`

---

## Phase C — MCP Tool `archguard_get_gim_context` (Plan 55)

**Depends on**: Phase A + Phase B

### Tests (write first)

File: `tests/unit/cli/mcp/tools/gim-tools.test.ts` (new, ~7 test cases)

Test cases (mock `loadSnapshots`, `loadEngine`, and `computeAllLosses`):
1. Tool returns direction hint when 2 snapshots are available (direction, confidence, signals fields present)
2. Tool returns all 4 loss statuses each with `proxy: true`
3. Tool returns `direction.direction === 'insufficient_data'` when 0 snapshots
4. Tool returns `highInfluenceEntities` sorted by inDegree DESC, top 5 only
5. Tool response includes `methodology` string mentioning "proxy approximations"
6. `projectRoot` parameter resolves to custom root when provided
7. GIM tool name `archguard_get_gim_context` is present in server tool registration

### Implementation

Files to create/modify:

- `src/cli/mcp/tools/gim-tools.ts` (new, ~90 lines)
  - Follow `ccb-tool.ts` pattern: `resolveRoot`, `textResponse` helpers
  - Export `registerGIMTools(server: McpServer, defaultRoot: string): void`
  - Register tool `archguard_get_gim_context` with optional `projectRoot` param
  - Implementation: resolve root → load snapshots → computeDirectionHint → load latest
    MetricVector from `snapshots[0].metricVector` → computeAllLosses → load engine for
    per-entity degree data → filter top 5 highInfluenceEntities (inDegree > outDegree,
    sorted by inDegree DESC) → return JSON with direction/losses/highInfluenceEntities/
    snapshotCount/methodology fields
  - If no snapshots: direction = insufficient_data, losses from zero-vector, empty entities
  - If loadEngine fails: return empty highInfluenceEntities (graceful degradation)

- `src/cli/mcp/mcp-server.ts` (modify, ~2 lines)
  - Add import: `import { registerGIMTools } from './tools/gim-tools.js';`
  - Add registration call in `createMcpServer()`: `registerGIMTools(server, defaultRoot);`

### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/tools/gim-tools.test.ts`
- [ ] `npm run type-check`

---

## Phase D — System Prompt Generator (Plan 56)

**Depends on**: Phase A + Phase B

### Tests (write first)

File: `tests/unit/analysis/gim/gim-prompt-generator.test.ts` (new, ~5 test cases)

Test cases (pure function tests, no mocking needed):
1. Expansion direction → prompt contains "EXPANSION" and a recommendation string
2. Insufficient data direction → prompt contains "insufficient data" notice
3. All 4 loss names appear in markdown table in the output (feasibility, consistency, description-length, generation-alignment)
4. Output contains proxy disclaimer text (e.g. "proxy approximations")
5. Output is non-empty string with at least one markdown heading (`##` or `###`)

### Implementation

Files to create/modify:

- `src/analysis/gim/gim-prompt-generator.ts` (new, ~40 lines)
  - Export pure function `generateGimPrompt(hint: DirectionHint, losses: Record<string, LossStatus>): string`
  - Returns markdown string matching proposal Section 4.1 template
  - Includes: direction summary section, loss function proxy table, caveat block, recommendation
  - All values explicitly labeled as proxy approximations
  - No I/O, no side effects

- `src/cli/commands/analyze.ts` (modify, ~5 lines — extending Phase A's `--gim` handler)
  - After Phase A writes `direction.json`, additionally:
    - Extract `vector = snapshots.length > 0 ? snapshots[0].metricVector : null`
    - Call `computeAllLosses(vector)` if vector exists, else use empty losses
    - Call `generateGimPrompt(hint, losses)`
    - Write result to `.archguard/gim/system-prompt.md`

### DoD
- [ ] `npm test -- --run tests/unit/analysis/gim/gim-prompt-generator.test.ts`
- [ ] `npm run type-check`
- [ ] `grep -q 'system-prompt.md' src/cli/commands/analyze.ts`
- [ ] `node dist/cli/index.js analyze --help | grep -q '\-\-gim'`

---

## Constraints

- All new source files must be pure functions (no I/O, no side effects) except tool registration and CLI glue
- No existing file may be changed by more than 20 lines
- `GimLossRule` must not include `'stability'` loss (requires multi-snapshot variance, incompatible with `evaluateAllRules` signature)
- Loss statuses must always carry `proxy: true` field — proxy nature must not be hidden
- `computeDirectionHint` must never return `confidence: 'high'` — 2 snapshots cannot justify high confidence
- `--gim` flag opt-in: without the flag, no `.archguard/gim/` directory is created
- Phases A and B have no dependency on each other and may be implemented in parallel

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run build`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal approved after self-review. All criteria passed: WHY motivation clear, 4 verifiable goals, approach aligned with codebase infrastructure, trade-offs explicit. Proceeding to plan draft.

Plan review (iteration 1): APPROVED. premise-ledger: [E] goal coverage: 4 goals mapped to Phase A/B/C/D — verified from proposal Goals section; [E] TDD structure: every Phase has Tests + Implementation sections in correct order; [E] first DoD uses npm test -- --run: verified per Phase; [E] acceptance gate[0] is npm test: verified; [C] file paths exist: src/analysis/fitness/rule-types.ts, rule-evaluator.ts, config-loader.ts, mcp-server.ts, analyze.ts all confirmed via shell; [C] snapshot-store.ts loadSnapshots signature confirmed; [H] DoD sufficiency: judgment on whether per-phase test commands are sufficient relies on background knowledge. GCL-self-report: E=5 C=2 H=1
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/analysis/gim/direction-hint.test.ts
- [ ] #2 npm test -- --run tests/unit/analysis/gim/gim-loss-evaluator.test.ts
- [ ] #3 npm test -- --run tests/unit/analysis/fitness/rule-evaluator.test.ts
- [ ] #4 npm test -- --run tests/unit/cli/mcp/tools/gim-tools.test.ts
- [ ] #5 npm test -- --run tests/unit/analysis/gim/gim-prompt-generator.test.ts
- [ ] #6 npm run type-check
- [ ] #7 npm test
- [ ] #8 npm run build
<!-- DOD:END -->
