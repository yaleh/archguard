---
doc_type: feature-qa
feature: 2026-06-22-registry-agent-guidance-contract
status: passed
reviewed: 2026-06-22
---

# registry-agent-guidance-contract QA

## Validation Commands

- `npm test -- tests/unit/cli/metadata-registry.test.ts`
  - Result: passed
  - Evidence: 12 tests passed, including freshness/docs policy failure cases and metadata import side-effect regression.
- `npm run type-check`
  - Result: passed
  - Evidence: `tsc --noEmit` exited 0.
- `npm run build`
  - Result: passed
  - Evidence: build completed and fixed dist imports.
- `npm run docs:check`
  - Result: passed after build
  - Evidence: `Metadata docs are up to date.`
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`
  - Result: passed
  - Evidence: 2 tests passed; CLI structured help, MCP metadata, and docs blocks remained aligned.

## Scenario Coverage

- `AgentGuidance` supports `avoidWhen` and `freshness`: covered by type-check and registry test assertions.
- `DocsContract` exists for agent-facing generated surfaces: covered by registry test assertions and validator failure case.
- Artifact-backed workflow tools declare freshness: covered by `workflowDependentMcpTools` test loop and validator failure case.
- Metadata import remains side-effect free: covered by existing import regression that checks metadata sources do not import `commander` or `@modelcontextprotocol`.
- Existing CLI/MCP/docs behavior unchanged: covered by metadata surface E2E and docs check.

## Residual Risk

- No blocking residual risk for this non-functional contract feature.

## Verdict

- Status: passed
