# Plan 53-56 — GIM Methodology Integration

> Proposal: `docs/proposals/proposal-gim-methodology-integration.md`
> Status: Draft
> Priority: LOW (methodology interpretation layer, no existing functionality affected)
> Estimated total changes: ~300 lines source + ~350 lines test

---

## Overview

Integrate GIM (Geometric Information Methodology) concepts into ArchGuard's analysis
output and MCP toolchain. This adds an interpretation layer on top of existing
MetricVector and snapshot infrastructure — direction hints from 2-point snapshot
comparison, loss function proxy rules in the fitness system, a single MCP tool for
LLM context, and a system prompt template generator.

All values produced are proxy approximations for structured LLM reasoning, not
precise measurements. The implementation is intentionally minimal (~300 lines) to
avoid giving proxy values false precision.

### Proposal-to-Phase mapping

| Proposal Phase | Plan Phase | Scope |
|----------------|------------|-------|
| Phase 1 (Direction Hint) | **A** (Plan 53) | `direction-hint.ts` — 2-point comparison + CLI `--gim` flag |
| Phase 2 (GIM Loss Rules) | **B** (Plan 54) | `gim-loss-evaluator.ts` + extend rule-types/evaluator/config-loader |
| Phase 3 (MCP Tool) | **C** (Plan 55) | `gim-tools.ts` — single `archguard_get_gim_context` tool |
| Phase 4 (System Prompt) | **D** (Plan 56) | `gim-prompt-generator.ts` — writes `.archguard/gim/system-prompt.md` |

### Delivery phases

| Phase | Scope | Gate | Depends on |
|-------|-------|------|------------|
| **A** | Direction hint types + pure function + CLI `--gim` flag | Unit tests pass; `computeDirectionHint` returns correct direction on synthetic snapshots |  Nothing (uses existing `snapshot-store.ts`, `snapshot-diff.ts`) |
| **B** | GimLossRule type + evaluator + Zod schema + rule-evaluator wiring | Unit tests pass; `evaluateGimLossRule` maps 4 losses correctly; config validation accepts gim-loss rules | Nothing (parallel with A) |
| **C** | Single MCP tool `archguard_get_gim_context` | Unit tests pass; tool returns direction + losses + high-influence entities JSON | **A** + **B** |
| **D** | System prompt template generator | Unit tests pass; `archguard analyze --gim` writes `.archguard/gim/system-prompt.md` | **A** + **B** |

---

## Phase A — Direction Hint (Plan 53)

**Depends on**: Nothing (uses existing `snapshot-store.ts`, `snapshot-diff.ts`)
**Estimated lines**: ~100 source + ~120 test
**Files**:
- `src/analysis/gim/direction-hint.ts` (new)
- `src/cli/commands/analyze.ts` (modify: ~15 lines for `--gim` flag)
- `tests/unit/analysis/gim/direction-hint.test.ts` (new)

### Stage A1 — DirectionHint types and pure function (~80 lines source + ~100 lines test)

**File**: `src/analysis/gim/direction-hint.ts` (new, ~80 lines)

Define types and implement `computeDirectionHint()`:

```typescript
export type DirectionType = 'expansion' | 'contraction' | 'stable' | 'insufficient_data';

export interface DirectionSignal {
  metric: string;
  delta: number;
  percentChange: number | null;
  interpretation: string;  // 'expansion signal' | 'contraction signal' | 'neutral'
}

export interface DirectionHint {
  direction: DirectionType;
  confidence: 'low' | 'medium';  // 2-point = low; 3-9 snapshots = medium; never 'high'
  signals: DirectionSignal[];
  recommendation: string;
  snapshotCount: number;
  caveat: string;
}
```

Implement `computeDirectionHint(snapshots: MetricSnapshot[]): DirectionHint`:
- If `snapshots.length < 2` -> return `insufficient_data` with empty signals
- Take the 2 most recent snapshots (already sorted DESC by `loadSnapshots()`)
- Call `diffSnapshots(snapshots[1], snapshots[0])` to get deltas (signature: `diffSnapshots(from: MetricSnapshot, to: MetricSnapshot): MetricDiffResult`; `from` = older = `[1]`, `to` = newer = `[0]`)
- Map 5 metrics to direction signals (expansion/contraction thresholds per proposal):

