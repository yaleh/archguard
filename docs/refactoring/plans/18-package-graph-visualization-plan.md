# Package Graph Visualization Improvements Implementation Plan

**Plan ID**: 18
**Based on**: [Proposal 18 - Package Graph Visualization Improvements](../proposals/plan-18-package-graph-visualization.md)
**Created**: 2026-02-25
**Status**: Ready for Implementation
**Priority**: Medium
**Branch**: `feat/go` (continue on existing branch)

**Architecture Decisions**:
- [ADR-002: ArchJSON Extensions v1.3](../adr/002-archjson-extensions.md) — `PackageNode.type` union widened, `GO_ATLAS_EXTENSION_VERSION` bumped to `1.1`

**Prerequisites**:
- Plan 17 (Go Atlas Quality Improvements) fully implemented ✅
- `feat/go` branch: 136 atlas tests passing

---

## 1. Overview

### 1.1 Objective

Improve the readability of the Package Dependency layer in the Go Architecture Atlas by adding role-based node colouring, subgraph grouping, and actionable cycle visualisation. The changes are grounded in a real-world comparison of the generated `architecture-package.mmd` against a manually redesigned version for `codex-swarm`.

### 1.2 Scope

**In scope**:
- Fix `:::cmd` hardcode bug; add `classDef` block for all node roles
- Widen `PackageNode.type` to include `'tests' | 'examples' | 'testutil'` (ADR-002 v1.3)
- Improve `classifyPackageType()` to correctly classify test and example packages
- Visual distinction between self-loop noise and genuine multi-package cycles
- Data-driven subgraph grouping (≥2 members) with `grp_` namespace

**Out of scope**:
- Subgraph support for the Capability or Goroutine layers
- Mermaid theme or layout direction changes
- Filtering of external/vendor nodes

### 1.3 Success Criteria

| Measure | Before | After |
|---------|--------|-------|
| Node role differentiation | All same colour (`:::cmd`) | 8 distinct `classDef` roles |
| `tests/*` classification | `internal` | `tests` |
| `pkg/hub/*` subgraph | Flat peer nodes | `subgraph grp_pkg_hub` |
| `cmd/*` subgraph | Flat peer nodes | `subgraph grp_cmd` (when ≥2 cmd packages) |
| `tests/*` subgraph | Flat peer nodes | `subgraph grp_tests` (when ≥2 tests packages) |
| Single-member packages | — | Top-level (no subgraph wrapper) |
| Self-loop edges | `-->` (invisible cycle comment) | `-.->|"⚠ self"|` |
| Multi-package cycle nodes | No visual mark | `:::cycle` red fill |
| Subgraph/node ID collision | n/a | Impossible (`grp_` prefix) |
| All existing tests | 136 atlas / 1364 total pass | ≥ same count pass |

### 1.4 Implementation Order

Iterations must run in order: P1 (`classifyPackageType`) must land before P3 (subgraph rendering uses the new type values). P0 and P2 are independent but P0 should land first so `classDef` entries are present before P1 activates new type values.

```
P0 (classDef fix) → P1 (type widening) → P2 (cycle styling) → P3 (subgraph)
```

---

## 2. Iteration Plan

---

### Iteration 1 — `classDef` Block + Fix `:::cmd` Hardcode (P0)

**Objective**: Every rendered node uses its actual `node.type` for styling, and all role types have a `classDef` declaration. Zero logic or type-system changes.

**Files modified**:
- `src/plugins/golang/atlas/renderers/mermaid-templates.ts`
- `tests/plugins/golang/atlas/mermaid-templates.test.ts`

**Test helper setup** (`mermaid-templates.test.ts`):
The `makePackageGraph` helper is defined in `atlas-renderer.test.ts` (line 33) but does NOT exist in `mermaid-templates.test.ts`. Add it at the top of the describe block in this iteration (P0) since P2 and P3 also need it:

```typescript
import type { PackageGraph } from '../../../../src/types/extensions.js';

function makePackageGraph(overrides?: Partial<PackageGraph>): PackageGraph {
  return { nodes: [], edges: [], cycles: [], ...overrides };
}
```

