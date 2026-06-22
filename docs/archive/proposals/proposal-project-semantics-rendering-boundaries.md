# Proposal: Project Semantics Rendering Boundaries

**Status**: Draft
**Date**: 2026-04-01
**Related**: `docs/proposals/proposal-skill-first-project-semantics.md`, `docs/plans/plan-54-skill-first-project-semantics.md`

---

## Problem Statement

ArchGuard now consumes repository-specific `projectSemantics` from config and from the `.archguard/project-semantics.json` sidecar. That integration is valuable, but the current rendering behavior applies `architecturalLayers` too mechanically in Mermaid outputs.

Two concrete rendering code paths are relevant to the boundary:

- `src/mermaid/generator.ts` package-level rendering via `generateLayeredPackageLevel()`
- `src/mermaid/ts-module-graph-renderer.ts` module graph rendering via `renderTsModuleGraph()`

The confirmed misleading output exists today in the TypeScript module graph renderer. That renderer:

1. wraps matched roots in a `layer_*` subgraph using the layer label
2. preserves the original root package/module grouping beneath that wrapper

When the layer label is the same as the real root package/module name, the output renders a misleading nested structure such as:

- `subgraph layer_cli["cli"]`
- inside it `subgraph cli_group["cli"]`

This is not a repository truth. It is a rendering artifact. The problem is visible in the ArchGuard repository itself when `architecturalLayers` contains:

- `src/analysis -> analysis`
- `src/cli -> cli`
- `src/mermaid -> rendering`

The result is architecturally misleading output even though the discovered knowledge is valid.

`src/mermaid/generator.ts` does not currently produce the same nested same-name wrapper shape. It is still in scope for this proposal because it is the other direct Mermaid consumer of `architecturalLayers`, and the rendering boundary should remain aligned across both consumers.

The broader boundary issue is:

- `architecturalLayers` is a grouping hint, not a license to duplicate hierarchy
- analysis-oriented semantics such as `nonProductionPatterns`, `barrelFiles`, and `suggestedDepth` should keep affecting analysis consumers
- Mermaid renderers must use `architecturalLayers` in a way that clarifies structure rather than inventing extra layers

## Goals

- Preserve the usefulness of `architecturalLayers` for package/module grouping
- Eliminate misleading same-name nested layer/package rendering in Mermaid outputs
- Keep package-level and TypeScript module-graph renderers behaviorally aligned
- Preserve current analysis consumers of `nonProductionPatterns`, `barrelFiles`, `suggestedDepth`, `additionalTestPatterns`, and `customAssertionPatterns`
- Add regression tests for same-name layer/root collisions
- Validate the fix against the real ArchGuard repository outputs

## Non-Goals

- Do not redesign the `ProjectSemanticsInput` schema
- Do not remove `architecturalLayers` from package or module graph rendering
- Do not change merge priority between config, sidecar, and defaults
- Do not stop embedding `projectSemantics` in JSON outputs in this change unless required by a proven regression
- Do not alter FIM or test-analysis semantics consumers beyond regression protection

## Design

### 1. Treat `architecturalLayers` as a grouping boundary, not an extra hierarchy level

For Mermaid renderers that preserve package/module hierarchy beneath an outer layer wrapper, when a root package/module is grouped under a layer and the layer label equals the root label, the renderer should avoid introducing a redundant same-name inner subgraph.

Expected behavior:

- keep the outer layer subgraph, because that is the semantic grouping
- emit the real root node and its children directly within that layer when the root label matches the layer label
- preserve nested child subgraphs below that root when they represent real package/module hierarchy

Example target shape for the ArchGuard repository:

```mermaid
subgraph layer_cli["cli"]
  cli["cli"]
  cli_analyze["cli/analyze"]
  ...
end
```

Not:

```mermaid
subgraph layer_cli["cli"]
  subgraph cli_group["cli"]
    cli["cli"]
    ...
  end
end
```

This keeps the semantic grouping while avoiding a false second `cli` level.

### 2. Fix the confirmed collision in the module graph renderer and keep both renderers aligned

The package-level renderer in `src/mermaid/generator.ts` and the TypeScript module graph renderer in `src/mermaid/ts-module-graph-renderer.ts` currently implement layering independently. The confirmed same-name nesting defect must be fixed in the module graph renderer, and both renderers should continue to honor the same high-level boundary:

- package overview diagrams
- TypeScript module graph diagrams

follow the same architectural rendering rule.

The shared rule is:

- `architecturalLayers` may reorganize matched roots into semantic layer groupings
- renderers must not fabricate an extra hierarchy level that is not present in the underlying package/module structure

For the module graph renderer specifically:

- if `layer label !== root label`, preserve the existing outer-layer + inner-root-group structure
- if `layer label === root label`, collapse the redundant same-name inner wrapper and render the root contents directly in the outer layer

For the package-level renderer specifically:

- retain the current direct node grouping behavior unless a test demonstrates an equivalent boundary defect

### 3. Keep non-rendering semantics on their current consumers

This change should explicitly preserve the existing usage boundaries:

- `src/analysis/test-analyzer.ts`
  - `additionalTestPatterns`
  - `customAssertionPatterns`
- `src/analysis/fim/fim-analysis.ts`
  - `nonProductionPatterns`
  - `barrelFiles`
  - `suggestedDepth`

Those semantics should continue affecting analysis behavior and should not be entangled with Mermaid hierarchy rules.

### 4. Verify on real repository output, not only synthetic tests

Synthetic unit tests are necessary but not sufficient because the regression was discovered only when ArchGuard analyzed itself.

The implementation must therefore validate against the live repository by generating:

- `.archguard/output/src/overview/package.mmd`

and confirming that:

- `layer_cli["cli"]` exists
- a same-name nested `cli_group["cli"]` does not exist under that layer
- equivalent redundant nesting is removed for `analysis`
- unmatched groups such as `core`, `parser`, `plugins`, `types`, and `utils` continue rendering normally

Unit coverage must also validate that `src/mermaid/generator.ts` keeps its existing layered grouping behavior for non-conflicting labels.

### 5. Documentation and test posture

This proposal does not require user-facing configuration changes. The main quality gates are:

- unit tests that fail before the implementation
- real-project output validation after implementation
- an architect review of generated output against the intended semantics boundary

## Alternatives

### Alternative A — Rename discovered layer labels to avoid collisions

Examples:

- `src/cli -> cli-layer`
- `src/analysis -> analysis-layer`

Rejected because this pushes a renderer defect into the discovery contract. A repository author should be allowed to use the most natural label when it matches a real package family name.

### Alternative B — Disable layered rendering for same-name labels

Rejected because it throws away valid semantics exactly in the projects where the labels are most natural.

### Alternative C — Stop injecting `projectSemantics` into output JSON

Rejected for this change because the confirmed bug is in Mermaid rendering structure, not in JSON persistence. Removing the JSON field would not fix the misleading diagrams.

## Open Questions

- Should the module-graph collision-collapse rule be implemented independently now, with a later shared helper only if a second renderer needs the same logic? For this change, either is acceptable as long as behavior stays aligned and code remains readable.
- Should a future follow-up narrow where `projectSemantics` is embedded in JSON outputs, or is broad embedding acceptable as provenance metadata? This proposal records the concern but does not require that follow-up to complete the rendering fix.
