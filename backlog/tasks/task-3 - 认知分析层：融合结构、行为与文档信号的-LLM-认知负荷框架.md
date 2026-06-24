---
id: TASK-3
title: 认知分析层：融合结构、行为与文档信号的 LLM 认知负荷框架
status: 'Epic: Done'
assignee: []
created_date: '2026-06-22 15:28'
updated_date: '2026-06-23 05:59'
labels:
  - 'kind:epic'
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
为认知系列创建 epic task 。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Epic Proposal: 认知分析层：融合结构、行为与文档信号的 LLM 认知负荷框架

## Background

Static analysis measures what code *is*; git history measures what code *was*. Neither
answers: *how hard will this file be for an AI agent to work with?* Empirical observation
of archguard's own session history (2909 tool calls, R/E ratios 0.18×–1.7× across key
files) shows that AI behavioral patterns are a reliable proxy for cognitive properties no
single tool can capture: a file read 11 times but edited twice encodes comprehension cost;
one edited 15 times while read 9 encodes convergence difficulty. These signals are
currently lost between sessions, forcing redundant structural exploration on every new
task. This epic builds infrastructure to capture, fuse, and cache structural (archguard),
behavioral (meta-cc), and documentation signals into a reusable cognitive load framework.

## Goals

1. A 5-step Cognitive Analysis Loop is defined as a reference `/cognitive-analysis` skill
   and executable against the archguard codebase, producing Pattern A/B/C classifications
   and cognitive load scores for at least 5 files — verifiable by running the skill and
   inspecting its output.
2. A new MCP tool `archguard_get_cognitive_summary` exists at
   `src/cli/mcp/tools/cognitive-summary-tool.ts`, returns < 2 KB per entity for any
   entity regardless of out-degree (including `QueryEngine` with out-degree=20), and is
   verified by unit tests covering single-entity, batch-of-10, and missing-entity inputs.
3. A Cognitive Context Bundle (CCB) schema is defined at
   `src/cli/cognitive/ccb-schema.ts` with writer/reader utilities (`ccb-writer.ts`,
   `ccb-reader.ts`) and an `archguard_get_ccb` MCP tool; SHA-256-based freshness
   enforcement is verified by an integration test confirming that a stale CCB triggers
   full reassembly while an unchanged-file CCB is returned from disk with no tool calls.
4. The CCB `documentation` field is implemented in the CCB assembler, integrating
   `docFreshnessGap` (computed from git co-change artifacts in archguard) with `docVoid`
   and `specPrecisionGap` (consumed from meta-cc `query_edit_sequences`); verified by
   unit tests for each flag and an integration test where `flow-graph-builder.ts` yields
   `docVoid=true` and `cognitiveLoad >= 0.90`.

## Decomposition Sketch

- **T1: archguard_get_cognitive_summary MCP tool** — Implement the compact structural
  digest tool at `src/cli/mcp/tools/cognitive-summary-tool.ts` returning method count,
  field count, in/out degree, top-5 dependents/dependencies, test coverage, and git risk
  per entity from existing `.archguard/` artifacts; register in `mcp-server.ts`; ship
  unit tests and update MCP usage guide.
- **T2: Cognitive Analysis Loop definition and /cognitive-analysis skill** — Define the
  5-step loop (Probe → Focus → Deep Dive → Synthesize → Cache) as an executable skill
  that uses existing archguard + meta-cc MCP tools to classify files as Pattern A/B/C
  and emit a cognitive load heatmap per package; validate on archguard self-analysis.
- **T3: Cognitive Context Bundle — schema, writer, reader, MCP tool, and /cognitive-prep
  skill** — Define `CognitiveContextBundle` interface in `src/cli/cognitive/ccb-schema.ts`;
  implement `ccb-writer.ts` (SHA-256 hash-keyed caching to `.archguard/cognitive/`) and
  `ccb-reader.ts` (freshness check); add `archguard_get_ccb` MCP tool; implement
  `/cognitive-prep` skill that assembles CCBs in parallel for all files in a planned
  edit; add `.archguard/cognitive/` to `.gitignore`.
