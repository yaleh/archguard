# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the ArchGuard project. ADRs document significant architectural decisions, their context, and consequences.

## Index

| ID | Title | Status | Date | Related |
|----|-------|--------|------|---------|
| [ADR-001](./001-goatlas-plugin-composition.md) | GoAtlasPlugin 使用组合模式 | 已采纳 | 2026-02-24 | [Proposal 16](../proposals/16-go-architecture-atlas.md), [Plan 16](../plans/16-go-architecture-atlas-implementation-plan.md) |
| [ADR-002](./002-archjson-extensions.md) | ArchJSON extensions 字段设计 | 已采纳 | 2026-02-24 | [Proposal 16](../proposals/16-go-architecture-atlas.md), [Plan 16](../plans/16-go-architecture-atlas-implementation-plan.md) |

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
- [Proposal XX](../proposals/xx-file.md)
```

---

**Last Updated**: 2026-02-24
