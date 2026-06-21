# mcp-agent-descriptions-from-registry Goal Feature Spec

## Roadmap Link

- Roadmap item: `mcp-agent-descriptions-from-registry`
- Feature type: `mixed`
- Dependencies: `command-metadata-registry-core`

## Source Documents

- Design: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-design.md`
- Checklist: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-checklist.yaml`
- Design review: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-design-review.md`
- Implementation review: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-review.md`
- QA report: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-qa.md`
- Acceptance report: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-acceptance.md`

## Core Running Path

Instantiate `createMcpServer()` in-process, list exposed MCP tool metadata, compare it with registry data for all 24 tools, then call representative tools to prove handler behavior is unchanged.

## Mandatory Commands

- `npm run type-check`
- `npm test -- tests/unit/cli/mcp/mcp-metadata-drift.test.ts`
- `npm test -- tests/unit/cli/mcp/mcp-server.test.ts tests/unit/cli/mcp/analyze-tool.test.ts tests/unit/cli/mcp/git-history-mcp.test.ts tests/unit/cli/mcp/test-analysis-mcp.test.ts`
- `npm test -- tests/integration/cli-mcp/analyze-equivalence.test.ts`

## Acceptance Evidence

- MCP list-tools metadata exposes exactly the same 24 tool names.
- Tool descriptions are registry-derived and expose concise useWhen, callFirst, failureRecovery, and limitations where applicable.
- Common parameter descriptions are registry-derived or explicitly covered by MCP drift tests.
- `archguard_get_file_entities` and `archguard_get_change_context` no longer use low-signal "Get..." style descriptions noted by ADR-006.
- Schema-shape assertions cover all 24 tools: top-level input field names and required/optional status remain unchanged.
- Representative in-process MCP calls prove output behavior remains unchanged.
- No verification relies on the current Claude Code hosted MCP process.

## Deliverables

- MCP metadata helper functions.
- Updated MCP tool/parameter description wiring.
- MCP metadata drift tests.
- 24-tool schema-shape preservation tests.
- Representative behavior-preservation tests.

## Cleanliness Rules

- Do not rename MCP tools.
- Do not change handlers, output payloads, query semantics, or Zod validation rules except for description text.
- Do not add stdout logging to MCP server code.
- Do not decompose `mcp-server.ts` unless required for a narrow helper extraction.

## Failure Recovery Boundaries

- If description wiring changes schema shape, revert the schema change and use a narrower helper.
- If in-process list-tools harness is missing, add a real test helper around project MCP code; do not use hosted Claude Code MCP as evidence.
- If a workflow-dependent description omits callFirst/failureRecovery, fix registry data or renderer before review.
- If representative behavior tests fail for unrelated baseline reasons, record baseline evidence and isolate whether this feature changed behavior.
