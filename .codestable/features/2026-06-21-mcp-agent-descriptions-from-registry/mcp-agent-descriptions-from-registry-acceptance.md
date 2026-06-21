---
doc_type: feature-acceptance
feature: 2026-06-21-mcp-agent-descriptions-from-registry
status: passed
accepted: 2026-06-21
round: 1
---

# mcp-agent-descriptions-from-registry Acceptance Report

> Phase: 3 acceptance
> Acceptance date: 2026-06-21
> Design: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-design.md`

## 1. Interface Contract Check

- [x] MCP metadata helper: `src/cli/mcp/metadata.ts` exposes `mcpToolDescription()` and `mcpParamDescription()`.
- [x] MCP tool description wiring: all 24 registered tools use registry-rendered descriptions through `mcpToolDescription()`.
- [x] Parameter description contract: inline Zod descriptions are drift-tested against registry parameter metadata.
- [x] Schema contract: drift tests assert field names and required fields for all 24 tools.

## 2. Behavior And Decision Check

- [x] Tool names were not renamed.
- [x] MCP handlers, output payloads, and query semantics were not intentionally changed.
- [x] Registry descriptions include useWhen, callFirst, recovery, and limitations where applicable.
- [x] Renderer output is concise: summary sentence plus semicolon-separated agent guidance sentence.
- [x] Hosted Claude Code MCP was not used for validation.

## 3. Acceptance Scenario Check

- [x] Review report exists and passed: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-review.md`
- [x] QA report exists and passed: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-qa.md`
- [x] QA covered design required commands and review focus.
- [x] failed / blocked QA items: none
- [x] residual-risk does not carry a core verification gap.

## 4. Terminology Consistency

- Registry terms used consistently: MCP tool metadata, parameter metadata, agent guidance, callFirst, failureRecovery, limitations.
- Code mount points match the design: `src/cli/metadata/`, `src/cli/mcp/metadata.ts`, MCP registration modules, and MCP drift/E2E tests.

## 5. Architecture Merge

- [x] `.codestable/architecture/ARCHITECTURE.md` now records `src/cli/mcp/metadata.ts` as an MCP registry consumer.
- [x] Architecture notes now state that MCP tool descriptions are projected from the registry while handlers and schemas remain in existing MCP modules.

## 6. Requirement Backfill

- No standalone requirement document was referenced by this feature. This is part of the `command-metadata-registry` roadmap rather than a user-facing requirement update.

## 7. Roadmap Update

- [x] `.codestable/roadmap/command-metadata-registry/command-metadata-registry-items.yaml` updated for `mcp-agent-descriptions-from-registry`.
- [x] Goal state updated to mark this feature accepted and advance to the next feature.

## 8. Attention Candidates

- No new recurring environment note needs to be added to `.codestable/attention.md`.
- Learning candidate: schema drift tests should compare exact field sets plus requiredness, not only exposed fields as a subset.

## 9. Leftovers

- Future improvement: derive `workflowDependentMcpTools` from registry entries with `agent.callFirst` instead of maintaining a separate list.
- Known limitation: parameter descriptions are still mirrored inline and in registry metadata, guarded by drift tests.

## 10. Final Audit

- Verification evidence source: QA report.
- Aggregate commands:
  - `npm run type-check` -> exit 0
  - `npm test -- tests/unit/cli/mcp/mcp-metadata-drift.test.ts` -> exit 0
  - `npm test -- tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts` -> exit 0
  - `npm test -- tests/unit/cli/mcp/mcp-server.test.ts tests/unit/cli/mcp/analyze-tool.test.ts tests/unit/cli/mcp/git-history-mcp.test.ts tests/unit/cli/mcp/test-analysis-mcp.test.ts` -> exit 0
  - `npm test -- tests/integration/cli-mcp/analyze-equivalence.test.ts` -> exit 0
- Scenario review: re-verified 5 / trust-prior-verify 0.
- Deliverable review: code, registry metadata, drift tests, E2E tests, architecture, roadmap state all present.
- Full working tree review: current untracked CodeStable and source/test files are intentional roadmap deliverables.
- Diff cleanliness: pass.
- Knowledge exits: learning candidate recorded above; no attention update needed.
- Conclusion: passed.
