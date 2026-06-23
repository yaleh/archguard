# Documentation-Code Sync Analysis: Freshness Gap and CCB Integration

> Status: Implemented (merged 2026-01-16, TASK-7)
> Scope: Consume doc session signals from meta-cc to detect documentation freshness gaps
>        and extend the Cognitive Context Bundle with a `documentation` field
> Branch: `feat/doc-code-sync` (future)
> Depends on: `proposal-cognitive-analysis-layer.md`,
>             `proposal-cognitive-context-bundle.md`,
>             meta-cc `proposal-doc-session-signals.md`

---

## Background

Documentation files play two structurally distinct roles in AI-assisted development
sessions (empirically observed in archguard's own session history: 17.3% of file touches
are `.md` files). The behavioral signals — which doc files were co-accessed alongside a
source file, and whether iteration remained high despite a spec being present — are
detected mechanically by meta-cc (see `proposal-doc-session-signals.md`).

This proposal covers the archguard side: one new mechanical signal that requires git
history data unavailable to meta-cc, and the integration of all doc signals into the
Cognitive Context Bundle (CCB).

### Signals Produced Here

| Signal | Source | How |
|---|---|---|
| `docFreshnessGap` | archguard (this proposal) | filter `topCochangeNeighbors` by `.md` extension |
| CCB `documentation` field | archguard CCB assembler | reads meta-cc flags + `docFreshnessGap` → LLM generates `guidance` text |

### Signals Consumed from meta-cc

| Signal | Produced by |
|---|---|
| `CoAccessedDocs` | meta-cc `proposal-doc-session-signals.md` |
| `DocVoid` | meta-cc `proposal-doc-session-signals.md` |
| `SpecPrecisionGap` | meta-cc `proposal-doc-session-signals.md` |

---

## Goals

- Compute `docFreshnessGap` from existing archguard git co-change artifacts: a source
  file changes frequently in git but no `.md` file co-changes with it
- Extend `CognitiveContextBundle` with a `documentation` field that aggregates all doc
  signals (from meta-cc and from git history)
- Update the CCB assembler to read meta-cc doc flags and produce LLM-generated guidance
  when any doc signal is set

---

## Non-Goals

- Re-implementing the session behavioral signals (`DocVoid`, `SpecPrecisionGap`,
  `CoAccessedDocs`) — those belong to meta-cc
- Analyzing the semantic content of documentation files
- Enforcing documentation standards or automatically generating docs

---

## Design

### 1. Doc Freshness Gap (archguard git)

`docFreshnessGap` answers: *does this source file change frequently in git without any
documentation file changing alongside it?*

The data already exists in `.archguard/query/git-history/file-metrics.json`. Each entry
contains `topCochangeNeighbors` — a ranked list of files that change together with the
target. The check is a single filter:

```typescript
function computeDocFreshnessGap(metrics: FileHistoryMetrics): boolean {
  if (metrics.commitCount < 5) return false;          // not actively changing
  const hasDocNeighbor = metrics.topCochangeNeighbors
    .some(n => n.target.endsWith('.md') || n.target.endsWith('.rst'));
  return !hasDocNeighbor;
}
```

A `docFreshnessGap=true` result means: the file has been committed ≥ 5 times in the
analyzed window (default: 90 days) but no documentation file has co-changed with it.
This is a staleness signal — either no documentation exists, or it exists but is not
being updated alongside the code.

This is implemented in `src/cli/cognitive/ccb-assembler.ts` alongside the other git
signal reads, not as a new MCP tool. The computation is a one-liner against existing
artifact data.

### 2. CCB `documentation` Field

Extend `CognitiveContextBundle` (defined in `proposal-cognitive-context-bundle.md`):

```typescript
interface CognitiveContextBundle {
  // ... existing fields (behavior, structure, evolution, scores, guidance) ...

  documentation: {
    // Spec docs co-accessed with this file in sessions (from meta-cc)
    specDocs: Array<{
      filePath: string;
      coAccessCount: number;
      totalReads: number;
    }>;

    // Boolean flags — all mechanical, no LLM
    docVoid: boolean;           // Pattern B + no spec doc co-accessed (meta-cc)
    specPrecisionGap: boolean;  // Pattern B + spec exists but still high-iteration (meta-cc)
    docFreshnessGap: boolean;   // high git churn + no .md co-changes in git (archguard)

    // LLM-generated hints (produced by CCB assembler, only when a flag is true)
    deFactoSpec?: string;       // e.g. "use flow-graph-builder.test.ts as de facto spec"
    freshnessWarning?: string;  // e.g. "architecture.md may be stale for this package"
  };
}
```

