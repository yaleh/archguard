# Plan 22: TypeScript Module Graph Visual Parity — Development Plan

> Source proposal: `docs/proposals/plan-22-ts-module-graph-visual-parity.md`
> Branch: `feat/visualization`
> Status: Draft

---

## Overview

Six proposal changes are grouped into three delivery phases based on implementation complexity and dependency:

| Phase | Changes | Primary concern | Dependency |
|-------|---------|-----------------|------------|
| Phase A | C1 + C3 + C5 — init header, classDef restructure, edge labels | String-only, no logic changes | None |
| Phase B | C2 — depth-based subgraph style directives | `emitTreeNode` signature extension | Rebase onto A |
| Phase C | C4 + C6 — node role annotations + legend subgraph | Cycle ID computation, test updates | Rebase onto B |

**Phase A** adds the `%%{init: ...}%%` header, replaces the single broken `classDef external` with a three-entry block (placed **before** the edges section to match Go Atlas ordering), and quotes edge labels. No function signatures or control flow change.

**Phase B** modifies `emitTreeNode` to pass a depth accumulator, then emits `style sgId fill:...` directives between the external subgraph and the classDef block. No existing tests break.

**Phase C** computes `cycleNodeIds`, threads it into `emitTreeNode` for `:::role` annotations, and appends the conditional legend subgraph. **Three existing tests require targeted updates** after the legend implementation lands (not before).

**Recommended landing order**: A → B → C. Each phase passes `npm test` independently before the next begins.

---

## Target function tail structure

The complete tail of `renderTsModuleGraph()` after all three phases, shown as a reference for implementers:

```
%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%   ← A
flowchart LR

  [internal subgraph blocks — with :::role annotations]                               ← C
  [external_deps subgraph — unchanged, :::external on nodes]

  subgraph legend["Legend"]                                                            ← C
    direction LR
    legend_internal["internal module"]:::internal
    legend_external["external dependency"]:::external   (conditional)
    legend_cycle["cycle ⚠"]:::cycle                    (conditional)
    legend_edge["--> depends on (bolder = more imports)"]
  end
  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01

  style sgId fill:#ffffff,...   (depth-1 subgraphs)                                   ← B
  style sgId fill:#f6f8fa,...   (depth-2 subgraphs)
  ...
  style external_deps fill:#ffffff,stroke:#d0d7de,stroke-width:1px

  classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329                         ← A
  classDef external fill:#fff8c5,stroke:#d4a72c,color:#633c01
  classDef cycle    fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e,font-weight:bold

  [normal edges]
  [cycle edges]

  linkStyle N stroke:#e74c3c,stroke-width:2px   (unchanged; see Depth and linkStyle note)
```

**Depth and linkStyle note**: The current code calls `emitTreeNode(root, lines, 1)` — outermost subgraphs use depth argument 1. This depth value determines Mermaid indentation (`pad = '  '.repeat(depth)`) and is unchanged throughout all phases. The palette index formula is `Math.min(depth - 1, styles.length - 1)`, mapping depth=1 → palette[0] (white), depth=2 → palette[1], etc.

`linkStyle N` refers to the Nth edge/link declaration (`-->`, `==>`, `===>`). Non-edge lines — `style`, `classDef`, `subgraph`, `end` — are not counted by Mermaid's link indexer. The `edgeIndex` counter in the code only increments inside edge loops, so inserting legend, style, and classDef sections before the edges section does not affect any `linkStyle N` index.

---

## Pre-flight

```bash
# Confirm baseline before any changes
npm test -- --testPathPattern=ts-module-graph-renderer
# Expected: 18 tests, all passing

# Confirm current renderer preamble (lines 165-167):
# lines.push('flowchart LR');
# lines.push('  classDef external stroke-dasharray: 5 5,fill:#f9f9f9,stroke:#aaa');
# lines.push('');
```

---

## Phase A — String-only Quick Wins (C1 + C3 + C5)

### Objectives

