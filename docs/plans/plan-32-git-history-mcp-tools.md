# Plan 32 — Git History MCP Tools

## Scope

This plan implements
[proposal-git-history-mcp-tools.md](../proposals/proposal-git-history-mcp-tools.md).
The target is a new opt-in git-history analysis pipeline plus four bounded MCP query tools:
`archguard_get_change_context`, `archguard_get_cochange`, `archguard_get_change_risk`, and
`archguard_get_ownership`. The first iteration is limited to repository-root history indexed at
package and file granularity.

## Dependencies and Sequencing

- Phase 1 depends on no new infrastructure outside the current query/artifact layout.
- Phase 2 depends on Phase 1 artifact schemas and loaders being stable.
- Phase 3 depends on Phase 2 query methods so the MCP layer stays thin.
- Existing `archguard_analyze` and current query/test-analysis tools remain unchanged.

## Phase 1 — Git History Artifact Foundation

### Objectives

Introduce a separate git-history analysis path that writes bounded query artifacts under
`.archguard/query/git-history`, without touching the default static-analysis workflow.

### Acceptance Criteria

- A dedicated `archguard_analyze_git` path exists and does not change `archguard_analyze`.
- Git-history artifacts are written under a stable directory rooted at `.archguard/query/git-history`.
- Missing-history conditions can be detected independently from existing query-artifact errors.
- The repository remains buildable after each stage.

### Stages

#### Stage 1.1 — Define Artifact Types and Storage Contract

- Change budget: <=200 lines
- Tasks:
  - Add history artifact interfaces for manifest, package metrics, file metrics, and co-change index.
  - Define versioning and minimal metadata fields such as `generatedAt`, analysis window, and HEAD ref.
  - Add unit tests or type-level checks around serialization shape where applicable.
- Tests:
  - Type-check for new interfaces and imports.
  - Unit tests for manifest serialization helpers if helpers are added.
- Exit criteria:
  - History artifact schema is explicit and imported from a single source of truth.

#### Stage 1.2 — Add History Analysis Writer

- Change budget: <=200 lines
- Tasks:
  - Introduce the core writer that collects bounded git-history aggregates for file and package targets.
  - Persist artifacts into `.archguard/query/git-history`.
  - Keep implementation limited to current HEAD / recent-window scanning.
- Tests:
  - Unit tests with temporary git repositories covering churn, ownership, and co-change aggregation.
  - Integration-style test proving artifact files are created in the expected directory.
- Exit criteria:
  - Running the new analysis path produces deterministic artifacts for a controlled test repository.

#### Stage 1.3 — Wire `archguard_analyze_git`

- Change budget: <=200 lines
- Tasks:
  - Register a separate MCP analyze tool and/or shared analyze entry path for git-history refresh.
  - Reuse existing `projectRoot` resolution conventions.
  - Return a compact summary response describing the analyzed window and artifact location.
- Tests:
  - MCP tool test for successful analysis response.
  - Error-path test when the target directory is not a git repository.
- Exit criteria:
  - `archguard_analyze_git` can refresh history artifacts without affecting existing analyze behavior.

## Phase 2 — Query-Layer Read Model

### Objectives

Load git-history artifacts into a thin read model and expose deterministic query methods for the
four target scenarios.

### Acceptance Criteria

- Query methods load persisted history data without invoking git commands on each MCP request.
- The read model supports package and file targets only.
- Each query method returns bounded, structured results with no raw commit streams.

### Stages

#### Stage 2.1 — Add History Loader and Error Surface

- Change budget: <=200 lines
- Tasks:
  - Add loader utilities for `.archguard/query/git-history`.
  - Define explicit "no git history data found" handling parallel to existing query/test-analysis patterns.
  - Keep history loading separate from `QueryEngine` if that reduces coupling; do not force-fit temporal data into ArchJSON.
- Tests:
  - Loader tests for happy path, missing directory, missing files, and version mismatch.
  - Regression test proving static query loading remains unchanged.
- Exit criteria:
  - A history read model can be loaded or rejected with actionable errors.

#### Stage 2.2 — Implement `getCochange()` and `getOwnership()`

