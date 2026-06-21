---
doc_type: feature-design-review
feature: 2026-06-21-cli-help-from-registry
status: passed
reviewed: 2026-06-21
round: 2
---

# cli-help-from-registry feature design Review

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-design.md`
- Checklist: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-checklist.yaml`
- Roadmap: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`
- Related docs: `.codestable/attention.md`, `docs/adr/007-cli-mcp-interface-parity.md`
- Code facts checked: `src/cli/index.ts`, `src/cli/commands/*.ts`, `package.json`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent `accb4f24-702d-4958-8210-97fcf4e1a44a`
- Raw output: Paseo activity; findings merged.
- Merge policy: suggestions affecting design execution were fact-checked and added to design/checklist.
- Gate effect: none.

## 2. Design Summary

- Goal: registry-backed human/structured CLI help with `archguard help --json`.
- Key contracts: human help stays text; structured help is deterministic JSON.
- Steps: 6; includes runtime Commander traversal and help snapshot tests.
- Checks: 9; include CLI E2E and human help compatibility.
- Baseline / validation: CLI tests, build, type-check, built CLI JSON command.

## 3. Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- none

### learning

- Drift tests should enumerate Commander runtime objects rather than grep source.

### praise

- The separate `archguard help --json` entrypoint avoids breaking Commander built-in help.

## 4. User Review Focus

- Confirm `archguard help --json` is the desired structured help entrypoint.

## 5. Residual Risk

- Dynamic or nested Commander options may need careful traversal in implementation.

## 6. Verdict

- Status: passed
- Next: user design review.