- **T4: Documentation signals integration into CCB** — Extend `ccb-assembler.ts` with
  `docFreshnessGap` (filter `topCochangeNeighbors` by `.md`/`.rst` extension) and consume
  meta-cc `CoAccessedDocs`/`DocVoid`/`SpecPrecisionGap` from `query_edit_sequences`;
  generate LLM-driven `deFactoSpec` and `freshnessWarning` guidance when any flag is set.
  *Blocked on meta-cc `proposal-doc-session-signals.md` being implemented externally.*

## Trade-offs and Risks

**What we are not doing:**
- Embedding LLM calls inside archguard or meta-cc; both remain LLM-free mechanical
  sensors. All pattern recognition and scoring happens in the LLM layer.
- Real-time or event-driven monitoring; the Cognitive Analysis Loop is demand-triggered.
- Cross-project cognitive analysis; scope is single project per invocation.
- Automatic CCB assembly on every file change; CCBs are assembled on demand only.
- Semantic analysis of documentation content; signals are structural and behavioral only.

**Known risks:**
- **External dependency (T4):** The `documentation` field in the CCB requires meta-cc to
  implement `proposal-doc-session-signals.md` (specifically `CoAccessedDocs`, `DocVoid`,
  and `SpecPrecisionGap` signals exposed via `query_edit_sequences`). This is an external
  project not under archguard's control. T4 is blocked until that meta-cc feature ships;
  T1–T3 are fully independent and can proceed without it. T4 must be treated as a
  conditionally-blocked child task with an explicit external dependency gate.
- **Behavioral signal freshness lag:** Meta-cc session history may lag real-time by one
  session. Pattern classifications for a file undergoing a major refactor may be based on
  pre-refactor behavioral data until the next session completes. Mitigated by keying CCB
  freshness on the source file's SHA-256 hash, not session timestamp.
- **LLM-generated guidance quality:** The `guidance.keyInvariants` and `editPrecautions`
  fields require LLM synthesis; their accuracy depends on model capability and available
  context at assembly time. No automated correctness gate exists for these narrative
  fields. The only validation is through manual inspection during integration testing.
- **CCB assembly latency at scale:** Assembling a stale CCB requires multiple MCP tool
  calls plus one LLM inference pass. For large projects with many simultaneously-stale
  CCBs, `/cognitive-prep` may be slow. The skill must parallelize `archguard_get_ccb`
  calls (already noted in the CCB proposal) to keep wall-clock time acceptable.

---

# Epic Plan: 认知分析层：融合结构、行为与文档信号的 LLM 认知负荷框架

## Background

Static analysis measures what code *is*; git history measures what code *was*. Neither
answers: *how hard will this file be for an AI agent to work with?* Empirical observation
of archguard's own session history (2909 tool calls, R/E ratios 0.18×–1.7× across key
files) shows that AI behavioral patterns are a reliable proxy for cognitive properties no
single tool can capture: a file read 11 times but edited twice encodes comprehension cost;
one edited 15 times while read 9 encodes convergence difficulty. These signals are
currently lost between sessions, forcing redundant structural exploration on every new
task. This epic builds infrastructure to capture, fuse, and cache structural (archguard),
behavioral (meta-cc), and documentation signals into a reusable cognitive load framework.

The framework is validated empirically: `src/core/query/query-engine.ts` (Pattern A,
R=11 E=2 out-degree=20), `src/plugins/golang/atlas/builders/flow-graph-builder.ts`
(Pattern B, E=15 R=9, git CRITICAL risk), and `src/mermaid/generator.ts` (Pattern C,
balanced). The `archguard_get_dependencies("QueryEngine", depth=1)` call produced 245,406
characters — exceeding LLM token limits — making the compact cognitive-summary tool a
hard requirement, not an optimisation.