**Root cause** (confirmed from `mermaid-templates.ts:18`):
```typescript
// CURRENT — wrong: applies :::cmd to every node
const style = node.type === 'cmd' ? ':::cmd' : `:::${node.type}`;
```
The ternary is logically equivalent to `:::${node.type}` — the branch is dead code. But neither branch matters because there is no `classDef` block, so all CSS classes are no-ops in the rendered output. Fix both problems in one iteration.

**TDD Story 1.1: Output includes classDef for all roles**

```
🔴 Red: renderPackageGraph() output does not contain 'classDef internal'
```
```typescript
it('emits classDef for all node roles', () => {
  const graph = makePackageGraph({ nodes: [], edges: [], cycles: [] });
  const result = MermaidTemplates.renderPackageGraph(graph);
  expect(result).toContain('classDef internal');
  expect(result).toContain('classDef cmd');
  expect(result).toContain('classDef tests');
  expect(result).toContain('classDef examples');
  expect(result).toContain('classDef testutil');
  expect(result).toContain('classDef vendor');
  expect(result).toContain('classDef external');
  expect(result).toContain('classDef cycle');
});
```
```
🟢 Green: Append classDef block at end of renderPackageGraph():

  output += '\n';
  output += '  classDef cmd      fill:#ff6b6b,stroke:#c0392b,color:#000\n';
  output += '  classDef tests    fill:#b2bec3,stroke:#636e72,color:#000\n';
  output += '  classDef examples fill:#74b9ff,stroke:#0984e3,color:#000\n';
  output += '  classDef testutil fill:#dfe6e9,stroke:#b2bec3,color:#000\n';
  output += '  classDef internal fill:#55efc4,stroke:#00b894,color:#000\n';
  output += '  classDef vendor   fill:#f0e6ff,stroke:#9b59b6,color:#000\n';
  output += '  classDef external fill:#ffeaa7,stroke:#fdcb6e,color:#000\n';
  output += '  classDef cycle    fill:#fd79a8,stroke:#e84393,stroke-width:3px\n';
```

**TDD Story 1.2: Node style uses `node.type`**

```
🔴 Red: an internal node is rendered with :::cmd instead of :::internal
```
```typescript
it('applies node.type as CSS class', () => {
  const graph = makePackageGraph({
    nodes: [
      { id: 'pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 3 },
      { id: 'cmd/server', name: 'cmd/server', type: 'cmd', fileCount: 1 },
    ],
    edges: [],
    cycles: [],
  });
  const result = MermaidTemplates.renderPackageGraph(graph);
  expect(result).toMatch(/pkg_hub\["pkg\/hub"\]:::internal/);
  expect(result).toMatch(/cmd_server\["cmd\/server"\]:::cmd/);
});
```
```
🟢 Green: Change line 18 in renderPackageGraph():

  // Before:
  const style = node.type === 'cmd' ? ':::cmd' : `:::${node.type}`;
  // After:
  const style = `:::${node.type}`;
```

**Acceptance criteria**:
- [ ] `classDef` block (8 entries) always present in output
- [ ] `:::internal` node uses `fill:#55efc4` in `classDef` declaration (visual correctness verified in integration smoke-test, not unit test)
- [ ] `:::cmd` node uses `fill:#ff6b6b` in `classDef` declaration
- [ ] No regression in existing `renderPackageGraph` tests

---

### Iteration 2 — `classifyPackageType()` + ADR-002 v1.3 Type Widening (P1)

**Objective**: Correctly classify `tests/*`, `examples/*`, and `*/testutil` packages. Widen `PackageNode.type` union in `src/types/extensions.ts` per ADR-002 v1.3.

**Files modified**:
- `src/types/extensions.ts` — widen `PackageNode.type` union
- `src/plugins/golang/atlas/builders/package-graph-builder.ts` — rewrite `classifyPackageType()`
- `tests/plugins/golang/atlas/package-graph-builder.test.ts` — new classification tests