- Change budget: <=200 lines
- Tasks:
  - Add read-model query methods for top co-change neighbors and ownership summaries.
  - Normalize co-change output to include both raw support and normalized strength.
  - Keep target validation strict: only `package` and `file`.
- Tests:
  - Unit tests for top-N behavior, normalization, empty-target handling, and ownership ranking.
- Exit criteria:
  - Co-change and ownership queries are stable enough for MCP exposure.

#### Stage 2.3 — Implement `getChangeRisk()` and `getChangeContext()`

- Change budget: <=200 lines
- Tasks:
  - Add explainable risk-score calculation from bounded factors.
  - Add a condensed context query that composes churn, ownership, co-change, and risk hints.
  - Ensure `change_context` remains a compact summary rather than a general report dump.
- Tests:
  - Unit tests for factor weighting, explanation fields, and context output bounds.
  - Negative tests for unknown targets and absent history data.
- Exit criteria:
  - All four query methods exist in the read layer and return bounded structured results.

## Phase 3 — MCP Surface and Documentation

### Objectives

Expose the history query model through MCP using repository-standard naming, descriptions, schema
documentation, and actionable error responses.

### Acceptance Criteria

- Four new MCP query tools are registered and callable.
- Tool descriptions inline the main limitations: history is aggregated, co-change is not proof of dependency, and results depend on analyzed window / current branch.
- User-facing docs explain the workflow: run `archguard_analyze_git` first, then query.

### Stages

#### Stage 3.1 — Register MCP Query Tools

- Change budget: <=200 lines
- Tasks:
  - Add MCP registrations for `archguard_get_change_context`, `archguard_get_cochange`, `archguard_get_change_risk`, and `archguard_get_ownership`.
  - Reuse `projectRoot` conventions from `mcp-server.ts`.
  - Keep parameter schemas narrow and explicit.
- Tests:
  - MCP server tests verifying registration and argument validation.
  - Query-tool tests for successful responses and missing-history guidance.
- Exit criteria:
  - All four tools are discoverable and callable through the MCP server.

#### Stage 3.2 — Document Workflow and Limits

- Change budget: <=200 lines
- Tasks:
  - Update README and MCP usage docs with the new history workflow.
  - Add examples emphasizing pre-change review scenarios rather than raw git inspection.
  - Document v1 limitations and non-goals explicitly.
- Tests:
  - Docs review for consistency with tool names and parameter contracts.
  - Optional smoke test on README/MCP examples if the repo has a docs-validation pattern available.
- Exit criteria:
  - User documentation matches the implemented workflow and does not overpromise entity-level precision.

## Test Strategy

- Use TDD for each stage: add failing unit or MCP tests before implementation where runtime behavior changes.
- Prefer temporary git repositories in tests over mocking raw git command output, so aggregation logic is exercised end-to-end.
- Keep regression coverage focused on ensuring current static-analysis and test-analysis workflows behave exactly as before.
- Add explicit tests for bounded outputs and recovery messages when history analysis has not been run.

## Risks and Mitigations

- Risk: The history read model drifts into a raw-git wrapper.
  Mitigation: Reject any stage that exposes commit lists, blame data, or generic git passthrough APIs.
- Risk: Entity-level expectations leak into v1 scope.
  Mitigation: Keep schemas and tests restricted to `package` and `file` target types only.
- Risk: Co-change output becomes too large on large repositories.
  Mitigation: Persist bounded top-N adjacency data and keep queries target-specific.
- Risk: History artifacts become coupled to ArchJSON internals.
  Mitigation: Store git-history artifacts as separate query data under `.archguard/query/git-history`.

## Proposed File Targets

- `src/cli/mcp/mcp-server.ts`
- `src/cli/mcp/analyze-tool.ts` or a new sibling history-analyze tool module
- `src/cli/query/` history read-model and loader files
- `src/types/` history artifact types
- `tests/unit/cli/mcp/` new history MCP tests
- `tests/unit/cli/query/` new history query tests
- `tests/integration/cli-mcp/` or a focused git-history integration test file
- `README.md`
- `docs/user-guide/mcp-usage.md`