## Goals

1. A 5-step Cognitive Analysis Loop is defined as a reference `/cognitive-analysis` skill
   and executable against the archguard codebase, producing Pattern A/B/C classifications
   and cognitive load scores for at least 5 files — verifiable by running the skill and
   inspecting its output.
2. A new MCP tool `archguard_get_cognitive_summary` exists at
   `src/cli/mcp/tools/cognitive-summary-tool.ts`, returns < 2 KB per entity for any
   entity regardless of out-degree (including `QueryEngine` with out-degree=20), and is
   verified by unit tests covering single-entity, batch-of-10, and missing-entity inputs.
3. A Cognitive Context Bundle (CCB) schema is defined at
   `src/cli/cognitive/ccb-schema.ts` with writer/reader utilities (`ccb-writer.ts`,
   `ccb-reader.ts`) and an `archguard_get_ccb` MCP tool; SHA-256-based freshness
   enforcement is verified by an integration test confirming that a stale CCB triggers
   full reassembly while an unchanged-file CCB is returned from disk with no tool calls.
4. The CCB `documentation` field is implemented in the CCB assembler, integrating
   `docFreshnessGap` (computed from git co-change artifacts in archguard) with `docVoid`
   and `specPrecisionGap` (consumed from meta-cc `query_edit_sequences`); verified by
   unit tests for each flag and an integration test where `flow-graph-builder.ts` yields
   `docVoid=true` and `cognitiveLoad >= 0.90`.

## Sub-Task Decomposition

1. **T1: archguard_get_cognitive_summary MCP tool** — Implement `src/cli/mcp/tools/cognitive-summary-tool.ts` returning compact structural digest (method count, field count, in/out degree, top-5 dependents/dependencies, test coverage, git risk) assembled from existing `.archguard/` artifacts; add `CognitiveSummaryEntry` type to `src/types/`; register in `mcp-server.ts`; ship unit tests (single entity, batch of 10, missing entity) and update MCP usage guide.
2. **T2: Cognitive Analysis Loop and /cognitive-analysis skill** — Define the 5-step loop (Probe → Focus → Deep Dive → Synthesize → Cache) as an executable Claude Code skill that uses existing archguard and meta-cc MCP tools to classify files as Pattern A/B/C and emit a per-package cognitive load heatmap; validate on archguard self-analysis producing classifications for at least 5 files including `query-engine.ts` (A) and `flow-graph-builder.ts` (B).
3. **T3: Cognitive Context Bundle — schema, writer, reader, MCP tool, and /cognitive-prep skill** — Define `CognitiveContextBundle` interface in `src/cli/cognitive/ccb-schema.ts`; implement `ccb-writer.ts` (SHA-256 hash-keyed write to `.archguard/cognitive/`) and `ccb-reader.ts` (freshness check); implement `ccb-assembler.ts` orchestrating tool calls and LLM synthesis; add `archguard_get_ccb` MCP tool; implement `/cognitive-prep` skill; add `.archguard/cognitive/` to `.gitignore`; verify freshness via integration test.
4. **T4: Documentation signals integration into CCB** — Extend `ccb-assembler.ts` with `computeDocFreshnessGap` (filter `topCochangeNeighbors` by `.md`/`.rst` extension); extend `CognitiveContextBundle` with `documentation` field; consume `CoAccessedDocs`, `DocVoid`, and `SpecPrecisionGap` from meta-cc `query_edit_sequences`; generate LLM-driven `deFactoSpec` and `freshnessWarning` guidance when flags are set; verify with unit tests for each flag and integration test confirming `flow-graph-builder.ts` yields `docVoid=true` and `cognitiveLoad >= 0.90`. *Blocked on meta-cc `proposal-doc-session-signals.md` being implemented externally.*

## Sequencing

