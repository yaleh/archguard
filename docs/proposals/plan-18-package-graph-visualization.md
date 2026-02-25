# Plan 18: Package Graph Visualization Improvements

**Status**: Revised (post architectural review)
**Branch**: feat/go
**Motivation**: Comparison of generated `architecture-package.mmd` against a manually redesigned version for `codex-swarm` revealed four concrete gaps that significantly reduce the readability of the package layer diagram.

---

## Background

Running ArchGuard's Go Atlas against `github.com/yaleh/codex-swarm` (39 packages, 85 edges) produced a flat `flowchart TB` with no visual grouping, no role-based colours, and cycle information buried in comments. A manual redesign of the same data using Mermaid `subgraph` blocks immediately exposed the hub sub-system structure and made cross-layer coupling obvious. The gaps identified are all fixable with targeted changes to two existing files.

---

## Identified Gaps

### Gap 1 — No subgraph grouping (highest readability impact)

The rendered diagram is a flat list of 39 nodes. Mermaid's `subgraph` is the standard way to express module/package boundaries in `flowchart`, and is what large Go projects use in architecture maps.

**Root cause**: `renderPackageGraph()` in `mermaid-templates.ts` iterates nodes and edges with no grouping logic.

**Evidence**: The manually redesigned version groups the same 39 nodes into 6 subgraphs (`cmd`, `tests`, `examples`, `pkg/hub`, `pkg/testutil`, `pkg/catalog`), making the hub sub-system and the test/entry-point layers immediately visible.

---

### Gap 2 — All nodes rendered with the same style (`:::cmd` bug + no `classDef`)

Every node in the generated output gets `:::cmd` regardless of its role. This is a two-part problem:

1. **Hardcoded class** — `renderPackageGraph()` line 18 applies `:::cmd` to all nodes instead of using `node.type`.
2. **No `classDef` block** — even if `node.type` were used correctly, there are no `classDef` declarations for `internal`, `tests`, `examples`, or `cycle`, so the styles would be no-ops. (The goroutine renderer correctly emits `classDef`; the package renderer does not.)
3. **`classifyPackageType()` is too coarse** — it only distinguishes `cmd` / `vendor` / `internal`. Packages under `tests/*` and `examples/*` are misclassified as `internal`.

**Impact**: A tests package and a core library package look identical in the diagram.

---

### Gap 3 — Cycle detection result is invisible, and self-loops are conflated with real cycles

Cycles are appended as `%% comments` (lines 93-95 in the generated file). They are invisible in the rendered PNG/SVG.

The two "cycles" detected in codex-swarm are both **self-loops** (`pkg/runtime → pkg/runtime`, `pkg/hub → pkg/hub`), not multi-package circular dependencies. These are likely artifacts of import path resolution (duplicate import records or internal alias patterns). Treating them with the same visual weight as real architectural cycles would mislead users.

The visual treatment must distinguish between:
- **Self-loop** (`from === to`): data quality noise, annotated with a warning label but not styled as a critical problem
- **Multi-package cycle**: genuine architectural debt, styled prominently

---

### Gap 4 — `pkg/hub` is not recognised as a sub-system

The generated diagram places `pkg/hub`, `pkg/hub/models`, `pkg/hub/store`, `pkg/hub/engine`, `pkg/hub/metrics`, `pkg/hub/testutil` as peer nodes at the same visual level as top-level packages. Wrapping them in a `subgraph` immediately reveals the hub as an internal platform rather than a single package.

This is a direct consequence of Gap 1 — no subgraph support — but deserves separate mention because the "one package with multiple sub-packages under a common prefix" pattern is the most common structural signal in Go codebases.

---

## Proposed Changes

### Files affected

| File | Change |
|------|--------|
| `src/plugins/golang/atlas/builders/package-graph-builder.ts` | Add `buildGroups()` method; update `classifyPackageType()` |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | Rewrite `renderPackageGraph()` with subgraph support, `classDef`, cycle styling |

`src/types/extensions.ts` and `src/plugins/golang/atlas/types.ts` are **not modified** — see Design Decision 1 below.

---

## Design Decisions

### Decision 1 — `PackageGroup` is renderer-internal, not part of ADR-002

`src/types/extensions.ts` is the single source of truth for the Atlas JSON data model (ADR-002). `PackageGroup` is a render-time computation whose `id` field would contain sanitized Mermaid IDs — a presentation-layer artefact. Adding it to `PackageGraph` would:

- Serialize rendering metadata into the persistent Atlas JSON output
- Couple the data model to a specific renderer (Mermaid)
- Violate the ADR-002 principle that the data model carries no presentation concerns

**Resolution**: `PackageGroup` is defined and used entirely within `mermaid-templates.ts` as a private intermediate type. `buildGroups()` in the builder returns a plain `Map<string, string[]>` (group label → node name list), which is passed as a separate argument to the renderer.

