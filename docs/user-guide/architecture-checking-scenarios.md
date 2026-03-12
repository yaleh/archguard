# Architecture Checking Scenarios

This guide organizes ArchGuard around common architecture review tasks instead of individual commands.

Use it when you want to answer questions like:

- What are the major modules in this codebase?
- Which classes or packages are tightly coupled?
- Are there circular dependencies?
- Which implementations exist for an interface?
- Which files or entities look oversized or isolated?
- How can an agent query architecture data through MCP?
- How well is the codebase covered by tests?
- Which test files have no assertions or no connection to source code?

## Before You Start

Generate analysis artifacts first:

```bash
archguard analyze
```

If you want to inspect a specific source set:

```bash
archguard analyze -s ./src
archguard analyze -s ./src/plugins
```

This writes diagrams to `.archguard/output/` and query artifacts to `.archguard/query/`.

## 1. Build a High-Level Architecture View

Use this when you need a quick map of the codebase before drilling into details.

```bash
archguard analyze
archguard analyze --diagrams package class
```

What to inspect:

- Package diagrams for top-level module boundaries
- Class diagrams for main abstractions and ownership
- Method-level diagrams for dense submodules

Good fit for:

- New-team onboarding
- Design reviews
- Large refactoring kickoff

Related docs:

- [CLI Usage](./cli-usage.md)
- [Configuration Reference](./configuration.md)

## 2. Trace Dependencies Around a Critical Component

Use this when you want to understand the blast radius of a change.

```bash
archguard query --entity "DiagramProcessor"
archguard query --deps-of "DiagramProcessor" --depth 2
archguard query --used-by "DiagramProcessor" --depth 2
```

What to inspect:

- Direct dependencies for local complexity
- Dependents for change impact
- Depth-2 traversals for subsystem-level influence

Good fit for:

- Refactoring planning
- PR risk analysis
- Ownership mapping

## 3. Check Interface Implementations and Inheritance Trees

Use this when you want to validate extension points or polymorphic design.

```bash
archguard query --implementers-of "ILanguagePlugin"
archguard query --subclasses-of "BaseExtractor"
```

What to inspect:

- Whether an abstraction is actually used
- Whether implementations are clustered or scattered
- Whether inheritance is shallow and intentional

Good fit for:

- Plugin architecture review
- Framework extension audits
- Base-class cleanup

## 4. Detect Circular Dependencies

Use this when you suspect layer violations or tightly tangled modules.

```bash
archguard query --cycles
archguard query --in-cycles
```

What to inspect:

- Which entities participate in cycles
- Whether cycles stay inside one submodule or cross subsystem boundaries
- Whether method-level cycles point to missing interfaces or incorrect ownership

Good fit for:

- Layered architecture enforcement
- Pre-release cleanup
- Monolith modularization

## 5. Find High-Coupling Hotspots

Use this when you want to identify likely refactoring targets.

```bash
archguard query --high-coupling
archguard query --high-coupling --threshold 12
```

What to inspect:

- Entities with many incoming and outgoing relationships
- Utility classes that became de facto coordinators
- Components that combine orchestration and domain logic

Good fit for:

- God-object detection
- Simplification work
- Architecture debt triage

## 6. Find Orphans and Under-Integrated Code

Use this when you want to identify dead code, unfinished integration, or isolated helpers.

```bash
archguard query --orphans
archguard query --file "src/cli/mcp/mcp-server.ts"
```

What to inspect:

- Entities with zero incoming and outgoing edges
- Files that contain many unrelated entities
- Modules that exist in diagrams but are not connected to the main flow

Good fit for:

- Dead-code review
- Cleanup after migrations
- Code organization review

## 7. Compare Subsystems with Query Scopes

Use this when you want to inspect one part of a repository without loading the entire architecture into a single graph.

Example configuration:

```json
{
  "diagrams": [
    { "name": "cli", "sources": ["./src/cli"], "level": "method" },
    { "name": "parser", "sources": ["./src/parser"], "level": "method" },
    { "name": "plugins", "sources": ["./src/plugins"], "level": "method" }
  ]
}
```

Then inspect available scopes:

```bash
archguard analyze
archguard query --list-scopes
archguard query --scope <scope-key> --summary
```

What to inspect:

- Whether one subsystem has much higher entity density than others
- Whether a specific source set has local cycles or hotspots
- Whether generated scopes match intended module boundaries

Good fit for:

- Monorepos
- Layer-by-layer review
- Team ownership boundaries

## 8. Review Go Projects with Atlas Layers

Use this when a standard package/class/method view is not enough for Go systems.

```bash
archguard analyze -s ./cmd --lang go
archguard analyze -s ./cmd --lang go --atlas-layers package,capability
archguard analyze -s ./cmd --lang go --no-atlas
```

