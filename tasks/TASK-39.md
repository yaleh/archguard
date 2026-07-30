---
id: TASK-39
title: Add per-language native-first Tree-sitter runtime selection
status: done
labels:
  - parser
  - tree-sitter
  - wasm
  - fallback
parent: TASK-31
children: []
extra: {}
---
## Proposal

Select the fastest usable parser independently for each language:

- `auto` (default): use native only when the runtime and selected grammar pass
  an actual parse health check; otherwise use WASM.
- `native`: require native and report an actionable failure.
- `wasm`: skip native probing and use the portable backend deterministically.

Fallback belongs inside the parser runtime resolver. It must not reuse
`runAnalysis()`'s current broad catch that silently turns a failed Go/Java/etc.
plugin into a TypeScript analysis.

## Blocked

Blocked by TASK-37 and TASK-38.

## Plan

1. Add a documented config/env policy such as
   `ARCHGUARD_PARSER_RUNTIME=auto|native|wasm`.
2. Resolve native modules from ArchGuard's own package-resolution scope when a
   trusted host supplied optional peers. Support an external module root only
   when explicitly configured; do not scan global npm locations or the
   analyzed project's `node_modules`.
3. Probe the tuple `(tree-sitter runtime, language grammar)` by importing it,
   setting the language, parsing a minimal fixture, and validating the root.
4. Cache the selected backend per language for the process lifetime and emit
   the choice plus fallback reason in verbose diagnostics.
5. Treat native runtime and grammar packages as optional peers or an explicitly
   installed external accelerator, not `dependencies`, `optionalDependencies`,
   or `bundleDependencies`. Keep `web-tree-sitter` and vendored WASM as the
   guaranteed baseline.
6. Remove the broad language-plugin-to-TypeScript fallback. If both backends
   fail, return an explicit language-specific initialization error.
7. Never switch backend after extraction begins; parser/extractor bugs must
   surface instead of being hidden by mid-run fallback.

## Acceptance Criteria

- [x] `auto`, `native`, and `wasm` policies are documented and tested.
      (docs/user-guide/parser-runtime.md; tests/unit/plugins/shared/parser-runtime.test.ts)
- [x] Selection occurs per language, allowing a mixed native/WASM process.
      (mixed selection unit test + tests/plugins/parser-runtime/mixed-selection.test.ts)
- [x] Default discovery never loads a native addon from the project being
      analyzed. (createRequire from the facade's own scope; sabotaged
      project-local node_modules test in parser-runtime.test.ts)
- [x] A healthy native install selects native and passes parity tests.
      (auto selects native for all 5 languages; byte-identical ArchJSON vs explicit native)
- [x] Missing, broken, ABI-incompatible, or grammar-incompatible native
      bindings fall back to WASM in `auto`. (fault-injected loaders)
- [x] Forced native reports a clear error and never silently uses WASM.
      (ParserInitializationError with remediation text)
- [x] Forced WASM does not attempt to import native modules. (loader call counters stay 0)
- [x] A failed Go/Java/Python/C++/Kotlin initialization is never silently
      analyzed as TypeScript. (broad catch removed from loadPluginForLanguage;
      tests/unit/cli/analyze/run-analysis-plugin-loading.test.ts)
- [x] Runtime choice and fallback reason are visible in diagnostics without
      polluting MCP stdout. (getParserRuntimeDiagnostics + verbose reporter;
      MCP uses StderrReporter)

## Definition of Done

- [x] Fault-injection tests cover missing and broken native bindings.
      (missing runtime, missing grammar, ABI-incompatible, grammar-mismatch loaders)
- [x] A normal packed install passes all language tests without native
      Tree-sitter packages; a separate trusted native fixture exercises
      native selection. (tests/integration/parser-runtime-packed.test.ts:
      npm pack + WASM-only overlay + ARCHGUARD_NATIVE_MODULE_ROOT fixture)
- [x] Runtime policy and dependency metadata changes are committed.
      (ARCHGUARD_PARSER_RUNTIME canonical + ARCHGUARD_PARSER_BACKEND alias;
      native tree-sitter packages declared optional peers in package.json/lock)

## Coordination

TASK-41 fixes the install-time dependency policy around this resolver. TASK-31
then consumes both in the npm Claude plugin. TASK-40 improves performance
without changing selection semantics.

## Land Evidence

- Gate: `npx vitest run` in the TASK-39 worktree — 268 files passed, 4203
  tests passed, 11 skipped, 0 failed (base 4137 + 66 new: 36 resolver unit,
  10 plugin-loading, 17 mixed-selection, 3 packed-install).
- `npx tsc --noEmit` clean; `check:runtime-deps` guard passes on the rebuilt
  dist; eslint 0 errors on touched files.
- Env reconciliation: `ARCHGUARD_PARSER_RUNTIME` (auto|native|wasm) is the
  canonical mechanism; `ARCHGUARD_PARSER_BACKEND` (native|wasm) remains a
  deprecated alias applied only when the canonical variable is unset —
  documented in docs/user-guide/parser-runtime.md and parser-backend.ts.
- Note: web-tree-sitter@0.25.10 (a declared production dependency since
  TASK-38) was missing from the shared node_modules and was installed;
  the native tree-sitter addons there were rebuilt for the host Node ABI.

## Loop-driver land evidence (2026-07-30)

- **Gate**: vitest **PASS** (exit 0), GateEvent `f5508eab-5aa6-401b-af4c-9e166a06c2cc`
  (2026-07-30T09:05:07Z), run with cwd = worktree and a 600s timeoutMs override
  (machine heavily loaded; configured 300s suffices unloaded).
- **Adversarial audit** (fresh-context, refute-first): **NO REFUTATION FOUND**.
  Per-AC verification against real code: all three policies implemented +
  tested; per-language mixed native/WASM process proven (cache key
  `policy:language`, real-plugin test); health probe parses a minimal fixture;
  four injected-loader fault families fall back to WASM; forced native throws
  actionable `ParserInitializationError`; forced WASM loader-spy asserts zero
  native imports; TypeScript fallback genuinely removed with per-language
  rejection tests; native resolution scoped to ArchGuard's own package scope
  (sabotaged-project test); diagnostics via StderrReporter off MCP stdout;
  packed-install integration test does real `npm pack` + WASM-only overlay +
  trusted-native-root runs. Main-pipeline caveat adjudicated NON-BLOCKING (no
  AC requires routing arch-json-provider.ts through the resolver; negative
  guarantees hold there too).
- **Non-blocking observations** (follow-up candidates): zod `configSchema` in
  src/cli/config-loader.ts does not declare `parserRuntime`/`nativeModuleRoot`
  (file-based config silently strips them; env vars are canonical and
  unaffected); selection cache is keyed by env read at call time.
- Merge to master pending human-steered merge (same convention as
  TASK-30/32/33/37/38).
