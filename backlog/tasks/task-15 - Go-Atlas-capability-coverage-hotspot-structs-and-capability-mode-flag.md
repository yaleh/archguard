---
id: TASK-15
title: 'Go Atlas capability coverage: hotspot structs and --capability-mode flag'
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 06:29'
updated_date: '2026-06-23 06:32'
labels:
  - 'kind:basic'
dependencies: []
references:
  - docs/proposals/proposal-atlas-capability-coverage.md
  - src/plugins/golang/atlas/builders/capability-graph-builder.ts
  - src/plugins/golang/atlas/renderers/capability-mermaid-template.ts
  - src/types/extensions/go-atlas.ts
  - src/plugins/golang/atlas/types.ts
  - src/cli/commands/analyze.ts
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend CapabilityGraphBuilder to include hotspot structs (methods ≥11 or fanIn > 5) and high-complexity packages even without interface relationships. Add CLI flag --atlas-capability-mode interface|full and :::concrete Mermaid style class.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Go Atlas capability coverage: hotspot structs and --capability-mode flag

## Background

The `CapabilityGraphBuilder` applies an interface-centric filter that retains only
interface nodes and structs with at least one edge to an interface. This is the correct
design for the primary use-case (visualising polymorphism), but it silently drops entire
packages that express complexity through concrete structs rather than interfaces.

When ArchGuard analysed `meta-cc`, the Capability diagram (38 nodes) omitted:
- `internal/query` — 32 structs, 74 functions, the most complex package
- `internal/output` — 8 structs, 34 functions
- `cmd/mcp-server` — 5 structs, 63 functions (the application entry point)

Go projects routinely separate domain interfaces (small packages, few structs) from
heavy concrete implementations (large packages, many structs). The current default hides
the latter, making the Capability diagram misleadingly sparse for such projects.

The fix is additive: a new `full` mode appends hotspot and complex-package structs to
the existing interface-centric result, and marks them with a `:::concrete-heavy` Mermaid
style class so readers understand why they appear. The existing `interface` mode
(default) is unchanged.

## Goals

1. When `--atlas-capability-mode full` is passed, structs with `methodCount >= 11` OR
   `fanIn > 5` are included in the Capability diagram output even without interface
   relationships, marked with `:::concrete-heavy` style class in the generated Mermaid
   diagram.

2. When `--atlas-capability-mode full` is passed, all structs from packages with
   `struct count >= 8` (configurable default) that have no currently-included nodes are
   added to the Capability diagram, also marked `:::concrete-heavy`.

3. The default behaviour (`--atlas-capability-mode interface`, or no flag) is unchanged:
   running `node dist/cli/index.js analyze --lang go` on any Go project produces the same
   Capability diagram as before this change.

## Proposed Approach

**`CapabilityBuildOptions` type** — add `mode?: 'interface' | 'full'` and
`minPackageStructs?: number` (default 8). `CapabilityGraphBuilder.build()` accepts these
options and runs the two new inclusion passes after the existing interface-centric filter
only when `mode === 'full'`.

**Hotspot pass** — after the main filter, scan `allNodes` for structs where
`methodCount >= 11 || fanIn > 5` (fanIn computed from the edge set before filtering).
Nodes not yet in the filtered list are tagged `isHotspotAdded = true` and appended.

**Complex-package pass** — count structs per package across `allNodes`. For each package
with `count >= minPackageStructs` whose nodes are all absent from the current result,
append all its structs tagged `isPackageHotspot = true`.

**Mermaid template** (`capability-mermaid-template.ts`) — add new
`classDef concrete-heavy fill:#fff3cd,stroke:#856404,color:#533f03` and apply
`:::concrete-heavy` to nodes where `isHotspotAdded || isPackageHotspot`. The existing
`:::concrete` (green) class is unchanged.

**`AtlasConfig`** — add `capabilityMode?: 'interface' | 'full'` field; the Atlas
renderer reads this and passes `{ mode: config.capabilityMode }` into
`CapabilityGraphBuilder.build()`.

**CLI flag** — `--atlas-capability-mode <mode>` in `analyze.ts`, mapped to
`AtlasConfig.capabilityMode`.

## Trade-offs and Risks

- Default unchanged: existing CI and snapshot tests are unaffected.
- `fanIn` is computed from the pre-filter edge set (edges between interface-centric
  nodes). In `full` mode, hotspot fanIn counts only interface-related inbound edges,
  not total struct usage. Documented as a known limitation.
- The `minPackageStructs` threshold (default 8) is configurable via
  `CapabilityBuildOptions` but not exposed as a separate CLI flag in this task.
- We do NOT change the Package layer or Goroutine/Flow layers.

---

# Plan: Go Atlas capability coverage: hotspot structs and --capability-mode flag

Proposal: docs/proposals/proposal-atlas-capability-coverage.md

## Phase A: CapabilityNode flags + hotspot inclusion pass in CapabilityGraphBuilder

### Tests (write first)

File: `tests/plugins/golang/atlas/capability-graph-builder.test.ts`

New test group `"full mode — hotspot inclusion"`:
- `"interface mode (default): struct with methodCount=12 and no edges is excluded"`
- `"full mode: struct with methodCount>=11 is included even without interface edges"`
- `"full mode: struct with fanIn>5 is included even without interface edges"`
- `"full mode: hotspot struct gets isHotspotAdded=true flag"`
- `"full mode: non-hotspot struct with no edges is NOT included by hotspot pass"`

### Implementation

- `src/types/extensions/go-atlas.ts` — add `isHotspotAdded?: boolean` and
  `isPackageHotspot?: boolean` to `CapabilityNode`.