What to inspect:

- Package dependency structure
- Capability clustering
- Goroutine topology
- Flow entry points and execution paths

Good fit for:

- Service topology review
- Concurrency review
- Architecture deep-dives for Go systems

Related docs:

- [Go Plugin Usage](./golang-plugin-usage.md)

## 9. Assess Test System Health

Use this when you want to understand the quality and coverage of the test suite without running any tests.

```bash
archguard analyze --include-tests
```

Or to refresh the test report without re-parsing source files:

```bash
archguard analyze --tests-only
```

This generates three files in `.archguard/test/`:
- `metrics.md` — totals, type breakdown, entity coverage ratio, assertion density, skip ratio
- `issues.md` — per-file quality issues: `zero_assertion`, `orphan_test`, `assertion_poverty`, `skip_accumulation`
- `coverage-heatmap.md` — four-bucket entity coverage map (well tested / partially tested / not tested / debug only)

Via MCP (useful when reviewing from an AI assistant):

```
archguard_analyze(includeTests: true)
archguard_detect_test_patterns()
archguard_get_test_metrics()
archguard_get_test_issues(severity: "warning")
archguard_get_test_coverage()
```

What to inspect:

- `entityCoverageRatio` — fraction of source entities covered by at least one test; values below 0.5 indicate large untested areas
- `assertionDensity` — average assertions per test case; below 1.0 means many tests verify nothing observable
- `byType.debug` — test files classified as debug (have test cases but zero assertions); these are either incomplete tests or exploration scripts
- `orphan_test` issues — test files with no detected link to any source entity; often integration or E2E tests, but also points to broken import paths
- `zero_assertion` issues — tests that run code but make no assertions; the most actionable warning

Good fit for:

- Pre-release test quality review
- Identifying test debt alongside architecture debt
- Onboarding — understanding what the test suite actually validates
- CI gate: check `entityCoverageRatio` and `issueCount.zero_assertion` as quality signals

Related docs:

- [MCP Usage Guide](./mcp-usage.md)

---

## 10. Query Architecture Data Through MCP

Use this when an agent, IDE assistant, or automation pipeline needs structured architecture answers.

```bash
archguard mcp
```

The MCP server exposes query tools for entity lookup, dependency traversal, implementer search, file-level inspection, cycle detection, summary, and `archguard_analyze` to refresh query artifacts mid-session.

Typical agent queries:

```
# What does this project contain?
archguard_summary()

# Who consumes a core type?
archguard_get_dependents(name: "ArchJSON", depth: 1)

# What implements an interface?
archguard_find_implementers(name: "ILanguagePlugin")

# What does a component depend on?
archguard_get_dependencies(name: "QueryEngine", depth: 2)

# Are there circular dependencies?
archguard_detect_cycles()

# Refresh after code changes
archguard_analyze()
```

Good fit for:

- Agent-assisted code review
- Architecture-aware development workflows
- Automated repository inspection

Related docs:

- [MCP Usage Guide](./mcp-usage.md)

## Typical Review Playbooks

### Refactoring Review

1. `archguard analyze`
2. `archguard query --high-coupling`
3. `archguard query --deps-of "<target>" --depth 2`
4. `archguard query --used-by "<target>" --depth 2`

### Layer Violation Review

1. `archguard analyze`
2. `archguard query --cycles`
3. `archguard query --in-cycles`
4. Inspect package and method diagrams for the affected scope

### Extension Point Review

1. `archguard analyze`
2. `archguard query --implementers-of "<interface>"`
3. `archguard query --subclasses-of "<base-class>"`
4. Inspect whether implementations remain cohesive

### Agent Workflow Review

1. `archguard analyze`
2. `archguard mcp`
3. Let the agent call query tools against persisted scopes
4. Re-run `archguard_analyze` after meaningful code changes

### Test Quality Review

1. `archguard analyze --include-tests`
2. Open `.archguard/test/metrics.md` — check `entityCoverageRatio` and `assertionDensity`
3. Open `.archguard/test/issues.md` — address `zero_assertion` warnings first
4. Open `.archguard/test/coverage-heatmap.md` — identify "Not Tested" entities
5. Re-run `archguard analyze --tests-only` after fixing test gaps (faster, skips re-parsing)

## Limits

ArchGuard is strongest for structural inspection:

- entities
- relations
- dependency shape
- scope summaries
- language-specific architecture views such as Go Atlas

It does not yet provide first-class architectural rule enforcement such as:

- "controller must not call repository directly"
- "package A may only depend on package B"
- "all implementations must live under a specific module"

Those checks can still be approximated today with query workflows, but they are not yet a dedicated policy engine.
