---
id: TASK-31
title: Package archguard as an npm-installed Claude Code plugin
status: needs-human
labels:
  - enhancement
  - packaging
  - claude-plugin
parent: null
children:
  - TASK-37
  - TASK-38
  - TASK-39
  - TASK-40
  - TASK-41
extra: {}
---
## Proposal

Retire the deprecated `~/.claude/mcp.json` registration path and distribute
ArchGuard as a real Claude Code plugin. The initial directory-source prototype
proved that the manifests and skills are valid, but it copied only `dist/` into
Claude Code's plugin cache. Because `tsc` does not bundle runtime dependencies,
the cached MCP entry fails before startup:

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'commander'
```

Claude Code officially supports marketplace plugin sources of type `npm` and
installs them with `npm install`. ArchGuard should use that path so ordinary JS
dependencies, platform-selected optional dependencies, and install scripts are
resolved on the target machine.

The npm plugin should use the dual Tree-sitter runtime delivered by TASK-37,
TASK-38, and TASK-39, with the installation policy enforced by TASK-41. A
normal install must always install `web-tree-sitter` and bundled WASM grammars,
but must not install or build `node-tree-sitter` (`tree-sitter`) or native
grammar packages. At runtime, ArchGuard may use native parsing only when a
trusted, externally supplied runtime and selected language grammar pass a
health check. TASK-40 is a performance follow-up and is not a correctness
prerequisite for packaging.

## Investigation findings (2026-07-30)

1. `plugin/.claude-plugin/*` and `plugin/.mcp.json` validate, and the two skills
   load, but a successful plugin copy is not a successful MCP installation.
2. A standalone launch from
   `~/.claude/plugins/cache/archguard/archguard/0.1.31/` fails on the first bare
   ESM import (`commander`); the source checkout masked this because Node found
   the repository's parent `node_modules`.
3. `NODE_PATH` is not a solution for this ESM application; a test with
   `NODE_PATH=<repo>/node_modules` still failed package resolution.
4. Tree-sitter language plugins are already dynamically selected from
   `runAnalysis()`, but `sharp` remains in the static MCP launch graph through
   `DiagramOutputRouter -> MermaidDiagramGenerator -> renderer`.
5. `sharp` uses target-platform optional packages. Tree-sitter grammar packages
   include common-platform prebuilds, while `tree-sitter@0.25.x` itself may
   require a native build. Bundling a binary produced on one host is not a
   cross-platform distribution strategy.

## Plan

1. Keep the validated Claude plugin manifests and skills, but turn the plugin
   subtree (or a dedicated thin package) into a publishable npm package.
2. Make the plugin package depend on an exact matching
   `@yalehwang/archguard` version and include `.claude-plugin/`, `.mcp.json`, and
   skills in its published files.
3. Change the marketplace entry from a relative directory source to:

   ```json
   {
     "source": {
       "source": "npm",
       "package": "@yalehwang/archguard-claude-plugin",
       "version": "<exact-version>"
     }
   }
   ```

4. Point `.mcp.json` at the npm-installed ArchGuard entry under the plugin's
   own dependency tree. Do not rely on a global `archguard`, repository parent
   directories, or `NODE_PATH`.
5. Make the MCP launch graph lazy enough that query-only startup does not load
   `sharp` or language parsers before they are used.
6. Integrate the dual runtime from TASK-37/TASK-38/TASK-39 and the WASM-baseline
   dependency policy from TASK-41. A normal install is the deterministic WASM
   baseline; native acceleration is discovered only at runtime.
7. Run a clean end-to-end plugin install, restart/reload plugins, and verify
   `claude mcp list` reports ArchGuard as connected.

## Acceptance Criteria

- [x] `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and
      `.mcp.json` exist and pass `claude plugin validate`.
- [x] The deprecated installer no longer writes new registrations to
      `~/.claude/mcp.json`.
- [x] Native dependency audit records the Tree-sitter and `sharp` import paths
      and distinguishes startup-time from analyze-time loading.
- [ ] The published plugin package contains its manifests, MCP config, skills,
      and a complete npm-resolvable runtime dependency closure.
- [ ] The marketplace uses an npm source; installation executes `npm install`
      and does not vendor a checkout-specific `node_modules`.
- [ ] MCP startup succeeds from the isolated Claude plugin cache with no source
      checkout and no global ArchGuard CLI.
- [ ] A normal clean `npm install` installs `web-tree-sitter` and the bundled
      grammar WASM assets, does not attempt to install/build `tree-sitter` or
      native grammar packages, and analyzes all five languages through WASM.
- [ ] A native-capable install selects native parsing after health checks and
      produces ArchJSON equivalent to the WASM path.
- [ ] `sharp` is absent from the query-only MCP startup graph and loads only
      when rendering functionality requires it.
- [ ] After plugin reload/restart, `claude mcp list` shows ArchGuard
      **Connected**.

## Definition of Done

- [ ] TASK-37, TASK-38, TASK-39, and TASK-41 are complete.
- [ ] The npm plugin artifact and install flow are committed.
- [ ] Clean-cache install and live MCP connection evidence are appended here.
- [ ] README documents npm-source installation, runtime selection, WASM
      fallback, and how to force native or WASM for diagnostics.

## Coordination

- TASK-37 -> TASK-38 -> TASK-39 -> TASK-41 is the correctness-critical runtime
  and installation-policy chain.
- TASK-31 integrates TASK-39/TASK-41 into the npm-installed Claude plugin.
- TASK-40 follows TASK-39 and optimizes perceived WASM performance; it need not
  block initial correctness unless benchmarks exceed its guardrail.
- TASK-34 is superseded by this npm plugin route.
- TASK-35 finalizes the user-facing installer after TASK-31.
- TASK-36 adds Codex integration after TASK-31/TASK-35 establish the canonical
  executable installation.