Concretely:
- `PackageGraphBuilder.build()` signature does **not** change
- A new `buildGroups(nodes: PackageNode[], moduleName: string): Map<string, string[]>` method is added to the builder as a `static` utility, or alternatively inlined in the renderer
- `renderPackageGraph(graph, groups?)` accepts an optional second parameter

### Decision 2 — `PackageNode.type` extension is a versioned ADR-002 change

The current definition in `extensions.ts:93`:

```typescript
type: 'internal' | 'external' | 'vendor' | 'std' | 'cmd';
```

Adding `'tests' | 'examples' | 'testutil'` widens this union. This is a **breaking change** for any exhaustive `switch` on `node.type`. The change must be recorded as ADR-002 v1.3 and all switch statements audited.

For this plan, the change is scoped to `classifyPackageType()` in the builder and `classDef` declarations in the renderer. The `extensions.ts` type union is widened as part of an ADR-002 minor version bump; a `CHANGELOG` entry is required.

### Decision 3 — Subgraph IDs use a `grp_` namespace prefix

When a package path and its sub-system group share the same string (e.g., `pkg/hub` is both a package node and the name of the group containing `pkg/hub/*`), using the same sanitized ID for the Mermaid subgraph and the node causes a rendering conflict. Mermaid interprets the node declaration inside the subgraph as a reference to the subgraph itself.

**Resolution**: All subgraph IDs are prefixed with `grp_`:
- Subgraph: `grp_pkg_hub`
- Node inside it: `github_com_yaleh_codex_swarm_pkg_hub`

This guarantees no collision regardless of the package structure.

### Decision 4 — Subgraphs are only created when a prefix has ≥ 2 members

Creating a `subgraph` for every single package (including the 16 standalone `pkg/*` packages in codex-swarm) produces 15+ single-element subgraph blocks, adding visual noise and degrading Mermaid's layout quality. A subgraph is created **only when two or more nodes share a common two-segment prefix**.

Standalone packages are emitted as top-level nodes without a subgraph wrapper.

### Decision 5 — Grouping algorithm is data-driven, not `pkg/`-prefixed

The rule "take first two segments if segment[0] is `pkg`" is codex-swarm-specific. Standard Go project layouts use `internal/`, `services/`, `app/`, and others.

**Resolution**: The algorithm groups by the two-segment prefix of any package that has siblings sharing the same prefix. Concretely:

```
For each package path (relative to module root):
  candidate_prefix = first two path segments
  if count(packages sharing candidate_prefix) >= 2:
    assign to group candidate_prefix
  else:
    no group (top-level node)
```

This produces the same result for codex-swarm (`pkg/hub`, `pkg/testutil`, `pkg/catalog` each get a group) but also works for `internal/auth` + `internal/db` layouts.

---

## Change 1 — `classifyPackageType()` (package-graph-builder.ts)

Widens `PackageNode.type` to include role-based values for test and example packages:

```typescript
private classifyPackageType(
  pkg: GoRawPackage
): 'internal' | 'external' | 'vendor' | 'std' | 'cmd' | 'tests' | 'examples' | 'testutil' {
  const full = pkg.fullName;
  // Segment-boundary-safe testutil check (avoids matching 'servicetestutil')
  const segments = full.split('/');
  const isTestutil = segments.some(s => s === 'testutil' || s === 'hubtest');

  if (full.startsWith('tests/') || full === 'tests') return 'tests';
  if (full.startsWith('examples/')) return 'examples';
  if (isTestutil) return 'testutil';
  if (pkg.name === 'main') return 'cmd';
  if (full.includes('/vendor/')) return 'vendor';
  return 'internal';
}
```

**Ordering note**: `tests/` and `examples/` are checked before `name === 'main'` to correctly classify a hypothetical `tests/main_test.go` package as `tests`, not `cmd`.

**`/testutil` check**: Uses `segments.some(s => s === 'testutil')` (exact segment match) instead of `full.includes('/testutil')` to avoid false matches on paths like `pkg/servicetestutil`.

This change requires a corresponding update to `PackageNode.type` in `extensions.ts` (ADR-002 v1.3).

---

## Change 2 — `buildGroups()` static utility (package-graph-builder.ts)

New static method, usable by the renderer without constructing a full builder instance:

```typescript
static buildGroups(nodes: PackageNode[], moduleName: string): Map<string, string[]> {
  // Strip module prefix, compute two-segment candidate for each node
  const prefixCount = new Map<string, number>();
  for (const node of nodes) {
    const rel = node.name; // name is already relative (e.g. "pkg/hub/models")
    const segments = rel.split('/');
    if (segments.length >= 2) {
      const prefix = segments.slice(0, 2).join('/');
      prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1);
    }
  }

  // Build group map: only prefixes with >= 2 members get a subgraph
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const segments = node.name.split('/');
    if (segments.length >= 2) {
      const prefix = segments.slice(0, 2).join('/');
      if ((prefixCount.get(prefix) ?? 0) >= 2) {
        const members = groups.get(prefix) ?? [];
        members.push(node.id);
        groups.set(prefix, members);
      }
    }
  }
  return groups;
}
```