- Add `%%{init: ...}%%` layout header before `flowchart LR` (Change 1).
- Replace the pre-existing `classDef external` line (bug: `stroke-dasharray: 5 5` has a space after the colon, invalid Mermaid syntax) with a three-entry `classDef` block placed **before the edge section** — matching verified Go Atlas output order (Change 3).
- Quote edge labels: `|N|` → `|"N refs"|` for `strength > 1` (Change 5).

No function signatures change. No new logic. No existing tests break.

### Why existing tests do not break

| Test | Current assertion | After Phase A |
|---|---|---|
| Line 44: `produces a flowchart LR header` | `toMatch(/^flowchart LR/m)` | `%%{init:...}%%` becomes line 1; `flowchart LR` becomes line 2. With the `m` flag, `^` matches the start of any line — assertion still passes. |
| Line 99: external style check | `toMatch(/stroke-dasharray\|:::ext\|classDef ext\|:::external/)` | `classDef external` is still present (repositioned, new hex values). Still matches `classDef ext`. |
| Line 58: thin arrow | `toMatch(/-->/)` | Edge format for strength-1 edges is unchanged (no label added). |
| Line 73: thick arrow | `toMatch(/===>\/stroke-width:.../)` | Thick arrow notation `===>` unchanged. |

### Files changed

| File | Change |
|------|--------|
| `src/mermaid/ts-module-graph-renderer.ts` | Add init header; remove early classDef; add three-entry classDef before edges; quote edge labels |

### Stage A-1 — Verify baseline

```bash
npm test -- --testPathPattern=ts-module-graph-renderer
# Must show: 18 passed
```

### Stage A-2 — Add `%%{init: ...}%%` header

In `renderTsModuleGraph()`, replace the preamble:

```typescript
// Before:
lines.push('flowchart LR');
lines.push('  classDef external stroke-dasharray: 5 5,fill:#f9f9f9,stroke:#aaa');
lines.push('');

// After:
lines.push("%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%");
lines.push('flowchart LR');
lines.push('');
```

The `classDef` line is removed from the top — it will be re-emitted in Stage A-3 at its correct position.

### Stage A-3 — Relocate and replace classDef block (before edges)

The target output order (verified from `codex-swarm/.archguard/architecture-package.mmd` lines 69–78) is:
`classDef block → edges`. The classDef block must appear **before** the edge emission loops.

Find the edge section in `renderTsModuleGraph()`:

```typescript
  lines.push('');

  // --- Edges ---
  const cycleModuleSets: Array<Set<string>> = ...
```

Insert the three-entry classDef block **before** `// --- Edges ---`:

```typescript
  lines.push('');

  // --- classDef block (before edges — matches Go Atlas output order) ---
  lines.push('  classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329');
  lines.push('  classDef external fill:#fff8c5,stroke:#d4a72c,color:#633c01');
  lines.push('  classDef cycle    fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e,font-weight:bold');
  lines.push('');

  // --- Edges ---
  const cycleModuleSets: Array<Set<string>> = ...
```

This also fixes the pre-existing syntax bug: `stroke-dasharray: 5 5` (space after colon, invalid) is eliminated by replacing the entire `classDef external` line.

### Stage A-4 — Quote edge labels

In both the normal-edges loop (line ~211) and the cycle-edges loop (line ~220), replace:

```typescript
// Before:
const label = edge.strength > 1 ? `|${edge.strength}|` : '';

// After:
const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
```

Both loops construct the `label` variable identically — apply the change in both places.

### Stage A-5 — Test

```bash
npm test -- --testPathPattern=ts-module-graph-renderer
# Must show: 18 passed (no regressions)
npm test
# Full suite must remain green
```

Add three new tests (append to the first `describe` block):

