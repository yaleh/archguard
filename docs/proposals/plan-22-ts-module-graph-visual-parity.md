# Plan 22: TypeScript Module Graph Visual Parity with Go Atlas

**Status**: Draft
**Branch**: feat/visualization
**Motivation**: The TypeScript `overview/package.mmd` flowchart diagram (`ts-module-graph-renderer.ts`) is visually minimal compared to the Go Atlas package graph that benefited from Plans 19–21. It lacks depth-based subgraph colouring, a legend, semantic node roles, and the polished layout header present in the Go output. The `class/` and `method/` classDiagrams already received semantic styling in Plan 19; the remaining gap is the flowchart renderer. This plan brings the TypeScript overview diagram to parity.

---

## Background

ArchGuard generates two categories of TypeScript diagrams:

| Renderer | Output | Plan 19 Status |
|---|---|---|
| `src/mermaid/ts-module-graph-renderer.ts` | `overview/package.mmd` (flowchart) | **Not touched** — minimal styling |
| `src/mermaid/generator.ts` | `class/*.mmd`, `method/*.mmd` (classDiagram) | ✅ Semantic `classDef` + node annotations added |

The Go Atlas package graph (`architecture-package.mmd`, managed by `mermaid-templates.ts`) received a full visual upgrade through Plans 19–21: GitHub Light palette, depth-based subgraph backgrounds, legend subgraph, weighted edge labels. The TypeScript flowchart output has not received equivalent treatment and presents a noticeably weaker visual compared to its Go counterpart.

**Self-analysis output comparison (`archguard/` vs `codex-swarm/.archguard/`):**

```
TS overview/package.mmd (current)          Go architecture-package.mmd (target quality)
──────────────────────────────────────     ─────────────────────────────────────────────
flowchart LR                               %%{init: {'flowchart': {'nodeSpacing': 50,
  classDef external stroke-dasharray: 5 5    'rankSpacing': 80, 'curve': 'basis'}}}%%
  subgraph cli_group["cli"]               flowchart TB
    ...                                     subgraph grp_cli["cli"]
  end                                         ...
  cli -->|2| cli_commands                   end
  linkStyle 103 stroke:#e74c3c,...          style grp_cli fill:#ffffff,...
                                            classDef internal fill:#dafbe1,...
                                            subgraph legend["Legend"]
                                              legend_internal["internal"]:::internal
                                            end
                                            cli -->|"3 refs"| cli_commands
```

---

## Identified Gaps

### Gap 1 — No layout initialisation header

`renderTsModuleGraph()` emits a bare `flowchart LR` with no `%%{init: ...}%%` directive. Dagre uses default node/rank spacing, producing tightly-packed output for projects with 30+ modules. Edge curves default to `linear`, creating visual clutter at high edge density.

---

### Gap 2 — Subgraph hierarchy has no depth-based background colouring

`emitTreeNode()` emits `subgraph sgId["label"]` blocks but no `style sgId fill:...` directives. All subgraphs render with identical Mermaid-default fill, making nesting depth invisible.

**Impact**: The hierarchy of `plugins/golang/atlas/renderers` inside `plugins/golang/atlas` inside `plugins/golang` inside `plugins` is indistinguishable at a glance. The Go Atlas package graph applies a four-level depth palette that makes nesting immediately readable.

---

### Gap 3 — Only `external` nodes have a `classDef`; internal nodes are unstyled

The current renderer emits one `classDef`:
```
classDef external stroke-dasharray: 5 5,fill:#f9f9f9,stroke:#aaa
```

This line also contains a pre-existing syntax bug: `stroke-dasharray: 5 5` has a space after the colon, which is invalid Mermaid style syntax. The correct form is `stroke-dasharray:5 5`. Internal module nodes (the majority) have no style assignment whatsoever.

---

### Gap 4 — Cycle nodes are not visually flagged

The renderer detects cycle edges and applies `linkStyle idx stroke:#e74c3c` to them. The nodes that participate in a cycle receive no special styling — only their connecting edges are red, making the architectural problem less visible.

---

### Gap 5 — Edge labels are bare integers, not quoted strings

Current output: `cli -->|2| cli_commands`
Go Atlas output: `cli -->|"3 refs"| cli_commands`

The bare integer label is ambiguous (weight? version? count?). The quoted descriptive form communicates intent.

