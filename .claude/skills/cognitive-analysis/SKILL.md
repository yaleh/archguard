---
name: cognitive-analysis
description: Run the 5-step Cognitive Analysis Loop to classify files as Pattern A/B/C and emit a per-package cognitive load heatmap. Pass a package path or file glob as the argument.
argument-hint: <package-path-or-glob>
allowed-tools:
  - mcp__archguard__archguard_get_cognitive_summary
  - mcp__archguard__archguard_get_change_risk
  - mcp__archguard__archguard_get_dependencies
  - mcp__archguard__archguard_get_entity_coverage
  - mcp__archguard__archguard_summary
  - mcp__plugin_meta-cc_meta-cc__query_tool_blocks
  - mcp__plugin_meta-cc_meta-cc__query_file_snapshots
  - Read
  - Bash
---

# Cognitive Analysis Loop

Classify source files as **Pattern A** (high comprehension cost, low edit frequency),
**Pattern B** (high edit frequency, convergence difficulty), or **Pattern C** (balanced)
and emit a per-package cognitive load heatmap.

## Prerequisites

- ArchGuard analysis artifacts must exist in `.archguard/` (run `npm run build && node dist/cli/index.js analyze -v` first).
- Meta-cc session history is optional but improves classification accuracy (behavioral R/E ratios). If absent, classification falls back to structural signals only.

## Step 1: Probe

For each entity in the target package:
1. Call `archguard_get_cognitive_summary` with the entity names to get methodCount, fieldCount, inDegree, outDegree, topDependents, topDependencies, testCoverageRatio, gitRiskLevel.
2. Call `archguard_get_change_risk` for git signals (changeFrequency, riskLevel).
3. If meta-cc session history is available, call `mcp__plugin_meta-cc_meta-cc__query_tool_blocks` filtered by the entity's file path to get read count (R) and edit count (E).

Collect results into a per-entity probe table:

| Entity | methodCount | outDegree | gitRisk | R | E | R/E |
|--------|-------------|-----------|---------|---|---|-----|

## Step 2: Focus — Pattern Classification

Apply thresholds to assign a candidate pattern:

**Primary (behavioral — use when meta-cc R and E are available):**
- R/E > 3.0 → **Pattern A candidate** (read many times, rarely edited = high comprehension cost)
- E/R > 1.5 → **Pattern B candidate** (edited more than read = convergence difficulty)
- Otherwise → **Pattern C** (balanced)

**Fallback (structural — use when meta-cc data is absent):**
- methodCount > 10 AND outDegree > 8 → **Pattern A candidate**
- gitRisk in ('HIGH', 'CRITICAL') AND methodCount > 5 → **Pattern B candidate**
- Otherwise → **Pattern C**

Flag Pattern A/B candidates for Deep Dive in Step 3.

## Step 3: Deep Dive

For each Pattern A or B candidate from Step 2:
1. Call `archguard_get_dependencies` with depth=1 to enumerate direct dependencies.
2. If meta-cc available, call `query_tool_blocks` for the file to see which tools were called most frequently — repeated `Read` calls on the same file confirm Pattern A; repeated `Edit` calls confirm Pattern B.
3. Confirm or revise the candidate pattern based on combined evidence.

## Step 4: Synthesize

Emit two output tables:

**Per-entity classification table:**
| Entity | File | Pattern | R/E ratio | outDegree | gitRisk | cognitiveLoad (0–1) |
|--------|------|---------|-----------|-----------|---------|---------------------|

cognitiveLoad formula: `min(1.0, (outDegree/20)*0.4 + (gitRiskScore/4)*0.3 + (1 - testCoverageRatio)*0.3)`
where gitRiskScore: LOW=1, MEDIUM=2, HIGH=3, CRITICAL=4.

**Per-package heatmap table:**
| Package | #Pattern A | #Pattern B | #Pattern C | Dominant Pattern |
|---------|-----------|-----------|-----------|-----------------|

## Step 5: Cache

If `.archguard/cognitive/` directory exists (CCB infrastructure from T3 is available):
- Write heatmap to `.archguard/cognitive/heatmap.json` as:
  ```json
  { "generatedAt": "<ISO timestamp>", "packages": [ { "package": "...", "patternA": 0, "patternB": 0, "patternC": 0, "dominant": "C" } ] }
  ```

If CCB infrastructure is absent:
- Emit inline note in the session transcript:
  `[cognitive-heatmap: {"generatedAt":"...","packages":[...]}]`

## Validation

Expected classifications on archguard self-analysis (as of 2026-06-22):

| Entity | File | Pattern | Rationale |
|--------|------|---------|-----------|
| QueryEngine | src/core/query/query-engine.ts | **A** | R=11, E=2 → R/E=5.5; outDegree=20; reads dominate (orientation cost) |
| FlowGraphBuilder | src/plugins/golang/atlas/builders/flow-graph-builder.ts | **B** | E=15, R=9 → E/R=1.67; gitRisk=CRITICAL; convergence difficulty |
| MermaidGenerator | src/mermaid/generator.ts | **C** | Balanced R/E, moderate outDegree |
| TypeScriptParser | src/parser/typescript-parser.ts | **C** | Moderate structural complexity, low git risk |
| CppPlugin | src/plugins/cpp/index.ts | **A** | High methodCount, high outDegree, low edit frequency |

Run `/cognitive-analysis src/` to reproduce these classifications.
