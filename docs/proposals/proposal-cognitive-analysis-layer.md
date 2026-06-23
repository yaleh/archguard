# Cognitive Analysis Layer: AI-Driven Code Comprehension Signals

> Status: Implemented (merged 2026-01-16, TASK-5)
> Scope: Framework — combines archguard (structural sensor) + meta-cc (behavioral sensor) with LLM reasoning to produce cognitive load intelligence
> Branch: `feat/cognitive-analysis` (future)

---

## Background

Static analysis tools measure what code *is*. Git history measures what code *was*. Neither
measures how hard code *is to work with* for an AI agent.

This proposal defines a **Cognitive Analysis Layer** — a reasoning workflow where Claude Code
or Codex calls archguard and meta-cc as mechanical sensors, then applies LLM inference to
produce cognitive load signals that neither tool can generate alone.

The framework was validated empirically by running archguard on its own codebase while
observing session history in meta-cc. The findings are documented in the Design section.

### Key Insight

> AI behavioral patterns are a proxy for code's cognitive properties that static analysis
> cannot capture.

When Claude reads a file 11 times but edits it only twice (`query-engine.ts`: R=11, E=2),
that ratio is not a measurement artifact — it encodes the comprehension cost of that file.
When Claude edits another file 15 times while reading it 9 times (`flow-graph-builder.ts`:
E=15, R=9), that ratio encodes the difficulty of converging to correct behavior.

These signals are invisible to any single tool. They emerge only when structural data
(archguard) and behavioral data (meta-cc) are held together and reasoned over by an LLM.

---

## The Three Behavioral Patterns

LLM inference over Read/Edit ratios identifies three distinct cognitive patterns:

### Pattern A — High-Comprehension, Low-Modification (HCLow-M)

```
Signal:  Read >> Edit  (ratio < 0.5)
Example: src/core/query/query-engine.ts  R=11, E=2, ratio=0.18x
         27 methods, out-degree=20, recently refactored (-730 lines)
```

Interpretation: the LLM needs many passes to build an accurate mental model before acting.
The code is **conceptually dense** — multiple orthogonal abstractions must be held in mind
simultaneously (e.g., `outputScope` × `queryFormat` × scope key resolution in QueryEngine).

This is not always pathological. Complex domain logic should require careful reading. It
becomes a problem when Pattern A coincides with high out-degree (many callers depend on
correct understanding of this file) and low or absent inline documentation of invariants.

**Root cause signal**: documentation debt or abstraction boundaries that are too wide.

### Pattern B — High-Iteration (HI)

```
Signal:  Edit >> Read  (ratio > 1.5)
Example: src/plugins/golang/atlas/builders/flow-graph-builder.ts  R=9, E=15, ratio=1.7x
         git risk CRITICAL (0.753), co-changes with golang/index.ts and atlas/types.ts
```

Interpretation: the LLM edits, runs tests, observes failure, re-edits. Correct behavior
cannot be predicted from reading the code — it must be discovered through iteration.

**Root cause signal**: behavioral invariants are implicit in tests rather than explicit in
interface contracts. The expected output shape of a builder is only knowable by running it.

### Pattern C — Balanced Active Development

```
Signal:  Read ≈ Edit  (ratio 0.6x – 1.4x)
Example: src/mermaid/generator.ts   R=14, E=12, ratio=0.9x
         src/cli/mcp/mcp-server.ts  R=11, E=11, ratio=1.0x
```

Interpretation: healthy development cadence. The LLM reads enough to understand, then
makes targeted changes. No excess exploration, no blind iteration.

---

## Empirical Validation

The following was observed by running this framework on archguard itself (2909 total
tool calls across project sessions):

| File | R | E | Ratio | Pattern | Structural Signal |
|---|---|---|---|---|---|
| `src/core/query/query-engine.ts` | 11 | 2 | 0.18x | A | 27 methods, out-degree=20 |
| `src/plugins/golang/atlas/builders/flow-graph-builder.ts` | 9 | 15 | 1.7x | B | git CRITICAL risk |
| `src/mermaid/generator.ts` | 14 | 12 | 0.9x | C | 61 entities in package |
| `src/cli/mcp/mcp-server.ts` | 11 | 11 | 1.0x | C | MCP entry point |
| `src/plugins/golang/index.ts` | 10 | 12 | 1.2x | C | git CRITICAL risk |

**Tool usage distribution** (`Bash:Edit = 1789:272 = 6.6:1`): the high Bash ratio
indicates that the LLM validates every edit through a full test run, rather than predicting
correctness from structural understanding alone. This is itself a signal: test suite
coverage (96.6%) is high, but LLM confidence in individual edits is low.

**API usability incident**: `archguard_get_dependencies("QueryEngine", depth=1)` returned
245,406 characters (7,266 lines), exceeding LLM token limits and forcing a disk fallback.
This is the first measured instance of archguard's own API creating a cognitive bottleneck
for the LLM using it.

---

## Goals

- Define the standard 5-step Cognitive Analysis Loop that LLM agents can execute using
  existing archguard and meta-cc MCP tools
- Specify three new capabilities required to close gaps found during validation:
  1. `archguard_get_cognitive_summary` — batch structural digest for high-complexity entities
     (see `proposal-cognitive-summary-mcp.md`)
  2. `meta-cc: query_edit_sequences` — ordered Read/Edit timeline per file
     (see meta-cc `proposal-edit-sequence-tool.md`)
  3. Cognitive Context Bundle (CCB) — standardized pre-edit context format
     (see `proposal-cognitive-context-bundle.md`)
- Produce a reference skill (`/cognitive-analysis`) that executes the loop

---

## Non-Goals

