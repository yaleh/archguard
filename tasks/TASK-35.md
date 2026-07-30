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

- [x] Running the installer twice succeeds and leaves one enabled plugin.
      (Verified against a stateful fake `claude` CLI mirroring 2.1.220's
      command surface in an isolated CLAUDE_CONFIG_DIR — the installer logic
      under test is real; the CLI is simulated. REAL so far as the CLI allows:
      real `claude plugin marketplace add` succeeds twice; the plugin install
      step stops at the unpublished-npm boundary — see Evidence.)
- [x] Claude installation does not depend on a global `archguard` command.
      (REAL: installer runs green with no `archguard` on PATH; static checks
      prove it never invokes npm, packs tarballs, or requires the binary.)
- [x] The installer does not install, build, or globally mutate native
      Tree-sitter runtime or grammar packages. (REAL: static invariants +
      the installer never invokes npm at all; Claude Code's own plugin-cache
      npm install resolves the WASM-baseline closure per TASK-31.)
- [x] The installer never writes to deprecated `~/.claude/mcp.json`.
      (REAL: tests assert the file is never created; the only mutation path
      is residue REMOVAL.)
- [x] Legacy ArchGuard-only residue is removed without altering unrelated MCP
      entries. (REAL: fixture tests + real-claude boundary run both assert
      unrelated `mcpServers` entries and other keys survive byte-for-byte
      semantics.)
- [ ] A clean install and an upgrade both end with `claude mcp list` reporting
      ArchGuard connected. (UNCHECKED — stops at the environment boundary:
      @yalehwang/archguard-claude-plugin / @yalehwang/archguard are not
      published and publishing is forbidden, so Claude Code's npm fetch fails
      with E404. See Evidence for the real-CLI boundary run.)
- [x] README matches the actual commands and package names.

## Definition of Done

- [x] TASK-31 is complete.
- [x] Installer and documentation changes are committed.
- [x] Idempotency, clean-install, and upgrade evidence are appended here.

## Coordination

TASK-34 is superseded. TASK-36 begins after this task establishes the canonical
installed executable that Codex should invoke.

## Evidence (landed 2026-07-30)

Implementation:
- `scripts/install-claude-user-scope.sh` rewritten as a thin wrapper over the
  new `scripts/install-claude-user-scope.mjs` (testable exported functions:
  `cleanupDeprecatedMcpJson`, `planActions`, `isLegacyArchguardEntry`,
  `findLegacyPlugins`). The installer: cleans deprecated mcp.json residue →
  `claude plugin marketplace add|update archguard` →
  `claude plugin install|update archguard@archguard --scope user` →
  re-enable if disabled → verify exactly one enabled instance. No npm
  invocation, no build, no global binary, no directory-source registration,
  no `--skip-build` (build step removed entirely).
- Docs: README.md install section + parser-runtime statement;
  docs/user-guide/mcp-usage.md helper-script section rewritten to the
  npm-source marketplace flow.

Tests (NEW: tests/integration/installer-claude-user-scope.test.ts, 25 tests;
fixture: tests/fixtures/installer/fake-claude.mjs):
- cleanupDeprecatedMcpJson: 8 fixture tests (absent, archguard-only → file
  deleted, mixed entries → unrelated preserved, residue-free byte-identical,
  malformed never clobbered, non-legacy shape kept, idempotent, path forms).
- planActions: 4 pure tests (add/install on clean slate, update/update on
  second run, install when marketplace exists, legacy-marketplace plugin
  ignored).
- Fake-CLI end-to-end (isolated HOME + CLAUDE_CONFIG_DIR, PATH without
  `archguard`): clean install, .sh wrapper path, run-twice idempotency with
  invocation-log assertions (1 add + 1 install, then 1 marketplace update +
  1 plugin update), upgrade 0.1.30 → 0.1.31 via manifest bump, re-enable of
  disabled plugin, residue cleanup during install, archguard-only residue
  file deletion, loud failure when marketplace lacks the plugin.
- Static invariants: no `npm install -g|pack|run build`, no `-g|--global`,
  no `command -v archguard`, no native tree-sitter references, wrapper has
  no executable mcp.json reference.
- REAL-CLI boundary test (real `claude` 2.1.220, isolated HOME +
  CLAUDE_CONFIG_DIR, real repo marketplace source): marketplace registered
  for real (verified via `claude plugin marketplace list --json`); deprecated
  mcp.json residue really removed with the unrelated entry preserved; plugin
  install then fails at the unpublished-npm boundary with E404 on
  @yalehwang/archguard-claude-plugin@0.1.31 (registry E404 confirmed twice
  by direct CLI probes on 2026-07-30). This is why the `claude mcp list`
  connected AC remains unchecked: the installer is correct up to the exact
  point where Claude Code fetches the plugin package from npm, which is
  impossible without publishing (forbidden).

REAL vs SIMULATED summary:
- REAL: residue cleanup (fixtures + real-CLI run), no-global-binary (PATH
  without archguard), no-native-mutation (static + no npm at all), never
  writes deprecated file, marketplace add/update idempotency (real CLI),
  README/docs accuracy.
- SIMULATED: claude CLI plugin install/update/enable/list responses in the
  idempotency + upgrade tests (stateful fake mirroring real 2.1.220 JSON
  shapes; the marketplace manifest and versions come from real fixture
  files). The npm registry is not simulated here at all — it is simply
  unreachable for the unpublished packages (E404 boundary).

Gate: `npx vitest run` in the worktree — 274 passed | 2 skipped files,
4284 passed | 11 skipped tests (base was 4259 passed; +25 new), exit 0.
`npm run type-check` clean. ESLint on changed files: 0 errors.