---

### Gap 6 — No legend subgraph

The diagram has no self-describing legend. A reader cannot determine from the PNG/SVG alone what colours mean. Plans 19–21 added legends to all four Go Atlas diagrams; the TypeScript flowchart has none.

---

## Out of Scope

### `class/*.mmd` and `method/*.mmd` (classDiagram)

These already have semantic `classDef` and node-type annotations from Plan 19. The remaining theoretical improvement — depth-based `style` directives on `namespace` blocks — is **not supported by Mermaid's `classDiagram` syntax**. Mermaid classDiagram does not accept `style namespace_id fill:...` directives. No actionable changes exist for these files.

---

## Known Limitations

### `TsModuleNode.type === 'external'` is a declared but unused type value

`TsModuleNode.type` is typed as `'internal' | 'external' | 'node_modules'`, but `module-graph-builder.ts` only ever emits `'internal'` or `'node_modules'` — the `'external'` value is never set in practice. The renderer already partitions nodes as:
- internal = `node.type !== 'node_modules'` (currently this means `type === 'internal'` only)
- external = `node.type === 'node_modules'`

This plan follows the same partition logic. Should the builder ever emit `type === 'external'` in the future, those nodes would receive `:::internal` styling — a silent mismatch. This pre-existing type inconsistency is out of scope for Plan 22 but should be resolved in the builder separately.

---

## Proposed Changes

### Files affected

| File | Change |
|---|---|
| `src/mermaid/ts-module-graph-renderer.ts` | All six gaps — see Changes 1–6 below |
| `tests/unit/mermaid/ts-module-graph-renderer.test.ts` | Update 3 existing tests + add new assertions |

`src/mermaid/generator.ts` is **not modified** in this plan.

---

## Design Decisions

### Decision 1 — Direction: keep `flowchart LR`

The Go Atlas package graph uses `TB` (top-to-bottom). However, for TypeScript module graphs `LR` is retained for the following reasons:

1. **Existing tests depend on it**: line 44 of the existing test file asserts `expect(output).toMatch(/^flowchart LR/m)`. Changing direction is a breaking change to the test contract that would require explicit justification beyond aesthetics.
2. **TypeScript module graphs are wide, not deep**: The ArchGuard self-analysis produces ~15 internal modules with a maximum depth of 4 (`plugins/golang/atlas/renderers`). `LR` spreads the tree horizontally, giving each level adequate space. `TB` stacks levels vertically, producing a tall narrow diagram that is less ergonomic in typical widescreen viewports.
3. **Output format stability**: Users may embed `overview/package.mmd` in READMEs or compare diffs in CI. A direction change alters the entire rendered layout, which is a higher-impact change than styling.

The layout header (`%%{init: ...}%%`) and spacing parameters (`nodeSpacing`, `rankSpacing`, `curve`) improve rendering quality without changing direction. These are introduced in Change 1.

If TB direction is desired in the future, it should be introduced as a configurable option (e.g. `mermaid.packageDiagramDirection: 'LR' | 'TB'`) with a deprecation path, not as a silent style change.

---

### Decision 2 — Depth palette matches Go Atlas exactly

The four-level palette from `MermaidTemplates.SUBGRAPH_DEPTH_STYLES` (already used in Go Atlas):

```
depth 0:  fill:#ffffff, stroke:#d0d7de, stroke-width:1px
depth 1:  fill:#f6f8fa, stroke:#d0d7de, stroke-width:1px
depth 2:  fill:#eaeef2, stroke:#8b949e, stroke-width:1px
depth 3+: fill:#d0d7de, stroke:#57606a, stroke-width:1px
```

Using the same values ensures visual consistency when a project's README shows both TypeScript and Go diagrams side by side.

**`external_deps` subgraph depth**: The `external_deps` subgraph is a top-level conceptual container, not a module hierarchy node. It is assigned **depth-0** style (`fill:#ffffff`) to match its position as a peer of other top-level subgraphs. Treating it as depth 1 (`fill:#f6f8fa`) would imply it is a child of something, which is incorrect. However, since all external dependencies are visually distinguished via `:::external` node annotations, the white depth-0 fill is sufficient — the subgraph boundary alone communicates grouping.

---

### Decision 3 — Semantic `classDef` for TypeScript module roles

TypeScript modules have two intrinsic roles (based on what `module-graph-builder.ts` actually produces):

