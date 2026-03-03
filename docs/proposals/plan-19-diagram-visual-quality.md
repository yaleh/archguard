# Plan 19: Diagram Visual Quality Improvements

**Status**: Draft
**Branch**: feat/visualization
**Motivation**: A systematic review of generated `.mmd` output against modern architecture diagram standards identified five concrete readability gaps. The fixes are targeted, require no data-model changes, and collectively bring ArchGuard's output in line with professional IDE-style documentation tooling.

---

## Background

Analysis of generated diagrams in `.archguard/` against reference standards (GitHub Light palette, Nord theme, professional Go project architecture maps) revealed the following:

1. TypeScript class diagrams have **no `classDef` blocks** — all nodes use Mermaid defaults (saturated purple/yellow), making interface/class/enum distinctions invisible
2. Go Atlas package graph uses **high-saturation colours** that read well in isolation but create visual fatigue in diagrams with 30+ nodes
3. **No legend subgraph** exists in any diagram — role-based colour meanings are implicit
4. **No node-priority ordering** — high-coupling "hub" packages are scattered among leaf nodes rather than placed centrally/first
5. **Edge interpolation** defaults to straight lines, which create visual clutter at high edge densities

All five issues are fixable by modifying two renderer files without touching type definitions or the data pipeline.

---

## Identified Gaps

### Gap 1 — TypeScript class diagram has no semantic node styling

`ValidatedMermaidGenerator.generateClassLevel()` emits `classDiagram` blocks with `namespace` groupings but no `classDef` declarations. Every class, interface, and enum renders identically with Mermaid's built-in purple fill.

**Impact**: A user cannot visually distinguish an interface (contract) from a concrete class (implementation) or an enum. This is the most critical readability gap for TypeScript output.

**Root cause**: `generator.ts` does not emit a `classDef` block or apply `:::styleName` annotations to entity declarations.

---

### Gap 2 — Go Atlas package graph uses high-saturation colours

The eight `classDef` entries in `mermaid-templates.ts:241-248` use fully-saturated fill colours (e.g. `#ff6b6b` red, `#55efc4` green, `#ffeaa7` yellow). On white backgrounds with 20+ nodes, the result reads as a "traffic light explosion" rather than a structured architecture map.

**Impact**: Reduces professional credibility; harder to focus attention on structural signals like cycles.

**Current palette**:
```
cmd:      fill:#ff6b6b,stroke:#c0392b  → saturated red
tests:    fill:#b2bec3,stroke:#636e72  → medium grey (acceptable)
examples: fill:#74b9ff,stroke:#0984e3  → saturated blue
testutil: fill:#dfe6e9,stroke:#b2bec3  → light grey (acceptable)
internal: fill:#55efc4,stroke:#00b894  → saturated green
vendor:   fill:#f0e6ff,stroke:#9b59b6  → saturated purple
external: fill:#ffeaa7,stroke:#fdcb6e  → saturated yellow
cycle:    fill:#fd79a8,stroke:#e84393  → saturated pink
```

---

### Gap 3 — No legend subgraph

Both Go Atlas and TypeScript module graphs use role-based colours, but the rendered PNG/SVG contains no legend. Users reading a generated diagram cannot know that green = `internal`, red = `cmd`, pink = `cycle` without reading the source `.mmd` file.

**Impact**: Diagrams are not self-documenting. This is particularly problematic when diagrams are embedded in READMEs or shared with stakeholders.

---

### Gap 4 — Nodes are not ordered by structural importance

`renderPackageGraph()` emits nodes in the order `graph.nodes` is provided, which is alphabetical by package path. High-coupling "hub" packages (`pkg/hub`, `core`, etc.) are scattered among leaf nodes.

**Impact**: High-coupling packages appear at the top of the generated `.mmd` source file, making it easier for humans to navigate. Dagre's rendered layout is topology-driven and not significantly affected by declaration order.

**Existing data**: `PackageNode` already carries `dependencies: string[]`, from which in-degree can be computed. No builder changes needed.

---

### Gap 5 — Edge interpolation defaults to straight lines

`FLOWCHART_INIT` in `mermaid-templates.ts:7` sets only `nodeSpacing` and `rankSpacing`. At edge densities above ~30 connections, straight-line edges overlap, making path tracing difficult.

**Impact**: Moderate — affects Go Atlas package graphs with dense dependency clusters more than TypeScript module graphs.

**Fix**: Add `curve: 'basis'` to the `flowchart` init config. This is a one-line change to a constant.

---

## Proposed Changes

### Files affected

