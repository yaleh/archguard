## Problem Statement

`src/plugins/cpp/archjson-mapper.ts`, `src/plugins/golang/archjson-mapper.ts`, `src/plugins/java/archjson-mapper.ts`, and `src/plugins/python/archjson-mapper.ts` all convert language-specific raw parser output into the same `Entity` / `Relation` / `Member` structures from `src/types/index.ts`. The shared behaviors are implemented repeatedly: entity ID creation, source location assembly, visibility normalization, member parameter mapping, and relation de-duplication. The Python mapper still generates relation IDs with `uuidv4()` instead of the shared `generateEntityId()` / `createRelation()` conventions in `src/plugins/shared/mapper-utils.ts`.

`src/mermaid/generator.ts` remains an 856-line multi-responsibility class. Although `src/mermaid/diagram-generator.ts`, `src/mermaid/comment-generator.ts`, and `src/mermaid/validation-pipeline.ts` already exist, `ValidatedMermaidGenerator` still owns validation, package grouping, entity/member rendering, relation rendering, type sanitization, ID normalization, and split-diagram generation.

`src/plugins/golang/atlas/renderers/mermaid-templates.ts` is a 977-line static utility that renders package, capability, goroutine, and flow diagrams in one file. The current layout makes layer-specific template changes risky and provides no file-level separation for the four atlas layers exposed by `src/plugins/golang/atlas/renderers/atlas-renderer.ts`.

`src/types/config.ts` has grown to 590 lines and mixes diagram metadata, Mermaid configuration, global runtime config, and CLI options in one file. New features keep increasing the blast radius of the shared config module because almost every config import points to the same file.

There are also unresolved TODO/FIXME markers in the Go Atlas area, including `src/plugins/golang/atlas/renderers/mermaid-templates.ts` and `src/plugins/golang/atlas/builders/goroutine-topology-builder.ts`.

## Goals

- Introduce a reusable mapper base in `src/plugins/shared/mapper-utils.ts` that centralizes ArchJSON mapping helpers used by the C++, Go, Java, and Python plugins.
- Reduce the responsibility surface of `src/mermaid/generator.ts` by moving cohesive rendering helpers into focused companion modules while preserving the public `ValidatedMermaidGenerator` API.
- Split Go Atlas Mermaid rendering by layer without changing the `AtlasRenderer` contract.
- Split configuration types by concern while preserving existing import paths through `src/types/config.ts`.
- Remove or formalize the current Go Atlas TODO/FIXME items as code or tracked issues.

## Non-Goals

- Replacing the current language-specific raw parser data models in `src/plugins/*/types.ts`.
- Changing the public `MermaidDiagramGenerator`, `ValidatedMermaidGenerator`, `AtlasRenderer`, or plugin entrypoint method signatures beyond internal helper injection.
- Redesigning the ArchJSON schema in `src/types/archjson.ts`.
- Introducing a new templating engine for Go Atlas rendering.

## Design

### 1. Shared mapper base

Expand `src/plugins/shared/mapper-utils.ts` from free functions into a small shared mapping module:

- Keep `generateEntityId()` and `createRelation()` as the stable low-level primitives.
- Add a new abstract `BaseArchJsonMapper<TPackage, TRawEntity = never>` class that exposes protected helpers instead of forcing inheritance on every mapper method.
- Put these helpers in the base:
  - `createEntityId(packageName, entityName)`
  - `createSourceLocation(file, startLine, endLine)`
  - `mapExportedVisibility(exported: boolean)`
  - `mapModifierVisibility(modifiers: string[], fallback?: Visibility)`
  - `mapParameters(parameters)`
  - `pushUniqueEntity(entities, seenIds, entity)`
  - `pushUniqueRelation(relations, seenKeys, relation)`
  - `createExplicitRelation(type, source, target, extras?)`