| Metric | Expansion signal | Contraction signal |
|--------|-----------------|-------------------|
| totalEntities | delta > +5% | delta < -5% |
| totalRelations | delta > +5% | delta < -5% |
| packageCount | delta > 0 | delta < 0 |
| sccCount | delta > 0 (debt) | delta < 0 (cleanup) |
| giniInDegree | delta > 0 (coupling) | delta < 0 (decoupling) |

- Simple majority vote (unweighted). Majority direction wins. No majority -> `stable`
- `confidence`: `'low'` for 2 snapshots, `'medium'` for 3-9
- `caveat`: always filled, e.g. `"Based on 2-snapshot comparison only. Not a statistically validated trend. Direction may reverse in next snapshot."`
- `recommendation`: template string based on direction (expansion -> suggest contraction, etc.)

**File**: `tests/unit/analysis/gim/direction-hint.test.ts` (new)

Tests (TDD):
1. `snapshots.length < 2` -> returns `insufficient_data`, empty signals
2. Two snapshots with rising entities/relations/packages -> `expansion`, confidence `low`
3. Two snapshots with falling entities/relations/packages -> `contraction`, confidence `low`
4. Mixed signals (2 expansion, 2 contraction, 1 neutral) -> `stable`
5. Three snapshots -> confidence `medium` (uses latest 2 for comparison)
6. Small deltas below 5% threshold -> treated as neutral, not expansion/contraction
7. `caveat` field always non-empty
8. `recommendation` matches direction type

**Acceptance criteria**:
- All 8 tests pass
- `computeDirectionHint` is a pure function (no I/O, no side effects)
- Imports only from `snapshot-diff.ts` types, no direct file I/O

---

### Stage A2 — CLI `--gim` flag wiring (~20 lines source + ~20 lines test)

**File**: `src/cli/commands/analyze.ts` (modify, ~15 lines)

Add `--gim` boolean flag to analyze command:
- When enabled, after analysis completes:
  1. Load snapshots via `loadSnapshots(outputDir)`
  2. Call `computeDirectionHint(snapshots)`
  3. Print direction hint summary to console (verbose format from proposal)
  4. Write `direction.json` to `.archguard/gim/` directory

**File**: `tests/unit/analysis/gim/direction-hint.test.ts` (extend, ~20 lines)

Additional tests:
9. `DirectionHint` serializes to valid JSON (for file output)
10. Direction hint with real-shaped MetricVector snapshots produces expected output

**Acceptance criteria**:
- `--gim` flag accepted by CLI
- Direction hint printed to console and written to `.archguard/gim/direction.json`
- Without `--gim`, no GIM output produced

---

## Phase B — GIM Loss Proxy Rules (Plan 54)

**Depends on**: Nothing (parallel with Phase A)
**Estimated lines**: ~120 source + ~130 lines test
**Files**:
- `src/analysis/gim/gim-loss-evaluator.ts` (new)
- `src/analysis/fitness/rule-types.ts` (modify: ~10 lines)
- `src/analysis/fitness/rule-evaluator.ts` (modify: ~5 lines)
- `src/cli/config-loader.ts` (modify: ~7 lines)
- `tests/unit/analysis/gim/gim-loss-evaluator.test.ts` (new)
- `tests/unit/analysis/fitness/rule-evaluator.test.ts` (extend)

### Stage B1 — GimLossRule type definition (~10 lines modify)

**File**: `src/analysis/fitness/rule-types.ts` (modify)

Add `GimLossRule` interface and extend `FitnessRule` union:

```typescript
export interface GimLossRule {
  type: 'gim-loss';
  loss: 'feasibility' | 'consistency' | 'description-length' | 'generation-alignment';
  op: ComparisonOp;
  value: number;
  message: string;
}

export type FitnessRule = MetricThresholdRule | DependencyConstraintRule | GimLossRule;
```

No `'stability'` loss — requires multi-snapshot data incompatible with `evaluateAllRules` signature (see proposal CRITICAL-2).

**Acceptance criteria**:
- `npm run type-check` passes
- `GimLossRule` importable from `rule-types.ts`

---

### Stage B2 — Loss evaluator pure function (~80 lines source + ~100 lines test)

**File**: `src/analysis/gim/gim-loss-evaluator.ts` (new, ~80 lines)