`PackageGraphBuilder.build()` signature is unchanged. The builder does not call `buildGroups()` — it is called by the renderer (or the caller that coordinates builder + renderer).

---

## Change 3 — `renderPackageGraph()` rewrite (mermaid-templates.ts)

### Signature change

```typescript
static renderPackageGraph(
  graph: PackageGraph,
  groups?: Map<string, string[]>
): string
```

The `groups` parameter is optional. When absent (e.g., in unit tests that only have a `PackageGraph`), the renderer falls back to flat output, preserving backward compatibility.

### 3a — `classDef` block (always emitted)

```
classDef cmd      fill:#ff6b6b,stroke:#c0392b,color:#000
classDef tests    fill:#b2bec3,stroke:#636e72,color:#000
classDef examples fill:#74b9ff,stroke:#0984e3,color:#000
classDef testutil fill:#dfe6e9,stroke:#b2bec3,color:#000
classDef internal fill:#55efc4,stroke:#00b894,color:#000
classDef vendor   fill:#f0e6ff,stroke:#9b59b6,color:#000
classDef external fill:#ffeaa7,stroke:#fdcb6e,color:#000
classDef cycle    fill:#fd79a8,stroke:#e84393,stroke-width:3px
```

All values from `PackageNode.type` (including existing `vendor` and `external`) have a corresponding `classDef`.

### 3b — Subgraph blocks

Nodes are partitioned: those whose `id` appears in any group value list go into a subgraph block; the rest are emitted top-level. Subgraph IDs use the `grp_` prefix to avoid collision with node IDs.

```
subgraph grp_pkg_hub["pkg/hub"]
  github_com_yaleh_codex_swarm_pkg_hub["pkg/hub"]:::internal
  github_com_yaleh_codex_swarm_pkg_hub_models["pkg/hub/models"]:::internal
  ...
end
```

### 3c — Cycle and self-loop edge styling

Build two sets from `graph.cycles`:
- `selfLoopNodes`: cycles where `packages.length === 1` (self-reference)
- `multiCycleNodes`: cycles where `packages.length > 1`

Edge rendering:
- Self-loop edges (`from === to`): use `-.->|"⚠ self"|` — visually distinct but not alarming
- Edges connecting nodes in a multi-package cycle: use `-.->` dashed arrow
- Nodes in a multi-package cycle: append `:::cycle`
- Self-loop nodes: no class change (the warning label on the edge is sufficient)

### 3d — Ref count labels preserved

Edge labels (`|"N refs"|` for `strength > 1`) are preserved unchanged. These provide coupling density information that the manually redesigned version incorrectly dropped.

---

## Implementation Priority

| Priority | Change | Effort | Type impact |
|----------|--------|--------|-------------|
| P0 | Add `classDef` block + fix `:::cmd` hardcode bug in renderer | ~8 lines | None |
| P1 | Improve `classifyPackageType()` + ADR-002 v1.3 type widening | ~15 lines | Minor (additive union widening) |
| P2 | Cycle/self-loop visual distinction in renderer | ~20 lines | None |
| P3 | `buildGroups()` + subgraph rendering | ~60 lines | None |

**P0** is purely a renderer fix with no type changes and no dependencies.
**P1** requires the ADR-002 type change; P0 should land first so the new `classDef` entries are already in place when P1 activates the new type values.
**P2** is independent of P1 and P3.
**P3** is independent and can be implemented last.

---

## ADR-002 v1.3 Change Record

**`PackageNode.type` union widened**:

```typescript
// Before (v1.2):
type: 'internal' | 'external' | 'vendor' | 'std' | 'cmd';

// After (v1.3):
type: 'internal' | 'external' | 'vendor' | 'std' | 'cmd' | 'tests' | 'examples' | 'testutil';
```

**Compatibility**: Additive change. Existing consumers that do not exhaustively switch on `type` are unaffected. Consumers with exhaustive switches (none currently identified in the codebase) would need a default branch or explicit handling.

**Atlas JSON**: The `type` field in serialized `PackageNode` objects may now contain the new values. Downstream consumers reading Atlas JSON must treat unknown `type` values gracefully.

---

## Test Plan

### Unit tests — `buildGroups()`

- Prefix with ≥ 2 members creates a group (`pkg/hub` with 5 sub-packages)
- Prefix with 1 member produces no group (`pkg/store` alone)
- Top-level single-segment paths (`cmd`, `tests`) produce no two-segment group
- Module name is correctly stripped when computing relative names
- Empty node list returns empty map