The inheritance pattern remains thin: each language mapper still owns its raw-model interpretation, but common mechanics are moved out of the plugin folders. Concretely:

- `src/plugins/golang/archjson-mapper.ts` uses the base for exported/private visibility, parameter mapping, entity de-duplication, and relation creation.
- `src/plugins/java/archjson-mapper.ts` uses the base for modifier-based visibility, source locations, parameter mapping, and relation de-duplication.
- `src/plugins/python/archjson-mapper.ts` drops `uuid` and uses shared relation creation and source location helpers.
- `src/plugins/cpp/archjson-mapper.ts` uses shared source location and relation de-duplication helpers while keeping C++-specific namespace resolution and `CppTypeExtractor` logic local.

### 2. Shrink `ValidatedMermaidGenerator`

Preserve `ValidatedMermaidGenerator` as the façade imported by tests and by `src/mermaid/diagram-generator.ts`, but move internal responsibilities into focused files under `src/mermaid/`:

- `generator-grouping.ts`: package grouping and visible-entity filtering helpers.
- `generator-formatting.ts`: entity/member formatting, relation line generation, visibility symbols, ID escaping, type normalization, and type sanitization.
- `generator-splitting.ts`: split-diagram assembly for class/method levels.
- `generator-validation.ts`: pre-generation validation that currently lives inside `validateBeforeGenerate()`.

`src/mermaid/generator.ts` then becomes a smaller orchestrator that wires these collaborators together and keeps the constructor plus public `generate()` / `generateClassDiagrams()` surface stable. This directly reduces the god-class pressure without forcing call sites to change.

### 3. Split Atlas Mermaid templates by layer

Move layer-specific rendering from `src/plugins/golang/atlas/renderers/mermaid-templates.ts` into sibling modules:

- `package-mermaid-template.ts`
- `capability-mermaid-template.ts`
- `goroutine-mermaid-template.ts`
- `flow-mermaid-template.ts`
- `template-shared.ts` for shared sanitization, tree building, and style constants

Keep `MermaidTemplates` as the compatibility façade exported from `src/plugins/golang/atlas/renderers/mermaid-templates.ts`. It forwards `renderPackageGraph()`, `renderCapabilityGraph()`, `renderGoroutineTopology()`, and `renderFlowGraph()` to the split modules so `AtlasRenderer` continues to work unchanged.

For TODO/FIXME handling:

- Replace the collision TODO in the template renderer with a concrete helper that guarantees unique subgraph IDs by suffixing sanitized labels when collisions occur.
- Convert the goroutine topology pattern-detection TODO into a tracked GitHub issue reference if the behavior remains out of scope for this refactor.

### 4. Split config types by concern

Create focused type modules under `src/types/`:

- `config-mermaid.ts`
- `config-diagram.ts`
- `config-global.ts`
- `config-cli.ts`

`src/types/config.ts` becomes a compatibility barrel that re-exports these modules plus `defaultMermaidConfig`. This keeps existing imports such as `import type { DiagramConfig } from '@/types/config.js'` working while shrinking the main file and isolating future edits by concern.

## Alternatives

- Keep free-function helpers in `mapper-utils.ts` and avoid a base class. Rejected because the repeated mapper code already clusters around protected helper behavior, and a base class makes those conventions explicit without changing plugin entrypoint contracts.
- Replace `ValidatedMermaidGenerator` entirely with several public classes. Rejected because too many tests and call sites already bind to the current class name and constructor.
- Split config types and force all consumers onto new import paths immediately. Rejected because it would create a noisy, repo-wide mechanical change with limited functional value.

## Open Questions

- Whether Python import dependency relations should continue targeting pseudo module IDs like `module:<name>` or should instead target full entity IDs when a matching in-scope module exists. This refactor keeps current behavior unless tests show an inconsistency that is cheap to resolve.
- Whether the Go Atlas goroutine pattern-detection TODO should be implemented now or only converted into a GitHub issue during this refactor.