Implement `evaluateGimLossRule(rule: GimLossRule, vector: MetricVector): RuleResult`:

Loss-to-MetricVector proxy mapping:

| Loss | Proxy metric | Computation |
|------|-------------|-------------|
| `feasibility` (L_T) | `sccCount` | `vector.sccCount` |
| `consistency` (L_C) | `inferredRelationRatio` | `vector.inferredRelationRatio` |
| `description-length` (L_D) | entity+relation count | `vector.totalEntities + vector.totalRelations` |
| `generation-alignment` (L_G) | `giniInDegree` | `vector.giniInDegree` |

Compare computed proxy value against `rule.value` using `rule.op`. Return `RuleResult` with `actual` set to proxy value.

Also export `computeAllLosses(vector: MetricVector): Record<string, LossStatus>` for MCP tool use:

```typescript
export interface LossStatus {
  value: number;
  status: 'healthy' | 'warning' | 'info';
  detail: string;
  proxy: true;  // always true — these are approximations
}
```

Status thresholds (hardcoded, not configurable — avoiding false precision):
- feasibility: 0 = healthy, >0 = warning
- consistency: <=0.3 = healthy, >0.3 = warning
- description-length: always `info` (project-specific, no universal threshold)
- generation-alignment: <=0.5 = healthy, >0.5 = warning

**File**: `tests/unit/analysis/gim/gim-loss-evaluator.test.ts` (new)

Tests (TDD):
1. feasibility: sccCount=0, op `==`, value 0 -> passed
2. feasibility: sccCount=3, op `==`, value 0 -> not passed, actual=3
3. consistency: inferredRelationRatio=0.12, op `<=`, value 0.3 -> passed
4. consistency: inferredRelationRatio=0.5, op `<=`, value 0.3 -> not passed
5. description-length: 514+370=884, op `<=`, value 1500 -> passed
6. generation-alignment: giniInDegree=0.776, op `<=`, value 0.5 -> not passed, actual=0.776
7. `computeAllLosses` with healthy vector -> all healthy/info statuses
8. `computeAllLosses` with unhealthy vector -> warning statuses for feasibility/consistency/alignment
9. Unknown loss type -> returns failed result with detail message

**Acceptance criteria**:
- All 9 tests pass
- `evaluateGimLossRule` is a pure function
- `computeAllLosses` returns all 4 losses with `proxy: true`

---

### Stage B3 — Wire into rule-evaluator and config-loader (~12 lines modify + ~30 lines test)

**File**: `src/analysis/fitness/rule-evaluator.ts` (modify, ~5 lines)

Add `'gim-loss'` branch in `evaluateAllRules` (rule-evaluator.ts line 57-62). Insert before the final `return evaluateMetricRule(...)` fallback:

```typescript
if (rule.type === 'gim-loss') {
  return evaluateGimLossRule(rule, vector);
}
```

Import `evaluateGimLossRule` from `@/analysis/gim/gim-loss-evaluator.js`. Also import `GimLossRule` from `./rule-types.js` (needed after `FitnessRule` union is extended in B1).

**File**: `src/cli/config-loader.ts` (modify, ~7 lines)

Add third branch to fitness rules `z.union` (config-loader.ts lines 201-215, inside `fitness.rules` array schema). Insert after the existing `z.object({ type: z.literal('no-dependency'), ... })` branch:

```typescript
z.object({
  type: z.literal('gim-loss'),
  loss: z.enum(['feasibility', 'consistency', 'description-length', 'generation-alignment']),
  op: z.enum(['<', '<=', '>', '>=', '==', '!=']),
  value: z.number(),
  message: z.string(),
}),
```

**File**: `tests/unit/analysis/fitness/rule-evaluator.test.ts` (extend, ~30 lines)

Tests:
1. `evaluateAllRules` with mixed rule types (metric + no-dependency + gim-loss) evaluates all
2. gim-loss rule passes through to `evaluateGimLossRule` correctly
3. Config loader accepts valid gim-loss rule JSON
4. Config loader rejects gim-loss rule with invalid loss type

**Acceptance criteria**:
- All existing rule-evaluator tests still pass
- New tests pass
- Config loader validates gim-loss rules correctly
- `npm run type-check` passes

---