```typescript
it('produces a %%{init}%% layout header as the first line', () => {
  const graph: TsModuleGraph = {
    nodes: [makeNode('src/cli'), makeNode('src/parser')],
    edges: [],
    cycles: [],
  };
  const output = renderTsModuleGraph(graph);
  const lines = output.split('\n');
  expect(lines[0]).toMatch(/^%%\{init:/);
  expect(lines[1]).toMatch(/^flowchart LR/);
  expect(output).toContain("'curve': 'basis'");
});

it('quotes edge labels for strength > 1', () => {
  const graph: TsModuleGraph = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [makeEdge('a', 'b', 1), makeEdge('a', 'c', 3)],
    cycles: [],
  };
  const output = renderTsModuleGraph(graph);
  expect(output).not.toMatch(/\|"1 refs"\|/);
  expect(output).toContain('|"3 refs"|');
});

it('classDef block has 3 entries, appears before edges, and has no stroke-dasharray syntax bug', () => {
  const graph: TsModuleGraph = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [makeEdge('a', 'b', 1)],
    cycles: [],
  };
  const output = renderTsModuleGraph(graph);
  expect(output).toContain('classDef internal fill:#dafbe1');
  expect(output).toContain('classDef external fill:#fff8c5');
  expect(output).toContain('classDef cycle    fill:#ffebe9');
  // Bug fix: no space after colon
  expect(output).not.toMatch(/stroke-dasharray: /);
  // classDef must appear before the first edge line
  const classDefPos = output.indexOf('classDef internal');
  const firstEdgePos = output.search(/\n  \w+ -->/);
  expect(classDefPos).toBeLessThan(firstEdgePos);
});
```

### Acceptance criteria — Phase A

- [ ] Output line 0 matches `%%{init:` and contains `'curve': 'basis'`
- [ ] Output line 1 is `flowchart LR` (direction unchanged)
- [ ] `classDef internal`, `classDef external`, `classDef cycle` all present
- [ ] `classDef external` uses `fill:#fff8c5` (not the old `#f9f9f9`)
- [ ] No `stroke-dasharray: ` (space after colon) anywhere in output
- [ ] Strength-1 edges have no label; strength-3 edges use `|"3 refs"|`
- [ ] `classDef` block appears **before** the first edge line in the output
- [ ] `npm test` 18 original + 3 new = 21 tests pass, no regressions

---

## Phase B — Depth-Based Subgraph Styles (C2)

### Objectives

Track the nesting depth of each subgraph during `emitTreeNode` recursion and emit `style sgId fill:...` directives after the external subgraph block and before the classDef block (which Phase A placed immediately before the edges). No existing tests break.

### Depth mapping

The current call site uses `emitTreeNode(root, lines, 1)` — depth=1 for outermost nodes — and this is **unchanged** to preserve the 2-space indentation that existing tests depend on. The palette lookup formula compensates:

```
palette index = Math.min(depth - 1, SUBGRAPH_DEPTH_STYLES.length - 1)
```

| depth arg | palette index | fill |
|-----------|--------------|------|
| 1 | 0 | `#ffffff` (outermost — pure white) |
| 2 | 1 | `#f6f8fa` |
| 3 | 2 | `#eaeef2` |
| 4+ | 3 | `#d0d7de` |

`external_deps` is a top-level conceptual container that does not go through `emitTreeNode`. Its style is hardcoded as the same string as palette[0]: `fill:#ffffff,stroke:#d0d7de,stroke-width:1px`.

### Files changed

| File | Change |
|------|--------|
| `src/mermaid/ts-module-graph-renderer.ts` | `emitTreeNode` signature; depth accumulator; `SUBGRAPH_DEPTH_STYLES` constant; style emission before classDef |

### Stage B-1 — Write failing tests

Add a new `describe` block in `tests/unit/mermaid/ts-module-graph-renderer.test.ts`. All tests must **fail** before Stage B-2:

```typescript
describe('renderTsModuleGraph – subgraph depth styles', () => {
  it('top-level (depth-1) subgraph receives fill:#ffffff style', () => {
    // graph: cli → cli/commands (cli is depth-1 subgraph)
    // expect output to contain: style cli_group fill:#ffffff,...
  });
  it('depth-2 subgraph receives fill:#f6f8fa style', () => {
    // graph: cli → cli/commands (cli/commands is depth-2 leaf inside cli subgraph)
    // BUT: cli/commands as a leaf doesn't produce a subgraph.
    // Use: plugins → plugins/golang → plugins/golang/atlas
    // plugins_group = depth-1 (fill:#ffffff), plugins_golang_group = depth-2 (fill:#f6f8fa)
  });
  it('depth-3 subgraph receives fill:#eaeef2 style', () => { ... });
  it('depth-4+ subgraph receives fill:#d0d7de style (clamped)', () => { ... });
  it('external_deps subgraph receives fill:#ffffff style', () => { ... });
  it('style directives appear after subgraph end blocks and before edge lines', () => { ... });
  it('style directive ID matches the subgraph ID token used in the subgraph declaration', () => { ... });
});
```