**Pre-check**: Confirm no exhaustive `switch` on `PackageNode.type` anywhere in the codebase before modifying the union. Run:
```bash
grep -rn "case 'internal'\|case 'external'\|case 'vendor'\|case 'std'\|case 'cmd'" src/
```
If any exhaustive switch is found, add a `default` branch before widening the union.

**ADR-002 v1.3 type change** (`src/types/extensions.ts`):
```typescript
// Before (v1.2):
type: 'internal' | 'external' | 'vendor' | 'std' | 'cmd';

// After (v1.3):
type: 'internal' | 'external' | 'vendor' | 'std' | 'cmd'
    | 'tests' | 'examples' | 'testutil';
```

**TDD Story 2.1: tests/* packages classified as `tests`**

```
🔴 Red: classifyPackageType for a package with fullName 'tests/integration' returns 'internal'
```
```typescript
it('classifies tests/* packages as tests', () => {
  expect(classify({ name: 'integration', fullName: 'tests/integration' })).toBe('tests');
  expect(classify({ name: 'tests', fullName: 'tests' })).toBe('tests');
  expect(classify({ name: 'stress', fullName: 'tests/stress' })).toBe('tests');
});

// helper in test file — MUST be defined INSIDE the existing `describe('PackageGraphBuilder', ...)` block,
// where `builder` is already in scope from `beforeEach`:
function classify(pkg: Partial<GoRawPackage>) {
  return (builder as any).classifyPackageType({ name: '', fullName: '', ...pkg });
}
```
```
🟢 Green:
  if (full.startsWith('tests/') || full === 'tests') return 'tests';
```

**TDD Story 2.2: examples/* packages classified as `examples`**

```
🔴 Red: classifyPackageType for fullName 'examples/user-service' returns 'internal'
```
```typescript
it('classifies examples/* packages as examples', () => {
  expect(classify({ fullName: 'examples/user-service' })).toBe('examples');
});
```
```
🟢 Green:
  if (full.startsWith('examples/')) return 'examples';
```

**TDD Story 2.3: */testutil classified as `testutil` with exact segment match**

```
🔴 Red: classifyPackageType for fullName 'pkg/hub/testutil' returns 'internal'
         AND fullName 'pkg/servicetestutil' (no segment boundary) also returns 'internal'
```
```typescript
it('classifies */testutil as testutil using exact segment match', () => {
  expect(classify({ fullName: 'pkg/hub/testutil' })).toBe('testutil');
  expect(classify({ fullName: 'pkg/testutil' })).toBe('testutil');
  expect(classify({ fullName: 'pkg/testutil/runner' })).toBe('testutil');
  expect(classify({ fullName: 'pkg/hubtest' })).toBe('testutil');
});

it('does NOT classify pkg/servicetestutil as testutil (not a segment boundary)', () => {
  expect(classify({ fullName: 'pkg/servicetestutil' })).toBe('internal');
});
```
```
🟢 Green:
  const segments = full.split('/');
  const isTestutil = segments.some(s => s === 'testutil' || s === 'hubtest');
  if (isTestutil) return 'testutil';
```