### Unit tests — `classifyPackageType()`

- `tests/integration` → `'tests'`
- `examples/user-service` → `'examples'`
- `pkg/hub/testutil` → `'testutil'` (segment match, not substring)
- `pkg/servicetestutil` → `'internal'` (not a segment-boundary match)
- `cmd/swarm-hub` (name=`main`) → `'cmd'`
- `pkg/hub` → `'internal'`

### Unit tests — `renderPackageGraph()`

- With no `groups`: output is flat, same structure as current (backward compat)
- With groups: subgraph blocks use `grp_` prefix, nodes inside retain full ID
- Self-loop edge (`from === to`) rendered as `-.->|"⚠ self"|`
- Multi-package cycle node gets `:::cycle` class
- Non-cycle, single-ref edge: plain `-->`
- Multi-ref edge: `-->|"N refs"|`
- `classDef` block always appears, contains all 8 role types

### Integration test

Re-run against `codex-swarm` and assert:
- `grp_pkg_hub` subgraph present and contains exactly `pkg/hub`, `pkg/hub/models`, `pkg/hub/store`, `pkg/hub/engine`, `pkg/hub/metrics`, `pkg/hub/testutil`
- `pkg/store` (single member) emitted as top-level node, no wrapping subgraph
- Self-loop edges for `pkg/runtime` and `pkg/hub` use dashed arrow with warning label
- All `cmd/*` nodes have `:::cmd` class

---

## Expected Output (codex-swarm after full implementation)

```
flowchart TB

  %% Top-level nodes (no group or single-member prefix)
  github_com_yaleh_codex_swarm_pkg_store["pkg/store"]:::internal
  github_com_yaleh_codex_swarm_pkg_runtime["pkg/runtime"]:::internal
  github_com_yaleh_codex_swarm_pkg_logging["pkg/logging"]:::internal
  ...

  subgraph grp_cmd["cmd"]
    github_com_yaleh_codex_swarm_cmd_swarm_hub["cmd/swarm-hub"]:::cmd
    github_com_yaleh_codex_swarm_cmd_swarm_mcp["cmd/swarm-mcp"]:::cmd
    github_com_yaleh_codex_swarm_cmd_preflight["cmd/preflight"]:::cmd
  end

  subgraph grp_tests["tests"]
    github_com_yaleh_codex_swarm_tests["tests"]:::tests
    github_com_yaleh_codex_swarm_tests_integration["tests/integration"]:::tests
    github_com_yaleh_codex_swarm_tests_stress["tests/stress"]:::tests
    ...
  end

  subgraph grp_pkg_hub["pkg/hub"]
    github_com_yaleh_codex_swarm_pkg_hub["pkg/hub"]:::internal
    github_com_yaleh_codex_swarm_pkg_hub_models["pkg/hub/models"]:::internal
    github_com_yaleh_codex_swarm_pkg_hub_engine["pkg/hub/engine"]:::internal
    github_com_yaleh_codex_swarm_pkg_hub_store["pkg/hub/store"]:::internal
    github_com_yaleh_codex_swarm_pkg_hub_metrics["pkg/hub/metrics"]:::internal
    github_com_yaleh_codex_swarm_pkg_hub_testutil["pkg/hub/testutil"]:::testutil
  end

  subgraph grp_pkg_testutil["pkg/testutil"]
    github_com_yaleh_codex_swarm_pkg_testutil["pkg/testutil"]:::testutil
    github_com_yaleh_codex_swarm_pkg_testutil_runner["pkg/testutil/runner"]:::testutil
    github_com_yaleh_codex_swarm_pkg_testutil_hub["pkg/testutil/hub"]:::testutil
  end

  %% Edges
  github_com_yaleh_codex_swarm_pkg_hub -->|"13 refs"| github_com_yaleh_codex_swarm_pkg_hub_models
  github_com_yaleh_codex_swarm_pkg_hub_engine -->|"21 refs"| github_com_yaleh_codex_swarm_pkg_hub_models
  github_com_yaleh_codex_swarm_pkg_runtime -.->|"⚠ self"| github_com_yaleh_codex_swarm_pkg_runtime
  ...

  classDef cmd      fill:#ff6b6b,stroke:#c0392b,color:#000
  classDef tests    fill:#b2bec3,stroke:#636e72,color:#000
  classDef examples fill:#74b9ff,stroke:#0984e3,color:#000
  classDef testutil fill:#dfe6e9,stroke:#b2bec3,color:#000
  classDef internal fill:#55efc4,stroke:#00b894,color:#000
  classDef vendor   fill:#f0e6ff,stroke:#9b59b6,color:#000
  classDef external fill:#ffeaa7,stroke:#fdcb6e,color:#000
  classDef cycle    fill:#fd79a8,stroke:#e84393,stroke-width:3px
```
