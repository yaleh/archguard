<!-- ARCHGUARD_METADATA:agent-surface:START -->
# ArchGuard Agent Surface

This page is generated from `src/cli/metadata/registry.ts`. Run `npm run docs:check` after changing commands, tools, or agent guidance.

## Setup

Claude Code project scope:

```bash
claude mcp add --scope project archguard -- archguard mcp
```

Codex user scope:

```bash
codex mcp add archguard -- archguard mcp
```

Codex config file:

```toml
[mcp_servers.archguard]
command = "archguard"
args = ["mcp"]
```

## Workflows

- Architecture orientation: call `archguard_analyze`, then `archguard_summary`, then query tools such as `archguard_find_entity`, `archguard_get_dependencies`, or `archguard_get_dependents`.
- Test analysis: call `archguard_analyze` with `includeTests: true`, then `archguard_detect_test_patterns`, then `archguard_get_test_metrics`, `archguard_get_test_issues`, or `archguard_get_entity_coverage`.
- Git history: run `archguard analyze --include-git` in CLI workflows or call `archguard_analyze_git` in MCP workflows, then use change context, co-change, risk, or ownership tools.
- Go Atlas: call `archguard_analyze` on a Go project, then inspect `archguard_get_atlas_layer`, `archguard_get_package_fanin`, `archguard_get_package_fanout`, or `archguard_detect_god_packages`.

## Analysis Tools

- `archguard_analyze`: Analyze project sources and refresh ArchGuard query artifacts.

## Query Tools

- `archguard_find_entity`: Find entities by name, type, or attribute filters. Call first: archguard_analyze.
- `archguard_get_dependencies`: Return direct and transitive dependencies for an entity. Call first: archguard_analyze.
- `archguard_get_dependents`: Return entities that depend on a named entity. Call first: archguard_analyze.
- `archguard_find_implementers`: Find classes or structs implementing an interface. Call first: archguard_analyze.
- `archguard_find_subclasses`: Find subclasses of a class in object-oriented languages. Call first: archguard_analyze.
- `archguard_get_file_entities`: Return entities defined in a specific source file. Call first: archguard_analyze.
- `archguard_detect_cycles`: Detect dependency cycles in analyzed architecture data. Call first: archguard_analyze.
- `archguard_summary`: Return pre-computed architecture counts, relation breakdowns, and top rankings. Call first: archguard_analyze.
- `archguard_get_package_stats`: Return per-package file, entity, method, and approximate line metrics. Call first: archguard_analyze.
- `archguard_find_callers`: Return direct and transitive callers of an entity or method from static call edges. Call first: archguard_analyze.

## Test Analysis Tools

- `archguard_detect_test_patterns`: Detect test frameworks and convention hints before reading test metrics or issues. Call first: archguard_analyze.
- `archguard_get_test_issues`: Return static-analysis test quality issues such as orphan tests, zero assertions, and skips. Call first: archguard_analyze, archguard_detect_test_patterns.
- `archguard_get_test_metrics`: Return test suite metrics and optional package coverage breakdowns. Call first: archguard_analyze, archguard_detect_test_patterns.
- `archguard_get_entity_coverage`: Return inferred coverage details for a single source entity. Call first: archguard_analyze, archguard_detect_test_patterns.

## Git History Tools

- `archguard_analyze_git`: Analyze git history and write churn, co-change, risk, and ownership artifacts.
- `archguard_get_change_context`: Return churn, ownership, co-change, and risk context for a file or package before editing. Call first: archguard_analyze_git.
- `archguard_get_cochange`: Return strongest co-change neighbors for a file or package. Call first: archguard_analyze_git.
- `archguard_get_change_risk`: Return an explainable heuristic risk score for changing a file or package. Call first: archguard_analyze_git.
- `archguard_get_ownership`: Return maintainer concentration and bus-factor proxy data for a file or package. Call first: archguard_analyze_git.

## Atlas Tools

- `archguard_get_atlas_layer`: Return a Go Atlas architecture layer such as package, capability, goroutine, or flow. Call first: archguard_analyze.
- `archguard_get_package_fanin`: List Go Atlas packages ranked by incoming package dependencies. Call first: archguard_analyze.
- `archguard_get_package_fanout`: List Go Atlas packages ranked by outgoing package dependencies. Call first: archguard_analyze.
- `archguard_detect_god_packages`: Detect Go Atlas packages that exceed coupling, file, struct, or function thresholds. Call first: archguard_analyze.

## Recovery Rules

- `archguard_summary`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_entity`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_dependencies`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_dependents`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_implementers`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_subclasses`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_file_entities`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_detect_cycles`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_atlas_layer`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_stats`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_callers`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_detect_test_patterns`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_test_metrics`: call archguard_analyze, archguard_detect_test_patterns first. If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.
- `archguard_get_test_issues`: call archguard_analyze, archguard_detect_test_patterns first. If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.
- `archguard_get_entity_coverage`: call archguard_analyze, archguard_detect_test_patterns first. If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.
- `archguard_get_change_context`: call archguard_analyze_git first. If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_cochange`: call archguard_analyze_git first. If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_change_risk`: call archguard_analyze_git first. If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_ownership`: call archguard_analyze_git first. If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_package_fanin`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_fanout`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_detect_god_packages`: call archguard_analyze first. If prerequisite data is missing, call archguard_analyze and retry.
<!-- ARCHGUARD_METADATA:agent-surface:END -->
