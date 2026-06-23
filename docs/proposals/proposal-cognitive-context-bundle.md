# Cognitive Context Bundle (CCB): Standardized Pre-Edit Context

> Status: Implemented (merged 2026-01-16, TASK-6)
> Scope: Standard format + assembly workflow for the context package Claude prepares before
>        editing a file; cached to disk and reused across sessions
> Branch: `feat/cognitive-context-bundle` (future)
> Depends on: `proposal-cognitive-analysis-layer.md`, `proposal-cognitive-summary-mcp.md`,
>             meta-cc `proposal-edit-sequence-tool.md`

---

## Background

Before editing a file, Claude typically performs a series of exploratory tool calls —
reading the file, querying its dependencies, checking recent git history — to build enough
context to act correctly. This exploration is:

1. **Repetitive**: the same queries are made at the start of every new session touching the
   same file, even if the file has not changed
2. **Unstructured**: context is assembled ad hoc, varying in depth and coverage between
   sessions and between LLM models
3. **Token-expensive**: structural queries (especially dependency graphs) consume significant
   context budget before any editing begins

The **Cognitive Context Bundle (CCB)** is a standardised JSON artifact that captures the
relevant structural, behavioral, and cognitive signals for a file. It is:

- **Assembled by the LLM** (not by archguard or meta-cc directly) from the outputs of the
  Cognitive Analysis Loop (see `proposal-cognitive-analysis-layer.md`)
- **Cached to disk** at `.archguard/cognitive/<file-hash>.json`
- **Reused** in subsequent sessions until the file's content hash changes
- **Compact** — designed to be injected into an LLM's system prompt or first user turn
  without significant token cost (target: < 1KB per file)

---

## Goals

- Define the CCB JSON schema
- Implement a CCB writer utility in archguard (`src/cli/cognitive/ccb-writer.ts`)
- Implement a CCB reader utility (`src/cli/cognitive/ccb-reader.ts`) that validates
  freshness by comparing the stored file hash against the current file
- Add `archguard_get_ccb` MCP tool that returns the CCB for a file, assembling it
  on demand if absent or stale
- Implement a `/cognitive-prep` skill that assembles CCBs for all files in a planned edit

---

## Non-Goals

- Storing the CCB inside the source file (e.g., as a comment block); it lives on disk only
- Including full code content in the CCB; the LLM reads the file itself
- Automatic CCB assembly on every file change (demand-driven only)
- Multi-file aggregate CCBs; one CCB per source file

---

## CCB JSON Schema

```typescript
interface CognitiveCon textBundle {
  // Provenance
  schemaVersion: "1.0";
  generatedAt: string;          // ISO 8601
  fileHash: string;             // SHA-256 of file content at time of assembly
  filePath: string;             // relative to project root

  // Behavioral signals (from meta-cc session history)
  behavior: {
    pattern: "A" | "B" | "C" | "unknown";
    // A = HCLow-M: high reads, low edits — conceptually dense
    // B = HI: high edits relative to reads — hard to converge
    // C = Balanced: healthy development cadence
    sessionReadCount: number;   // Read tool calls to this file (all sessions)
    sessionEditCount: number;   // Edit/Write tool calls to this file (all sessions)
    readEditRatio: number;      // sessionReadCount / max(sessionEditCount, 1)
    recentSessionCount: number; // sessions that touched this file in last 30 days
  };

  // Structural signals (from archguard)
  structure: {
    primaryEntity: string;      // name of the main class/interface in this file
    entityCount: number;        // total entities defined in this file
    methodCount: number;        // total methods across all entities
    outDegree: number;          // number of direct structural dependencies
    inDegree: number;           // number of direct dependents
    testCoverageScore: number;  // 0.0–1.0 from archguard test analysis
    testFileCount: number;
  };

  // Git evolution signals (from archguard git history)
  evolution: {
    commitCount: number;        // in analyzed window (default 90 days)
    riskLevel: "low" | "medium" | "high" | "critical";
    primaryOwner: string;       // email
    lastChangedAt: string;      // YYYY-MM-DD
    topCochangeNeighbors: Array<{ file: string; strength: number }>;
    // strength: Jaccard similarity [0, 1]
  };

  // Composite scores (LLM-computed)
  scores: {
    cognitiveLoad: number;      // [0, 1] — higher = more LLM effort needed
    docDebtScore: number;       // [0, 1] — higher = more documentation needed
    iterationRisk: number;      // [0, 1] — higher = harder to get right first try
  };

  // LLM-generated guidance (the key differentiator)
  guidance: {
    summary: string;            // 1–2 sentences: what this file does and why it's complex
    keyInvariants: string[];    // known invariants/contracts Claude must respect
    editPrecautions: string[];  // specific things to check or avoid when editing
    cochangeAlert?: string;     // if topCochangeNeighbors is non-empty: "editing this
                                //  file typically requires also editing X"
  };
}
```

