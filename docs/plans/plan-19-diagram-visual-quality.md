# Plan 19: Diagram Visual Quality — Development Plan

> Source proposal: `docs/proposals/plan-19-diagram-visual-quality.md`
> Branch: `feat/visualization`
> Status: Draft

---

## Overview

Five proposal changes are grouped into three delivery phases based on file locality and dependency:

| Phase | Changes | Files | Dependency |
|-------|---------|-------|------------|
| Phase A | P0 + P1 — curve interpolation + Go Atlas palette | `mermaid-templates.ts` | None |
| Phase B | P2 + P3 — in-degree ordering + legend subgraph | `mermaid-templates.ts` | Rebase onto A before starting |
| Phase C | P4a + P4b — TypeScript class diagram styling | `generator.ts` | Independent of A and B |

A and B both modify `renderPackageGraph()` in `mermaid-templates.ts`. Phase A changes the `classDef` string values (lines 241-248) and `FLOWCHART_INIT`; Phase B adds logic inside the same function. Phase B must be developed from the Phase A merged state — start Phase B by rebasing onto `master` after Phase A lands. C is entirely in `generator.ts` and can be developed in parallel with A or B.

**Recommended landing order**: A first (lowest risk, 9 lines total), then B (rebase on A), then C.

---

## Phase A — Go Atlas Quick Wins (P0 + P1)

### Objectives

- Add `curve: 'basis'` to `FLOWCHART_INIT` so all four Atlas flowchart renderers use smooth Bezier interpolation instead of straight lines.
- Replace the eight `classDef` colour values in `renderPackageGraph()` with a muted GitHub Light palette while preserving all semantic identifiers and existing `:::styleName` usages.

No logic changes. No new methods. No type changes.

### Files changed

| File | Lines | Change |
|------|-------|--------|
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | 32–33 | Add `'curve': 'basis'` to `FLOWCHART_INIT` |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | 241–248 | Replace 8 `classDef` hex values |

### Stages

#### Stage A-1 — Verify baseline (read before write)

Confirm current state to guard against line drift:

```bash
npm test -- tests/plugins/golang/atlas/mermaid-templates.test.ts
```

All tests must pass. Confirm the following constants match:
- `mermaid-templates.ts:32-33`: `FLOWCHART_INIT` contains only `nodeSpacing` and `rankSpacing`
- `mermaid-templates.ts:241`: `classDef cmd      fill:#ff6b6b,...`

#### Stage A-2 — Add `curve: 'basis'` to `FLOWCHART_INIT`

Modify `mermaid-templates.ts:32-33`:

```typescript
// Before:
private static readonly FLOWCHART_INIT =
  "%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80}}}%%\n";

// After:
private static readonly FLOWCHART_INIT =
  "%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%\n";
```

#### Stage A-3 — Replace package graph palette

Replace `mermaid-templates.ts:241-248` (the eight `classDef` lines in `renderPackageGraph()`):

```
// Before (saturated):
  classDef cmd      fill:#ff6b6b,stroke:#c0392b,color:#000
  classDef tests    fill:#b2bec3,stroke:#636e72,color:#000
  classDef examples fill:#74b9ff,stroke:#0984e3,color:#000
  classDef testutil fill:#dfe6e9,stroke:#b2bec3,color:#000
  classDef internal fill:#55efc4,stroke:#00b894,color:#000
  classDef vendor   fill:#f0e6ff,stroke:#9b59b6,color:#000
  classDef external fill:#ffeaa7,stroke:#fdcb6e,color:#000
  classDef cycle    fill:#fd79a8,stroke:#e84393,stroke-width:3px

// After (muted GitHub Light):
  classDef cmd      fill:#ffebe9,stroke:#cf222e,color:#82071e
  classDef tests    fill:#f6f8fa,stroke:#d0d7de,color:#57606a
  classDef examples fill:#ddf4ff,stroke:#54aeff,color:#0550ae
  classDef testutil fill:#f6f8fa,stroke:#d0d7de,color:#57606a
  classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329
  classDef vendor   fill:#fdf4ff,stroke:#d2a8ff,color:#6e40c9
  classDef external fill:#fff8c5,stroke:#d4a72c,color:#633c01
  classDef cycle    fill:#ffebe9,stroke:#cf222e,stroke-width:3px,color:#82071e,font-weight:bold
```

