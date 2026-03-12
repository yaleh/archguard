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

To include test analysis alongside architecture parsing, pass `includeTests: true`:

```
archguard_analyze(includeTests: true)
```

This is required before calling any of the four test analysis tools below.

---

### Test Analysis Tools

These four tools provide static test quality analysis. They require test data to be present: call `archguard_analyze(includeTests: true)` at least once before using them.

**Required call sequence:**

1. `archguard_analyze(includeTests: true)` — parse source and run test analysis
2. `archguard_detect_test_patterns()` — inspect detected frameworks and suggested config
3. `archguard_get_test_metrics()` / `archguard_get_test_issues()` / `archguard_get_test_coverage()` — query results

---

### `archguard_detect_test_patterns`

Detect test frameworks and conventions in the project. Returns detected framework names, confidence levels, and a suggested `patternConfig` for review.

**Use when**: starting test analysis, or when auto-detected patterns may be wrong for the project.

```
archguard_detect_test_patterns()
```

Example output:
```json
{
  "detectedFrameworks": [{ "name": "vitest", "confidence": "high" }],
  "suggestedPatternConfig": { "assertionPatterns": ["\\bexpect\\s*\\("] },
  "notes": ["Detected 166 test files. Pattern config source: auto."]
}
```

> **Note**: The `patternConfig` returned here is informational. It describes what was detected at analyze time. Passing it to the query tools does not currently re-run the analysis with a different config — see [Known Limitations](#known-limitations).

---

### `archguard_get_test_metrics`

Return a summary of test quality metrics: file counts by type, entity coverage ratio, assertion density, skip ratio, and issue counts.

**Parameters**:
- `patternConfig` *(optional)* — from `archguard_detect_test_patterns`; currently informational only

```
archguard_get_test_metrics()
```

Key fields in the response:

| Field | Meaning |
|-------|---------|
| `totalTestFiles` | Number of test files discovered |
| `byType` | Breakdown: unit / integration / e2e / performance / debug / unknown |
| `entityCoverageRatio` | Fraction of source entities linked to at least one test |
| `assertionDensity` | Average assertions per test case across all test files |
| `skipRatio` | Fraction of test cases marked skip/todo |
| `issueCount` | Count per issue type |

---

### `archguard_get_test_issues`

Return the list of quality issues detected in test files.

**Parameters**:
- `patternConfig` *(optional)* — from `archguard_detect_test_patterns`
- `severity` *(optional)* — filter by `"warning"` or `"info"`

```
archguard_get_test_issues()
archguard_get_test_issues(severity: "warning")
```

Issue types:

| Type | Severity | Meaning |
|------|----------|---------|
| `zero_assertion` | warning | Test file has test cases but no detected assertions |
| `orphan_test` | info | Test file has no detected link to any source entity |
| `assertion_poverty` | info | Assertion density below 1.0 per test case |
| `skip_accumulation` | info | More than 20% of test cases are skipped |

---

### `archguard_get_test_coverage`

Return the per-entity coverage map: which source entities are linked to which test files, and at what confidence score.

**Parameters**:
- `patternConfig` *(optional)* — from `archguard_detect_test_patterns`

```
archguard_get_test_coverage()
```

Coverage score is computed from two layers:
- **Import analysis** (weight 0.85): test file imports source file → entities in that file are linked
- **Path-convention** (weight 0.6): `foo.test.ts` → `foo.ts`, `test_foo.py` → `foo.py`, `foo_test.go` → `foo.go`

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

### Test quality review workflow

1. `archguard_analyze(includeTests: true)` — parse and run test analysis
2. `archguard_detect_test_patterns()` — check detected frameworks and config
3. `archguard_get_test_metrics()` — review coverage ratio and assertion density
4. `archguard_get_test_issues(severity: "warning")` — address warnings first
5. `archguard_get_test_issues()` — review all issues including orphan tests
6. `archguard_get_test_coverage()` — identify which source entities lack test coverage

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
| Test tools return "No test analysis data" | `archguard_analyze` was called without `includeTests: true` | Call `archguard_analyze(includeTests: true)` then retry |

---

## Known Limitations

### Test Analysis

**`patternConfig` is accepted but not re-applied at query time.**
The `patternConfig` parameter on `archguard_get_test_metrics`, `archguard_get_test_issues`, and `archguard_get_test_coverage` is part of the tool schema but is not currently used at query time. All results come from data computed during the `archguard_analyze(includeTests: true)` call. Changing `patternConfig` at query time has no effect on the returned data.

Workaround: if the auto-detected patterns are wrong, re-run analysis with a corrected config via the CLI `--include-tests` flag and a custom `archguard.config.json`.

**TypeScript `orphan_test` false positives with ESM-style `.js` imports.**
Test files that import source using the TypeScript ESM convention (`from '../foo.js'`) may be incorrectly reported as `orphan_test`. The import resolver preserves the `.js` extension, which does not match the `.ts` entity file path stored in the index. This affects most TypeScript projects using standard ESM module resolution.

**`zero_assertion` false positives in tests with long setup.**
Assertion counting uses a 20-line sliding window from each `it()`/`test()` call. Tests that contain long mock setup before their `expect()` calls may be reported as having zero assertions even when they do not.

**Third-party test files inside `tests/poc/**/node_modules/`.**
Test discovery recursively scans the `tests/` directory without excluding sub-`node_modules` folders. POC directories that have their own `node_modules` may contribute third-party test files to the results. These appear as `orphan_test` entries. Use `testFileGlobs` in your config to scope discovery if needed.

---

## Related

- [Architecture Checking Scenarios](./architecture-checking-scenarios.md)
- [CLI Usage Guide](./cli-usage.md)
- [Configuration Reference](./configuration.md)