| File | Change |
|------|--------|
| `src/mermaid/generator.ts` | Emit semantic `classDef` block and `:::styleName` annotations for TypeScript class diagrams |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | Update `classDef` palette, add legend subgraph, add node-priority sorting, add `curve` config |

No type definition files (`src/types/`, `src/plugins/golang/atlas/types.ts`) are modified. This proposal is purely a renderer-layer change.

---

## Design Decisions

### Decision 1 — Semantic colours replace role colours for TypeScript class diagrams

TypeScript class diagrams use `classDiagram` (not `flowchart`), so the `:::styleName` syntax does not apply. Instead, Mermaid's `classDef` + `class EntityName styleName` syntax is used.

Entity types in `src/types/index.ts:75-82`:
```typescript
export type EntityType =
  | 'class' | 'interface' | 'enum'
  | 'struct' | 'trait' | 'abstract_class' | 'function';
```

Note: `type` (TypeScript type alias) is **not** a valid `EntityType` value. Go structs map to `struct`; abstract classes to `abstract_class`; standalone functions to `function`.

**Prerequisite — fix dead conditional in `generator.ts:331`**:
```typescript
// Current (always returns 'class' — dead branch):
const classType = entity.type === 'interface' ? 'class' : 'class';

// Must be fixed to read entity.type before styling can work:
const classType = 'class'; // Mermaid classDiagram only uses 'class' keyword
```
This is a pre-existing bug. The entity type information must still be carried through for the annotation step (1b), even though the declaration keyword is always `class`.

**Alternative considered — Mermaid stereotypes**: Mermaid classDiagram natively supports `<<interface>>`, `<<enumeration>>`, `<<abstract>>` stereotypes which render as UML-standard text labels inside the node box. These are visible in static PNG/SVG and require no classDef. However, stereotypes and classDef are not mutually exclusive; using both provides shape-semantic cues (stereotype) and colour differentiation (classDef). This proposal uses classDef only; stereotypes may be added in a follow-up.

Proposed `classDef` palette (GitHub Light, covering all `EntityType` values):
```
class:         fill:#f6f8fa,stroke:#d0d7de,color:#24292f
interface:     fill:#ddf4ff,stroke:#54aeff,color:#0969da
enum:          fill:#fff8c5,stroke:#d4a72c,color:#633c01
struct:        fill:#f6f8fa,stroke:#d0d7de,color:#24292f   (same as class)
trait:         fill:#ddf4ff,stroke:#54aeff,color:#0969da   (same as interface)
abstract_class fill:#fdf4ff,stroke:#d2a8ff,color:#8250df
function:      fill:#f6f8fa,stroke:#d0d7de,color:#57606a   (muted, rarely primary)
```

**Rationale**: Interfaces are highlighted in blue (contract role); enums in amber (data/constant); abstract classes in lavender (partial implementation); structs alias to class style (both are data containers); traits alias to interface style (both are behavioural contracts); standalone functions use muted grey (secondary). All fills are low-saturation GitHub-style.

### Decision 2 — Go Atlas palette shifts to muted GitHub Light tones

The new palette preserves semantic meaning (red = entry point, grey = test, green = internal) but reduces saturation to ~40% of current values:

```
cmd:      fill:#ffebe9,stroke:#cf222e,color:#82071e   (muted red)
tests:    fill:#f6f8fa,stroke:#d0d7de,color:#57606a   (neutral grey)
examples: fill:#ddf4ff,stroke:#54aeff,color:#0550ae   (muted blue)
testutil: fill:#f6f8fa,stroke:#d0d7de,color:#57606a   (same as tests)
internal: fill:#dafbe1,stroke:#2da44e,color:#116329   (muted green)
vendor:   fill:#fdf4ff,stroke:#d2a8ff,color:#6e40c9   (muted purple)
external: fill:#fff8c5,stroke:#d4a72c,color:#633c01   (muted amber)
cycle:    fill:#ffebe9,stroke:#cf222e,stroke-width:3px,color:#82071e,font-weight:bold
```

**Rationale**: `cycle` shares the cmd red hue (both are "attention required") but is distinguished by `stroke-width:3px` and `font-weight:bold`. `testutil` and `tests` use identical fill/stroke values — both represent test infrastructure and should not be visually differentiated. They retain separate `classDef` identifiers so that future specialisation (e.g. testutil gaining a distinctive border) requires only a one-line change without restructuring node declarations.

### Decision 3 — Legend is a non-interactive `subgraph` at diagram bottom

Mermaid flowcharts do not support HTML tooltips in static SVG output. A `subgraph legend["Legend"]` block at the end of the diagram, containing one representative node per active type, is the only portable approach.