| Role | Condition | `classDef` name | Colour |
|---|---|---|---|
| `internal` | `node.type !== 'node_modules'` | `internal` | `fill:#dafbe1,stroke:#2da44e,color:#116329` (muted green) |
| `external` | `node.type === 'node_modules'` | `external` | `fill:#fff8c5,stroke:#d4a72c,color:#633c01` (muted amber) |
| `cycle` | node participates in any cycle | `cycle` | `fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e,font-weight:bold` (muted red) |

`cycle` is applied as an **override** — a cycle-participating node gets `:::cycle` regardless of whether it is also `internal`. Cycle membership takes priority.

The pre-existing `classDef external` is replaced entirely, fixing both the style values and the syntax bug (`stroke-dasharray: 5 5` → `stroke-dasharray:5 5`).

---

### Decision 4 — Quoted edge labels with descriptive suffix

```
strength 1:     cli --> cli_commands              (no label — identical to current)
strength 2–9:   cli -->|"2 refs"| cli_commands    (medium arrow, quoted label)
strength 10+:   cli ===>|"12 refs"| cli_commands  (thick arrow, quoted label)
```

Strength-1 edges omit the label entirely (no change). Strength > 1 uses `"N refs"` format. "refs" communicates "import reference count."

---

### Decision 5 — Legend is conditional on active node types

The legend subgraph emits only the node types present in the current graph:
- `legend_internal` — always present (every TS project has internal modules)
- `legend_external` — present only if `externalNodes.length > 0`
- `legend_cycle` — present only if `graph.cycles.length > 0`
- `legend_edge` — always present (edge weight explanation)

This matches the Go Atlas legend strategy from Plan 21.

---

### Decision 6 — Output section ordering matches Go Atlas

The Go Atlas package graph emits sections in this order (verified from `codex-swarm/.archguard/architecture-package.mmd`):

```
1. %%{init: ...}%%
2. flowchart TB/LR
3. [subgraph blocks with :::annotated nodes]
4. subgraph legend + style legend
5. style grp_* directives (depth-based)
6. classDef block
7. [edges]
```

This plan follows the same ordering for consistency. The legend is emitted **before** the `style` and `classDef` blocks, not after.

---

## Change 1 — Layout initialisation header

In `renderTsModuleGraph()`, replace:
```typescript
lines.push('flowchart LR');
```
with:
```typescript
lines.push("%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%");
lines.push('flowchart LR');
```

Direction remains `LR` (see Decision 1).

---

## Change 2 — Depth-based subgraph background colours

### 2a — Track depth in `emitTreeNode`

Change the function signature to pass a shared mutable accumulator for `(subgraphId, depth)` pairs:

```typescript
function emitTreeNode(
  node: TreeNode,
  lines: string[],
  depth: number,
  subgraphStyles: Array<{ id: string; depth: number }>
): void
```

When a subgraph block is opened, push `{ id: sgId, depth }` to `subgraphStyles` before recursing into children.

### 2b — Emit `style` directives after legend (see Decision 6)

The depth palette constants (matching Go Atlas):
```
depth 0: fill:#ffffff,stroke:#d0d7de,stroke-width:1px
depth 1: fill:#f6f8fa,stroke:#d0d7de,stroke-width:1px
depth 2: fill:#eaeef2,stroke:#8b949e,stroke-width:1px
depth 3+: fill:#d0d7de,stroke:#57606a,stroke-width:1px
```

After the legend block, iterate `subgraphStyles` and emit `style sgId <palette[min(depth, 3)]>`.

Also emit a depth-0 style for the `external_deps` subgraph (see Decision 2).

---

## Change 3 — Semantic `classDef` block (fixes existing syntax bug)

Replace the existing single `classDef external` line (which contains a `stroke-dasharray` syntax bug) with a three-entry block:

```
classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329
classDef external fill:#fff8c5,stroke:#d4a72c,color:#633c01
classDef cycle    fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e,font-weight:bold
```

This also fixes the pre-existing bug: `stroke-dasharray: 5 5` (space after colon, invalid Mermaid syntax) is eliminated.

---

## Change 4 — Node role annotations

### 4a — Collect cycle node IDs before rendering

```typescript
const cycleNodeIds = new Set(graph.cycles.flatMap((c) => c.modules));
```