## Phase C — MCP Tool (Plan 55)

**Depends on**: **Phase A** (direction hint) + **Phase B** (loss evaluator)
**Estimated lines**: ~100 source + ~80 lines test
**Files**:
- `src/cli/mcp/tools/gim-tools.ts` (new)
- `src/cli/mcp/mcp-server.ts` (modify: ~2 lines)
- `tests/unit/cli/mcp/tools/gim-tools.test.ts` (new)

### Stage C1 — `archguard_get_gim_context` tool (~90 lines source + ~70 lines test)

**File**: `src/cli/mcp/tools/gim-tools.ts` (new, ~90 lines)

Follow existing MCP tool pattern (reference: `fim-tools.ts`):

```typescript
export function registerGIMTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_get_gim_context',
    'Get GIM context: evolution direction hint and loss function proxy values.',
    { projectRoot: z.string().optional() },
    async ({ projectRoot }) => { /* ... */ }
  );
}
```

Implementation:
1. Resolve project root via `resolveRoot()`
2. Load snapshots via `loadSnapshots(archguardDir)` (signature: `loadSnapshots(outputDir: string): Promise<MetricSnapshot[]>`)
3. Compute direction hint via `computeDirectionHint(snapshots)`
4. Load latest MetricVector from `snapshots[0].metricVector` (snapshots are sorted DESC by timestamp)
5. Compute losses via `computeAllLosses(vector)`
6. Load entity-level degree data via `loadEngine(archguardDir)` → `engine.getSummary()` to get `fileStats` array, then compute per-entity inDegree/outDegree from relations. Filter to top 5 entities where `inDegree > outDegree`, sorted by inDegree DESC. **Note**: this requires ArchJSON data from a prior `analyze` run; if unavailable, return empty `highInfluenceEntities` array.
7. Return structured JSON with `direction`, `losses`, `highInfluenceEntities`, `snapshotCount`, `methodology` fields

**File**: `tests/unit/cli/mcp/tools/gim-tools.test.ts` (new)

Tests (TDD):
1. Tool returns direction hint from 2 snapshots
2. Tool returns all 4 loss statuses with `proxy: true`
3. Tool returns `insufficient_data` when 0 snapshots
4. Tool returns high-influence entities (sorted by inDegree DESC)
5. Tool returns `methodology` string explaining proxy nature
6. `projectRoot` parameter resolves correctly

**Acceptance criteria**:
- All 6 tests pass
- Tool registered and callable via MCP server
- Output matches JSON schema from proposal

---

### Stage C2 — Register in MCP server (~10 lines modify + ~10 lines test)

**File**: `src/cli/mcp/mcp-server.ts` (modify, ~2 lines)

Add import and registration call:

```typescript
import { registerGIMTools } from './tools/gim-tools.js';
// in createMcpServer():
registerGIMTools(server, defaultRoot);
```

**File**: `tests/unit/cli/mcp/tools/gim-tools.test.ts` (extend)

Test:
7. GIM tool appears in server tool list

**Acceptance criteria**:
- MCP server starts without errors
- `archguard_get_gim_context` tool discoverable

---

## Phase D — System Prompt Generator (Plan 56)

**Depends on**: **Phase A** (direction hint) + **Phase B** (loss evaluator)
**Estimated lines**: ~40 source + ~40 lines test
**Files**:
- `src/analysis/gim/gim-prompt-generator.ts` (new)
- `src/cli/commands/analyze.ts` (modify: ~5 lines, extend `--gim` handler)
- `tests/unit/analysis/gim/gim-prompt-generator.test.ts` (new)

### Stage D1 — Prompt template generator (~40 lines source + ~40 lines test)

**File**: `src/analysis/gim/gim-prompt-generator.ts` (new, ~40 lines)

Implement `generateGimPrompt(hint: DirectionHint, losses: Record<string, LossStatus>): string`:

- Pure function, returns markdown string
- Includes: direction summary, loss table, caveat, recommendation
- Template structure matches proposal Section 4.1
- All values explicitly labeled as proxy approximations

**File**: `src/cli/commands/analyze.ts` (modify, ~5 lines)

Extend `--gim` handler from Stage A2. The full `--gim` orchestration in analyze.ts after analysis completes:

```typescript
// Full --gim flow (A2 sets up steps 1-3; D1 adds steps 4-5)
// 1. const snapshots = await loadSnapshots(outputDir);
// 2. const hint = computeDirectionHint(snapshots);
// 3. write hint to .archguard/gim/direction.json  (Stage A2)
// 4. const vector = snapshots.length > 0 ? snapshots[0].metricVector : null;
//    const losses = vector ? computeAllLosses(vector) : {};
// 5. const prompt = generateGimPrompt(hint, losses);
//    write prompt to .archguard/gim/system-prompt.md  (Stage D1)
```

- Write output to `.archguard/gim/system-prompt.md`

**File**: `tests/unit/analysis/gim/gim-prompt-generator.test.ts` (new)

Tests (TDD):
1. Expansion direction -> prompt contains "EXPANSION" and recommendation
2. Insufficient data -> prompt contains "insufficient data" notice
3. All 4 losses appear in markdown table
4. Proxy disclaimer present in output
5. Output is valid markdown (no unclosed formatting)

**Acceptance criteria**:
- All 5 tests pass
- `generateGimPrompt` is a pure function
- `archguard analyze --gim` writes system-prompt.md alongside direction.json

---

## Test Strategy

**Approach**: TDD (write tests first, then implement)

**Coverage target**: >= 80% line coverage for all new files

| Phase | Test file | Test count | Strategy |
|-------|-----------|------------|----------|
| A | `tests/unit/analysis/gim/direction-hint.test.ts` | 10 | Synthetic MetricSnapshot pairs with known deltas |
| B | `tests/unit/analysis/gim/gim-loss-evaluator.test.ts` | 9 | Synthetic MetricVector with known metric values |
| B | `tests/unit/analysis/fitness/rule-evaluator.test.ts` (extend) | 4 | Mixed rule arrays, config validation |
| C | `tests/unit/cli/mcp/tools/gim-tools.test.ts` | 7 | Mock snapshot-store and snapshot-diff, verify JSON shape |
| D | `tests/unit/analysis/gim/gim-prompt-generator.test.ts` | 5 | Template output assertions |

**Total**: ~35 new tests

**Mocking strategy**:
- `loadSnapshots` and `diffSnapshots` mocked in Phase A/C tests (avoid file I/O)
- `resolveRoot` and `loadEngine` mocked in Phase C tests (note: `loadEngine` signature is `loadEngine(archDir: string, scopeKey?: string): Promise<QueryEngine>`)
- No mocking needed for Phase B/D (pure functions with value inputs)

**Test gap acknowledgment**:
- No automated integration test for the full `--gim` flag flow (snapshots -> direction -> losses -> prompt -> file writes). The unit tests cover each piece in isolation; the integration is verified manually (see below).
- Phase C mocks `loadEngine` — if `getSummary()` response shape changes, the mock may drift. Pin mock shape to current `QueryEngine` interface.

**Integration verification**: After all phases, run `npm run build && node dist/cli/index.js analyze --gim -v` on ArchGuard itself to verify end-to-end. Confirm:
1. `.archguard/gim/direction.json` is written with valid `DirectionHint` JSON
2. `.archguard/gim/system-prompt.md` is written with markdown containing direction + loss table
3. Console output shows GIM direction hint summary
4. Without `--gim`, no `.archguard/gim/` directory is created

---

## Summary of file changes

| File | Phase | Operation | Lines changed |
|------|-------|-----------|---------------|
| `src/analysis/gim/direction-hint.ts` | A | new | ~80 |
| `src/analysis/gim/gim-loss-evaluator.ts` | B | new | ~80 |
| `src/analysis/gim/gim-prompt-generator.ts` | D | new | ~40 |
| `src/cli/mcp/tools/gim-tools.ts` | C | new | ~90 |
| `src/analysis/fitness/rule-types.ts` | B | modify | ~10 |
| `src/analysis/fitness/rule-evaluator.ts` | B | modify | ~5 |
| `src/cli/config-loader.ts` | B | modify | ~7 |
| `src/cli/commands/analyze.ts` | A+D | modify | ~20 |
| `src/cli/mcp/mcp-server.ts` | C | modify | ~2 |

**New code**: ~290 lines across 4 new files
**Modified code**: ~44 lines across 5 existing files (each < 20 lines)