The legend is **conditional**: only role types that actually appear in the current graph are included, plus `cycle` if the graph has any detected cycles. An all-internal codebase would show only the `internal` entry.

Legend nodes use a fixed abbreviated label (e.g. `legend_cmd["cmd (entry)"]`) and are assigned the same `:::styleName` as their counterparts. No edges connect legend nodes to the main graph.

**Note**: `cycle` is not a `PackageNode.type` value — it is a conditional style applied at render time based on `cycleNodeIds`. Legend inclusion of `cycle` must be driven by `graph.cycles.length > 0`, not by scanning `graph.nodes.map(n => n.type)`.

### Decision 4 — Node ordering uses in-degree computed at render time

In-degree for each node = number of edges in `graph.edges` where `edge.to === node.id`. Nodes with higher in-degree (more dependents) are emitted first. This is computed in `renderPackageGraph()` without modifying the builder or data structures.

Tie-breaking is alphabetical to ensure deterministic output.

**Scope of benefit**: The primary value is making the `.mmd` source file more readable to humans — high-coupling packages appear at the top of the file. The impact on Dagre's rendered layout is marginal: Dagre is a topology-driven algorithm (it uses the edge graph, not declaration order, as its primary layout input). Do not expect node ordering alone to eliminate edge crossings in dense graphs.

### Decision 5 — `curve: 'basis'` is the only interpolation change

Mermaid supports `basis`, `linear`, `cardinal`, `step`, `stepBefore`, `stepAfter`. For package dependency graphs where edges represent import relationships (directional but not sequential), `basis` (smooth Bezier) provides the best balance of path-traceability and visual smoothness. `step` variants are reserved for flow/sequence diagrams.

---

## Change 1 — TypeScript class diagram semantic styling (generator.ts)

### 1a — Prerequisite fix in `generator.ts:331`

The existing dead conditional must be removed before styling can be applied:

```typescript
// Before (always evaluates to 'class' — dead branch, remove):
const classType = entity.type === 'interface' ? 'class' : 'class';

// After (semantically equivalent, but entity.type is now accessible for step 1b):
const classType = 'class';
```

### 1b — `classDef` block emission

After the opening `classDiagram` line in `generateClassLevel()` and `generateMethodLevel()`, emit a `classDef` block covering all seven `EntityType` values:

```
classDiagram
  classDef classNode     fill:#f6f8fa,stroke:#d0d7de,color:#24292f
  classDef interface     fill:#ddf4ff,stroke:#54aeff,color:#0969da
  classDef enum          fill:#fff8c5,stroke:#d4a72c,color:#633c01
  classDef struct        fill:#f6f8fa,stroke:#d0d7de,color:#24292f
  classDef trait         fill:#ddf4ff,stroke:#54aeff,color:#0969da
  classDef abstract_class fill:#fdf4ff,stroke:#d2a8ff,color:#8250df
  classDef function      fill:#f6f8fa,stroke:#d0d7de,color:#57606a
```

### 1c — `:::styleName` annotation injection

After all entity and relation declarations, append style annotations using `:::` syntax (the correct Mermaid classDiagram syntax for applying a `classDef`):

```
%% Node type annotations
  PluginRegistry:::classNode
  ILanguagePlugin:::interface
  OutputFormat:::enum
  GoParser:::struct
```

**Syntax note**: In Mermaid `classDiagram`, `classDef` is applied via `ClassName:::styleName` — either inline in the class declaration or as a standalone line after declarations. The space-separated form `class ClassName styleName` is a deprecated syntax that creates parsing ambiguity with class declarations and must not be used.

**Implementation**: After emitting all class bodies and relation lines, iterate `this.archJson.entities`, map `entity.type` to the corresponding `classDef` name, and emit `  ${normalizedName}:::${styleClass}`. Use the same `normalizeEntityName()` + `escapeId()` pipeline as the class declaration lines to ensure IDs match.

---

## Change 2 — Go Atlas palette update (mermaid-templates.ts)

Replace lines 241–248 with the muted GitHub Light palette from Design Decision 2.

No other logic changes. The `classDef` identifiers (`cmd`, `tests`, `internal`, etc.) are unchanged, so all existing `:::styleName` usages in node declarations remain valid.

---

## Change 3 — Legend subgraph (mermaid-templates.ts)

Add a `renderLegend(activeTypes: Set<string>): string` private static method.

Call site: at the end of `renderPackageGraph()`, before the `classDef` block.

```
subgraph legend["Legend"]
  direction LR
  legend_cmd["cmd (entry point)"]:::cmd
  legend_internal["internal"]:::internal
  legend_cycle["cycle (circular dep)"]:::cycle
end
```