### Example CCB

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-06-14T12:30:00Z",
  "fileHash": "a3f8c2...",
  "filePath": "src/core/query/query-engine.ts",

  "behavior": {
    "pattern": "A",
    "sessionReadCount": 11,
    "sessionEditCount": 2,
    "readEditRatio": 5.5,
    "recentSessionCount": 4
  },

  "structure": {
    "primaryEntity": "QueryEngine",
    "entityCount": 1,
    "methodCount": 27,
    "outDegree": 20,
    "inDegree": 8,
    "testCoverageScore": 1.0,
    "testFileCount": 13
  },

  "evolution": {
    "commitCount": 4,
    "riskLevel": "high",
    "primaryOwner": "calvino.huang@gmail.com",
    "lastChangedAt": "2026-06-12",
    "topCochangeNeighbors": [
      { "file": "tests/unit/cli/query/query-engine.test.ts", "strength": 0.4 },
      { "file": "src/core/query/edge-list-serializer.ts",    "strength": 0.25 }
    ]
  },

  "scores": {
    "cognitiveLoad": 0.87,
    "docDebtScore": 0.82,
    "iterationRisk": 0.31
  },

  "guidance": {
    "summary": "QueryEngine is the central query dispatcher for all MCP and CLI query operations. Its 27 methods span three orthogonal concerns: entity lookup, relation traversal, and output formatting.",
    "keyInvariants": [
      "outputScope (package/class/method) and queryFormat (structured/edge-list) are fully orthogonal — a change to one must not assume the value of the other.",
      "All query methods must be idempotent with respect to the underlying ArchJSON; QueryEngine holds no mutable state.",
      "Scope key resolution ('global' alias → manifest.globalScopeKey) happens at the QueryEngine boundary — callers must not resolve scope keys themselves."
    ],
    "editPrecautions": [
      "Any new query method must pass through OutputScopeFilter to honour the outputScope parameter.",
      "Test coverage is 100% — all 13 test files are likely affected by interface changes; run tests/unit/core/query/ and tests/unit/cli/query/ after edits.",
      "QueryEngine is imported by 8 entities including McpServer and ArchJsonProvider — a signature change cascades broadly."
    ],
    "cochangeAlert": "Editing this file has a 50% historical co-change rate with tests/unit/cli/query/query-engine.test.ts — plan to update tests in the same session."
  }
}
```

---

## Freshness Model

A CCB is **stale** when the current SHA-256 of the source file differs from `fileHash`.

On `archguard_get_ccb(file)`:
1. Check if `.archguard/cognitive/<file-hash>.json` exists
2. Hash the current file content
3. If hash matches → return cached CCB (fast path, no tool calls needed)
4. If hash differs or CCB absent → trigger assembly:
   - Call `archguard_get_cognitive_summary([file])` for structural signals
   - Call `archguard_get_change_context(file)` for git signals
   - Call `meta-cc.query_edit_sequences(file)` for behavioral signals
   - LLM synthesizes scores and `guidance` block
   - Writer saves to `.archguard/cognitive/<new-hash>.json`
   - Old CCB file is deleted

Behavioral signals (`behavior.*`) are the only fields with a weaker freshness guarantee:
they reflect session history up to the last meta-cc query, which may lag real time by one
session. This is acceptable — the pattern classification (A/B/C) is stable over multiple
sessions and not invalidated by individual edits.

---

## `archguard_get_ccb` MCP Tool

```typescript
archguard_get_ccb({
  file: string,            // relative file path
  forceRefresh?: boolean,  // ignore cache, always re-assemble (default: false)
  projectRoot?: string,
})
→ CognitiveContextBundle | { found: false, reason: string }
```

The tool returns the CCB directly in the MCP response (not as a file_ref) because CCBs
are designed to fit the token budget.

---

## `/cognitive-prep` Skill

Before beginning a multi-file editing task, Claude invokes `/cognitive-prep` with the list
of files it intends to edit. The skill:

1. Calls `archguard_get_ccb` for each file (parallel)
2. For stale/missing CCBs, triggers the Cognitive Analysis Loop steps 1–4
3. Returns a summary: "Ready. Loaded CCBs for 4 files. 2 are Pattern B (high iteration
   risk): flow-graph-builder.ts (score 0.79) and golang/index.ts (score 0.71). Key
   co-change alert: editing flow-graph-builder.ts typically requires also updating
   atlas/types.ts (co-change strength 0.33)."

---

## Implementation

```
src/cli/cognitive/
├── ccb-schema.ts          CognitiveContextBundle interface
├── ccb-writer.ts          assembleAndSave(file, signals) → void
├── ccb-reader.ts          load(file) → CCB | null (null if stale/absent)
└── ccb-assembler.ts       orchestrates tool calls + LLM synthesis

src/cli/mcp/tools/
└── cognitive-ccb-tool.ts  archguard_get_ccb MCP handler

.archguard/cognitive/      on-disk CCB store (gitignored)
```

---

## Plan

| Phase | Work |
|---|---|
| 1 | Define `CognitiveContextBundle` schema in `src/cli/cognitive/ccb-schema.ts` |
| 2 | Implement `ccb-writer.ts` and `ccb-reader.ts` with hash-based freshness |
| 3 | Implement `ccb-assembler.ts`: reads signals from archguard + meta-cc artifacts, calls LLM for `scores` and `guidance` generation |
| 4 | Add `archguard_get_ccb` MCP tool |
| 5 | Add `/cognitive-prep` skill |
| 6 | Unit tests: fresh CCB return, stale detection, assembly round-trip |
| 7 | Integration test: full loop on archguard self (`query-engine.ts` produces Pattern A CCB) |
| 8 | Add `.archguard/cognitive/` to `.gitignore` |

---

## Design Decisions

**Why LLM generates `guidance`?** The `guidance.keyInvariants` and `editPrecautions`
fields require reasoning that neither archguard nor meta-cc can produce mechanically. An
invariant like "outputScope and queryFormat are orthogonal" cannot be derived from the
dependency graph — it requires understanding the semantics of the parameters. The LLM is
the only component in the stack capable of this inference.

**Why cache on disk?** The assembly process requires multiple tool calls and LLM inference.
For large projects, assembling CCBs for all touched files on every session start would be
prohibitively slow. Caching makes the common case (file unchanged between sessions) a
near-zero-cost operation.

**Why one CCB per file, not per entity?** Files are the natural unit of Claude's editing
operations (Edit, Write tools operate on files). Entities within a file share the same
behavioral history (they are Read and Edited together). A per-entity CCB would fragment
the behavioral signal unnecessarily.
