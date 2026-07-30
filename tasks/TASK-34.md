---
id: TASK-34
title: "Superseded: register Claude MCP through a global PATH command"
status: done
labels:
  - install
  - mcp
  - claude-code
  - superseded
parent: null
children: []
extra: {}
---
## Proposal

This task originally proposed repairing user-scope registration with:

```text
claude mcp add -s user archguard -- archguard mcp
```

That would replace the dead `~/.claude/mcp.json` residue, but it requires an
independently installed global CLI and leaves plugin installation unable to
resolve its own dependencies.

## Decision (2026-07-30)

Superseded by TASK-31. Claude Code's supported npm marketplace source performs
`npm install`, so the plugin can own and resolve its complete dependency tree.
The canonical Claude integration will therefore be an npm-installed plugin, not
a PATH-based user-scope MCP registration.

The old command remains useful only as a manual diagnostic or emergency
fallback; it is not a supported installation path.

## Acceptance Criteria

- [x] The PATH-based approach was evaluated against the plugin approach.
- [x] The canonical direction is recorded in TASK-31.
- [x] No production implementation is required in this superseded task.

## Definition of Done

- [x] Closed as superseded by TASK-31.

## Coordination

TASK-31 owns Claude plugin packaging. TASK-35 owns installer cleanup and must
remove or migrate any remaining legacy registration residue safely.
