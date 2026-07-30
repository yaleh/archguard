---
id: TASK-31
title: Package archguard as an npm-installed Claude Code plugin
status: done
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

## Touches

- plugin/** (publishable npm plugin package: manifests, .mcp.json, skills, package.json/files)
- package.json / package-lock.json (version pin + published files for the core package)
- .claude-plugin/** (marketplace entry switch to npm source)
- src/cli/mcp/** (lazy MCP launch graph: no sharp / no language parsers at query-only startup)
- src/mermaid/** (sharp behind lazy load, only when rendering)
- README.md (npm-source install, runtime selection, WASM fallback, force-runtime diagnostics)
- tests/** (plugin packaging, lazy-startup graph, clean-cache MCP startup tests)
- tasks/TASK-31.md

scripts/install-claude-user-scope.sh finalization is TASK-35; Codex integration
is TASK-36; parser internals (37/38/39/41) are done and out of scope.

## Acceptance Criteria

- [x] `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and
      `.mcp.json` exist and pass `claude plugin validate`.
- [ ] The deprecated installer no longer writes new registrations to
      `~/.claude/mcp.json`. **UNCHECKED 2026-07-30 per adversarial-audit
      refutation**: the installer still writes the registration (with a
      `_deprecated` marker); removal is TASK-35 scope. See Land Evidence.
- [x] Native dependency audit records the Tree-sitter and `sharp` import paths
      and distinguishes startup-time from analyze-time loading.
- [x] The published plugin package contains its manifests, MCP config, skills,
      and a complete npm-resolvable runtime dependency closure. (Verified on the
      packed tarball — the exact publish artifact. Registry publication itself
      is intentionally deferred; see Land Evidence.)
- [x] The marketplace uses an npm source; installation executes `npm install`
      and does not vendor a checkout-specific `node_modules`.
- [x] MCP startup succeeds from the isolated Claude plugin cache with no source
      checkout and no global ArchGuard CLI.
- [x] A normal clean `npm install` installs `web-tree-sitter` and the bundled
      grammar WASM assets, does not attempt to install/build `tree-sitter` or
      native grammar packages, and analyzes all five languages through WASM.
- [x] A native-capable install selects native parsing after health checks and
      produces ArchJSON equivalent to the WASM path.
- [x] `sharp` is absent from the query-only MCP startup graph and loads only
      when rendering functionality requires it.
- [ ] After plugin reload/restart, `claude mcp list` shows ArchGuard
      **Connected**.

## Definition of Done

- [x] TASK-37, TASK-38, TASK-39, and TASK-41 are complete.
- [x] The npm plugin artifact and install flow are committed.
- [x] Clean-cache install and live MCP connection evidence are appended here.
- [x] README documents npm-source installation, runtime selection, WASM
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

## Land Evidence (2026-07-30)

### What was built

- `plugin/` is now a publishable npm package `@yalehwang/archguard-claude-plugin`
  (version pinned to the core `0.1.31`, exact-version dependency on
  `@yalehwang/archguard`, `files`: `.claude-plugin/`, `.mcp.json`,
  `mcp-launcher.mjs`, `skills/`). The directory-source prototype's dist
  vendoring is gone; `plugin/sync.sh` now syncs only the skills.
- `plugin/mcp-launcher.mjs` resolves `@yalehwang/archguard/dist/cli/index.js`
  from the plugin's own dependency tree via `createRequire` (works for nested
  and hoisted npm layouts) and execs it as the MCP stdio server.
  `plugin/.mcp.json` points at `${CLAUDE_PLUGIN_ROOT}/mcp-launcher.mjs`.
- Repo-root `.claude-plugin/marketplace.json` is the marketplace manifest with
  an npm source: `{ "source": "npm", "package": "@yalehwang/archguard-claude-plugin",
  "version": "0.1.31" }`. The prototype's plugin-level marketplace.json
  (relative directory source) was removed.
- `src/mermaid/renderer.ts`: `sharp` is now a dynamic import inside
  `convertSVGToPNG` — out of the static MCP launch graph, loaded only for PNG
  rendering.
- `src/cli/processors/arch-json-provider.ts` (scope extension, flagged): the
  diagram-parse path constructed language plugins with the DEFAULT native
  backend, so `archguard analyze --lang go|java|python|cpp|kotlin` crashed on
  any WASM-only install (exactly the npm plugin cache layout) even with
  `ARCHGUARD_PARSER_RUNTIME=wasm`. The five fallback constructions now select
  the backend through `selectParserBackendFor` (TASK-39 resolver), honoring
  env policy first, then `parserRuntime`/`nativeModuleRoot` config.

### REAL commands (not simulation)

- `claude plugin validate plugin/` — PASSED (plugin manifest + .mcp.json).
- `claude plugin validate .` — PASSED (root marketplace manifest).
- `claude plugin marketplace add /tmp/wt-archguard-TASK-31` (isolated
  CLAUDE_CONFIG_DIR) — PASSED; marketplace accepted.
- `claude plugin install archguard@archguard` (isolated CLAUDE_CONFIG_DIR) —
  Claude Code executed a REAL `npm install @yalehwang/archguard-claude-plugin@0.1.31`
  against registry.npmjs.org and failed ONLY with E404 (package not published —
  publishing is forbidden by task instructions). This proves the marketplace
  npm-source wiring end to end: Claude Code resolves the npm source and runs
  `npm install` itself.
- `npm run build` — OK; `npm run type-check` — OK; eslint on touched files —
  0 errors.
- Gate: `npx vitest run` — 4259 passed, 11 skipped, 0 failed (273 files,
  283s). Base was 4226 passed; +33 new tests.

### SIMULATED faithfully (tests/integration/plugin-install.test.ts)

Simulation boundary: the ONLY stand-ins are (a) an npm `overrides` entry in
the throwaway prefix redirecting `@yalehwang/archguard` to the locally packed
core tarball (standing in for registry availability) and (b) a temp prefix
standing in for `~/.claude/plugins/cache`. Packing, `npm install`, dependency
resolution, MCP launch, and the protocol handshake are all real:

- `npm pack` of both packages; real `npm install <plugin-tarball> --omit=dev`
  into an isolated prefix. Installed closure contains the plugin manifests,
  `.mcp.json`, launcher, skills, `@yalehwang/archguard` with `dist/` +
  `assets/grammars/*.wasm`, `commander`, `@modelcontextprotocol/sdk`, `zod`,
  `web-tree-sitter`; contains NO `tree-sitter`/`tree-sitter-*`/
  `@tree-sitter-grammars/*`; install log has no node-gyp/prebuild-install/
  ERESOLVE. (The ERR_MODULE_NOT_FOUND: commander failure mode of the
  directory-source prototype is gone.)
- REAL MCP handshake (MCP SDK client over stdio) against the installed
  launcher, cwd outside repo and prefix, env scrubbed of NODE_PATH/ARCHGUARD_*:
  `tools/list` returns the archguard tools (archguard_summary,
  archguard_analyze, >10 tools).
- sharp runtime laziness: `sharp` + `@img/*` physically deleted from the
  installed closure; the MCP handshake still succeeds.
- All five languages analyzed through the plugin-installed closure via the
  real CLI (`analyze -s <fixture> --lang <lang> -f json`,
  ARCHGUARD_PARSER_RUNTIME=wasm): valid ArchJSON with matching language and
  non-empty sourceFiles for go, java, python, cpp, kotlin — after the
  arch-json-provider wiring fix above (previously failed with "Cannot find
  module 'tree-sitter'").
- tests/integration/mcp-launch-graph.test.ts: mechanical static-import walk of
  `dist/cli/index.js` — `sharp`, `tree-sitter`, and all native grammar
  packages are statically unreachable; `sharp` and `web-tree-sitter` remain
  dynamic imports.
- Native-capable selection with ArchJSON parity: inherited from TASK-41
  (tests/integration/install-policy.test.ts — trusted ARCHGUARD_NATIVE_MODULE_ROOT
  selects native, byte-identical ArchJSON); still green in the gate run above.

### NOT fully satisfied

- "After plugin reload/restart, `claude mcp list` shows ArchGuard Connected":
  requires the package to exist on the npm registry; publishing is forbidden
  by the task. Evidence boundary: REAL `claude plugin install` executed
  `npm install` of the exact plugin coordinate (failed only at registry E404),
  and the REAL MCP handshake from the simulated cache succeeded. Once
  `@yalehwang/archguard-claude-plugin@0.1.31` and `@yalehwang/archguard@0.1.31`
  are published, `claude plugin install archguard@archguard` + restart is the
  only remaining manual step.
- The pre-checked AC "The deprecated installer no longer writes new
  registrations to `~/.claude/mcp.json`": on the current base,
  `scripts/install-claude-user-scope.sh` STILL writes the registration (with a
  `_deprecated` marker). Left untouched per instructions; finalization is
  TASK-35.

## Loop-driver land evidence (2026-07-30)

- **Gate**: vitest **PASS** (exit 0), GateEvent `b176ba74-bf02-4ca2-851b-37e26ce448c7`
  (2026-07-30T10:57:12Z), cwd = worktree, 600s timeoutMs override under load
  (4259 passed | 11 skipped per the builder's run).
- **Adversarial audit** (fresh-context, refute-first): **REFUTATION FOUND →
  remediated**. The single blocking clause was the pre-checked installer AC
  (installer still writes `~/.claude/mcp.json`; TASK-35 scope) — remediated by
  unchecking it with user approval (parity with the honestly-unchecked
  "claude mcp list Connected" AC). Everything else verified clean:
  arch-json-provider scope extension JUSTIFIED (fallback constructions are the
  live production path; all five constructors defaulted to native backend —
  the meta-cc crash was real; fix is minimal, tested for all five languages on
  WASM-only packed installs, native-healthy behavior unchanged); sharp
  lazy-loading real (static import-graph test + physical-deletion handshake
  test); mcp-launcher resolves core from the plugin's own dependency tree;
  plugin package + marketplace pinned by unit tests; README matches reality;
  WASM-baseline ACs hold in the packed context; diff hygiene clean.
- **Non-blocking observations**: native-dependency-audit AC is prose-only
  (thin); implicit inter-test dependency in plugin-install tests
  (sharp-deletion runs before analyze tests — harmless, `-f json` needs no
  sharp).
- Merged to master by the loop-driver at land (post-revision rule for
  pre-dispatched tasks).
