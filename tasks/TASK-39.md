---
id: TASK-39
title: Add per-language native-first Tree-sitter runtime selection
status: ready
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
