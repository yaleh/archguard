---
doc_type: feature-design-review
feature: 2026-06-21-command-metadata-registry-core
status: passed
reviewed: 2026-06-21
round: 2
---

# command-metadata-registry-core feature design Review

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-design.md`
- Checklist: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-checklist.yaml`
- Roadmap: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`
- Related docs: `.codestable/attention.md`, `docs/adr/006-mcp-tool-design-standards.md`, `docs/adr/007-cli-mcp-interface-parity.md`
- Code facts checked: `src/cli/index.ts`, `src/cli/commands/*.ts`, `src/cli/mcp/*.ts`, `src/cli/mcp/tools/*.ts`, `package.json`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent `accb4f24-702d-4958-8210-97fcf4e1a44a`
- Raw output: Paseo activity; findings merged.
- Merge policy: blocking/important findings were fact-checked and design/checklist were updated before this verdict.
- Gate effect: none.

## 2. Design Summary

- Goal: typed registry foundation for the current CLI/MCP baseline.
- Key contracts: registry model, 7 CLI commands, 24 MCP tools, explicit callFirst matrix.
- Steps: 5; inventory, parity, guidance, and validation are independently verifiable.
- Checks: 11; include real verification hints, side-effect-free import, and coverage threshold.
- Baseline / validation: type-check, registry unit tests, selected CLI/MCP regression tests.

## 3. Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- Metadata import side-effect checks should stay lightweight; the implementer can enforce this via dependency assertions or module import tests.

### learning

- Full callFirst coverage must target consuming tools, not only the analysis trigger tools.

### praise

- Baseline inventory and non-goals are crisp; this is a safe first minimal loop.

## 4. User Review Focus

- Confirm the explicit callFirst matrix is the right starting source of truth.

## 5. Residual Risk

- If new tools are added during implementation, the baseline test must be intentionally updated with the new registry entry.

## 6. Verdict

- Status: passed
- Next: user design review.