**TDD Story 2.4: Ordering — tests/* takes priority over name === 'main'**

```
🔴 Red: a hypothetical 'tests' package named 'main' would be classified as 'cmd'
         (name check fires before path check)
```
```typescript
it('tests/* path takes priority over name=main', () => {
  expect(classify({ name: 'main', fullName: 'tests/helper' })).toBe('tests');
});
```
```
🟢 Green: Order the checks: path prefix checks first, name === 'main' after.

  private classifyPackageType(pkg: GoRawPackage): PackageNode['type'] {
    const full = pkg.fullName;
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
Note: return type annotation `PackageNode['type']` automatically tracks the union from `extensions.ts`.

**Acceptance criteria**:
- [ ] `PackageNode.type` in `extensions.ts` includes the three new values
- [ ] `classifyPackageType` returns `'tests'` for `tests/integration`
- [ ] `classifyPackageType` returns `'testutil'` for `pkg/hub/testutil` but NOT for `pkg/servicetestutil`
- [ ] `classifyPackageType` returns `'tests'` (not `'cmd'`) for a `main`-named package under `tests/`
- [ ] `npm run type-check` passes (no exhaustive switch errors)

---

### Iteration 3 — Cycle and Self-loop Visual Distinction (P2)

**Objective**: Make cycle information visible in the rendered diagram. Self-loops (likely data noise) get a warning label; genuine multi-package cycles get red node styling.

**Files modified**:
- `src/plugins/golang/atlas/renderers/mermaid-templates.ts`
- `tests/plugins/golang/atlas/mermaid-templates.test.ts`

**Design note**: The codex-swarm analysis detected two "cycles": `pkg/runtime → pkg/runtime` and `pkg/hub → pkg/hub`. Both are self-loops (`packages.length === 1` in the `PackageCycle` record). These are treated differently from genuine multi-package cycles (`packages.length > 1`). The `:::cycle` class (red fill) is reserved for the latter.

**Regression guard**: `atlas-renderer.test.ts` line 282 asserts that `renderPackageGraph()` output contains `%% Cycles detected:` followed by the cycle list. This comment block is currently emitted at the end of the function. **Do not remove or change this comment** — it must remain intact after P2 changes. Add the new self-loop/cycle visual logic alongside the existing comment, not instead of it.

**TDD Story 3.1: Self-loop edge rendered as dashed with warning label**

```
🔴 Red: edge where from === to is rendered as '-->' (same as normal edge)
```
```typescript
it('renders self-loop edge as dashed arrow with warning label', () => {
  const graph = makePackageGraph({
    nodes: [{ id: 'pkg/runtime', name: 'pkg/runtime', type: 'internal', fileCount: 2 }],
    edges: [{ from: 'pkg/runtime', to: 'pkg/runtime', strength: 1 }],
    cycles: [{ packages: ['pkg/runtime'], severity: 'warning' }],
  });
  const result = MermaidTemplates.renderPackageGraph(graph);
  expect(result).toContain('pkg_runtime -.->|"⚠ self"| pkg_runtime');
  expect(result).not.toMatch(/pkg_runtime --> pkg_runtime/);
});
```
```
🟢 Green: In the edge emission loop, detect self-loops:

  for (const edge of graph.edges) {
    const fromId = this.sanitizeId(edge.from);
    const toId = this.sanitizeId(edge.to);
    const isSelfLoop = edge.from === edge.to;
    if (isSelfLoop) {
      output += `  ${fromId} -.->|"⚠ self"| ${toId}\n`;
      continue;
    }
    const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
    output += `  ${fromId} -->${label} ${toId}\n`;
  }
```

**TDD Story 3.2: Multi-package cycle nodes get `:::cycle` class**

```
🔴 Red: node participating in a 2+ package cycle has no :::cycle class
```
```typescript
it('applies :::cycle to nodes in a multi-package cycle', () => {
  const graph = makePackageGraph({
    nodes: [
      { id: 'pkg/a', name: 'pkg/a', type: 'internal', fileCount: 1 },
      { id: 'pkg/b', name: 'pkg/b', type: 'internal', fileCount: 1 },
    ],
    edges: [
      { from: 'pkg/a', to: 'pkg/b', strength: 1 },
      { from: 'pkg/b', to: 'pkg/a', strength: 1 },
    ],
    cycles: [{ packages: ['pkg/a', 'pkg/b'], severity: 'error' }],
  });
  const result = MermaidTemplates.renderPackageGraph(graph);
  expect(result).toMatch(/pkg_a\[.*\]:::cycle/);
  expect(result).toMatch(/pkg_b\[.*\]:::cycle/);
});
```
```
🟢 Green: Build cycleNodeIds set before emitting nodes:

  const cycleNodeIds = new Set(
    graph.cycles
      .filter(c => c.packages.length > 1)
      .flatMap(c => c.packages)
  );

  // In node emission:
  const baseStyle = `:::${node.type}`;
  const style = cycleNodeIds.has(node.id) ? ':::cycle' : baseStyle;
```

**TDD Story 3.3: Self-loop node does NOT get `:::cycle` class**

```
🔴 Red: single-package "cycle" (self-loop) incorrectly gets :::cycle styling
```
```typescript
it('does not apply :::cycle to self-loop nodes', () => {
  const graph = makePackageGraph({
    nodes: [{ id: 'pkg/runtime', name: 'pkg/runtime', type: 'internal', fileCount: 2 }],
    edges: [{ from: 'pkg/runtime', to: 'pkg/runtime', strength: 1 }],
    cycles: [{ packages: ['pkg/runtime'], severity: 'warning' }],
  });
  const result = MermaidTemplates.renderPackageGraph(graph);
  expect(result).not.toMatch(/pkg_runtime\[.*\]:::cycle/);
  expect(result).toMatch(/pkg_runtime\[.*\]:::internal/);
});
```
```
🟢 Green: The filter `c.packages.length > 1` in Story 3.2 already handles this.
         No additional code needed.
```

**Acceptance criteria**:
- [ ] Self-loop edge (`from === to`) → `-.->|"⚠ self"|`
- [ ] Self-loop node retains its role class, NOT `:::cycle`
- [ ] Multi-package cycle nodes → `:::cycle` (overrides role class)
- [ ] Normal edges unchanged

---

### Iteration 4 — Data-driven Subgraph Grouping (P3)

**Objective**: Automatically group packages sharing a two-segment path prefix (when ≥2 members) into Mermaid `subgraph` blocks. Subgraph IDs use `grp_` prefix to prevent ID collision with package nodes.

**Files modified**:
- `src/plugins/golang/atlas/renderers/mermaid-templates.ts` — `buildGroups()` private static + `renderPackageGraph()` subgraph logic
- `tests/plugins/golang/atlas/mermaid-templates.test.ts` — grouping and subgraph stories

**Design decision**: `buildGroups()` is implemented as a `private static` on `MermaidTemplates` (not on the builder). This keeps the render pipeline self-contained: `renderPackageGraph(graph)` computes groups internally from `graph.nodes`, with no changes to call sites in `atlas-renderer.ts`.

**P2 dependency**: P3's `renderPackageGraph()` Green code uses `cycleNodeIds` (the `Set` built in P2 Story 3.2). Treat P3 as additive — implement the full updated `renderPackageGraph()` method including the `cycleNodeIds` set already introduced by P2. The complete method signature after P3 is shown in Story 4.3 Green.

**`grp_` + sanitizeId length note**: Subgraph IDs are constructed as `'grp_' + sanitizeId(label)`. Since `sanitizeId` truncates to 64 characters (Plan 17), a group label like `pkg/very-long-subsystem-name` could theoretically collide with another after truncation. In practice all codex-swarm group labels are ≤15 chars. Add a `// TODO: potential collision if group labels exceed 59 chars after sanitize` comment in the implementation.

**TDD Story 4.1: buildGroups() returns correct groups**

```
🔴 Red: (MermaidTemplates as any).buildGroups([...]) is undefined
```
```typescript
const buildGroups = (nodes: PackageNode[]) =>
  (MermaidTemplates as any).buildGroups(nodes) as Map<string, string[]>;

it('groups packages sharing a two-segment prefix', () => {
  const nodes: PackageNode[] = [
    { id: 'mod/pkg/hub',        name: 'pkg/hub',        type: 'internal', fileCount: 1 },
    { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
    { id: 'mod/pkg/hub/store',  name: 'pkg/hub/store',  type: 'internal', fileCount: 1 },
    { id: 'mod/pkg/store',      name: 'pkg/store',      type: 'internal', fileCount: 1 },
  ];
  const groups = buildGroups(nodes);
  // pkg/hub has 3 members — gets a group
  expect(groups.has('pkg/hub')).toBe(true);
  expect(groups.get('pkg/hub')).toHaveLength(3);
  // pkg/store has 1 member — no group
  expect(groups.has('pkg/store')).toBe(false);
});
```
```
🟢 Green:

  // Two-layer grouping rule:
  //   Top-level dirs (cmd, tests, examples) → group by first segment alone
  //   All other multi-segment paths         → group by first two segments
  private static readonly TOP_LEVEL_GROUP_DIRS = new Set(['cmd', 'tests', 'examples']);

  private static getGroupPrefix(name: string): string | null {
    const segs = name.split('/');
    if (segs.length < 2) return null;
    if (MermaidTemplates.TOP_LEVEL_GROUP_DIRS.has(segs[0])) return segs[0];
    return segs.slice(0, 2).join('/');
  }

  private static buildGroups(nodes: PackageNode[]): Map<string, string[]> {
    const prefixCount = new Map<string, number>();
    for (const node of nodes) {
      const prefix = MermaidTemplates.getGroupPrefix(node.name);
      if (prefix) prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1);
    }
    const groups = new Map<string, string[]>();
    for (const node of nodes) {
      const prefix = MermaidTemplates.getGroupPrefix(node.name);
      if (prefix && (prefixCount.get(prefix) ?? 0) >= 2) {
        const members = groups.get(prefix) ?? [];
        members.push(node.id);
        groups.set(prefix, members);
      }
    }
    return groups;
  }
```

**TDD Story 4.2: cmd/*, tests/*, examples/* — top-level dirs group by first segment**

```
🔴 Red: cmd/* packages are not grouped (old two-segment algorithm treated 'cmd/server' and 'cmd/worker' as different prefixes)
```
```typescript
it('groups cmd/* packages under the single-segment prefix "cmd"', () => {
  const nodes: PackageNode[] = [
    { id: 'mod/cmd/server', name: 'cmd/server', type: 'cmd', fileCount: 1 },
    { id: 'mod/cmd/worker', name: 'cmd/worker', type: 'cmd', fileCount: 1 },
  ];
  const groups = buildGroups(nodes);
  expect(groups.has('cmd')).toBe(true);
  expect(groups.get('cmd')).toHaveLength(2);
});

it('groups tests/* packages under the single-segment prefix "tests"', () => {
  const nodes: PackageNode[] = [
    { id: 'mod/tests/integration', name: 'tests/integration', type: 'tests', fileCount: 1 },
    { id: 'mod/tests/unit',        name: 'tests/unit',        type: 'tests', fileCount: 1 },
  ];
  const groups = buildGroups(nodes);
  expect(groups.has('tests')).toBe(true);
  expect(groups.get('tests')).toHaveLength(2);
});

it('does not group a single cmd/* package', () => {
  const nodes: PackageNode[] = [
    { id: 'mod/cmd/server', name: 'cmd/server', type: 'cmd', fileCount: 1 },
  ];
  const groups = buildGroups(nodes);
  expect(groups.size).toBe(0);
});
```
```
🟢 Green: The `TOP_LEVEL_GROUP_DIRS` Set and `getGroupPrefix()` from Story 4.1 already handle this.
         'cmd/server' → segs[0] === 'cmd' → prefix = 'cmd'
         'cmd/worker' → segs[0] === 'cmd' → prefix = 'cmd'
         Count for 'cmd' = 2 → qualifies. ✓ No additional code change needed.
```

**TDD Story 4.3: Subgraph blocks appear in rendered output with `grp_` prefix**

```
🔴 Red: renderPackageGraph() output for grouped nodes has no subgraph blocks
```
```typescript
it('wraps grouped nodes in subgraph blocks using grp_ prefix', () => {
  const graph = makePackageGraph({
    nodes: [
      { id: 'mod/pkg/hub',        name: 'pkg/hub',        type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
    ],
    edges: [],
    cycles: [],
  });
  const result = MermaidTemplates.renderPackageGraph(graph);
  expect(result).toContain('subgraph grp_pkg_hub["pkg/hub"]');
  expect(result).toContain('end');
  // node ID inside subgraph is unchanged (full sanitized id)
  expect(result).toContain('mod_pkg_hub["pkg/hub"]:::internal');
  // subgraph id ≠ node id
  expect(result).not.toMatch(/subgraph mod_pkg_hub/);
});
```
```
🟢 Green: Complete updated renderPackageGraph() — integrates cycleNodeIds from P2 (Story 3.2)
         and adds subgraph support. This is the full method body after P3 lands:

  static renderPackageGraph(graph: PackageGraph): string {
    let output = 'flowchart TB\n';

    // --- cycle detection (introduced in P2) ---
    const cycleNodeIds = new Set(
      graph.cycles
        .filter(c => c.packages.length > 1)
        .flatMap(c => c.packages)
    );

    // --- subgraph grouping (introduced in P3) ---
    const groups = MermaidTemplates.buildGroups(graph.nodes);
    // TODO: potential collision if group labels exceed 59 chars after sanitize
    const nodeGroupMap = new Map<string, string>();
    for (const [label, ids] of groups) {
      for (const id of ids) nodeGroupMap.set(id, label);
    }

    // Pass 1: emit top-level nodes (not in any group)
    for (const node of graph.nodes) {
      if (!nodeGroupMap.has(node.id)) {
        const style = cycleNodeIds.has(node.id) ? ':::cycle' : `:::${node.type}`;
        output += `  ${MermaidTemplates.sanitizeId(node.id)}["${node.name}"]${style}\n`;
      }
    }

    // Pass 1 cont.: emit subgraph blocks
    for (const [label, ids] of groups) {
      const sgId = 'grp_' + MermaidTemplates.sanitizeId(label);
      output += `\n  subgraph ${sgId}["${label}"]\n`;
      for (const id of ids) {
        const node = graph.nodes.find(n => n.id === id)!;
        const style = cycleNodeIds.has(node.id) ? ':::cycle' : `:::${node.type}`;
        output += `    ${MermaidTemplates.sanitizeId(node.id)}["${node.name}"]${style}\n`;
      }
      output += '  end\n';
    }

    // Pass 2: emit edges (self-loops introduced in P2 Story 3.1)
    output += '\n';
    for (const edge of graph.edges) {
      const fromId = MermaidTemplates.sanitizeId(edge.from);
      const toId   = MermaidTemplates.sanitizeId(edge.to);
      if (edge.from === edge.to) {
        output += `  ${fromId} -.->|"⚠ self"| ${toId}\n`;
        continue;
      }
      const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
      output += `  ${fromId} -->${label} ${toId}\n`;
    }

    // Pass 3: cycle comment (retain for atlas-renderer.test.ts:282 compatibility)
    if (graph.cycles.length > 0) {
      output += '\n  %% Cycles detected:\n';
      for (const cycle of graph.cycles) {
        output += `  %%   ${cycle.packages.join(' → ')}\n`;
      }
    }

    // Pass 4: classDef block (introduced in P0)
    output += '\n';
    output += '  classDef cmd      fill:#ff6b6b,stroke:#c0392b,color:#000\n';
    output += '  classDef tests    fill:#b2bec3,stroke:#636e72,color:#000\n';
    output += '  classDef examples fill:#74b9ff,stroke:#0984e3,color:#000\n';
    output += '  classDef testutil fill:#dfe6e9,stroke:#b2bec3,color:#000\n';
    output += '  classDef internal fill:#55efc4,stroke:#00b894,color:#000\n';
    output += '  classDef vendor   fill:#f0e6ff,stroke:#9b59b6,color:#000\n';
    output += '  classDef external fill:#ffeaa7,stroke:#fdcb6e,color:#000\n';
    output += '  classDef cycle    fill:#fd79a8,stroke:#e84393,stroke-width:3px\n';
    return output;
  }
```
Note: The `%% Cycles detected:` comment in Pass 3 is intentionally retained to avoid breaking `atlas-renderer.test.ts:282`.

**TDD Story 4.4: Single-member packages remain top-level**

```
🔴 Red: a single-member package is wrapped in a subgraph
```
```typescript
it('emits single-member packages as top-level nodes without subgraph', () => {
  const graph = makePackageGraph({
    nodes: [
      { id: 'mod/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 2 },
    ],
    edges: [],
    cycles: [],
  });
  const result = MermaidTemplates.renderPackageGraph(graph);
  expect(result).not.toContain('subgraph');
  expect(result).toContain('mod_pkg_store["pkg/store"]:::internal');
});
```
```
🟢 Green: The ≥2 threshold in buildGroups() already handles this. No code change needed.
```

**TDD Story 4.5: Edges are emitted after all nodes and subgraphs**

```
🔴 Red: edges appear before subgraph end, causing Mermaid parse error
```
```typescript
it('emits all edges after all subgraph blocks', () => {
  // build a graph with one edge between two grouped nodes
  const graph = makePackageGraph({
    nodes: [
      { id: 'mod/pkg/hub',   name: 'pkg/hub',   type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/hub/m', name: 'pkg/hub/m', type: 'internal', fileCount: 1 },
    ],
    edges: [{ from: 'mod/pkg/hub', to: 'mod/pkg/hub/m', strength: 3 }],
    cycles: [],
  });
  const result = MermaidTemplates.renderPackageGraph(graph);
  const subgraphEnd = result.lastIndexOf('end');
  const edgeLine   = result.indexOf('mod_pkg_hub -->');
  expect(edgeLine).toBeGreaterThan(subgraphEnd);
});
```
```
🟢 Green: Emit all nodes/subgraphs in one pass, then emit edges in a second pass.
         Two-pass rendering is already the pattern in the existing code.
```

**Acceptance criteria**:
- [ ] `buildGroups()` returns a group only for prefix with ≥ 2 members
- [ ] `cmd/server` + `cmd/worker` → `subgraph grp_cmd["cmd"]` (top-level dir rule)
- [ ] `tests/unit` + `tests/integration` → `subgraph grp_tests["tests"]` (top-level dir rule)
- [ ] `pkg/hub` + `pkg/hub/models` → `subgraph grp_pkg_hub["pkg/hub"]` (two-segment rule)
- [ ] Subgraph ID (`grp_pkg_hub`) ≠ contained node ID (`mod_pkg_hub`) — no collision
- [ ] Edges appear after all `end` tokens in the output
- [ ] Single-member packages are top-level nodes, no wrapping subgraph
- [ ] `atlas-renderer.test.ts:282` (`%% Cycles detected:`) still passes
- [ ] codex-swarm integration: `grp_pkg_hub` contains 6 nodes; `pkg/store` is top-level

---

## 3. Test Execution Order

Run after each iteration:
```bash
npm test tests/plugins/golang/atlas/mermaid-templates.test.ts
npm test tests/plugins/golang/atlas/package-graph-builder.test.ts
npm run type-check
```

Run after all iterations:
```bash
npm test                  # full suite — 1364+ passing required
npm run lint              # no new errors in modified files
```

Integration smoke-test after P3:
```bash
cd /home/yale/work/codex-swarm
node /home/yale/work/archguard/dist/cli/index.js analyze -s . --lang go --atlas \
  --output-dir ./archguard --no-cache -v
# Verify in output:
grep 'subgraph grp_pkg_hub'   archguard/architecture-package.mmd  # two-segment grouping
grep 'subgraph grp_tests'     archguard/architecture-package.mmd  # top-level dir grouping
grep 'subgraph grp_examples'  archguard/architecture-package.mmd  # top-level dir grouping
grep 'classDef internal'      archguard/architecture-package.mmd
grep '⚠ self'                 archguard/architecture-package.mmd
```

---

## 4. Files Modified Summary

| File | Iterations | Change type |
|------|-----------|-------------|
| `src/types/extensions.ts` | P1 | `PackageNode.type` union widened (ADR-002 v1.3) |
| `src/plugins/golang/atlas/builders/package-graph-builder.ts` | P1 | `classifyPackageType()` rewrite |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | P0, P2, P3 | `renderPackageGraph()` + new private statics |
| `tests/plugins/golang/atlas/mermaid-templates.test.ts` | P0, P2, P3 | New test stories |
| `tests/plugins/golang/atlas/package-graph-builder.test.ts` | P1 | New classification tests |
