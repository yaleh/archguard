---
doc_type: roadmap
slug: command-metadata-registry
status: active
created: 2026-06-21
last_reviewed: 2026-06-21
tags: [cli, mcp, metadata, docs, agent-surface]
related_requirements: []
related_architecture: [ARCHITECTURE, docs/adr/006-mcp-tool-design-standards.md, docs/adr/007-cli-mcp-interface-parity.md]
---

# Command Metadata Registry And Agent-Oriented Tool Descriptions

## 1. Background

ArchGuard currently has useful CLI and MCP surfaces, but command and tool
descriptions are manually maintained in several places:

- CLI command registration lives in `src/cli/index.ts` and `src/cli/commands/*`.
- MCP tool registration is split across `src/cli/mcp/mcp-server.ts`,
  `src/cli/mcp/analyze-tool.ts`, and `src/cli/mcp/tools/*`.
- User-facing descriptions live in Commander calls, Zod schema descriptions,
  README tables, `docs/user-guide/cli-usage.md`, and
  `docs/user-guide/mcp-usage.md`.

This roadmap implements the first two lessons from the codebase-memory-mcp
comparison:

1. Establish one typed command/tool metadata registry that can drive CLI
   catalog/help, structured help, MCP tools, README/help blocks, and agent
   surface documentation.
2. Improve agent-oriented descriptions so each tool explains when to use it,
   what should be called first, and how to recover from common failures.

## 2. Scope And Explicit Non-Goals

### This Roadmap Covers

- A typed metadata model for ArchGuard CLI commands, query flags, MCP tools,
  common parameters, examples, validation tags, and agent guidance.
- A registry module that inventories all current CLI commands and MCP tools.
- CLI help/catalog/structured help consuming registry metadata instead of
  separately authored strings where feasible.
- MCP tool descriptions and parameter descriptions consuming registry metadata,
  while preserving existing tool behavior and QueryEngine semantics.
- Generated or checked README/help/agent-surface documentation blocks from the
  same registry.
- Drift tests that fail when a command/tool exists in one surface but is missing
  from the registry or generated docs.

### Explicit Non-Goals

- No persistent graph database, Cypher-like query language, semantic search, or
  code indexing backend in this roadmap.
- No changes to core analysis semantics, QueryEngine results, diagram output, or
  ArchJSON schema beyond what is necessary to describe existing commands.
- No removal of existing CLI flags or MCP tool names.
- No switch away from Commander, Zod, or the MCP SDK.
- No hand-written generated documentation checked in without a verification
  path that detects drift.

## 3. Module Split

```text
command-metadata-registry
├── Metadata Model: typed definitions for commands, flags, tools, params, examples, and agent guidance
├── Registry Source: inventory of current CLI/MCP surfaces using the model
├── Surface Adapters: thin adapters that translate registry entries into Commander, MCP, and docs shapes
└── Drift Verification: tests/scripts proving surfaces and docs are registry-aligned
```

### Execution Status

- `command-metadata-registry-core`: done. The typed registry, baseline
  inventory, parity mapping, `callFirst` matrix, and core validators are
  implemented under `src/cli/metadata/`.
- `cli-help-from-registry`: done. CLI command descriptions, structured
  `archguard help --json`, human help fallback, bidirectional CLI drift tests,
  and built CLI E2E are implemented.
- `mcp-agent-descriptions-from-registry`: done. MCP tool descriptions now
  render from registry metadata, schema field/requiredness/description drift is
  tested through in-process MCP listTools, and workflow call-first guidance has
  E2E coverage.
- `docs-agent-surface-generation`: done. README, CLI usage, MCP usage, and
  agent surface generated blocks now render from registry metadata; CI runs
  `npm run docs:check`; the full metadata surface E2E covers CLI help JSON,
  in-process MCP metadata, docs freshness, parity mappings, workflow call-first
  guidance, and stale-doc failure.

### Current Surface Baseline

The first implementation must pin the current surface inventory before migrating
consumers. As of 2026-06-21, the registry must cover:

**CLI commands, 7 total**:

- `analyze`
- `cache`
- `check`
- `diff`
- `init`
- `mcp`
- `query`

**MCP tools, 24 total**:

- Core query tools: `archguard_find_entity`, `archguard_get_dependencies`,
  `archguard_get_dependents`, `archguard_find_implementers`,
  `archguard_find_subclasses`, `archguard_get_file_entities`,
  `archguard_detect_cycles`, `archguard_summary`,
  `archguard_get_atlas_layer`, `archguard_get_package_stats`
- Analysis tools: `archguard_analyze`, `archguard_analyze_git`
- Test analysis tools: `archguard_detect_test_patterns`,
  `archguard_get_test_metrics`, `archguard_get_test_issues`,
  `archguard_get_entity_coverage`
