# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the ArchGuard project. ADRs document significant architectural decisions, their context, and consequences.

## Index

| ID | Title | Status | Date | Related |
|----|-------|--------|------|---------|
| [ADR-001](../../quay-adr/ADR-001.md) | GoAtlasPlugin 使用组合模式 | 已采纳 | 2026-02-24 | [Proposal 16](../archive/refactoring/proposals/16-go-architecture-atlas.md), [Plan 16](../archive/refactoring/plans/16-go-architecture-atlas-implementation-plan.md) |
| [ADR-002](../../quay-adr/ADR-002.md) | ArchJSON extensions 字段设计 | 已采纳 | 2026-02-24 | [Proposal 16](../archive/refactoring/proposals/16-go-architecture-atlas.md), [Plan 16](../archive/refactoring/plans/16-go-architecture-atlas-implementation-plan.md) |
| [ADR-003](../../quay-adr/ADR-003.md) | Inline SVG Style Patching for librsvg Compatibility | Accepted | 2026-03-05 | `src/mermaid/renderer.ts`, `tests/unit/mermaid/edge-style-inline.test.ts` |
| [ADR-004](../../quay-adr/ADR-004.md) | CLI 与 MCP 必须共享单一分析写盘路径 | Proposed | 2026-03-07 | [proposal-mcp-analyze-tool.md](../proposals/proposal-mcp-analyze-tool.md) |
| [ADR-005](../../quay-adr/ADR-005.md) | 缺省分析自动发现主语言并使用项目级 scope | Proposed | 2026-03-08 | [proposal-default-analysis-language-scopes.md](../proposals/proposal-default-analysis-language-scopes.md) |
| [ADR-006](../../quay-adr/ADR-006.md) | MCP Tool 设计规范 | Accepted | 2026-03-12 | `src/cli/mcp/mcp-server.ts` |
| [ADR-007](../../quay-adr/ADR-007.md) | CLI 与 MCP 接口一致性规范 | Accepted | 2026-03-13 | `src/cli/commands/query.ts`, `src/cli/mcp/mcp-server.ts`, `tests/integration/cli-mcp/` |
| [ADR-008](../../quay-adr/ADR-008.md) | 分析前 LLM 语义探索层 | Proposed | 2026-03-30 | [proposal-llm-semantic-exploration.md](../proposals/proposal-llm-semantic-exploration.md) |

## How to Read ADRs

Each ADR follows a standard structure:

- **Context and Problem Statement**: What problem are we trying to solve?
- **Decision Drivers**: What constraints and requirements influence the decision?
- **Considered Options**: What alternatives were evaluated?
- **Decision**: What was chosen and why?
- **Consequences**: What are the positive and negative impacts?
- **Implementation**: How is the decision being implemented?

## Contributing

When making a significant architectural decision:

1. Create a new ADR file using the next sequential number
2. Follow the template structure
3. Link related proposals, plans, and ADRs
4. Update this index file
5. Submit for team review

## ADR Lifecycle

```
Proposed → Accepted → Implemented → Deprecated → Superseded
```

- **Proposed**: Initial draft for review
- **Accepted**: Decision approved by team
- **Implemented**: Decision has been implemented
- **Deprecated**: Decision is no longer recommended
- **Superseded**: Replaced by a newer ADR

## Template

```markdown
# ADR-XXX: [Title]

**Status**: [Proposed | Accepted | Implemented | Deprecated | Superseded]
**Date**: YYYY-MM-DD
**Context**: [Related proposals/plans]
**Decision Makers**: ArchGuard Team

---

## Context

[Describe the problem or opportunity]

## Decision Drivers

- [Constraint 1]
- [Constraint 2]
- [Requirement 1]

## Considered Options

### Option A: [Description]

**Pros**:
- Pro 1
- Pro 2

**Cons**:
- Con 1
- Con 2

### Option B: [Description]

[...]

## Decision

[Chosen option and rationale]

## Consequences

### Positive

- Consequence 1
- Consequence 2

### Negative

- Consequence 1
- Consequence 2

## Implementation

[How the decision is being implemented]

## Related Decisions

- [ADR-XXX](./xxx-file.md)
- [Proposal XX](../archive/refactoring/proposals/xx-file.md)
```

---

**Last Updated**: 2026-03-30
