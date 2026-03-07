# ArchGuard Architecture Overview

This document describes the current implementation architecture of ArchGuard as of March 2026.

It replaces older descriptions that were centered on a TypeScript-only pipeline, hook listeners, and default LLM grouping. The current system is a plugin-based, multi-language analysis tool with a shared analysis core, persisted query artifacts, and MCP integration.

## 1. System Shape

ArchGuard is organized around five major areas:

1. Entry layer
2. Shared analysis core
3. Query layer
4. Language plugin layer
5. Output and rendering layer

At the center is a stable intermediate representation: `ArchJSON`.

`ArchJSON` is the contract shared by parsers, query tools, diagram generation, and language-specific extensions such as Go Atlas.

## 2. Major Components

### 2.1 Entry Layer

Primary entrypoints:

- CLI commands under `src/cli/commands/`
- MCP server under `src/cli/mcp/`

Responsibilities:

- parse user input
- choose work/output directories
- call the shared analysis core or query layer
- present results to terminals or MCP clients

Important rule:

- CLI and MCP must not maintain separate analysis write paths

That constraint is captured in [ADR-004](../adr/004-single-analysis-write-path-for-cli-and-mcp.md).

### 2.2 Shared Analysis Core

The shared orchestration entrypoint is `runAnalysis()` in `src/cli/analyze/run-analysis.ts`.

Responsibilities:

- load configuration
- normalize diagram selection
- invoke diagram processing
- write diagram manifests
- persist query scopes
- generate output indexes

This is the write-path authority for both CLI and MCP analysis.

### 2.3 Diagram Processing Pipeline

`DiagramProcessor` in `src/cli/processors/diagram-processor.ts` is the main batch execution component.

Responsibilities:

- group diagrams by source set
- reuse parsed `ArchJSON` where possible
- isolate failures per diagram
- coordinate render worker pools
- collect query scopes for later persistence

Supporting components include:

- `ArchJsonProvider`
- `DiagramOutputRouter`
- `ParallelProgressReporter`
- `MermaidRenderWorkerPool`

### 2.4 Query Layer

The query layer turns persisted analysis artifacts into architecture inspection tools.

Core components:

- `persistQueryScopes()` in `src/cli/query/query-artifacts.ts`
- `loadEngine()` in `src/cli/query/engine-loader.ts`
- `QueryEngine` in `src/cli/query/query-engine.ts`
- MCP query registration in `src/cli/mcp/mcp-server.ts`

Responsibilities:

- persist `ArchJSON` and indexes per scope
- expose summaries, dependencies, dependents, implementers, subclasses, cycles, and file-level views
- provide a stable architecture query surface for CLI and MCP clients

This is what makes ArchGuard usable for architecture review, not just diagram generation.

### 2.5 Language Plugin Layer

Language support is built around `ILanguagePlugin` in `src/core/interfaces/language-plugin.ts` and `PluginRegistry` in `src/core/plugin-registry.ts`.

The plugin contract includes:

- initialization
- project and file parsing
- supported diagram levels
- optional dependency extraction
- optional validation

Current in-repo plugin implementations:

- TypeScript
- Go
- Go Atlas
- Java
- Python
- C++

The registry handles:

- plugin registration
- version lookup
- extension routing
- directory marker detection
- dynamic loading

### 2.6 Parsing Backends

ArchGuard uses different backends depending on language:

- TypeScript: `ts-morph`
- Go / Java / Python / C++: `tree-sitter`-based parsing
- Go optionally integrates `gopls` for better semantic accuracy

The TypeScript path includes `TypeScriptParser`, extractor components, and `ParallelParser` for concurrent file parsing.

### 2.7 Output and Rendering Layer

ArchGuard can produce:

- Mermaid source
- SVG
- PNG
- JSON
- query artifacts
- Go Atlas extension data

Core rendering and validation components live under `src/mermaid/`.

Responsibilities include:

- Mermaid generation
- syntax validation
- structural validation
- render validation
- quality checks
- auto-repair
- SVG-to-PNG conversion

## 3. Core Data Flow

### 3.1 Analysis Flow

```text
CLI or MCP analyze request
  -> runAnalysis()
  -> normalize selected diagrams
  -> DiagramProcessor
  -> ArchJsonProvider
  -> Language plugin
  -> ArchJSON
  -> output artifacts + query artifacts
```

### 3.2 Query Flow

```text
CLI query or MCP query request
  -> loadEngine()
  -> QueryEngine
  -> in-memory ArchJSON + ArchIndex
  -> structured architecture answers
```

### 3.3 Go Atlas Flow

```text
GoAtlasPlugin
  -> delegate base parsing to GoPlugin
  -> build package / capability / goroutine / flow layers
  -> attach atlas result under ArchJSON.extensions.goAtlas
```

The Go Atlas branch is intentionally built with composition rather than inheritance. See [ADR-001](../adr/001-goatlas-plugin-composition.md).

## 4. Architectural Boundaries

The intended boundaries are:

- Entry layer adapts commands and protocols
- Shared analysis core owns write-side orchestration
- Query layer owns read-side architecture inspection
- Plugins own language-specific parsing and optional enrichments
- Mermaid layer owns rendering and validation concerns

This separation is mostly healthy in the current codebase. In particular:

- query logic is separated from disk loading
- analysis write-side is centralized
- plugin interfaces are explicit
- no circular dependency cycles were detected in the `src/` architecture scope during self-analysis

## 5. What Changed From Earlier Designs

The current implementation differs from older architecture descriptions in several important ways:

- It is no longer TypeScript-only
- It no longer revolves around a hook-listener trigger model
- It does not depend on an always-on LLM grouping stage
- It includes a persisted query layer
- It exposes MCP tools for architecture inspection
- It includes Go Atlas as a language-specific extension path
- It centralizes CLI and MCP analysis through a shared write path

## 6. Strengths

Current strengths of the architecture:

- Stable intermediate representation around `ArchJSON`
- Clear plugin extension mechanism
- Shared analysis core for CLI and MCP consistency
- Query layer suitable for agent workflows
- Multi-language support without collapsing into command-specific branching
- Good alignment between rendered outputs and queryable artifacts

## 7. Current Risks

The most important risks are architectural growth risks, not immediate correctness failures:

- `DiagramProcessor` is accumulating orchestration responsibilities
- advanced features such as Go Atlas stretch the basic language plugin contract
- some user and developer docs can drift when new architecture capabilities land

These are manageable, but they are the right places to watch during future refactors.

## 8. Related Documents

- [Architecture Checking Scenarios](../user-guide/architecture-checking-scenarios.md)
- [CLI Usage](../user-guide/cli-usage.md)
- [Plugin Development Guide](./plugin-development-guide.md)
- [ArchJSON Levels](./archjson-levels.md)
- [ADR-001: GoAtlasPlugin Composition](../adr/001-goatlas-plugin-composition.md)
- [ADR-004: Single Analysis Write Path for CLI and MCP](../adr/004-single-analysis-write-path-for-cli-and-mcp.md)