The `documentation` field is omitted from the CCB when all three flags are false and
`specDocs` is empty — no documentation signal, no field.

### 3. CCB Assembler Update

The CCB assembler (`src/cli/cognitive/ccb-assembler.ts`) already calls
`query_edit_sequences` (meta-cc) for behavioral signals. Add:

1. Extract `CoAccessedDocs`, `DocVoid`, `SpecPrecisionGap` from the
   `query_edit_sequences` response
2. Compute `docFreshnessGap` from the local git artifact (no extra tool call)
3. Populate `documentation.specDocs`, `documentation.docVoid`,
   `documentation.specPrecisionGap`, `documentation.docFreshnessGap`
4. If any flag is true, include the `documentation` field in the LLM synthesis prompt
   so the LLM can generate `deFactoSpec` and `freshnessWarning` guidance text

The LLM prompt addition when flags are present:

```
Documentation signals for <file>:
  docVoid=<bool>          (no spec doc consulted across <N> editing sessions)
  specPrecisionGap=<bool> (spec "<path>" consulted <N>× but iteration remained high)
  docFreshnessGap=<bool>  (file committed <N>× in 90 days, no .md co-changes in git)
  specDocs: <list>

Generate guidance.deFactoSpec and guidance.freshnessWarning as appropriate.
```

---

## Revised Cognitive Load Heatmap

Adding the documentation dimension changes the final CCB scores for two files:

```
BEFORE (source and git signals only):
  flow-graph-builder.ts   Pattern B   cogLoad=0.79
  corpus.ts               Pattern B   cogLoad=0.65

AFTER (adding doc signals):
  flow-graph-builder.ts   Pattern B + docVoid=true      cogLoad → 0.91
  corpus.ts               Pattern B + specPrecisionGap  cogLoad → 0.65 + warning note

UNCHANGED:
  QueryEngine             Pattern A   cogLoad=0.87   (no doc signals set)
```

`flow-graph-builder.ts` reaches 0.91 — the highest cognitive load in the project — once
the documentation void is factored in. It is the most-iterated file with the least
documentation support.

---

## Plan

| Phase | Work |
|---|---|
| 1 | Implement `computeDocFreshnessGap` in `ccb-assembler.ts` (filter co-change neighbors) |
| 2 | Extend `CognitiveContextBundle` schema with `documentation` field |
| 3 | Update CCB assembler: extract doc flags from `query_edit_sequences` response |
| 4 | Update CCB assembler: add doc signals to LLM synthesis prompt |
| 5 | Unit test: `docFreshnessGap=true` when commitCount ≥ 5 and no `.md` neighbor |
| 6 | Unit test: `docFreshnessGap=false` when commitCount < 5 |
| 7 | Unit test: `documentation` field omitted from CCB when all flags false |
| 8 | Integration test: `flow-graph-builder.ts` CCB contains `docVoid=true`, `cogLoad ≥ 0.90` |
| 9 | Integration test: `corpus.ts` CCB contains `specPrecisionGap=true` and non-empty `specDocs` |

---

## Relationship to Other Proposals

```
proposal-cognitive-analysis-layer.md      ← EXTENDS Step 4 (synthesize doc signals)
proposal-cognitive-context-bundle.md      ← EXTENDS CCB schema and assembler
meta-cc/proposal-doc-session-signals.md   ← DEPENDS ON (provides DocVoid, SpecPrecisionGap, CoAccessedDocs)
meta-cc/proposal-edit-sequence-tool.md    ← DEPENDS ON (provides query_edit_sequences tool)
```

The git co-change check (`docFreshnessGap`) does not require any new MCP tool — it reads
`.archguard/query/git-history/file-metrics.json` directly inside the CCB assembler.
