---
id: TASK-36
title: Add Codex user-scope MCP integration for archguard
status: needs-human
labels:
  - install
  - mcp
  - codex
parent: null
children: []
extra: {}
---
## Proposal

ArchGuard has no Codex MCP integration at any scope. Add it after the npm
package and Claude plugin establish a canonical, dependency-complete runtime.

Codex does not consume Claude plugin manifests, so its MCP configuration must
invoke an ArchGuard installation that owns its runtime dependencies. It must
not point into Claude's versioned plugin cache.

## Blocked

Blocked by TASK-31 and TASK-35. Those tasks determine the published package,
entry point, upgrade behavior, and runtime-selection configuration.

## Plan

1. Select a stable Codex executable path based on the npm artifact finalized by
   TASK-31/TASK-35.
2. Add an idempotent `[mcp_servers.archguard]` registration to the appropriate
   Codex config.
3. Preserve unrelated Codex configuration.
4. Forward the same `auto|native|wasm` parser-runtime setting supported by
   TASK-39.
5. Verify connection and at least one query plus one analysis through Codex.

## Acceptance Criteria

- [ ] Codex has one valid ArchGuard MCP entry at the intended user scope.
- [ ] The entry does not reference Claude's plugin cache or the source checkout.
- [ ] Re-running installation does not duplicate or corrupt TOML configuration.
- [ ] Query-only MCP startup works without native parsing.
- [ ] Analysis works with native when available and WASM when native is absent.
- [ ] A real Codex session connection and tool-call evidence is appended here.

## Definition of Done

- [ ] TASK-31 and TASK-35 are complete.
- [ ] Codex registration and documentation are committed.
- [ ] Clean-install and live connection evidence are recorded.

## Coordination

TASK-37/TASK-38/TASK-39 provide the portable parser runtime through TASK-31.
TASK-40 is a performance follow-up and does not block Codex correctness.