(`TsModuleCycle.modules: string[]` — verified against `src/types/extensions.ts:297`)

### 4b — Apply role annotation to leaf and real-parent node declarations

In `emitTreeNode()`, pass `cycleNodeIds` and apply:
```typescript
const roleClass = cycleNodeIds.has(id) ? ':::cycle' : ':::internal';
// Leaf node:
lines.push(`${pad}${nid}["${label}"]${roleClass}`);
// Real parent self-declaration inside its subgraph:
lines.push(`${pad}  ${nid}["${label}"]${roleClass}`);
```

**Virtual (synthetic) parent nodes** — nodes where `moduleNode === null` — have no module ID and do not represent actual source modules. They do not receive a `:::` annotation; their visual identity comes entirely from the subgraph `style` directive in Change 2. This is intentional and consistent with Go Atlas treatment of virtual groupings.

External nodes already receive `:::external` — no change needed there.

---

## Change 5 — Quoted edge labels

```typescript
// Before:
const label = edge.strength > 1 ? `|${edge.strength}|` : '';
// After:
const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
```

---

## Change 6 — Legend subgraph (emitted before style/classDef blocks)

Following Decision 6 ordering, after all subgraph node blocks and before `style` directives, emit:

```
subgraph legend["Legend"]
  direction LR
  legend_internal["internal module"]:::internal
  legend_external["external dependency"]:::external   ← only if externalNodes.length > 0
  legend_cycle["cycle ⚠"]:::cycle                    ← only if graph.cycles.length > 0
  legend_edge["--> depends on (bolder = more imports)"]
end
style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01
```

Followed by the `style grp_*` directives (Change 2b), then the `classDef` block (Change 3), then edges.

---

## Final Output Structure (After)

```
%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%
flowchart LR

  subgraph cli_group["cli"]            ← depth 0
    cli["cli"]:::internal
    subgraph cli_commands_group["cli/commands"]   ← depth 1
      cli_commands["cli/commands"]:::internal
    end
    ...
  end
  subgraph plugins_group["plugins"]    ← depth 0 (virtual)
    subgraph plugins_golang_group[...] ← depth 1
      subgraph plugins_golang_atlas_group[...]  ← depth 2
        plugins_golang_atlas["..."]:::internal
        subgraph plugins_golang_atlas_renderers_group[...]  ← depth 3
          ...:::internal
        end
      end
    end
  end
  subgraph external_deps["External Dependencies"]
    path["path"]:::external
    ...
  end

  subgraph legend["Legend"]
    direction LR
    legend_internal["internal module"]:::internal
    legend_external["external dependency"]:::external
    legend_edge["--> depends on (bolder = more imports)"]
  end
  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01

  style cli_group              fill:#ffffff,stroke:#d0d7de,stroke-width:1px
  style cli_commands_group     fill:#f6f8fa,stroke:#d0d7de,stroke-width:1px
  style plugins_group          fill:#ffffff,stroke:#d0d7de,stroke-width:1px
  style plugins_golang_group   fill:#f6f8fa,stroke:#d0d7de,stroke-width:1px
  style plugins_golang_atlas_group  fill:#eaeef2,stroke:#8b949e,stroke-width:1px
  style plugins_golang_atlas_renderers_group  fill:#d0d7de,stroke:#57606a,stroke-width:1px
  style external_deps          fill:#ffffff,stroke:#d0d7de,stroke-width:1px

  classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329
  classDef external fill:#fff8c5,stroke:#d4a72c,color:#633c01
  classDef cycle    fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e,font-weight:bold

  cli -->|"3 refs"| cli_commands
  ...
  linkStyle 103 stroke:#e74c3c,stroke-width:2px   ← cycle edges unchanged
```

---

## Test Plan

**File**: `tests/unit/mermaid/ts-module-graph-renderer.test.ts` (already exists — 18 tests)

This plan **updates 3 existing tests** and **adds new test cases**.

### Existing tests that must be updated

| Line | Test name | Current assertion | Required update |
|---|---|---|---|
| 44 | `'produces a flowchart LR header'` | `toMatch(/^flowchart LR/m)` | Update to also verify `%%{init:` precedes it; keep `LR` assertion |
| 205–206 | `'nodes without children are NOT wrapped in a subgraph'` | `not.toContain('subgraph')`, `not.toContain('end')` | Legend is now always emitted — change to assert absence of *content* subgraphs: e.g. check that no `subgraph` line appears before `subgraph legend` |
| 354 | `'does not create a virtual parent when only one node has that prefix'` | `not.toContain('subgraph')` | Same fix as above |