- Git history tools: `archguard_get_change_context`,
  `archguard_get_cochange`, `archguard_get_change_risk`,
  `archguard_get_ownership`
- Call graph tools: `archguard_find_callers`
- Atlas analytics tools: `archguard_get_package_fanin`,
  `archguard_get_package_fanout`, `archguard_detect_god_packages`

**CLI/MCP parity baseline**:

- The 22 query/read MCP tools listed in ADR-007 must map to their existing
  `archguard query` flags.
- `archguard_analyze` maps to `archguard analyze`.
- `archguard_analyze_git` maps to `archguard analyze --include-git`. ADR-007
  uses older `archguard analyze-git` wording; the registry must encode the
  current CLI fact and may update docs/ADR references during docs generation.

**Docs subject to generated-block or stale-doc verification**:

- `README.md`
- `docs/user-guide/cli-usage.md`
- `docs/user-guide/mcp-usage.md`
- a new or existing agent surface document chosen during
  `docs-agent-surface-generation`

### Metadata Model

- **Responsibility**: Define the stable TypeScript contract for command/tool
  descriptions and agent guidance.
- **Carried features**: `command-metadata-registry-core`.
- **Existing code touched**: new files under `src/cli/metadata/` and tests.

### Registry Source

- **Responsibility**: Store the canonical inventory of CLI commands, query
  options, MCP tools, examples, prerequisites, limitations, and recovery hints.
- **Carried features**: `command-metadata-registry-core`,
  `mcp-agent-descriptions-from-registry`.
- **Existing code touched**: new registry modules plus references from existing
  CLI/MCP registration files.

### Surface Adapters

- **Responsibility**: Project metadata into Commander descriptions, structured
  help JSON, MCP tool descriptions/schema descriptions, and docs blocks.
- **Carried features**: `cli-help-from-registry`,
  `mcp-agent-descriptions-from-registry`, `docs-agent-surface-generation`.
- **Existing code touched**: `src/cli/index.ts`, `src/cli/commands/*`,
  `src/cli/mcp/*`, docs generation scripts.

### Drift Verification

- **Responsibility**: Fail tests when CLI/MCP/docs/help surfaces drift from the
  registry.
- **Carried features**: all items.
- **Existing code touched**: tests under `tests/unit/cli`,
  `tests/unit/cli/mcp`, `tests/integration/cli-mcp`, and possibly
  `scripts/`.

## 4. Interface Contracts And Shared Protocols

These contracts are roadmap-level constraints for later feature design. Field
names may be refined during implementation, but the concepts and direction must
remain intact unless this roadmap is updated.

### 4.1 Command Metadata Entry

**Direction**: Registry Source -> Surface Adapters
**Form**: TypeScript interface

```ts
export type ArchGuardSurface = 'cli' | 'mcp' | 'docs' | 'agent';

export interface ArchGuardMetadataEntry {
  id: string;
  title: string;
  summary: string;
  category:
    | 'analysis'
    | 'query'
    | 'mcp'
    | 'test-analysis'
    | 'git-history'
    | 'atlas'
    | 'cache'
    | 'configuration'
    | 'docs';
  surfaces: ArchGuardSurface[];
  agent: AgentGuidance;
  examples: UsageExample[];
  verification: VerificationHint[];
}
```

**Constraints**:

- `id` is stable and unique across registry entries.
- `summary` must be short enough for CLI and MCP tool descriptions.
- `surfaces` declares where this entry is expected to appear; drift tests compare
  this field against actual adapters.
- `verification` must reference real commands or test files, not prose-only
  claims.

### 4.2 Agent Guidance

**Direction**: Registry Source -> MCP descriptions, structured help, agent docs
**Form**: TypeScript interface

```ts
export interface AgentGuidance {
  useWhen: string[];
  callFirst?: string[];
  followWith?: string[];
  failureRecovery: string[];
  limitations: string[];
}
```

**Constraints**:

- `useWhen` explains tool selection in agent-facing language.
- `callFirst` is required when a tool depends on generated artifacts or prior
  pattern detection, for example `archguard_analyze`,
  `archguard_detect_test_patterns`, or `archguard_analyze_git`.
- `failureRecovery` must include concrete next actions for common no-data or
  stale-cache states.
- `limitations` must include static-analysis approximation notes where relevant,
  consistent with ADR-006.
- The core registry feature must capture an initial `callFirst` matrix for
  workflow-dependent tools, including:
  - query tools that need existing `.archguard/query` artifacts:
    `archguard_analyze` or prior `archguard analyze`
  - test tools that need `archguard_analyze(includeTests: true)` or
    `archguard analyze --include-tests`
  - git history tools that need `archguard_analyze_git` or
    `archguard analyze --include-git`
  - Atlas analytics tools that need Go Atlas analysis data