Note: All eight `classDef` identifiers are unchanged. No `:::styleName` usages in node declarations require modification.

#### Stage A-4 — Test

```bash
npm test -- tests/plugins/golang/atlas/mermaid-templates.test.ts
```

Checks:
- All 351-361 assertions (`toContain('classDef internal')`, etc.) still pass — they check names only, not hex values.
- The single hex-asserting test at line 1711 (`classDef hotspot fill:#ff7675,...`) is in `renderCapabilityGraph()`, which this phase does not touch — it must pass unchanged.
- `FLOWCHART_INIT` string in output now contains `'curve': 'basis'`.

### Acceptance criteria

- [ ] `npm test` total count unchanged (no regressions).
- [ ] `FLOWCHART_INIT` contains `'curve': 'basis'`.
- [ ] `classDef cmd` uses `fill:#ffebe9`.
- [ ] `classDef cycle` uses `stroke-width:3px` and `font-weight:bold`.
- [ ] All eight `classDef` names preserved as-is.
- [ ] `renderCapabilityGraph` hotspot test at line 1711 still passes.
- [ ] No changes to any file other than `mermaid-templates.ts`.

---

## Phase B — Go Atlas Structural Improvements (P2 + P3)

### Objectives

- Sort package nodes by in-degree before emission so high-coupling packages appear at the top of the `.mmd` source file.
- Add a conditional `Legend` subgraph at the bottom of `renderPackageGraph()` output, containing one representative node per active type, with `cycle` included when `graph.cycles.length > 0`.

### Files changed

| File | Change |
|------|--------|
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | In-degree sort at head of `renderPackageGraph()`; new `private static renderLegend()` method; call site before `classDef` block |

### Stages

#### Stage B-1 — Write failing tests for in-degree ordering

In `tests/plugins/golang/atlas/mermaid-templates.test.ts`, add a describe block:

```
describe('renderPackageGraph — in-degree ordering', () => {
  it('emits highest in-degree node before lower in-degree nodes in output text')
  it('excludes self-loop edges from in-degree calculation')
  it('breaks ties alphabetically for deterministic output')
  it('flat graph (all in-degree 0) emits nodes in alphabetical order')
})
```

Use a small synthetic `PackageGraph` (3-5 nodes, 4-6 edges). Assert by checking `output.indexOf(highDegreeNodeId) < output.indexOf(lowDegreeNodeId)` in the raw string.

All four tests must **fail** before implementation.

#### Stage B-2 — Implement in-degree sort in `renderPackageGraph()`

At the start of `renderPackageGraph()`, before Pass 1 (node emission), insert:

```typescript
// Compute in-degree for source-file ordering (topology unchanged)
const inDegree = new Map<string, number>();
for (const node of graph.nodes) inDegree.set(node.id, 0);
for (const edge of graph.edges) {
  if (edge.from !== edge.to) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
}
const sortedNodes = [...graph.nodes].sort((a, b) => {
  const diff = (inDegree.get(b.id) ?? 0) - (inDegree.get(a.id) ?? 0);
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
});
```

**Scope of this change — top-level ungrouped nodes only**: Replace `graph.nodes` with `sortedNodes` in the Pass 1 `for...of` loop (line ~228: `for (const node of graph.nodes)`). This sorts nodes that are emitted directly as top-level declarations.

The `renderGroupNodes(roots, nodeMap, cycleNodeIds, '  ')` call is **not changed** — it accepts a `GroupNode[]` tree (the `roots` variable), not `graph.nodes`. Nodes inside subgraph groups are ordered by their position in `group.nodeIds`, which is populated during `buildGroupTree`. Sorting nodes within subgraphs would require passing `sortedNodes` to `buildGroupTree` instead of `graph.nodes` — this is a larger change outside this plan's scope.

The `nodeMap` and `buildGroupTree` calls retain `graph.nodes` as their input to preserve lookup correctness and group membership.

Run Stage B-1 tests — all must pass.

**Update acceptance criteria accordingly**: The ordering guarantee applies to top-level ungrouped nodes. Nodes inside subgraph blocks are not covered by this change.

#### Stage B-3 — Write failing tests for legend subgraph

In the same test file, add:

```
describe('renderPackageGraph — legend subgraph', () => {
  it('includes legend node for each PackageNode.type present in graph')
  it('includes legend_cycle entry when cycleNodeIds is non-empty (multi-package cycle)')
  it('omits legend_cycle when cycleNodeIds is empty (no multi-package cycles)')
  it('omits legend_cycle when graph.cycles contains only self-loops (packages.length === 1)')
  it('legend subgraph uses direction LR')
  it('legend subgraph ID is "legend"')
  it('no edges exist between legend nodes and graph nodes')
  it('legend appears before classDef block in output (between Pass 1 and Pass 2)')
})
```

All seven tests must **fail** before implementation.

#### Stage B-4 — Implement `renderLegend()` and call site

Add a private static method to `MermaidTemplates`:

```typescript
private static renderLegend(activeTypes: Set<string>): string {
  const LEGEND_LABELS: Record<string, string> = {
    cmd:      'cmd (entry point)',
    tests:    'tests',
    examples: 'examples',
    testutil: 'testutil',
    internal: 'internal',
    vendor:   'vendor',
    external: 'external (module boundary)',
    cycle:    'cycle (circular dep)',
  };
  let out = '  subgraph legend["Legend"]\n';
  out += '    direction LR\n';
  for (const type of Object.keys(LEGEND_LABELS)) {
    if (activeTypes.has(type)) {
      out += `    legend_${type}["${LEGEND_LABELS[type]}"]:::${type}\n`;
    }
  }
  out += '  end\n\n';
  return out;
}
```

**Active type collection** in `renderPackageGraph()`, immediately after `cycleNodeIds` is computed (around line 221), so `cycleNodeIds` is already available:

```typescript
const activeTypes = new Set(graph.nodes.map((n) => n.type as string));
if (cycleNodeIds.size > 0) activeTypes.add('cycle');
```

Note: The condition is `cycleNodeIds.size > 0`, **not** `graph.cycles.length > 0`. Only multi-package cycles (`packages.length > 1`) produce `:::cycle`-styled nodes. Self-loop cycles (`packages.length === 1`) appear in `graph.cycles` but never generate `:::cycle` node annotations. Including `cycle` in the legend when no node actually carries `:::cycle` would produce a misleading legend entry.

**Call site — insertion between Pass 1 and Pass 2**:

Insert `output += MermaidTemplates.renderLegend(activeTypes);` after the `renderGroupNodes` call (end of Pass 1) and before `output += '\n'` that precedes the `classDef` block (start of Pass 2):

```typescript
// Pass 1 cont.: recursive subgraph tree
output += MermaidTemplates.renderGroupNodes(roots, nodeMap, cycleNodeIds, '  ');

// ← INSERT HERE: output += MermaidTemplates.renderLegend(activeTypes);

// Pass 2: classDef block
output += '\n';
output += '  classDef cmd ...\n';
```

**Why this placement is required — edge-ordering test constraint**:

`mermaid-templates.test.ts:600-613` asserts:
```typescript
const subgraphEnd = result.lastIndexOf('end');
const edgeLine   = result.indexOf('mod_pkg_hub -->');
expect(edgeLine).toBeGreaterThan(subgraphEnd);
```

The legend `subgraph...end` block contains the literal keyword `end`. If legend is inserted **after** edges (e.g. after Pass 3b or Pass 4), `lastIndexOf('end')` returns a position after the edges, making `edgeLine > subgraphEnd` false — the test fails.

Inserting legend **before** edges (between Pass 1 and Pass 2) ensures legend's `end` appears before all edge declarations. `lastIndexOf('end')` returns legend's `end` position; edges follow it; the test passes.

The same constraint affects the existing subgraph `end` blocks from Pass 1. The classDef `vendor` value contains the substring `end` (v**end**or), which is why the original code comment at line 238 explains classDef must be placed before edges — to avoid `lastIndexOf('end')` landing inside a classDef string that appears after edges. Legend placement follows the same reasoning.

**Legend node ID safety**: `legend_cmd`, `legend_internal`, etc. are hardcoded with a `legend_` prefix. These cannot collide with real package node IDs (which use `sanitizeId()` on full module paths and never produce `legend_*` output).

Run Stage B-3 tests — all must pass.

#### Stage B-5 — Full test suite

```bash
npm test -- tests/plugins/golang/atlas/mermaid-templates.test.ts
npm test
```

All pre-existing tests must pass. New test count must equal Stage B-1 count + Stage B-3 count.

### Acceptance criteria