### New test cases

| Test | Assertion |
|---|---|
| Layout header present | Output starts with `%%{init:` containing `'curve': 'basis'` |
| Layout header before flowchart | `%%{init:` line appears before `flowchart LR` line |
| Direction unchanged | Output contains `flowchart LR` (not `TB`) |
| Internal node annotation | Internal leaf node line contains `:::internal` |
| External node annotation | `node_modules` node line contains `:::external` |
| Cycle node annotation | Node in a cycle gets `:::cycle`, not `:::internal` |
| Cycle node override priority | A node in a cycle does not also have `:::internal` |
| Depth-0 subgraph style | Top-level subgraph has `style ... fill:#ffffff` |
| Depth-1 subgraph style | Depth-1 subgraph has `style ... fill:#f6f8fa` |
| Depth-2 subgraph style | Depth-2 subgraph has `style ... fill:#eaeef2` |
| Depth-3+ subgraph style | Depth-3 subgraph has `style ... fill:#d0d7de` |
| external_deps style is depth-0 | `external_deps` subgraph has `style external_deps fill:#ffffff` |
| Edge label single | Strength-1 edge has no `\|` label |
| Edge label multi | Strength-3 edge label is `\|"3 refs"\|` |
| classDef internal | Output contains `classDef internal fill:#dafbe1` |
| classDef external (replaces old) | Output contains `classDef external fill:#fff8c5` (NOT `fill:#f9f9f9`) |
| classDef external syntax correct | `classDef external` does NOT contain `stroke-dasharray: ` (space after colon) |
| classDef cycle | Output contains `classDef cycle fill:#ffebe9` |
| Legend always present | Output contains `subgraph legend["Legend"]` |
| Legend style | Output contains `style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5` |
| Legend internal node | Legend contains `legend_internal["internal module"]:::internal` |
| Legend external conditional absent | No external nodes → legend does NOT contain `legend_external` |
| Legend external conditional present | External nodes present → legend contains `legend_external["external dependency"]:::external` |
| Legend cycle conditional absent | No cycles → legend does NOT contain `legend_cycle` |
| Legend cycle conditional present | Cycles present → legend contains `legend_cycle["cycle ⚠"]:::cycle` |
| Legend ordering: before style directives | `subgraph legend` line appears before any `style grp_` line |
| Legend ordering: before classDef | `subgraph legend` line appears before any `classDef` line |
| Cycle edge linkStyle unchanged | Cycle edges still have `linkStyle ... stroke:#e74c3c` |
| Virtual node no annotation | Virtual parent node declaration has no `:::` suffix |

---

## Validation

```bash
cd /home/yale/work/archguard

# 1. Run unit tests for the renderer (existing 18 + new cases)
npm test -- --testPathPattern=ts-module-graph-renderer

# 2. Full test suite (must remain green — currently 1866/1866)
npm test

# 3. Build
npm run build

# 4. Self-analysis — verify overview/package.mmd output
rm -rf .archguard
node dist/cli/index.js analyze -v
head -5 .archguard/overview/package.mmd          # verify %%{init:%% + flowchart LR
grep "legend" .archguard/overview/package.mmd    # verify legend subgraph
grep ":::cycle" .archguard/overview/package.mmd  # verify cycle nodes (if any)
grep "style grp_\|style cli\|style plugins" .archguard/overview/package.mmd  # verify depth styles
grep "classDef" .archguard/overview/package.mmd  # verify 3-entry classDef block

# 5. Codex-swarm — verify Go output is unchanged
node dist/cli/index.js analyze -s /home/yale/work/codex-swarm \
  --lang go --output-dir /home/yale/work/codex-swarm/.archguard -v
```

---

## Critical Files

| File | Role |
|---|---|
| `src/mermaid/ts-module-graph-renderer.ts` | **Primary implementation** — all six changes |
| `tests/unit/mermaid/ts-module-graph-renderer.test.ts` | **Existing file** — update 3 tests + add ~27 new cases |

No changes to: `src/mermaid/generator.ts`, `src/types/`, `src/plugins/`, or any builder.