- `src/plugins/golang/atlas/builders/capability-graph-builder.ts` — add
  `CapabilityBuildOptions` interface; change `build(rawData)` to
  `build(rawData, options?: CapabilityBuildOptions)`; run hotspot inclusion pass
  when `mode === 'full'` after fanIn/fanOut post-processing.

### DoD
- [ ] `npm test -- --run tests/plugins/golang/atlas/capability-graph-builder.test.ts`
- [ ] `grep -q 'isHotspotAdded' src/types/extensions/go-atlas.ts`

---

## Phase B: Complex-package struct inclusion pass + :::concrete-heavy Mermaid style

### Tests (write first)

File: `tests/plugins/golang/atlas/capability-graph-builder.test.ts`

New test group `"full mode — complex-package inclusion"`:
- `"full mode: package with struct count >= 8 and no included nodes adds all structs"`
- `"full mode: package already partially included is NOT re-included by complex-package pass"`
- `"full mode: complex-package structs get isPackageHotspot=true"`
- `"full mode: package with struct count < minPackageStructs is excluded"`
- `"minPackageStructs option: custom threshold of 5 includes package with 5 structs"`

File: `tests/plugins/golang/atlas/mermaid-templates.test.ts`

New test group `"capability template — concrete-heavy style"`:
- `"node with isHotspotAdded=true renders :::concrete-heavy class suffix"`
- `"node with isPackageHotspot=true renders :::concrete-heavy class suffix"`
- `"classDef concrete-heavy is emitted when any concrete-heavy node exists"`
- `"legend entry for concrete-heavy is emitted when any such node exists"`
- `"regular concrete struct (no flags) still renders :::concrete (green)"`

### Implementation

- `src/plugins/golang/atlas/builders/capability-graph-builder.ts` — complex-package
  pass: build `packageStructCounts` from `allNodes`; for packages with
  `count >= (options.minPackageStructs ?? 8)` with no nodes in current result, append
  all structs with `isPackageHotspot = true`.
- `src/plugins/golang/atlas/renderers/capability-mermaid-template.ts` — when
  `node.isHotspotAdded || node.isPackageHotspot`, render `:::concrete-heavy`; emit
  `classDef concrete-heavy fill:#fff3cd,stroke:#856404,color:#533f03` and legend entry
  when any such node exists.

### DoD
- [ ] `npm test -- --run tests/plugins/golang/atlas/capability-graph-builder.test.ts`
- [ ] `npm test -- --run tests/plugins/golang/atlas/mermaid-templates.test.ts`
- [ ] `grep -q 'concrete-heavy' src/plugins/golang/atlas/renderers/capability-mermaid-template.ts`

---

## Phase C: AtlasConfig.capabilityMode + --atlas-capability-mode CLI flag

### Tests (write first)

File: `tests/plugins/golang/atlas/capability-graph-builder.test.ts`

New test group `"CapabilityBuildOptions — options contract"`:
- `"build() with no options defaults to interface mode (no hotspot structs included)"`
- `"build() with mode='interface' explicitly excludes hotspot structs"`

File: `tests/plugins/golang/atlas/atlas-renderer.test.ts`

New test group `"AtlasConfig.capabilityMode wiring"`:
- `"capabilityMode: 'full' in AtlasConfig is passed to CapabilityGraphBuilder.build()"`
- `"capabilityMode: undefined defaults to interface mode"`

### Implementation

- `src/plugins/golang/atlas/types.ts` — add `capabilityMode?: 'interface' | 'full'`
  to `AtlasConfig`.
- `src/plugins/golang/atlas/renderers/atlas-renderer.ts` — pass
  `{ mode: config.capabilityMode }` to `CapabilityGraphBuilder.build()`.
- `src/cli/commands/analyze.ts` — add
  `--atlas-capability-mode <mode>` option; map to `atlasConfig.capabilityMode`.

### DoD
- [ ] `npm test -- --run tests/plugins/golang/atlas/`
- [ ] `grep -q 'atlas-capability-mode' src/cli/commands/analyze.ts`
- [ ] `grep -q 'capabilityMode' src/plugins/golang/atlas/types.ts`

---

## Constraints

- Default mode is `'interface'`; any Go project without `--atlas-capability-mode full`
  must produce identical Capability diagram output as before.
- `:::concrete-heavy` is a NEW classDef; the existing `:::concrete` (green) is unchanged.
- `isHotspotAdded` and `isPackageHotspot` are mutually exclusive flags.
- `minPackageStructs` is NOT exposed as a separate CLI flag in this task.

## Acceptance Gate
- [ ] `npm test`
- [ ] `grep -q 'isHotspotAdded' src/types/extensions/go-atlas.ts`
- [ ] `grep -q 'capabilityMode' src/plugins/golang/atlas/types.ts`
- [ ] `grep -q 'atlas-capability-mode' src/cli/commands/analyze.ts`
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/plugins/golang/atlas/capability-graph-builder.test.ts
- [ ] #2 npm test -- --run tests/plugins/golang/atlas/mermaid-templates.test.ts
- [ ] #3 npm test -- --run tests/plugins/golang/atlas/
- [ ] #4 grep -q 'atlas-capability-mode' src/cli/commands/analyze.ts
- [ ] #5 grep -q 'capabilityMode' src/plugins/golang/atlas/types.ts
- [ ] #6 grep -q 'isHotspotAdded' src/types/extensions/go-atlas.ts
- [ ] #7 grep -q 'concrete-heavy' src/plugins/golang/atlas/renderers/capability-mermaid-template.ts
- [ ] #8 npm test
<!-- DOD:END -->
