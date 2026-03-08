# ArchGuard MCP Usage Guide

ArchGuard exposes its architecture query capabilities as an MCP (Model Context Protocol) server. This lets AI assistants such as Claude query structural information about a codebase in real time, without needing the full source text in context.

## Prerequisites

Run analysis at least once to generate query artifacts:

```bash
archguard analyze
```

This writes query data to `.archguard/query/`. The MCP server reads from this directory.

## Installation

### Claude Code

Use the `claude mcp add` command. The `--` separator distinguishes the server name from the command passed to the server.

**Project scope** (stored in `.mcp.json`, applies only to this project):

```bash
claude mcp add --scope project archguard -- archguard mcp
```

**User scope** (available across all projects):

```bash
claude mcp add --scope user archguard -- archguard mcp
```

**Custom work directory** (when artifacts are not in the default `.archguard`):

```bash
claude mcp add --scope project archguard -- archguard mcp --arch-dir /path/to/project/.archguard
```

Verify the server was added:

```bash
claude mcp list
claude mcp get archguard
```

Remove if needed:

```bash
claude mcp remove archguard
```

### Codex

Use the `codex mcp add` command:

```bash
codex mcp add archguard -- archguard mcp
```

Or configure directly in `~/.codex/config.toml` (project-scoped: `.codex/config.toml`):

