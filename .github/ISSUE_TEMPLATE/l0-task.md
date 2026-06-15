---
name: L0 Agent Task
about: Queue an atomic plan phase for autonomous L0 execution
title: "[L0] "
labels: ""
assignees: ""
---

## Task

<!-- One-paragraph description of the specific work. Reference the plan file and phase. -->


See: `docs/plans/<plan-file>.md` § Phase <N>.

## DoD

<!-- Exact shell commands. The L0 loop runs these in order; all must exit 0. -->
- [ ] `npm run type-check`
- [ ] `npm test -- --reporter=verbose 2>&1 | tail -5`

## Constraints

<!-- Optional: anything the agent must not do. Leave empty if no constraints. -->