- Embedding LLM calls inside archguard or meta-cc; both remain LLM-free mechanical sensors
- Real-time file system monitoring (the loop is triggered on demand, not continuously)
- Replacing static analysis; cognitive signals are additive, not substitutive
- Cross-project cognitive analysis (single-project scope for this proposal)

---

## Design

### The Cognitive Analysis Loop

```
Step 1 — PROBE (parallel, fast)
  archguard_summary()              → entity counts, top by method/out-degree
  meta-cc.get_work_patterns()      → tool frequency, file churn, Bash ratio
  LLM: identify anomalies
       • Bash:Edit ratio > 5 → heavy test-driven iteration
       • entity with method_count > 20 AND in top-5 Read files → Pattern A candidate
       • high out-degree entity never in Edit files → potential dead interface

Step 2 — FOCUS (LLM selects top-N files from session churn + structural overlap)
  meta-cc.query_edit_sequences(top_files)  → ordered Read/Edit timeline
  archguard_get_change_context(top_files)  → git risk, co-change neighbors
  LLM: classify each file as Pattern A / B / C
       compute preliminary cognitive_cost score

Step 3 — DEEP DIVE (per-file, targeted)
  For Pattern A files:
    archguard_get_cognitive_summary([file])  → structural digest (NOT full dep graph)
    LLM: correlate read_count × out-degree × test_coverage → doc_debt_score
  For Pattern B files:
    archguard_get_entity_coverage(entity)   → test coverage detail
    archguard_get_cochange(file)            → evolutionary neighbors
    LLM: identify missing invariant documentation, hidden coupling

Step 4 — SYNTHESIZE
  LLM produces:
    • per-file cognitive pattern label (A/B/C)
    • cognitive_load_score [0–1] per file/package
    • doc_debt_priority list (Pattern A × out-degree ranked)
    • iteration_risk list (Pattern B × git_risk ranked)
    • api_usability_issues (tools whose output exceeded token limits)

Step 5 — CACHE as Cognitive Context Bundle (CCB)
  LLM writes CCB to .archguard/cognitive/context-<file-hash>.json
  CCB is reused in subsequent sessions until file content changes
```

### Architectural Principle

```
┌─────────────────────────────────────────────────────────────┐
│                 Claude Code / Codex                         │
│         ← LLM inference: pattern recognition,              │
│           cross-signal correlation, natural language output  │
└───────────────────┬────────────────────┬────────────────────┘
                    ↓                    ↓
         ┌──────────────────┐  ┌──────────────────────┐
         │    archguard     │  │       meta-cc         │
         │ (structural      │  │  (behavioral          │
         │  sensor)         │  │   sensor)             │
         │                  │  │                       │
         │ • entity/relation│  │ • Read/Edit sequences │
         │ • dependency graph│  │ • error→retry pairs  │
         │ • test coverage  │  │ • Bash call volume    │
         │ • git evolution  │  │ • token consumption   │
         │ • co-change      │  │ • stop_reason dist.   │
         └──────────────────┘  └──────────────────────┘
```

Both tools are LLM-free. Inference happens exclusively in the LLM layer.

### Signal Combination Matrix

| Structural Signal (archguard) | Behavioral Signal (meta-cc) | LLM Inference |
|---|---|---|
| high out-degree | high Read, low Edit | doc_debt: explain invariants |
| god class (methods > 20) | high Edit ratio | refactor: extract focused interface |
| low test coverage | high Edit, many errors | test gap: add invariant tests |
| git CRITICAL risk | Pattern B (high-iteration) | hidden coupling: explicit contract needed |
| no callers (dead code) | never Read or Edited | deletion candidate (high confidence) |
| recently refactored (-N lines) | high Read, low Edit | stabilization phase: doc the new shape |

---

## Plan

| Phase | Deliverable |
|---|---|
| 1 | This proposal + three sub-proposals reviewed and approved |
| 2 | Implement `archguard_get_cognitive_summary` MCP tool (archguard) |
| 3 | Implement `query_edit_sequences` tool (meta-cc) |
| 4 | Define CCB JSON schema; implement CCB writer skill in archguard |
| 5 | Implement `/cognitive-analysis` skill that executes the 5-step loop |
| 6 | Validate on archguard self-analysis and one external project (meta-cc) |

---

## Expected Outcomes

After the full loop runs on archguard itself, the LLM can produce:

```
Cognitive Analysis Report — archguard (2026-06-14)

HIGH DOC DEBT (Pattern A):
  src/core/query/query-engine.ts
    score: 0.87  [R=11, E=2, out-degree=20, coverage=100%]
    recommendation: Add invariant-level comments explaining outputScope×queryFormat
    orthogonality. These 2 dimensions are the primary source of comprehension cost.

HIGH ITERATION RISK (Pattern B):
  src/plugins/golang/atlas/builders/flow-graph-builder.ts
    score: 0.79  [E=15, R=9, git-risk=CRITICAL]
    recommendation: Document the expected FlowEdge shape and cycle-detection invariant
    at the builder interface level. Currently only expressible by running tests.

API USABILITY:
  archguard_get_dependencies("QueryEngine", depth=1) → 245K chars, exceeded LLM limit
    recommendation: Use archguard_get_cognitive_summary instead for initial orientation.

COGNITIVE LOAD HEATMAP (packages):
  src/plugins/golang/atlas/builders/  ████████░░  0.79  (Pattern B dominant)
  src/core/query/                     ███████░░░  0.71  (Pattern A dominant)
  src/mermaid/                        █████░░░░░  0.53  (Pattern C, healthy)
  src/types/                          █░░░░░░░░░  0.12  (low cognitive load)
```