Active types are determined as follows:
- Collect `PackageNode.type` values from `graph.nodes` (covers `internal`, `cmd`, `tests`, etc.)
- If `graph.cycles.length > 0`, also include `cycle` (since `cycle` is not a `PackageNode.type` — it is a render-time conditional style)

The legend subgraph uses `direction LR` regardless of the parent graph's direction to keep it compact.

---

## Change 4 — Node ordering by in-degree (mermaid-templates.ts)

At the start of `renderPackageGraph()`, before Pass 1 (node emission):

```typescript
// Compute in-degree for priority ordering
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

Replace all iterations over `graph.nodes` with iterations over `sortedNodes`.

---

## Change 5 — Curve interpolation (mermaid-templates.ts)

Modify `FLOWCHART_INIT` constant (lines 32-33):

```typescript
// Before:
const FLOWCHART_INIT = "%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80}}}%%\n";

// After:
const FLOWCHART_INIT = "%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%\n";
```

This change applies to all four flowchart-based Atlas renderers (package, capability, goroutine, flow).

---

## Implementation Priority

| Priority | Change | Effort | File | Impact |
|----------|--------|--------|------|--------|
| P0 | Curve interpolation (`curve: basis`) | 1 line | `mermaid-templates.ts:32` | All Go Atlas flowcharts |
| P1 | Go Atlas palette update (muted colours) | 8 lines | `mermaid-templates.ts:241-248` | Package graph readability |
| P2 | Node ordering by in-degree | ~15 lines | `mermaid-templates.ts` | `.mmd` source readability |
| P3 | Legend subgraph | ~30 lines | `mermaid-templates.ts` | Self-documentation |
| P4a | Fix dead conditional (`generator.ts:331`) | 1 line | `generator.ts` | Prerequisite for P4b |
| P4b | TypeScript class diagram semantic styling | ~35 lines | `generator.ts` | TS output differentiation |

P0–P3 are independent and can land in any order. P4a is a prerequisite for P4b; both are independent of P0–P3.

---

## Test Plan

### Unit tests — `renderPackageGraph()` palette

- All eight `classDef` entries present in output
- Each uses the new muted colour values (assert hex strings)
- `:::cmd` nodes still receive the cmd classDef (regression)
- `:::cycle` nodes use `stroke-width:3px` (regression)

### Unit tests — legend subgraph

- Graph with only `internal` + `cmd` nodes: legend contains only those two entries
- Graph with `cycle` nodes: legend includes `cycle` entry
- Legend subgraph ID is `legend`, uses `direction LR`
- No edges exist between legend nodes and graph nodes

### Unit tests — in-degree ordering

- Node with highest in-degree appears before nodes with lower in-degree in output
- Tie-breaking is deterministic (alphabetical)
- Self-loop edges excluded from in-degree calculation

### Unit tests — curve interpolation

- `FLOWCHART_INIT` string contains `'curve': 'basis'`
- Init block appears as first line of `renderPackageGraph()` output

### Unit tests — TypeScript class diagram styling

- `classDef interface` present in `classDiagram` output when at least one interface entity exists
- `class InterfaceName interface` annotation emitted for each interface entity
- `class ClassName classNode` annotation emitted for each class entity
- Entity ID in annotation matches entity ID in class declaration
- No duplicate annotation lines for the same entity

### Regression — existing tests

**`mermaid-templates.test.ts`** (package graph palette change):
- Tests at lines 351-361 assert `toContain('classDef internal')` etc. by name only — no hex values — so they pass without modification after the palette change.
- The single hex-asserting test (`line 1711: classDef hotspot fill:#ff7675,...`) is in `renderCapabilityGraph`, which this proposal does not modify. No update needed.

**`generator.test.ts`** (TypeScript class diagram styling):
- Tests asserting `toContain('classDiagram')` are unaffected.
- Tests asserting exact output strings that include entity declarations (e.g. `toMatch(/classDiagram[\s\S]+class User/)`) may need `:::classNode` annotations appended. Identify these by running the test suite after P4 lands and updating each failing assertion.

---

## Non-Goals

The following items were considered and explicitly excluded from this proposal:

- **Interactive highlighting** (hover-based edge fade): requires HTML embedding, outside static SVG scope
- **Bidirectional edge merging** (`o--o` syntax for mutual dependencies): requires identifying symmetric edge pairs; deferred to a separate proposal
- **Per-subgraph node-count limits and auto-split**: complexity overhead exceeds readability benefit at current project scales; `maxPackages: 10` in `grouper.ts` already bounds diagram size
- **Tooltip / click annotations**: not supported in static PNG/SVG output
