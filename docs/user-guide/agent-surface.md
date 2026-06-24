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

# ArchGuard Instructions for Codex

Codex MCP config uses `~/.codex/config.toml` with `[mcp_servers.archguard]` running `archguard mcp`.

Source metadata hash: `07a5bce6fc156e17c8a204df31c30e44c781adf5f8aca9b67d28ce9c3e269c4d`

## Operating Rules

- Prefer ArchGuard MCP tools when you need architecture, dependency, test-analysis, git-history, or Go Atlas context.
- Call the listed prerequisite tools before tools that read generated artifacts.
- Treat query, test-analysis, git-history, and Atlas results as snapshots; refresh them when source, tests, or git history changed.
- Use CLI commands when a human-readable terminal workflow is more appropriate than MCP JSON.

## Core Workflows

### Analysis

- `archguard_analyze`: Analyze project sources and refresh ArchGuard query artifacts. Follow with: archguard_summary. Freshness: Refreshes source-derived ArchGuard artifacts for the current project when it runs. Recovery: If the result is empty, verify the target path/name and rerun analysis if code changed.

### Query Artifacts

- `archguard_find_entity`: Find entities by name, type, or attribute filters. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_dependencies`: Return direct and transitive dependencies for an entity. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_dependents`: Return entities that depend on a named entity. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_implementers`: Find classes or structs implementing an interface. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_subclasses`: Find subclasses of a class in object-oriented languages. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_file_entities`: Return entities defined in a specific source file. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_detect_cycles`: Detect dependency cycles in analyzed architecture data. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_summary`: Return pre-computed architecture counts, relation breakdowns, and top rankings. Call first: archguard_analyze. Follow with: archguard_find_entity, archguard_get_dependencies. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_ccb`: Return a cached Cognitive Context Bundle for a source file. Call first: archguard_analyze, archguard_analyze_git. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and archguard_analyze_git and retry.
- `archguard_get_cognitive_summary`: Return compact structural digests for requested entity names. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_stats`: Return per-package file, entity, method, and approximate line metrics. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_metrics`: Aggregate fan-in, fan-out, and cycle count per package. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_callers`: Return direct and transitive callers of an entity or method from static call edges. Call first: archguard_analyze. Freshness: Reads the last .archguard/query analysis snapshot; rerun archguard_analyze after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.

### Test Analysis

- `archguard_detect_test_patterns`: Detect test frameworks and convention hints before reading test metrics or issues. Call first: archguard_analyze. Follow with: archguard_get_test_metrics, archguard_get_test_issues. Freshness: Reads the last test-analysis artifacts; rerun archguard_analyze with includeTests and archguard_detect_test_patterns after test changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_test_issues`: Return static-analysis test quality issues such as orphan tests, zero assertions, and skips. Call first: archguard_analyze, archguard_detect_test_patterns. Freshness: Reads the last test-analysis artifacts; rerun archguard_analyze with includeTests and archguard_detect_test_patterns after test changes. Recovery: If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.
- `archguard_get_test_metrics`: Return test suite metrics and optional package coverage breakdowns. Call first: archguard_analyze, archguard_detect_test_patterns. Freshness: Reads the last test-analysis artifacts; rerun archguard_analyze with includeTests and archguard_detect_test_patterns after test changes. Recovery: If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.
- `archguard_get_entity_coverage`: Return inferred coverage details for a single source entity. Call first: archguard_analyze, archguard_detect_test_patterns. Freshness: Reads the last test-analysis artifacts; rerun archguard_analyze with includeTests and archguard_detect_test_patterns after test changes. Recovery: If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.

### Git History

- `archguard_analyze_git`: Analyze git history and write churn, co-change, risk, and ownership artifacts. Follow with: archguard_get_change_context. Freshness: Reads the last git-history analysis snapshot; rerun archguard_analyze_git after new commits or when changing the history window. Recovery: If the result is empty, verify the target path/name and rerun analysis if code changed.
- `archguard_get_change_context`: Return churn, ownership, co-change, and risk context for a file or package before editing. Call first: archguard_analyze_git. Freshness: Reads the last git-history analysis snapshot; rerun archguard_analyze_git after new commits or when changing the history window. Recovery: If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_cochange`: Return strongest co-change neighbors for a file or package. Call first: archguard_analyze_git. Freshness: Reads the last git-history analysis snapshot; rerun archguard_analyze_git after new commits or when changing the history window. Recovery: If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_change_risk`: Return an explainable heuristic risk score for changing a file or package. Call first: archguard_analyze_git. Freshness: Reads the last git-history analysis snapshot; rerun archguard_analyze_git after new commits or when changing the history window. Recovery: If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_ownership`: Return maintainer concentration and bus-factor proxy data for a file or package. Call first: archguard_analyze_git. Freshness: Reads the last git-history analysis snapshot; rerun archguard_analyze_git after new commits or when changing the history window. Recovery: If prerequisite data is missing, call archguard_analyze_git and retry.

### Go Atlas

- `archguard_get_atlas_layer`: Return a Go Atlas architecture layer such as package, capability, goroutine, or flow. Call first: archguard_analyze. Freshness: Reads the last Go Atlas artifacts; rerun archguard_analyze on the Go project after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_fanin`: List Go Atlas packages ranked by incoming package dependencies. Call first: archguard_analyze. Freshness: Reads the last Go Atlas artifacts; rerun archguard_analyze on the Go project after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_fanout`: List Go Atlas packages ranked by outgoing package dependencies. Call first: archguard_analyze. Freshness: Reads the last Go Atlas artifacts; rerun archguard_analyze on the Go project after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_detect_god_packages`: Detect Go Atlas packages that exceed coupling, file, struct, or function thresholds. Call first: archguard_analyze. Freshness: Reads the last Go Atlas artifacts; rerun archguard_analyze on the Go project after source changes. Recovery: If prerequisite data is missing, call archguard_analyze and retry.


## Recovery Rules

- `archguard_find_entity`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_dependencies`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_dependents`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_implementers`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_find_subclasses`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_file_entities`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_detect_cycles`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_summary`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_atlas_layer`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_ccb`: If prerequisite data is missing, call archguard_analyze and archguard_analyze_git and retry.
- `archguard_get_cognitive_summary`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_stats`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_metrics`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_detect_test_patterns`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_test_issues`: If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.
- `archguard_get_test_metrics`: If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.
- `archguard_get_entity_coverage`: If prerequisite data is missing, call archguard_analyze and archguard_detect_test_patterns and retry.
- `archguard_get_change_context`: If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_cochange`: If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_change_risk`: If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_get_ownership`: If prerequisite data is missing, call archguard_analyze_git and retry.
- `archguard_find_callers`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_fanin`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_get_package_fanout`: If prerequisite data is missing, call archguard_analyze and retry.
- `archguard_detect_god_packages`: If prerequisite data is missing, call archguard_analyze and retry.
<!-- ARCHGUARD_METADATA:agent-surface:END -->