### 4.3 CLI Metadata Projection

**Direction**: Registry Source -> Commander command/options and structured help
**Form**: Adapter functions

```ts
export interface CliCommandMetadata extends ArchGuardMetadataEntry {
  cli: {
    command: string;
    description: string;
    options: CliOptionMetadata[];
  };
}

export interface CliOptionMetadata {
  flags: string;
  description: string;
  defaultValue?: string | number | boolean;
  allowedValues?: string[];
  mapsToMcpTool?: string;
}
```

**Required structured help output**:

```json
{
  "program": "archguard",
  "commands": [
    {
      "name": "query",
      "description": "...",
      "options": [
        {
          "flags": "--summary",
          "description": "...",
          "mapsToMcpTool": "archguard_summary"
        }
      ]
    }
  ]
}
```

**Constraints**:

- Existing `archguard <command> --help` output remains human-readable.
- Structured help must be available from a deterministic new CLI entrypoint:
  `archguard help --json`. This must not replace Commander built-in help;
  existing `archguard --help` and `archguard <command> --help` behavior remains
  human-readable.
- Query CLI flags mapped in ADR-007 must declare their MCP counterpart.
- Option registration may remain inline for behavioral safety, but option
  descriptions and MCP mapping metadata must be either registry-derived or
  covered by a CLI->registry drift test in `cli-help-from-registry`.

### 4.4 MCP Metadata Projection

**Direction**: Registry Source -> MCP server registration
**Form**: Adapter functions and metadata lookup

```ts
export interface McpToolMetadata extends ArchGuardMetadataEntry {
  mcp: {
    toolName: string;
    description: string;
    inputSchemaId: string;
    cliEquivalent?: string;
  };
}
```

**Constraints**:

- Existing tool names and behavior must remain unchanged.
- Tool descriptions must be assembled from metadata fields and comply with
  ADR-006: concise what/when/limitation/workflow guidance.
- Existing ADR-006 low-priority description issues, including "Get" prefixes on
  `archguard_get_file_entities` and `archguard_get_change_context`, must be
  fixed as part of metadata-derived MCP descriptions.
- Zod schema shapes may remain near the current handlers, but parameter
  descriptions must come from metadata helper functions where practical. Any
  parameter description left inline must be covered by an MCP->registry drift
  test that compares the exposed description to metadata.
- No MCP verification may rely on a Claude Code-hosted long-running server;
  tests must use in-process MCP or an independent stdio process.

### 4.5 Docs And Agent Surface Generation

**Direction**: Registry Source -> README/help/docs blocks
**Form**: generation script or checked renderer

```ts
export interface DocsBlock {
  targetFile: string;
  markerStart: string;
  markerEnd: string;
  content: string;
}
```

**Constraints**:

- README/help generated sections must use stable markers so updates are
  deterministic and reviewable.
- The repository must have a verification command that detects stale generated
  docs without silently rewriting them in CI.
- Agent surface docs must list recommended workflows, for example:
  analyze -> summary -> find_entity/dependencies, analyze(includeTests) ->
  detect_test_patterns -> test metrics/issues, analyze_git -> change context.

## 5. Feature Breakdown

1. **command-metadata-registry-core** - Add the typed registry model, inventory
   current CLI/MCP surfaces, and validate uniqueness, category coverage, and
   ADR-007 CLI/MCP mappings.
   - Module: Metadata Model + Registry Source.
   - Depends on: none.
   - Status: done.
   - Feature: `2026-06-21-command-metadata-registry-core`.
   - Evidence: unit tests prove the 7 CLI commands and 24 MCP tools in the
     Current Surface Baseline have registry entries with agent guidance and
     verification hints, including a first `callFirst` matrix. This item only
     proves the inventory exists and is type-valid; consumer drift tests belong
     to later surface-adapter items.

2. **cli-help-from-registry** - Connect CLI command descriptions, catalog, and
   structured help JSON to registry metadata while preserving existing command
   behavior.
   - Module: Surface Adapters.
   - Depends on: `command-metadata-registry-core`.
   - Status: done.
   - Feature: `2026-06-21-cli-help-from-registry`.
   - Evidence: `archguard --help`, `archguard query --help`, and structured
     help output expose registry-derived descriptions and current flags; tests
     prove CLI command/option descriptions and ADR-007 MCP mappings do not drift
     from registry metadata.

3. **mcp-agent-descriptions-from-registry** - Refactor MCP registration to use
   registry-derived tool descriptions and agent guidance, including `callFirst`,
   failure recovery, and limitations.
   - Module: Registry Source + Surface Adapters.
   - Depends on: `command-metadata-registry-core`.
   - Status: done.
   - Feature: `2026-06-21-mcp-agent-descriptions-from-registry`.
   - Evidence: in-process MCP tests inspect tool metadata and verify no current
     tool loses its name, schema, or behavior; tests prove MCP tool and exposed
     parameter descriptions do not drift from registry metadata.

