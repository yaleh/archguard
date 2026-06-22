---
doc_type: feature-review
feature: 2026-06-22-registry-install-config-contract
status: passed
reviewed: 2026-06-22
round: 1
---

# registry-install-config-contract Review

## Scope

- Design: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-design.md`
- Checklist: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-checklist.yaml`
- Diff reviewed: `src/cli/metadata/types.ts`, `src/cli/metadata/registry.ts`, `src/cli/metadata/validators.ts`, `src/cli/index.ts`, metadata tests, generated docs blocks.

## Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- The later `agent-onboarding-cli` feature should move `install`, `update`, and `config` from staged metadata into the enforced runtime baseline in the same change that registers their Commander command shells.

### residual-risk

- Staged metadata is visible to registry consumers that explicitly read `stagedCliCommands`, but structured help and docs currently render only runtime baseline commands. This is intentional until command shells exist.

## Test And QA Focus

- Verify `help` is now in the enforced runtime CLI baseline.
- Verify staged `install` / `update` / `config` metadata validates without entering runtime structured help.
- Verify surface policy and install/docs validators fail invalid combinations.
- Verify docs and metadata surface E2E remain green.

## Verdict

- Status: passed