- [ ] Among top-level ungrouped nodes, highest in-degree node appears before lowest in-degree node in output.
- [ ] Self-loop edges excluded from in-degree calculation.
- [ ] Tie-breaking is alphabetical (deterministic across runs).
- [ ] Nodes inside subgraph blocks are not reordered (out of scope for this change).
- [ ] Legend subgraph present with ID `legend`, using `direction LR`.
- [ ] Legend contains only types present in `graph.nodes` (plus `cycle` when `cycleNodeIds.size > 0`).
- [ ] Legend omits `cycle` when all entries in `graph.cycles` have `packages.length === 1`.
- [ ] No edges between legend nodes and graph nodes in output.
- [ ] Legend appears between Pass 1 (`renderGroupNodes`) and Pass 2 (`classDef` block).
- [ ] Existing edge-ordering test (`mermaid-templates.test.ts:600-613`) still passes.
- [ ] `npm test` total count does not decrease.
- [ ] No changes to any file other than `mermaid-templates.ts`.

---

## Phase C — TypeScript Class Diagram Semantic Styling (P4a + P4b)

### Objectives

- Fix the dead conditional in `generator.ts:331` (P4a — prerequisite).
- Emit a `classDef` block and `:::styleName` annotations in `generateClassLevel()` and `generateMethodLevel()` that visually distinguish all seven `EntityType` values (P4b).

### Files changed

| File | Lines | Change |
|------|-------|--------|
| `src/mermaid/generator.ts` | 331 | Remove dead conditional; replace with `const classType = 'class'` |
| `src/mermaid/generator.ts` | `generateClassLevel()`, `generateMethodLevel()` | Emit `classDef` block after `classDiagram`; emit `:::styleName` annotations after relations |

### Stages

#### Stage C-1 — Write failing tests for P4a (dead conditional)

In `tests/unit/mermaid/generator.test.ts`, the dead conditional at line 331 has no observable test impact — `classType` is always `'class'` either way. P4a is a code-quality fix; its test coverage is provided by verifying the fix does not break any existing tests. Run baseline:

```bash
npm test -- tests/unit/mermaid/generator.test.ts
```

Record passing count. This is the regression baseline for P4a.

#### Stage C-2 — Fix dead conditional (P4a)

In `generator.ts:331`, replace:

```typescript
// Before:
const classType = entity.type === 'interface' ? 'class' : 'class';

// After:
const classType = 'class'; // Mermaid classDiagram only uses the 'class' keyword
```

Run baseline tests — count must be unchanged.

#### Stage C-3 — Write failing tests for P4b (classDef + annotations)

Add a describe block in `tests/unit/mermaid/generator.test.ts`:

```
describe('ValidatedMermaidGenerator — semantic classDef', () => {
  it('emits classDef block with all 7 EntityType entries in class-level output')
  it('emits classDef block in method-level output')
  it('does NOT emit classDef block in package-level output')
  it('annotates a class entity with :::classNode after all declarations')
  it('annotates an interface entity with :::interface')
  it('annotates an enum entity with :::enum')
  it('annotates a struct entity with :::struct')
  it('annotates a trait entity with :::trait')
  it('annotates an abstract_class entity with :::abstract_class')
  it('annotates a function entity with :::function')
  it('annotation ID matches the normalized entity name used in the class declaration')
  it('emits no duplicate annotation lines for the same entity')
})
```

Use small ArchJSON fixtures (1–2 entities, minimal members). All 12 tests must **fail** before implementation.

**Coverage note**: All seven `EntityType` values (`class`, `interface`, `enum`, `struct`, `trait`, `abstract_class`, `function`) must have an individual annotation test. The acceptance criterion "No entity type falls through to an undefined classDef name" is only verifiable if all seven are explicitly tested.

**Fixture note**: `Entity` requires `id`, `name`, `type`, `visibility`, `members`, `sourceLocation`. Use:
```typescript
const makeEntity = (name: string, type: EntityType): Entity => ({
  id: `src/test.ts.${name}`,
  name,
  type,
  visibility: 'public',
  members: [],
  sourceLocation: { file: 'src/test.ts', startLine: 1, endLine: 10 },
});
```

#### Stage C-4 — Implement classDef emission (P4b)

**Step 1 — `classDef` map and helper** (add as module-level constants in `generator.ts`, before the `ValidatedMermaidGenerator` class declaration):

`entity.type === 'class'` maps to the `classDef` name `classNode` (not `class`) to avoid ambiguity with Mermaid's `class` declaration keyword. All other `EntityType` values use their own name as the `classDef` identifier.

