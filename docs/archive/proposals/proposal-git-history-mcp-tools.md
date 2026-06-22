# Git History Analysis for MCP: Aggregated Evolution Queries Without Raw Git Wrappers

> Status: Draft
> Scope: Add an opt-in git-history analysis pipeline and a small MCP query surface for
>        change risk, co-change, ownership, and task-oriented change context.
> Depends on: [ADR-004](../adr/004-single-analysis-write-path-for-cli-and-mcp.md),
>             [ADR-006](../adr/006-mcp-tool-design-standards.md)

---

## Background

ArchGuard already covers the "current structure" side of project understanding well:

- `QueryEngine` is a pure in-memory query layer over persisted ArchJSON and index data
  ([src/cli/query/query-engine.ts](/home/yale/work/archguard/src/cli/query/query-engine.ts)).
- The MCP server exposes architecture and test-analysis tools as machine-readable queries,
  with per-call `projectRoot` / `scope` resolution instead of process-local state
  ([src/cli/mcp/mcp-server.ts](/home/yale/work/archguard/src/cli/mcp/mcp-server.ts)).
- Existing proposals and ADRs already emphasize bounded responses, explicit workflow
  dependencies, and "query-first" interfaces instead of dumping raw data
  ([docs/adr/006-mcp-tool-design-standards.md](/home/yale/work/archguard/docs/adr/006-mcp-tool-design-standards.md)).

What ArchGuard does not currently capture is the time dimension: where the architecture is
stable vs. unstable, which files and packages repeatedly change together, whether ownership is
 concentrated or fragmented, and what nearby areas are likely to matter before an agent edits a
 target.

Raw `git` commands can answer low-level questions such as "show commits touching this file" or
"blame this line". They do not directly answer the higher-level questions an MCP agent needs:

- Is this package risky to change right now?
- When this file changes, what else usually changes with it?
- Is this area structurally independent but evolutionarily coupled?
- Is this module stable but complex, or both complex and still thrashing?

Those are aggregation, normalization, and mapping problems. They become more valuable when the
results align with ArchGuard's existing package / file / entity query model instead of forming a
parallel "git-only" API surface.

---

## Goals

1. Add an opt-in git-history analysis path that produces persisted, queryable aggregate data.
2. Expose only high-value MCP queries that go beyond raw `git` command wrappers.
3. Reuse ArchGuard's existing project-root, scope, and query-tool conventions.
4. Keep initial scope limited to file- and package-level history mapping; defer entity-level
   mapping until the foundation is proven.
5. Make history results consumable by agents with bounded, structured responses.

## Non-Goals

- Do not add MCP tools equivalent to `git log`, `git blame`, `git show`, `git diff`, or branch
  listing.
- Do not make git-history analysis part of the default `archguard_analyze` path.
- Do not require any LLM inside ArchGuard to interpret commit messages or classify changes.
- Do not attempt full branch-topology analytics in the first iteration.
- Do not promise rename-perfect or entity-perfect lineage tracking in the first iteration.

---

## Current State Audit

### Query-layer shape

`QueryEngine` currently answers static architecture and test-analysis questions from one scope's
persisted ArchJSON / ArchIndex pair. It already provides a good model for the git feature:

- persisted analysis output
- pure query methods
- MCP tools that resolve the engine on demand

This strongly suggests that git-history support should follow the same pattern: analyze once,
persist query artifacts, load lightweight read models later.

### MCP design constraints

ADR-006 establishes several constraints that are directly relevant here:

- tool descriptions must embed limitations
- large raw dumps are discouraged
- tools should expose task-oriented queries rather than parameterized raw access
- workflow dependencies must be explicit

A git-history feature that simply proxies `git` subcommands would violate the spirit of this
design standard even if it were technically easy to implement.

### Existing documentation direction

The repository already contains git- and GIT-framework-oriented reference material under
`docs/references/`, including
[docs/references/GIT_Analysis_for_ArchGuard.md](/home/yale/work/archguard/docs/references/GIT_Analysis_for_ArchGuard.md).
Those documents point toward ArchGuard as a structure + metrics + feedback system, which fits
"aggregated evolution analysis" better than "raw git wrapper".

---

## Problem Statement

Agents using ArchGuard today can inspect the present architecture and test state, but they still
lack answers to several recurring decision-time questions:

1. Before changing a target, is it a high-risk area?
2. If a file or package changes, what else should the agent inspect to avoid partial fixes?
3. Which parts of the system look structurally separated but keep changing together?
4. Which areas are good refactor candidates because instability and coupling keep accumulating?

The missing capability is not "access to git"; it is a persisted evolution model aligned with the
same project root and scope semantics as the current query layer.

---

## Proposed Design

### Summary