**T1 must land before T2, T3, and T4.**
T1 delivers `archguard_get_cognitive_summary`, which is the primary orientation tool
called in Step 3 (Deep Dive) of the Cognitive Analysis Loop (T2) and in the CCB assembler
(T3). Without T1, both T2 and T3 would have to fall back to the 245K-character
`archguard_get_dependencies` output, which is infeasible for LLM consumption.

**T2 and T3 can proceed in parallel after T1 lands.**
T2 (the skill/loop) and T3 (CCB schema + infrastructure) have no mutual dependency at
implementation time. T2 validates the loop interactively; T3 builds the cached artifact
format. They may be developed in parallel by different agents after T1 is complete.

**T3 must land before T4.**
T4 extends the CCB schema (`CognitiveContextBundle`) and the assembler (`ccb-assembler.ts`)
defined in T3. T4 cannot be implemented until T3's `ccb-schema.ts` and `ccb-assembler.ts`
are merged.

**T4 is additionally gated on an external meta-cc dependency.**
T4 consumes `CoAccessedDocs`, `DocVoid`, and `SpecPrecisionGap` signals from meta-cc's
`query_edit_sequences` tool, which requires `proposal-doc-session-signals.md` to be
implemented in the meta-cc project (external, not under archguard's control). Until that
work ships, T4 cannot complete its end-to-end integration test. T4 may be partially
started (schema extension + local `docFreshnessGap` computation from git artifacts) but
must be explicitly held at "In Progress" until the meta-cc gate clears.

**Recommended execution order:** T1 → (T2 ‖ T3) → T4

## Constraints

- No LLM calls inside archguard or meta-cc TypeScript code. Both remain LLM-free
  mechanical sensors. All pattern recognition, scoring, and `guidance` generation happen
  in the LLM (Claude Code) layer — either in the `/cognitive-analysis` skill or inside
  the CCB assembler invoked via `archguard_get_ccb`.
- `archguard_get_cognitive_summary` must return < 2 KB per entity and < 20 KB for a
  batch of 10, regardless of entity out-degree. This is a hard token-budget constraint;
  the tool must not pass through full dependency graph payloads.
- CCBs are assembled on demand only, not automatically on file change. The
  `.archguard/cognitive/` directory is gitignored and treated as a local cache.
- SHA-256 file hashing (not session timestamp) is the freshness key for CCBs. A CCB is
  stale when the source file's current hash differs from `fileHash` in the bundle.
- T4 carries an explicit external dependency gate: it MUST NOT be considered "Done"
  until meta-cc `proposal-doc-session-signals.md` ships `query_edit_sequences` with
  `CoAccessedDocs`, `DocVoid`, and `SpecPrecisionGap` fields populated. T1–T3 are fully
  independent of this gate and may complete without it.
- All new MCP tools must follow the existing registration pattern in
  `src/cli/mcp/mcp-server.ts` (using `server.tool(...)` with Zod schemas, consistent
  with `test-analysis-tools.ts`, `atlas-analytics-tools.ts`, and `git-history-tools.ts`).
- New TypeScript files under `src/cli/cognitive/` and `src/cli/mcp/tools/` must use
  path aliases (`@/types`, `@/cli`, etc.) rather than relative imports across module
  boundaries, per project convention.
- Test suite must remain at or above the current passing count after each child task
  (currently 3141+ passing, 0 failing). Each child task ships its own unit tests before
  merging.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Epic proposal self-review: APPROVED
premise-ledger:
Motivation (WHY, 3-8 lines): Background is 8 lines, explains why signals are lost between sessions forcing redundant exploration. PASS.
Goals (numbered, verifiable): 4 goals, each checkable by running skill output inspection or unit/integration test assertions. PASS.
Decomposition Sketch (>=2 children, covers Goals): 4 candidate children T1-T4 with one-line scope each; T1→Goal2, T2→Goal1, T3→Goal3, T4→Goal4. PASS.
Feasibility (aligns with codebase): MCP tools pattern established at src/cli/mcp/tools/; cognitive/ dir does not yet exist (correctly new); artifact paths match existing .archguard/ structure. PASS.
Completeness (trade-offs and risks): 5 non-goals and 4 risks identified; external meta-cc dependency for T4 explicitly called out. PASS.
Consistency (no contradictions): T4 external block stated consistently in both Decomposition and Trade-offs sections. PASS.
GCL-self-report: E=1 C=0 H=0

Epic proposal approved. Starting epic plan draft.

Epic plan drafted. 4 children decomposed: T1 (cognitive-summary MCP tool) → T2 (loop skill) ‖ T3 (CCB infra) → T4 (doc signals, externally gated). Plan written to /tmp/etb-plan.md and set in task Implementation Plan section.

Epic plan review iteration 1: APPROVED
premise-ledger:
[E] Sub-Task Decomposition present: Section exists with 4 children (T1–T4), each with title and one-line description.
[E] Goal coverage: Goal 1→T2, Goal 2→T1, Goal 3→T3, Goal 4→T4 — all covered.
[E] Sequencing coherence: T1→(T2‖T3)→T4 stated explicitly, rationale sound, acyclic, T4 external gate documented.
[E] Scope discipline: All children map to declared Goals; T4 conditional flag is correct, not a hidden epic.
[E] No premature creation: Plan describes intended children only, creates none.
[E] File paths / feasibility: src/cli/mcp/tools/ exists with 5 tool files — cognitive-summary-tool.ts follows established pattern; src/cli/cognitive/ does not exist yet — T3 creating it is correct; mcp-server.ts uses server.tool() + register*Tools(server, defaultRoot) pattern confirmed; @/types alias confirmed, CognitiveSummaryEntry addition is consistent with existing extensions.
GCL-self-report: E=6 C=0 H=0

cap:propose=approved

cap:decompose=started

cap:decompose=done
epicDecompose: 4 children created at Basic: Proposal. Promote chosen children -> Basic: Ready to execute.
Sequencing: T1 first (TASK-4, others depend on it), then T2 (TASK-5) and T3 (TASK-6) in parallel, T4 (TASK-7) last (blocked on meta-cc).

cap markers cleared: cap:decompose reset (children archived — will re-decompose via feature-to-backlog)

cap:decompose=started (re-decompose after archive reset)

cap:decompose=done
epicDecompose: 4 children created at Basic: Backlog. Promote chosen children → Basic: Ready to execute.
Sequencing: T1 first (TASK-4, others depend on it), then T2 (TASK-5) and T3 (TASK-6) in parallel, T4 (TASK-7) last (blocked on meta-cc external dependency).

Sub-task TASK-4 completed: 2026-06-22T17:05:22Z

onChildDone: 1/4 children done (TASK-4 Basic: Done; TASK-5, TASK-6, TASK-7 at Basic: Backlog)

Sub-task TASK-5 completed: 2026-06-22T17:15:38Z

onChildDone: 0/4 children done (TASK-4, TASK-5 Basic: Done; TASK-6 In Progress; TASK-7 Backlog)

onChildDone TASK-5: 2/4 children done (TASK-4 ✓, TASK-5 ✓; TASK-6 In Progress, TASK-7 Backlog)

Sub-task TASK-6 completed: 2026-06-22T17:25:33Z

onChildDone TASK-6: 3/4 children done (TASK-4 ✓, TASK-5 ✓, TASK-6 ✓; TASK-7 at Basic: Backlog — blocked on meta-cc external dependency)

Sub-task TASK-7 reached terminal status: Basic: Done — 2026-06-23T04:12:20Z

onChildDone: 4/4 children done — all children Basic: Done

cap:evaluate=recommendation:FINISH | done=4 needsHuman=0 | all children Basic: Done with DoD pass | data_source: measured

RECOMMENDATION: FINISH.
To finish: set status → Epic: Done.
To iterate: set status → Epic: Proposal or Epic: Plan and re-run /epic-to-backlog.
<!-- SECTION:NOTES:END -->