```typescript
// Maps EntityType → classDef identifier used in .mmd output
const ENTITY_CLASSDEF_STYLES: Record<string, string> = {
  classNode:      'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',  // EntityType 'class'
  interface:      'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  enum:           'fill:#fff8c5,stroke:#d4a72c,color:#633c01',
  struct:         'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  trait:          'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  abstract_class: 'fill:#fdf4ff,stroke:#d2a8ff,color:#8250df',
  function:       'fill:#f6f8fa,stroke:#d0d7de,color:#57606a',
};

function entityTypeToClassDef(type: EntityType): string {
  return type === 'class' ? 'classNode' : type;
}
```

**Step 2 — emit `classDef` block** in both `generateClassLevel()` and `generateMethodLevel()`, immediately after `lines.push('classDiagram')`:

```typescript
// Emit semantic classDef block for all entity types
for (const [name, style] of Object.entries(ENTITY_CLASSDEF_STYLES)) {
  lines.push(`  classDef ${name} ${style}`);
}
lines.push('');
```

Note: `groupEntitiesByPackage()` is a data computation called on the next line — it does not write to `lines[]`. The classDef block is pushed before any namespace or class declarations are appended.

**Step 3 — emit `:::styleName` annotations** at the end of both methods, after all entity and relation declarations and before `return lines.join('\n')`:

```typescript
// Emit node type annotations (:::styleName syntax)
lines.push('');
lines.push('  %% Node type annotations');
const seen = new Set<string>();
for (const entity of this.archJson.entities) {
  const normalizedId = this.escapeId(this.normalizeEntityName(entity.name));
  if (seen.has(normalizedId)) continue;
  seen.add(normalizedId);
  lines.push(`  ${normalizedId}:::${entityTypeToClassDef(entity.type)}`);
}
```

The `classDef` block emits `classDef classNode ...`; annotations emit `ClassName:::classNode` for class entities and `ClassName:::interface` for interfaces, etc.

#### Stage C-5 — Verify and run full suite

```bash
npm test -- tests/unit/mermaid/generator.test.ts
npm test
```

Existing tests that assert exact `classDiagram` output strings may now include extra `classDef` and annotation lines. Identify failures and update only the assertion strings — do not change business logic.

```bash
# Identify which tests need assertion updates:
npm test -- tests/unit/mermaid/generator.test.ts 2>&1 | grep "AssertionError\|●"
```

### Acceptance criteria

- [ ] `generator.ts:331` dead conditional removed; replaced with `const classType = 'class'`.
- [ ] `classDiagram` output for `class` level includes all seven `classDef` entries (classNode, interface, enum, struct, trait, abstract_class, function).
- [ ] `classDiagram` output for `method` level includes all seven `classDef` entries.
- [ ] `classDiagram` output for `package` level does **not** include `classDef` entries.
- [ ] Each entity emits exactly one `:::styleName` annotation line.
- [ ] Annotation ID matches the normalized entity name used in the class declaration.
- [ ] `entity.type === 'class'` maps to `:::classNode` (not `:::class`).
- [ ] `entity.type === 'trait'` maps to `:::trait` (all seven EntityType values individually verified by tests).
- [ ] No entity type falls through to an undefined `classDef` name.
- [ ] `npm test` total count does not decrease (12 new tests from C-3).
- [ ] No changes to any file other than `generator.ts`.

---

## Cross-Phase Test Validation

After all three phases are complete:

```bash
npm run type-check
npm run lint
npm test
npm run build
node dist/cli/index.js analyze -v
```

The self-validation run generates `.archguard/` output. Inspect the generated `.mmd` files to confirm:
- `overview/package.mmd`: Contains `'curve': 'basis'` in init block; `classDef internal` uses `#dafbe1`; `legend` subgraph present.
- `class/all-classes.mmd` (if generated): Contains `classDef interface`; entities annotated with `:::interface` or `:::classNode`.

---

## Non-Goals (reminder)

These items are explicitly out of scope for this plan and should not be implemented as "while we're here" additions:

- Mermaid stereotype annotations (`<<interface>>`, `<<enumeration>>`) — separate proposal
- Interactive edge highlighting — requires HTML viewer, not static SVG
- `o--o` bidirectional edge merging — requires symmetric pair detection
- Per-subgraph node-count auto-split — deferred
