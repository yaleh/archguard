# ArchGuard Self-Analysis Report

> Generated: 2026-06-16  
> Tool: ArchGuard v0.1.24 analyzing its own `src/` directory

## Summary

| Metric | Value |
|--------|-------|
| Total entities (classes/interfaces) | 524 |
| Total relations | 1,457 |
| Top-level packages | 8 (`analysis`, `cli`, `core`, `mermaid`, `parser`, `plugins`, `types`, `utils`) |
| Cross-package dependency cycles | 30 |
| God packages (fanout > 20) | 2 (`cli`: fanout=95, `plugins`: fanout=68) |
| Entity test coverage ratio | 1.3% (only `src/` was scanned; tests live in `tests/`) |
| Highest-churn files (6 months) | `src/cli/commands/analyze.ts` (42 changes), `src/cli/processors/diagram-processor.ts` (38) |

**Diagram set**: 3-tier (package → class → 8 method-level modules). All generated successfully.

## Architecture Diagram Quality

The 3-tier diagram set accurately captures the intended `cli → processors/plugins → core/types` layering at the package level. The overview/package flowchart shows 8 first-level nodes with 214 cross-package relations, correctly representing inbound (`types` fanin=43) and outbound (`cli` fanout=95) directions.

The class-level diagram (`class/all-classes`) captures all 524 entities with 1,457 relations, though it is densely connected and benefits from being split (currently rendered as a single diagram). The method-level diagrams per module (`method/cli`, `method/plugins`, etc.) are the most readable tier — they provide focused views of individual subsystems and accurately reflect sub-module decomposition.

**Accuracy limitations**: The class-level diagram merges sub-packages within `cli` (e.g., `cli/mcp`, `cli/query`, `cli/processors`) into a single visual block, making it harder to distinguish the query-engine layer from the MCP server layer. A finer-grained split at sub-package level would improve this.

## Strengths

- **Plugin isolation**: Each language plugin (`typescript`, `go`, `java`, `python`, `cpp`, `kotlin`) is encapsulated under `src/plugins/<lang>/` with a uniform `ILanguagePlugin` interface. Adding new languages does not require changes to core orchestration logic.
- **Clear `core/types` separation**: `src/types/` (fanin=43) is a pure dependency sink — all packages depend on it, and it depends on nothing except external libraries. This enables stable contract definitions across the codebase.
- **`core/interfaces` layer**: Dependency, Entity, and Relation interfaces are cleanly separated from implementation in `src/core/interfaces/`, making it straightforward to swap implementations.
- **`analysis/` module cohesion**: The `src/analysis/` package (24 entities, fanout=12) is well-scoped — it handles test analysis, coverage mapping, and fitness functions without bleeding into rendering or CLI concerns.
- **Worker-thread renderer**: `src/mermaid/render-worker-pool.ts` demonstrates sound performance design — isolating CPU-intensive rendering from the main thread via a typed pool abstraction.

## Issues

### 1. God Package: `cli` (fanout=95, fanin=32)

`src/cli/` is the largest and most coupled package with 144 entities and fanout of 95. It contains fundamentally different responsibilities:
- **Orchestration** (`cli/commands/analyze.ts`, `cli/analyze/run-analysis.ts`)
- **Query engine** (`cli/query/query-engine.ts`) — 13 git changes in 6 months, high coupling
- **MCP server** (`cli/mcp/mcp-server.ts`) — 20 git changes
- **Processors** (`cli/processors/diagram-processor.ts`) — 38 git changes, highest after `analyze.ts`
- **Cache management** (`cli/cache-manager.ts`)
- **Progress/error reporting** (`cli/progress.ts`, `cli/error-handler.ts`)

These sub-systems have very different change rates and stakeholders but share the same package boundary, causing inflated coupling metrics.

### 2. God Package: `plugins` (fanout=68, fanin=18)

`src/plugins/` contains 151 entities across 6 language plugins. While each plugin is internally cohesive, the flat `plugins` package boundary aggregates all language-specific code into one coupling unit. The `golang/atlas/` sub-system alone contains 23 source files with 5 distinct builders.

### 3. Dependency Cycles: `analysis ↔ cli ↔ types`

