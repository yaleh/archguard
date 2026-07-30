---
id: TASK-35
title: Finalize the installer for the npm-source Claude plugin
status: ready
labels:
  - install
  - packaging
  - claude-plugin
parent: null
children: []
extra: {}
---
## Proposal

Finalize `scripts/install-claude-user-scope.sh` after TASK-31 produces the
npm-installed Claude plugin. The script must install/register the marketplace
and plugin idempotently without separately installing a global ArchGuard CLI
for Claude Code.

The current working-tree prototype builds and globally installs an npm tarball,
then registers a directory-source plugin. That split installation masks missing
plugin dependencies and is no longer the selected design.

## Blocked

Blocked by TASK-31. Do not finalize the script until the npm package name,
published file layout, and MCP entry path are stable.

## Plan

1. Replace directory-source assumptions with the npm-source marketplace flow
   established by TASK-31.
2. Remove the global `npm install -g` prerequisite from the Claude-only path.
3. Make marketplace add/update and plugin install/update idempotent.
4. Detect and safely remove the deprecated ArchGuard entry from
   `~/.claude/mcp.json` without deleting unrelated user configuration.
5. Document native auto-detection, WASM fallback, and the force-runtime
   diagnostic setting. State explicitly that the normal installer does not
   install native Tree-sitter packages.
6. Verify repeated installation and upgrade from an older plugin version.

## Touches

- scripts/install-claude-user-scope.sh (npm-source marketplace flow, idempotency, deprecated mcp.json cleanup)
- plugin/** (registration references only — package coordinates/paths the installer points at)
- README.md (install docs matching actual commands)
- docs/** (native auto-detect / WASM fallback / force-runtime install docs)
- tests/** (installer idempotency, clean-install, upgrade, mcp.json-residue cleanup tests — in ISOLATED config dirs)
- tasks/TASK-35.md

Core/plugin packaging (TASK-31, done) and Codex integration (TASK-36) are out of scope.

## Acceptance Criteria

- [ ] Running the installer twice succeeds and leaves one enabled plugin.
- [ ] Claude installation does not depend on a global `archguard` command.
- [ ] The installer does not install, build, or globally mutate native
      Tree-sitter runtime or grammar packages.
- [ ] The installer never writes to deprecated `~/.claude/mcp.json`.
- [ ] Legacy ArchGuard-only residue is removed without altering unrelated MCP
      entries.
- [ ] A clean install and an upgrade both end with `claude mcp list` reporting
      ArchGuard connected.
- [ ] README matches the actual commands and package names.

## Definition of Done

- [ ] TASK-31 is complete.
- [ ] Installer and documentation changes are committed.
- [ ] Idempotency, clean-install, and upgrade evidence are appended here.

## Coordination

TASK-34 is superseded. TASK-36 begins after this task establishes the canonical
installed executable that Codex should invoke.
