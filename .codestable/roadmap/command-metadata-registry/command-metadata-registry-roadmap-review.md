---
doc_type: roadmap-review
roadmap: command-metadata-registry
status: passed
reviewed: 2026-06-21
round: 2
---

# command-metadata-registry roadmap Review

## 1. Scope And Inputs

- Roadmap: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`
- Items: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-items.yaml`
- Related docs:
  - `.codestable/attention.md`
  - `.codestable/architecture/ARCHITECTURE.md`
  - `docs/adr/006-mcp-tool-design-standards.md`
  - `docs/adr/007-cli-mcp-interface-parity.md`
  - `README.md`
  - `docs/user-guide/cli-usage.md`
  - `docs/user-guide/mcp-usage.md`
- Code facts checked:
  - `src/cli/index.ts`
  - `src/cli/commands/analyze.ts`
  - `src/cli/commands/query.ts`
  - `src/cli/mcp/mcp-server.ts`
  - `src/cli/mcp/analyze-tool.ts`
  - `src/cli/mcp/tools/*.ts`
  - `package.json`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent `b0aaa8e3-ce5a-4ce9-a4db-04a85a2ce839`
- Raw output: agent activity captured via Paseo; findings merged below.
- Merge policy: findings were locally fact-checked against roadmap, docs, and code. The two blocking findings were addressed in roadmap round 2 before this verdict.
- Gate effect: none.

## 2. Roadmap Summary

- Goal completion signal: one typed metadata registry inventories the current 7 CLI commands and 24 MCP tools, then drives or verifies CLI help/catalog, `archguard help --json`, MCP descriptions/parameter descriptions, README/user-guide/help blocks, and agent surface docs.
- Module split: Metadata Model, Registry Source, Surface Adapters, Drift Verification.
- Interface contracts: roadmap defines `ArchGuardMetadataEntry`, `AgentGuidance`, `CliCommandMetadata`, `McpToolMetadata`, and docs block contracts.
- Items: 4 planned items; minimal loop is `command-metadata-registry-core`.
- Dependency shape: DAG. `cli-help-from-registry` and `mcp-agent-descriptions-from-registry` depend on core; `docs-agent-surface-generation` depends on both consumer migrations.

## 3. Findings

### blocking

- none

### important

- none

### nit

- [ ] RMR-001 `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md#2` `related_requirements: []` is empty.
  - Evidence: no upstream requirement doc exists for this internal refactor.
  - Impact: non-blocking; the roadmap scope is clear without a requirement.
  - Follow-up: optional future `cs-req` backfill if this becomes a longer-lived product capability.

### suggestion

- [ ] RMR-002 Consider making a dedicated ADR for the command metadata registry once item 1 lands.
  - Evidence: the roadmap now requires either a new ADR or updates to ADR-006 / ADR-007.
  - Impact: not needed before user review; should be decided during `command-metadata-registry-core` design.

### learning

- ADR-006 and ADR-007 already contained most of the desired policy; this roadmap is valuable because it turns those prose standards into typed metadata and drift tests.
- ADR-007 says MCP verification must not rely on a Claude Code-hosted server; the roadmap correctly preserves that constraint for MCP adapter tests.

### praise

- Scope is controlled: no core analysis behavior, QueryEngine result, diagram output, or ArchJSON changes are included.
- The roadmap now pins the concrete 7-command / 24-tool baseline, making inventory completeness objectively testable.
- Drift-test ownership is split by consumer layer, which makes each feature independently reviewable.

## 4. User Review Focus

- Confirm the structured help entrypoint: `archguard help --json`.
- Confirm generated or verified docs blocks are acceptable in `README.md`, `docs/user-guide/cli-usage.md`, `docs/user-guide/mcp-usage.md`, and an agent-surface doc.
- Confirm top-level CLI-only commands such as `diff` and `check` should live in the same registry with CLI/docs/agent surfaces and no MCP mapping.

## 5. Residual Risk

- Zod schema shape remains near handlers while descriptions move to or are checked against metadata. This keeps behavior safer but requires good tests to prevent mixed-source drift.
- `diff` and `check` have less ADR coverage than query/MCP surfaces; item 1 mitigates this by requiring help-output cross-checks.
- Generated docs can become noisy if marker blocks are too broad; item 4 mitigates this with deterministic marker-bounded blocks and stale-doc checks.

## 6. Verdict

- Status: passed
- Next: give roadmap and review summary to the user for the first CodeStable confirmation gate. Only after explicit user confirmation should feature design begin.