30 cross-package cycles detected. The dominant pattern involves three packages:
- `analysis → cli` (analysis depends on `cli/query` for query engine access)
- `cli → types` (CLI commands depend on types)
- `types → analysis` (metric vector and extensions reference analysis types)

Key cycle examples:
- `analysis -> cli -> types -> analysis` (3-node cycle)
- `cli -> core -> cli` (bidirectional: core uses cli utilities)
- `core -> mermaid -> core` (mermaid references core entity types)

The `analysis → cli/query` dependency is the primary cycle driver: `src/analysis/test-analyzer.ts` imports from `src/cli/query/query-engine.ts`, creating a path back through `cli → types → analysis`.

### 4. Churn × Coupling Hotspots

The highest-risk files (high churn × high coupling):

| File | Git Changes (6mo) | Package Coupling |
|------|-------------------|-----------------|
| `src/cli/commands/analyze.ts` | 42 | `cli` (fanout=95) |
| `src/cli/processors/diagram-processor.ts` | 38 | `cli` (fanout=95) |
| `src/mermaid/generator.ts` | 26 | `mermaid` (fanout=10) |
| `src/plugins/golang/index.ts` | 24 | `plugins` (fanout=68) |
| `src/cli/mcp/mcp-server.ts` | 20 | `cli` (fanout=95) |
| `src/types/index.ts` | 22 | `types` (fanin=43) |

`src/cli/commands/analyze.ts` and `src/cli/processors/diagram-processor.ts` are the highest-risk combination: both are frequently changed and live inside the god `cli` package.

### 5. Test Coverage Gap (src/ entities)

When analyzing only `src/` for test files, coverage is 1.3% (tests are co-located in `tests/`, not `src/`). While this is a measurement artifact, it highlights that the tool's self-analysis does not automatically discover test files outside the source directory. For external projects, this could produce misleading low-coverage results unless the test directory is co-located.

## Recommendations

### R1 — Split `cli` into sub-packages (High Priority)

Extract these sub-systems from `src/cli/` into peer-level packages:
- `src/query/` — move `cli/query/query-engine.ts` and related query tools here. This directly breaks the `analysis → cli → types → analysis` cycle by placing the query engine at the same layer as `analysis`.
- `src/mcp/` — move `cli/mcp/mcp-server.ts` and MCP tools here, since the MCP server is independently versioned and consumed.
- Keep `src/cli/` for orchestration only: commands, processors, config-loader, progress, error-handler.

**Expected benefit**: Reduces `cli` fanout from 95 to ~30; eliminates the primary cycle chain.

### R2 — Break `analysis ↔ cli/query` circular dependency (High Priority)

`src/analysis/test-analyzer.ts` depends on `src/cli/query/query-engine.ts`. After R1 splits the query engine to `src/query/`, this becomes `analysis → query` (acyclic). No source change is needed beyond the move — only import paths update.

### R3 — Break `core ↔ mermaid` cycle (Medium Priority)

`src/mermaid/` depends on `src/core/` for entity types, and `src/core/` imports Mermaid configuration types. Extract a `src/core/mermaid-types.ts` interface shim that Mermaid implements, removing the upward dependency from `core` into `mermaid`.

### R4 — Introduce sub-package boundaries for `plugins` (Medium Priority)

Create a plugin registry at `src/plugins/index.ts` that acts as the sole dependency target, hiding individual plugin implementations. Consumers should import from `src/plugins/` (the registry) rather than `src/plugins/golang/`, `src/plugins/cpp/`, etc. This reduces fanin spread without restructuring files.

### R5 — Add test root discovery flag to CLI (Low Priority)

Add a `--test-root <path>` CLI flag so that the test analyzer can discover test files outside the source directory. This would raise the self-reported coverage ratio from 1.3% to the actual ~9.5% (from prior meta-cc session data) when both `src/` and `tests/` are provided.

### R6 — Reduce `src/cli/commands/analyze.ts` churn (Low Priority)

This file has 42 changes in 6 months — the highest in the project. Much of this churn is due to adding new CLI flags as language plugins are added. Extracting plugin-specific flag registration to each plugin's own `registerFlags(cmd)` method would decouple flag additions from the core analyze command.