**Fixtures**: Use graphs like `['a', 'a/b', 'a/b/c', 'a/b/c/d']` to exercise depth-1 through depth-4.

### Stage B-2 — Extend `emitTreeNode` signature

Add `subgraphStyles: Array<{ id: string; depth: number }>` as the final parameter. The mutable array is shared across the entire recursive call and populated each time a subgraph block is opened:

```typescript
function emitTreeNode(
  node: TreeNode,
  lines: string[],
  depth: number,
  subgraphStyles: Array<{ id: string; depth: number }>
): void {
  const pad = '  '.repeat(depth);
  const id = nodeTreeId(node);
  const nid = toNodeId(id);
  const label = id || '(root)';

  if (node.children.length === 0) {
    lines.push(`${pad}${nid}["${label}"]`);
  } else {
    const sgId = `${nid}_group`;
    subgraphStyles.push({ id: sgId, depth });               // ← record depth before recursing
    lines.push(`${pad}subgraph ${sgId}["${label}"]`);
    if (node.moduleNode !== null) {
      lines.push(`${pad}  ${nid}["${label}"]`);
    }
    for (const child of node.children) {
      emitTreeNode(child, lines, depth + 1, subgraphStyles);
    }
    lines.push(`${pad}end`);
  }
}
```

### Stage B-3 — Update call site and add depth constant

Declare the accumulator and pass it in `renderTsModuleGraph()`:

```typescript
const SUBGRAPH_DEPTH_STYLES = [
  'fill:#ffffff,stroke:#d0d7de,stroke-width:1px', // depth-1 (palette index 0) — outermost
  'fill:#f6f8fa,stroke:#d0d7de,stroke-width:1px', // depth-2 (palette index 1)
  'fill:#eaeef2,stroke:#8b949e,stroke-width:1px', // depth-3 (palette index 2)
  'fill:#d0d7de,stroke:#57606a,stroke-width:1px', // depth-4+ (palette index 3, clamped)
];

// ...

const subgraphStyles: Array<{ id: string; depth: number }> = [];

const forest = buildForest(internalNodes);
for (const root of forest) {
  emitTreeNode(root, lines, 1, subgraphStyles);    // depth=1 unchanged — preserves indentation
}
```

### Stage B-4 — Emit style directives before classDef

After the external subgraph block and **before** the classDef block that Phase A placed before the edges:

```typescript
  // [external_deps subgraph — unchanged]
  lines.push('');

  // --- Depth-based subgraph background styles ---
  for (const { id, depth } of subgraphStyles) {
    const paletteIndex = Math.min(depth - 1, SUBGRAPH_DEPTH_STYLES.length - 1);
    lines.push(`  style ${id} ${SUBGRAPH_DEPTH_STYLES[paletteIndex]}`);
  }
  if (externalNodes.length > 0) {
    // external_deps is hardcoded: same fill as palette[0], not passed through emitTreeNode
    lines.push(`  style external_deps fill:#ffffff,stroke:#d0d7de,stroke-width:1px`);
  }
  lines.push('');

  // --- classDef block (Phase A — position unchanged) ---
  lines.push('  classDef internal fill:#dafbe1,...');
  // ...

  // --- Edges ---