```toml
[mcp_servers.archguard]
command = "archguard"
args = ["mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

With a custom work directory:

```toml
[mcp_servers.archguard]
command = "archguard"
args = ["mcp", "--arch-dir", "/path/to/project/.archguard"]
```

Verify in the Codex TUI by typing `/mcp`.

### Custom Work Directory

If your analysis artifacts are not in the default `.archguard` directory, pass `--arch-dir` to the server command (see examples above).

### Refreshing Without Restarting

Call `archguard_analyze` from within the MCP session to reparse the project and update query artifacts without restarting the server.

---

## Available Tools

### `archguard_summary`

Return a high-level summary of the analyzed project: entity counts, relation counts, scope list, and top-level statistics.

**Use when**: starting an architecture review, or when you don't know what queries are useful yet.

```
archguard_summary()
```

---

### `archguard_find_entity`

Look up a specific named entity (class, interface, function, enum).

**Parameters**:
- `name` — entity name (exact or partial match)

```
archguard_find_entity(name: "DiagramProcessor")
```

---

### `archguard_get_dependencies`

Return what a given entity depends on — its outgoing relationships.

**Parameters**:
- `name` — entity name
- `depth` — traversal depth (default: 1; use 1–2 to avoid oversized results)

```
archguard_get_dependencies(name: "DiagramProcessor", depth: 2)
```

**Good fit for**: blast-radius estimation before refactoring.

---

### `archguard_get_dependents`

Return which entities depend on a given entity — its incoming relationships (reverse lookup).

**Parameters**:
- `name` — entity name
- `depth` — traversal depth (default: 1)

```
archguard_get_dependents(name: "ArchJSON", depth: 1)
```

**Good fit for**: finding all consumers of a core type or interface.

> **Note**: `depth: 2` on widely-used types can return very large results. Start with `depth: 1`.

---

### `archguard_find_implementers`

Find all classes that implement a given interface.

**Parameters**:
- `name` — interface name

```
archguard_find_implementers(name: "ILanguagePlugin")
```

**Good fit for**: auditing extension points, validating plugin architecture.

---

### `archguard_find_subclasses`

Find all classes that extend a given base class.

**Parameters**:
- `name` — base class name

```
archguard_find_subclasses(name: "BaseExtractor")
```

---

### `archguard_get_file_entities`

Return all entities defined in a specific source file.

**Parameters**:
- `name` — file path relative to the project root (e.g. `src/cli/mcp/mcp-server.ts`)

```
archguard_get_file_entities(name: "src/types/index.ts")
```

> **Note**: Use the path as it appears in the project, including the `src/` prefix. Omitting the prefix causes a lookup failure.

---

### `archguard_detect_cycles`

Detect circular dependencies in the analyzed scope.

**Parameters**: none required

```
archguard_detect_cycles()
```

**Good fit for**: layer violation review, pre-release cleanup.

---

### `archguard_analyze`

Rerun analysis for the current project and refresh query artifacts in place. Call this after meaningful code changes to keep MCP results current.

```
archguard_analyze()
```

---

## Typical Usage Patterns

### Orientation — what can I query?

```
archguard_summary()
```

Review entity counts and scope list to understand what data is available, then choose the right query.

### Who consumes a core type?

```
archguard_get_dependents(name: "ArchJSON", depth: 1)
```

Lists all classes and functions that directly reference `ArchJSON`.

### What does a component depend on?

```
archguard_get_dependencies(name: "QueryEngine", depth: 2)
```

Shows the full dependency chain for `QueryEngine`, two levels deep.

### What implements an interface?

```
archguard_find_implementers(name: "ILanguagePlugin")
```

Lists every plugin implementation registered in the codebase.

### What entities does a file contain?

```
archguard_get_file_entities(name: "src/types/index.ts")
```

Returns classes, interfaces, enums, and functions defined in that file.

### Are there circular dependencies?

```
archguard_detect_cycles()
```

Returns the set of entities participating in dependency cycles.

### Combined architecture review workflow

1. `archguard_summary()` — map the codebase
2. `archguard_detect_cycles()` — check for structural problems
3. `archguard_find_implementers(name: "ILanguagePlugin")` — audit extension points
4. `archguard_get_dependents(name: "<CoreType>", depth: 1)` — trace usage
5. `archguard_analyze()` — refresh after code changes

### Analyzing a project that is not the current working directory

Ask the AI to analyze any path. `archguard_analyze` accepts an absolute source path and writes results under `<project>/.archguard/`:

> Use archguard MCP to analyze the architecture of `/home/user/work/my-other-project`.

The AI will call:

```
archguard_analyze(source: "/home/user/work/my-other-project")
```

No CLI pre-step or config file is needed. After the call returns, follow-up queries target the newly written artifacts automatically.

If the MCP server was started without a `--arch-dir` argument and you need to point it at a different project's existing artifacts, restart the server with:

```bash
archguard mcp --arch-dir /path/to/project/.archguard
```

### Querying from an existing analysis cache

Query artifacts written by a previous `archguard analyze` run or `archguard_analyze` call persist in `.archguard/query/`. They remain valid as long as the source files have not changed. You can start querying immediately without re-running analysis:

> Show me what depends on `UserService` in this project. Use the existing archguard cache — no need to re-analyze.

The AI will call query tools directly against the persisted index:

```
archguard_summary()
archguard_get_dependents(name: "UserService", depth: 1)
```

Call `archguard_analyze()` only when you know the code has changed since the last run. The built-in SHA-256 file cache means re-analysis is fast (unchanged files are skipped), but skipping it entirely is faster still when the code has not changed.

### Suggesting refactoring directions

Combine structural queries to give the AI enough data to reason about refactoring. A typical prompt:

> Using archguard MCP, analyze this project's architecture and suggest refactoring directions.

The AI will typically sequence:

```
archguard_summary()                                    # get overall shape
archguard_detect_cycles()                              # find circular dependencies
archguard_get_dependents(name: "<high-coupling>", depth: 1)  # trace hotspots
archguard_find_implementers(name: "<interface>")       # check extension points
```

Then synthesize findings into concrete suggestions — for example:

- Extract a shared interface where cycles exist between two modules
- Split a class that has too many incoming dependents (god object)
- Move orphaned helpers into a more appropriate package
- Consolidate scattered implementations of an interface

You can guide the AI more specifically:

> Based on the archguard analysis, which classes have the most incoming dependencies? Suggest how to reduce coupling.

> The archguard cycle detector found a cycle between `parser` and `mermaid`. Suggest how to break it.

---

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Result too large / truncated | `depth` too high on a widely-used entity | Reduce to `depth: 1` |
| Entity not found | Wrong name casing or wrong file path format | Check with `archguard_summary()` first, then match exact name |
| File entity lookup fails | Path missing `src/` prefix or wrong separator | Use the full relative path as it appears in the project |
| Stale results after code changes | Query artifacts not refreshed | Call `archguard_analyze()` or re-run `archguard analyze` |
| MCP server fails to start | Analysis artifacts not generated yet | Run `archguard analyze` first |

---

## Related

- [Architecture Checking Scenarios](./architecture-checking-scenarios.md)
- [CLI Usage Guide](./cli-usage.md)
- [Configuration Reference](./configuration.md)