4. **docs-agent-surface-generation** - Generate or verify README/help/user-guide
   and agent surface blocks from the registry, and add drift tests to keep docs,
   CLI, and MCP aligned.
   - Module: Surface Adapters + Drift Verification.
   - Depends on: `cli-help-from-registry`,
     `mcp-agent-descriptions-from-registry`.
   - Status: done.
   - Feature: `2026-06-21-docs-agent-surface-generation`.
   - Evidence: docs check fails on stale generated sections; README and MCP/CLI
     guides describe Codex/Claude workflows and agent recovery paths from the
     registry; cross-surface tests prove docs workflows reference registered CLI
     commands and MCP tools only.

**Minimal loop**: `command-metadata-registry-core` is the first independently
verifiable loop: the repo can prove the complete current command/tool inventory
exists in one typed source before any consumer is migrated.

## 6. Delivery Order

The order is dependency-driven:

1. Build and validate the canonical metadata source.
2. Migrate CLI help/catalog/structured help to consume it.
3. Migrate MCP descriptions and agent guidance to consume it.
4. Generate/check docs and agent surface blocks from it.

CLI and MCP behavior must remain stable after each step. The roadmap favors
small adapters over a large rewrite of `QueryEngine` or command handlers.

## 7. Risks, Assumptions, And Validation

### Goal Completion Signal

This roadmap is complete when ArchGuard has one typed metadata registry that:

- inventories the 7 current CLI commands and 24 current MCP tools;
- drives or verifies CLI help/catalog and `archguard help --json`;
- drives or verifies MCP tool and parameter descriptions;
- drives or verifies README/help/user-guide and agent surface blocks;
- includes tests at each consumer layer that detect drift for that layer.
- runs those drift tests through `npm test` or the repository's CI test command
  so future CLI/MCP additions fail when the registry is not updated.

### Top 3 Risks And Mitigations

1. **Registry becomes another copy instead of the source of truth**.
   - Mitigation: each consumer feature must either derive from the registry or
     add a failing drift test that compares consumer strings/coverage to the
     registry.
2. **MCP behavior changes while refactoring descriptions**.
   - Mitigation: in-process MCP tests must snapshot tool names/input schemas and
     run representative calls before and after the migration.
3. **Generated docs become noisy or hard to review**.
   - Mitigation: generated sections must be marker-bounded and deterministic;
     docs verification must report stale blocks without broad unrelated rewrites.

### Key Assumptions

- Existing command names, CLI flags, and MCP tool names are the compatibility
  boundary.
- Commander and MCP SDK remain the runtime registration mechanisms.
- Zod remains the authoritative runtime validator for MCP inputs; metadata may
  describe or reference schemas but does not replace runtime validation unless a
  feature design explicitly proves a safe path.

### Baseline And Validation Entrypoints

Later features should use the existing project commands:

- `npm run type-check`
- `npm test`
- `npm run test:unit`
- `npm run test:integration -- tests/integration/cli-mcp`
- `npm run build`
- targeted Vitest files under `tests/unit/cli`, `tests/unit/cli/mcp`, and
  `tests/integration/cli-mcp`

### Delivery Artifacts

- `src/cli/metadata/*` registry/model/adapter files.
- Updated CLI/MCP registration code using registry metadata.
- Structured help command or equivalent deterministic JSON output.
- README/docs generated blocks or verification renderer.
- Tests proving registry coverage and drift detection.
- Either a new ADR for the command metadata registry or an update to ADR-006 /
  ADR-007 documenting that the registry is now the source for command/tool
  descriptions and parity metadata.

### Knowledge Writeback Candidates

- If the metadata model stabilizes, write an ADR or architecture backfill for
  "single command metadata source drives CLI/MCP/docs".
- If docs generation markers are introduced, record their maintenance rule in
  `docs/CONTRIBUTING.md`.
- If a common no-data recovery vocabulary emerges for agents, add it to
  `.codestable/attention.md` or a future agent-surface guide.

## 8. Observations

- ADR-006 already defines MCP tool description quality, but enforcement is
  currently manual. This roadmap should turn the ADR into tests and metadata.
- ADR-007 already defines CLI/MCP parity mappings. This roadmap should encode
  the mapping into registry data and use it as the source for docs.
- `diff` and `check` are current CLI commands but are not covered by the
  ADR-007 CLI/MCP parity table because they do not have MCP equivalents.
  `command-metadata-registry-core` must cross-check their registry entries
  against `archguard diff --help` and `archguard check --help`.