```

Phase C will insert the legend block between the external subgraph and the style directives, preserving this relative ordering.

### Stage B-5 — Run tests

```bash
npm test -- --testPathPattern=ts-module-graph-renderer
# Stage B-1 tests: now pass
# All 21 prior tests: still pass
npm test
# Full suite green
```

### Acceptance criteria — Phase B

- [ ] depth-1 subgraphs have `style sgId fill:#ffffff,...`
- [ ] depth-2 subgraphs have `style sgId fill:#f6f8fa,...`
- [ ] depth-3 subgraphs have `style sgId fill:#eaeef2,...`
- [ ] depth-4+ subgraphs have `style sgId fill:#d0d7de,...` (clamped)
- [ ] `external_deps` has `style external_deps fill:#ffffff,...` (when external nodes present)
- [ ] Style directives appear after all subgraph `end` blocks and **before** `classDef` lines
- [ ] Style directives appear **before** edge lines
- [ ] `style` IDs have no slashes (same sanitisation path as subgraph IDs via `toNodeId`)
- [ ] All prior subgraph structure tests pass (emitTreeNode behavior unchanged)
- [ ] `npm test` 21 original + 7 new = 28 tests pass, no regressions

---

## Phase C — Node Role Annotations + Legend (C4 + C6)

### Objectives

- Compute `cycleNodeIds` and thread it through `emitTreeNode` to annotate nodes with `:::internal`, `:::external`, or `:::cycle`.
- Emit a conditional legend subgraph before the style directives (between the external subgraph and the `style grp_*` block).
- **Update three existing tests** that will break when the always-present legend introduces `subgraph` and `end` keywords into every output.

### Stage ordering rationale

The three existing tests currently pass. They will start failing **after** the legend is implemented (Stage C-2), not before. Therefore the update sequence is:

1. **Stage C-1**: Write new failing tests (target behavior — all fail before implementation)
2. **Stage C-2**: Implement annotations + legend
3. **Stage C-3**: Run tests — new tests pass; **three existing tests now fail** due to legend
4. **Stage C-4**: Update those three existing tests to reflect the new behavior
5. **Stage C-5**: Full suite green

### Files changed

| File | Change |
|------|--------|
| `src/mermaid/ts-module-graph-renderer.ts` | `cycleNodeIds` computation; `emitTreeNode` annotation param; legend block insertion |
| `tests/unit/mermaid/ts-module-graph-renderer.test.ts` | New test cases (Stage C-1); update 3 existing tests (Stage C-4) |

### Stage C-1 — Write new failing tests

Add two `describe` blocks. All tests must **fail** before Stage C-2:

```typescript
describe('renderTsModuleGraph – node role annotations', () => {
  it('internal leaf node declaration contains :::internal');
  it('internal real-parent self-declaration (inside its own subgraph) contains :::internal');
  it('virtual parent node declaration has NO ::: suffix');
  it('node_modules leaf declaration contains :::external');
  it('cycle-participating node contains :::cycle, not :::internal');
  it('cycle annotation takes priority: a cycle node does NOT also have :::internal');
  it('non-cycle node in a graph that has cycles still gets :::internal');
});

describe('renderTsModuleGraph – legend subgraph', () => {
  it('legend subgraph is always present');
  it('legend always contains legend_internal["internal module"]:::internal');
  it('legend always contains legend_edge node');
  it('legend uses direction LR');
  it('legend omits legend_external when no node_modules nodes');
  it('legend includes legend_external["external dependency"]:::external when node_modules nodes exist');
  it('legend omits legend_cycle when no cycles');
  it('legend includes legend_cycle["cycle ⚠"]:::cycle when cycleNodeIds.size > 0');
  it('legend has amber style: fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01');
  it('legend subgraph appears before style grp_* directives in output');
  it('legend subgraph appears before classDef lines in output');
  it('no graph edges reference legend node IDs');
});
```

Run the full suite — 28 prior tests pass, new tests fail:
```bash
npm test -- --testPathPattern=ts-module-graph-renderer
# Expected: 28 passed, N failed (the new ones)
```

### Stage C-2 — Compute `cycleNodeIds` and extend `emitTreeNode`

**Step 1**: In `renderTsModuleGraph()`, add `cycleNodeIds` computation immediately after the node partition (before `buildForest`):

```typescript
// Build cycle node set for role annotation
// TsModuleCycle.modules: string[] — verified at src/types/extensions.ts:296-299
const cycleNodeIds = new Set(graph.cycles.flatMap((c) => c.modules));
```

