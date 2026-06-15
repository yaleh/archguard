# archguard_get_cognitive_summary: Batch Structural Digest for LLM Consumption

> Status: Draft (rev 1)
> Scope: New MCP tool — replaces `archguard_get_dependencies` for initial orientation on
>        high-complexity entities; designed for LLM token budget constraints
> Branch: `feat/cognitive-summary-mcp` (future)
> Depends on: `proposal-cognitive-analysis-layer.md`

---

## Problem Statement

`archguard_get_dependencies` returns a full dependency graph. For a high-complexity entity
like `QueryEngine` (out-degree=20), `depth=1` returns **245,406 characters across 7,266
lines** — more than most LLM context windows can hold in a single tool result.

This was observed directly during a cognitive analysis session on archguard:

```
archguard_get_dependencies("QueryEngine", depth=1, scope=class, format=edge-list)
→ 245,406 chars / 7,266 lines
→ Result saved to disk (exceeded inline token limit)
→ LLM cannot use this output directly
```

The same problem will occur for any entity with out-degree > ~10, because the full
dependency graph includes not just direct dependencies but their full entity definitions
(fields, methods, nested types). This is correct for deep structural analysis but wrong
for an LLM trying to orient itself before editing.

What an LLM needs before touching a file is not a full graph — it is a **cognitive digest**:
the key structural facts that determine comprehension cost and edit risk.

---

## Goals

- Add `archguard_get_cognitive_summary` MCP tool that accepts a list of files or entity
  names and returns a compact structural digest per entity
- Digest fits in one LLM tool result regardless of entity complexity (target: < 2KB per
  entity, < 20KB total for a batch of 10)
- Digest includes the signals needed for Pattern A/B/C classification (see
  `proposal-cognitive-analysis-layer.md`)
- Tool is explicitly positioned as the LLM's first call for structural orientation,
  before any deeper `get_dependencies` or `find_entity` queries

---

## Non-Goals

- Replacing `archguard_get_dependencies`; that tool remains for deep structural analysis
- Including full member lists (methods and fields are counted, not enumerated)
- Providing call-level data; the digest is class/interface level only
- Ranking or scoring entities; scoring is the LLM's job

---

## Design

### Input

```typescript
archguard_get_cognitive_summary({
  files?: string[],      // file paths, e.g. ["src/core/query/query-engine.ts"]
  entities?: string[],   // entity names, e.g. ["QueryEngine", "GoPlugin"]
  // At least one of files or entities must be provided.
  // When files is provided, all entities defined in those files are included.
  projectRoot?: string,
  scope?: string,
})
```

### Output (per entity)

```typescript
interface CognitiveSummaryEntry {
  entityId: string;          // dotted-path ID
  name: string;
  type: string;              // class | interface | function | ...
  file: string;              // source file path (relative)
  package: string;

  // Structural complexity signals
  methodCount: number;
  fieldCount: number;
  outDegree: number;         // direct dependency count (entities this one depends on)
  inDegree: number;          // direct dependent count (entities that depend on this one)

  // Top dependents (who calls/imports this?) — limited to 5, sorted by in-degree desc
  topDependents: Array<{ name: string; file: string }>;

  // Top dependencies (what does this depend on?) — limited to 5, sorted by out-degree desc
  topDependencies: Array<{ name: string; file: string }>;

  // Test coverage (from test analysis artifacts if available)
  testCoverage?: {
    covered: boolean;
    coverageScore: number;   // 0.0–1.0
    testFileCount: number;
  };

  // Git evolution (from git history artifacts if available)
  gitSignals?: {
    commitCount: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    lastChangedAt: string;
  };
}
```

### Full response

```typescript
{
  entries: CognitiveSummaryEntry[],
  requestedFiles: string[],        // files resolved from input
  missingFiles: string[],          // files not found in analysis data
  missingEntities: string[],       // entity names not matched
  hint: string                     // e.g. "3 of 5 entities have outDegree > 10.
                                   //  For deeper analysis call archguard_get_dependencies
                                   //  on specific entities."
}
```

### Contrast with existing tools

| | `archguard_get_dependencies` | `archguard_get_cognitive_summary` |
|---|---|---|
| Output size | 10K–250K+ chars | < 2KB per entity |
| Depth | Configurable BFS (1–5) | Always 1 (direct only) |
| Members | Full (methods + fields) | Counted only |
| Use case | Deep structural analysis | Pre-edit orientation |
| LLM usability | Fails for god classes | Designed for LLM consumption |
| Coverage included | No | Yes (if available) |
| Git signals included | No | Yes (if available) |

### Implementation

The tool assembles data from artifacts already on disk — no re-analysis needed:

```
.archguard/query/<scope>.json          → entity list, method/field counts
.archguard/query/git-history/          → riskLevel, commitCount, lastChangedAt
.archguard/query/<scope>-test-*.json   → coverage scores
```

The in-degree and out-degree are computed from the relation list in the scope ArchJSON by
filtering `relation.source === entityId` (out-degree) and `relation.target === entityId`
(in-degree). `topDependents` and `topDependencies` are the top-5 by degree, same
entity-to-file lookup that `get_dependencies` already performs.

Location: `src/cli/mcp/tools/cognitive-summary-tool.ts`

---

## Plan

| Phase | Work |
|---|---|
| 1 | Add `CognitiveSummaryEntry` type to `src/types/` |
| 2 | Implement entity lookup: method/field count, in/out degree, top-5 lists |
| 3 | Wire test coverage and git signals from existing artifact readers |
| 4 | Register `archguard_get_cognitive_summary` in `mcp-server.ts` |
| 5 | Unit tests: single entity, batch of 10, mixed files+entities input, missing entries |
| 6 | Update MCP usage guide with "orientation → summary → deep dive" workflow |

---

## Expected Output Example

```json
{
  "entries": [
    {
      "entityId": "src.core.query.QueryEngine",
      "name": "QueryEngine",
      "type": "class",
      "file": "src/core/query/query-engine.ts",
      "package": "src/core/query",
      "methodCount": 27,
      "fieldCount": 4,
      "outDegree": 20,
      "inDegree": 8,
      "topDependents": [
        { "name": "ArchJsonProvider", "file": "src/cli/processors/arch-json-provider.ts" },
        { "name": "McpServer",        "file": "src/cli/mcp/mcp-server.ts" },
        { "name": "QueryCommand",     "file": "src/cli/commands/query.ts" }
      ],
      "topDependencies": [
        { "name": "ArchJSON",          "file": "src/types/index.ts" },
        { "name": "EdgeListSerializer","file": "src/core/query/edge-list-serializer.ts" },
        { "name": "OutputScopeFilter", "file": "src/core/query/output-scope-filter.ts" }
      ],
      "testCoverage": {
        "covered": true,
        "coverageScore": 1.0,
        "testFileCount": 13
      },
      "gitSignals": {
        "commitCount": 4,
        "riskLevel": "high",
        "lastChangedAt": "2026-06-12"
      }
    }
  ],
  "requestedFiles": ["src/core/query/query-engine.ts"],
  "missingFiles": [],
  "missingEntities": [],
  "hint": "QueryEngine has outDegree=20 and methodCount=27. For full dependency graph call archguard_get_dependencies with depth=1. Consider archguard_get_entity_coverage for test detail."
}
```

This response is ~800 bytes. The equivalent `archguard_get_dependencies` call returns
245,406 bytes — a **300× reduction** for the same orientation task.