Introduce a separate `archguard_analyze_git` workflow that scans recent git history and persists
aggregated evolution data under `.archguard`. Then expose a minimal MCP query surface focused on
four high-value questions: change context, co-change, change risk, and ownership. The first
iteration operates at file and package granularity only, with explicit limitations around rename
handling, branch coverage, and approximation semantics.

### Design Principles

#### 1. Separate history analysis from static analysis

Do not extend `archguard_analyze` with default git scanning. History scans are materially more
expensive, have different freshness expectations, and will often be unnecessary for a given MCP
session.

The git workflow should therefore be explicit:

1. `archguard_analyze(...)` for structure/test refresh
2. `archguard_analyze_git(...)` for opt-in history refresh
3. git-history query tools for bounded reads

This mirrors the existing test-analysis workflow, where opt-in data production precedes opt-in
queries.

#### 2. Persist aggregates, not commit streams

The stored artifact should not be a general-purpose commit database exposed through MCP. It should
be a compact, query-oriented index derived from history, containing:

- analysis window metadata
- per-file and per-package churn metrics
- ownership aggregates
- co-change adjacency data
- derived risk factors

The unit of value is "aggregated answerable state", not "full git fidelity".

#### 3. Align target identifiers with existing ArchGuard concepts

Initial target kinds:

- `project`
- `package`
- `file`

`entity` should be deferred. Entity-history mapping is much less reliable because method moves,
renames, splits, and extract-refactorings destroy naive continuity. The first release should not
pretend to be more precise than the data supports.

#### 4. Prefer task-oriented tools over broad report tools

The first MCP surface should stay intentionally small. Agents rarely need raw historical tables;
they need high-level answers in the middle of another task.

### Proposed Artifacts

Store git-history query artifacts under:

`<projectRoot>/.archguard/query/git-history/`

Recommended files:

- `manifest.json`
  - analysis window, default branch / analyzed HEAD, generatedAt, version
- `package-metrics.json`
  - package-level churn, ownership, co-change summary, risk factors
- `file-metrics.json`
  - file-level churn, ownership, risk factors
- `cochange-index.json`
  - bounded adjacency index for package and file targets

This keeps the new data clearly query-oriented and colocated with the existing query artifacts,
without overloading ArchJSON itself with temporal concerns.

### Proposed CLI / MCP Analyze Entry Point

#### `archguard_analyze_git`

Purpose:

- scan git history for a bounded time window
- build the git-history query artifacts
- reuse `projectRoot` resolution conventions from current MCP tools

Suggested parameters:

- `projectRoot?: string`
- `sinceDays?: number`
- `maxCommits?: number`
- `includeMerges?: boolean`
- `granularities?: ('package' | 'file')[]`

Design notes:

- default to a bounded recent window, not full repository history
- operate on the current checked-out branch / HEAD only in v1
- return summary metadata, not large detail tables

### Proposed MCP Query Tools

#### 1. `archguard_get_change_context`

Purpose:

Return the small set of history signals an agent needs before editing a target.

Suggested input:

- `projectRoot?: string`
- `targetType: 'package' | 'file'`
- `target: string`

Suggested output:

- target summary
- recent churn
- owner concentration
- top co-change neighbors
- risk hints
- analyzed window metadata

Why this tool exists:

It compresses the most common "what should I know before touching this?" workflow into one call.
This is more aligned with MCP usage than forcing the agent to stitch together 3-4 narrower
history tools in the common case.

#### 2. `archguard_get_cochange`

Purpose:

Return the strongest co-change neighbors for a package or file.

Suggested input:

- `projectRoot?: string`
- `targetType: 'package' | 'file'`
- `target: string`
- `topN?: number`

Suggested output:

- normalized co-change neighbors
- raw joint-change counts
- support metadata for the current analysis window

Important limitation:

The description must state that co-change is an evolutionary signal, not proof of direct runtime
or static dependency.

#### 3. `archguard_get_change_risk`

Purpose:

Return a bounded, explainable risk score for changing a target.

Suggested input:

- `projectRoot?: string`
- `targetType: 'package' | 'file'`
- `target: string`

Suggested output:

- `riskScore`
- `riskLevel`
- factor breakdown:
  - churn
  - authorCount
  - ownerConcentration
  - cochangeBreadth
  - recency

Design note:

This must be explainable. The score is only useful if an agent can see which factors drove it.

#### 4. `archguard_get_ownership`

Purpose:

Return the maintainer concentration view for a package or file.

Suggested input:

- `projectRoot?: string`
- `targetType: 'package' | 'file'`
- `target: string`

Suggested output:

- ranked contributors
- primary owner share
- activeMaintainers count
- bus-factor proxy

Why keep this separate from `change_context`:

Ownership questions occur independently of edit planning, and the output can be larger than what
fits comfortably into the condensed context tool.

### Deliberately Deferred Tools

The following are plausible future tools, but should not be in v1:

- `archguard_get_evolution_trends`
- `archguard_get_refactor_candidates`
- `archguard_get_coupling_mismatch`

They are valuable, but each depends on the same base index. They should wait until the first
history pipeline proves useful and bounded in practice.

---

## Data Model Guidance

### Package-level metrics

For each package:

- `commitCount`
- `activeDays`
- `addedLines`
- `deletedLines`
- `authorCount`
- `primaryOwner`
- `primaryOwnerShare`
- `topCochangeNeighbors`
- `riskFactors`

### File-level metrics

For each file:

- same core metrics as package
- package membership
- top co-change neighbors

### Co-change edge shape

Each edge should carry both raw count and normalized strength:

- `jointChangeCount`
- `strength`
- `windowCoverage`

Without normalization, the busiest files will dominate every ranking and the query becomes much
less useful.

### Risk model

The first risk model should remain intentionally simple and auditable:

- high churn increases risk
- more distinct recent authors increases coordination risk
- low owner concentration increases ambiguity risk
- wide co-change neighborhood increases blast-radius risk
- very recent activity increases instability risk

This is a heuristic score, not a predictive defect model. The tool description should say so.

---

## Alternatives Considered

### Alternative A: Add thin wrappers around common git commands

Rejected because:

- it duplicates tools the user or agent can already run directly
- it produces large, low-signal outputs
- it does not align with ArchGuard's query-first architecture
- it adds little durable value beyond shell access

### Alternative B: Fold git-history into `archguard_analyze`

Rejected because:

- most analysis sessions do not need history
- git scanning has different performance and freshness characteristics
- it would penalize the common structure-only path

### Alternative C: Support entity history in the first iteration

Rejected because:

- identity continuity at method/entity level is fragile
- rename and refactor noise would create false confidence
- file/package history already covers the highest-value agent workflows

### Alternative D: Add history fields directly to `archguard_summary`

Rejected for v1 because:

- `archguard_summary` is intentionally compact and broadly applicable
- history data requires separate opt-in analysis
- extending the summary too early risks mixing static and temporal semantics before the new
  pipeline is proven

---

## Risks

### 1. Misleading precision

History metrics can appear more authoritative than they are, especially around renames, squashed
commits, or merge-heavy workflows.

Mitigation:

- keep v1 at file/package level
- embed limitations in tool descriptions
- expose factor breakdowns instead of opaque scores

### 2. Unbounded output growth

Co-change data can become dense on large repositories.

Mitigation:

- store a bounded top-N adjacency list per target
- keep MCP queries focused on one target at a time
- avoid "return full graph" tools in v1

### 3. Drift from existing query conventions

If git-history introduces a parallel loading or routing model, the MCP surface becomes harder to
reason about.

Mitigation:

- mirror existing `projectRoot` resolution
- keep analyze and query separation consistent with current MCP patterns
- colocate artifacts under `.archguard/query`

### 4. Scope mismatch for multi-scope projects

History is naturally repository-wide, while current query engines are scope-bound.

Mitigation:

- start with repository-root history artifacts keyed by package/file path
- keep static scope selection out of the history query contract in v1
- revisit static-history scope joins only after practical usage reveals the need

---

## Testing and Validation

### Unit

- history aggregation from synthetic commit/file-touch inputs
- co-change strength normalization
- risk-score factor calculation
- ownership aggregation and bus-factor proxy calculation
- artifact load / missing-artifact error paths

### Integration

- temporary git repositories with controlled histories
- `archguard_analyze_git` writes expected artifacts under `.archguard/query/git-history`
- MCP tools return bounded JSON text responses and actionable recovery messages

### Regression / Compatibility

- no behavior change to `archguard_analyze`
- no behavior change to existing query tools when git-history data is absent
- git-history tools return explicit guidance when analysis has not been run yet

---

## Open Questions

1. Should v1 persist only the latest analyzed window, or allow multiple named windows?
2. Should package boundaries reuse existing package-stat grouping logic where possible, or should
   git-history define its own normalized package path rules?
3. Should `archguard_get_change_context` include static architecture snippets in the future, or
   stay strictly history-only?

---

## Recommended Scope Cut

Implement v1 with exactly one analyze tool and four query tools:

- `archguard_analyze_git`
- `archguard_get_change_context`
- `archguard_get_cochange`
- `archguard_get_change_risk`
- `archguard_get_ownership`

Architectural corrections applied during review:

- no raw git wrappers
- no summary-surface expansion in v1
- no entity-level history mapping in v1
- no default integration into `archguard_analyze`