**Step 2**: Add `cycleNodeIds: Set<string>` as the final parameter of `emitTreeNode`:

```typescript
function emitTreeNode(
  node: TreeNode,
  lines: string[],
  depth: number,
  subgraphStyles: Array<{ id: string; depth: number }>,
  cycleNodeIds: Set<string>
): void {
  const pad = '  '.repeat(depth);
  const id = nodeTreeId(node);
  const nid = toNodeId(id);
  const label = id || '(root)';

  // Role annotation: only for real module nodes (moduleNode !== null).
  // Virtual (synthetic) parent nodes have no module ID and get no annotation;
  // their visual role is carried by the subgraph style directive from Phase B.
  const roleClass = node.moduleNode !== null
    ? (cycleNodeIds.has(id) ? ':::cycle' : ':::internal')
    : '';

  if (node.children.length === 0) {
    lines.push(`${pad}${nid}["${label}"]${roleClass}`);
  } else {
    const sgId = `${nid}_group`;
    subgraphStyles.push({ id: sgId, depth });
    lines.push(`${pad}subgraph ${sgId}["${label}"]`);
    if (node.moduleNode !== null) {
      lines.push(`${pad}  ${nid}["${label}"]${roleClass}`);
    }
    for (const child of node.children) {
      emitTreeNode(child, lines, depth + 1, subgraphStyles, cycleNodeIds);
    }
    lines.push(`${pad}end`);
  }
}
```

Update the call site:
```typescript
for (const root of forest) {
  emitTreeNode(root, lines, 1, subgraphStyles, cycleNodeIds);
}
```

External nodes already have `:::external` — no change needed.

**Step 3**: Emit the legend block **before** the style directives (between the external subgraph `end` and the `style grp_*` block from Phase B):

```typescript
  // [external_deps subgraph]
  lines.push('');

  // --- Legend (before style directives — matches Go Atlas section order) ---
  lines.push('  subgraph legend["Legend"]');
  lines.push('    direction LR');
  lines.push('    legend_internal["internal module"]:::internal');
  if (externalNodes.length > 0) {
    lines.push('    legend_external["external dependency"]:::external');
  }
  if (cycleNodeIds.size > 0) {
    lines.push('    legend_cycle["cycle \u26a0"]:::cycle');
  }
  lines.push('    legend_edge["--> depends on (bolder = more imports)"]');
  lines.push('  end');
  lines.push('  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01');
  lines.push('');

  // --- Depth-based subgraph background styles (Phase B — position unchanged) ---
  for (const { id, depth } of subgraphStyles) {
    ...
  }
```

**`legend_cycle` condition**: `cycleNodeIds.size > 0`, not `graph.cycles.length > 0`. Only nodes that actually carry `:::cycle` in the diagram warrant a legend entry. `cycleNodeIds` is populated from `graph.cycles.flatMap(c => c.modules)`, correctly scoped to actual cycle participants.

**Legend node ID safety**: `legend_internal`, `legend_external`, `legend_cycle`, `legend_edge` are prefixed with `legend_`. `toNodeId()` sanitises real module paths by replacing `/`, `.`, `-`, `@`, `:` with underscores and never produces a `legend_*` identifier, so no collision is possible.

### Stage C-3 — Run tests, identify breakage

```bash
npm test -- --testPathPattern=ts-module-graph-renderer
```

Expected outcome: new tests from Stage C-1 now pass. Exactly **three existing tests** fail because the legend introduces `subgraph` and `end` into every output:

| Line | Test name | Failing assertion |
|------|-----------|-------------------|
| 205 | `'nodes without children are NOT wrapped in a subgraph'` | `not.toContain('subgraph')` |
| 206 | same test | `not.toContain('end')` |
| 354 | `'does not create a virtual parent when only one node has that prefix'` | `not.toContain('subgraph')` |

No other tests should fail. If additional tests break, investigate before proceeding.

### Stage C-4 — Update the three existing tests

**Test at line ~195 (`'nodes without children are NOT wrapped in a subgraph'`)**:

