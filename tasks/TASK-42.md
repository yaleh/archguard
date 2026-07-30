---
id: TASK-42
title: Make the parser runtime resolver the single construction entry for language plugins
labels:
  - architecture
  - parser
  - tree-sitter
parent: null
children: []
extra: {}
status: done
---
## Proposal

Backend selection currently has two consumers: `loadPluginForLanguage`
(test-analysis path, wired through `selectParserBackendFor` by TASK-39) and the
main diagram pipeline (`src/cli/processors/arch-json-provider.ts`), which
constructed the five language plugins directly with the default native backend
singleton. TASK-31 fixed the symptom by routing the pipeline's construction
points through `selectParserBackendFor`, but the structural hazard remains:
any future caller can still construct `new GoPlugin()` etc. with the default
native singleton and silently bypass runtime selection. This exact shape of
bug shipped to users: on a WASM-only install, `archguard analyze --lang go`
crashed and `ARCHGUARD_PARSER_RUNTIME=wasm` was a no-op on that path
(meta-cc incident, 2026-07-30).

Make bypassing the resolver structurally impossible, not merely unfashionable:
language plugins must be constructible only through the resolver-mediated
factory, and the "default native singleton" must stop being the ambient
default.

## Blocked

Blocked by TASK-31 (its pipeline wiring fix is the starting point).

## Plan

1. Audit every construction site of the five language plugins
   (`new GoPlugin|JavaPlugin|PythonPlugin|CppPlugin|KotlinPlugin`) across
   `src/` and enumerate who passes a backend and who relies on defaults.
2. Introduce a single factory (e.g. `createLanguagePlugin(language, options)`
   in `src/plugins/shared/` or the plugin registry) that internally resolves
   the backend via `selectParserBackendFor` and returns a ready plugin.
3. Remove or privatize the ambient default: plugin constructors should REQUIRE
   an explicit backend (or an explicit "unresolved, test-only" marker), so
   `new GoPlugin()` with no argument fails to compile. Migrate all callers
   (including tests) to the factory or to explicit injection.
4. Delete/restrict the exported `nativeParserBackend` singleton if it is no
   longer needed as an ambient default; keep it reachable only as the
   resolver's internal probe result or for explicit test injection.
5. Add a static guard test (import-graph or grep-based) asserting no `src/`
   file constructs the five plugins directly outside the factory.

## Touches

- src/plugins/shared/plugin-factory.ts (NEW: single resolver-mediated factory)
- src/plugins/golang/index.ts src/plugins/java/index.ts src/plugins/python/index.ts src/plugins/cpp/index.ts src/plugins/kotlin/index.ts (constructor signatures only: require explicit backend)
- src/cli/processors/arch-json-provider.ts (caller migration)
- src/cli/analyze/run-analysis.ts src/cli/mcp/analyze-tool.ts (caller migration)
- src/core/plugin-registry.ts (registry-mediated construction if applicable)
- tests/plugins/plugin-factory/** (NEW: factory tests incl. Go constructor migration)
- tests/unit/architecture/** (NEW: static guard test — no direct five-plugin construction in src/)
- tests/unit/plugins/java/** tests/unit/plugins/python/** tests/unit/plugins/cpp/** tests/unit/plugins/kotlin/** (constructor migration)
- tests/cross-language.test.ts
- tests/integration/plugins/go-mcp-server.integration.test.ts
- tests/integration/plugins/go-plugin-gopls.integration.test.ts
- tests/integration/plugins/go-plugin.integration.test.ts
- tests/integration/plugins/java-plugin.integration.test.ts
- tests/integration/plugins/python-plugin.integration.test.ts
- tests/plugins/cpp/cpp-plugin.test.ts
- tests/plugins/golang/atlas/excludeTests.test.ts
- tests/plugins/golang/atlas/go-atlas-plugin.test.ts
- tests/plugins/golang/go-atlas-adapter.test.ts
- tests/plugins/golang/go-plugin-dependency-edges.test.ts
- tests/plugins/golang/go-plugin-merge.test.ts
- tests/plugins/golang/go-plugin.test.ts
- tests/plugins/java/java-plugin.test.ts
- tests/plugins/python/python-plugin.test.ts
- tests/unit/analysis/test-analyzer.test.ts
- tests/unit/plugins/supported-levels.test.ts
- tasks/TASK-42.md

The exact test files above were transferred to TASK-42 for constructor-call
migration only after TASK-44 was paused with zero changes. This supersedes the
earlier test-directory exclusion; TASK-44 product files remain excluded.

Do NOT modify: package.json/lock, src/types/**, src/plugins/shared/parser-runtime.ts,
src/plugins/shared/wasm-parser-backend.ts, src/plugins/golang/atlas/**,
tests/unit/plugins/golang/**, tests/unit/plugins/shared/** (owned by parallel
TASK-40/TASK-44). No behavior change to selection semantics or backends.

## Construction-site inventory

Before (master HEAD `06255e8`):

- `src/cli/analyze/run-analysis.ts`: five direct constructions; Go, Java,
  Python, C++, and Kotlin each passed a backend returned by a local
  `selectParserBackendFor` wrapper.
- `src/cli/processors/arch-json-provider.ts`: five direct constructions; Go,
  C++, Python, Java, and Kotlin each passed a backend returned by the
  provider's local `selectParserBackendFor` wrapper.
- Plugin constructors defaulted omitted arguments to the exported
  `nativeParserBackend` singleton.
- Tests contained no-argument construction in 17 files (enumerated in the
  transferred Touches list above).

After:

- `src/plugins/shared/plugin-factory.ts` is the only source file that directly
  constructs the five plugins (including the `GoAtlasPlugin` compatibility
  alias), and every construction receives the backend selected internally by
  `selectParserBackendFor`.
- `run-analysis.ts` and `arch-json-provider.ts` call
  `createLanguagePlugin(language, options)`; there are no other direct
  constructions in `src/`.
- Public constructor implementation signatures require a `ParserBackend`; omitted
  arguments fail TypeScript compilation and a runtime guard rejects untyped
  JavaScript/`any` construction. Constructors contain no backend fallback.
- All 17 transferred test files now pass `nativeParserBackend` explicitly;
  mechanical inventory finds zero no-argument constructions under `tests/`.

## Acceptance Criteria

- [x] Every language-plugin construction in `src/` goes through the single
      resolver-mediated factory (enumerate before/after sites as evidence).
- [x] `new <Lang>Plugin()` without an explicit backend is a compile error.
- [x] A static guard test fails CI if a new direct construction site appears.
- [x] WASM-only packed-install analyze for all five languages still passes
      (regression guard for the meta-cc incident shape).
- [x] All existing tests pass without weakened assertions.

## Definition of Done

- [x] Refactor and guard test committed.
- [x] Before/after construction-site inventory appended to this task body.

## Coordination

Builds on TASK-31's pipeline wiring fix. TASK-43 (actionable errors) and
TASK-44 (Atlas timeout) are independent and may run in any order after this.

## Final loop-driver evidence (2026-07-30)

- Driver gate PASS after remediation: GateEvent `1ed0da4d-171f-4861-95b7-306229ecef5e`.
- Final fresh-context audit: **NO REFUTATION FOUND**. Required constructors + runtime guards, TypeChecker boundary (alias/namespace), real packed five-language CLI WASM regression, exact constructor-only test migration, and restored valid Python fixture all verified.
- `node_modules` is the driver-created untracked deps-ready symlink and is absent from the commit tree.