This test verifies that leaf-only graphs (no hierarchy) produce no *content* subgraphs. After adding the legend, the assertion must distinguish the legend subgraph from content subgraphs:

```typescript
// Before:
expect(output).not.toContain('subgraph');
expect(output).not.toContain('end');

// After:
// The legend is always present — verify it's the ONLY subgraph.
// Any content subgraph would appear before the legend in the output.
const legendIdx = output.indexOf('\n  subgraph legend[');
expect(legendIdx).toBeGreaterThan(0); // legend always present
const beforeLegend = output.slice(0, legendIdx);
expect(beforeLegend).not.toContain('subgraph'); // no content subgraphs before legend
```

**Test at line ~344 (`'does not create a virtual parent when only one node has that prefix'`)**:

Apply the same strategy:

```typescript
// Before:
expect(output).not.toContain('subgraph');

// After:
const legendIdx = output.indexOf('\n  subgraph legend[');
expect(legendIdx).toBeGreaterThan(0);
const beforeLegend = output.slice(0, legendIdx);
expect(beforeLegend).not.toContain('subgraph');
```

### Stage C-5 — Full suite green

```bash
npm test -- --testPathPattern=ts-module-graph-renderer
# All tests pass: 28 prior (3 updated) + Stage C-1 new count
npm test
# Full suite green
```

### Acceptance criteria — Phase C

- [ ] Internal leaf node line ends with `:::internal`
- [ ] Internal real-parent self-declaration ends with `:::internal`
- [ ] Virtual parent subgraph wrapper line has **no** `:::` suffix
- [ ] `node_modules` node ends with `:::external`
- [ ] Cycle-participating node ends with `:::cycle`, not `:::internal`
- [ ] `legend_internal` always present in legend
- [ ] `legend_external` present iff `externalNodes.length > 0`
- [ ] `legend_cycle` present iff `cycleNodeIds.size > 0`
- [ ] `legend_edge` always present
- [ ] Legend style: `fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01`
- [ ] Legend appears **before** `style grp_` directives in output
- [ ] Legend appears **before** `classDef` lines in output
- [ ] Three updated existing tests pass with `indexOf('\n  subgraph legend[')` strategy
- [ ] Line 206 `not.toContain('end')` is replaced — no assertion on bare `end` keyword remains
- [ ] `linkStyle N` indices unchanged (cycle edges still styled red)
- [ ] `npm test` full count does not decrease; all unmodified prior tests pass unchanged

---

## Cross-Phase Validation

After all three phases land:

```bash
npm run type-check
npm run lint
npm test
npm run build

# Self-analysis
rm -rf .archguard
node dist/cli/index.js analyze -v

# Spot-check generated overview/package.mmd
head -3 .archguard/overview/package.mmd
# Expected line 0: %%{init: {'flowchart': ...
# Expected line 1: flowchart LR

grep "subgraph legend" .archguard/overview/package.mmd
# Expected: one match

# Verify section ordering: legend < style grp_ < classDef < first edge
awk '/subgraph legend/{l=NR} /style grp_/{s=NR} /classDef internal/{c=NR} / --> /{if(!e)e=NR} END{print "legend="l" style="s" classDef="c" edge="e}' \
  .archguard/overview/package.mmd
# Expected: legend < style < classDef < edge (all values increasing)

grep ":::cycle" .archguard/overview/package.mmd || echo "(no cycles in archguard itself)"

# Verify Go output is unchanged
node dist/cli/index.js analyze -s /home/yale/work/codex-swarm \
  --lang go --output-dir /tmp/codex-check -v
diff /home/yale/work/codex-swarm/.archguard/architecture-package.mmd \
     /tmp/codex-check/architecture-package.mmd
# Expected: no diff
```

---

## Non-Goals (reminder)

- `flowchart TB` direction — retained as `LR`; TB may be introduced as a config option in a future plan
- `TsModuleNode.type === 'external'` dead union value — builder-side fix, separate issue
- Mermaid classDiagram `namespace` depth styling — not supported by Mermaid syntax
- Any changes to `generator.ts`, `mermaid-templates.ts`, or builder files
