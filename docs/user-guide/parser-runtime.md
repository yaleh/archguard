# Parser Runtime Selection (auto | native | wasm)

ArchGuard parses Go, Java, Python, C++, and Kotlin with Tree-sitter. Two
runtimes can serve those languages:

- **native** — the `tree-sitter` Node addon plus per-language grammar packages
  (`tree-sitter-go`, `tree-sitter-java`, …). Fastest, but optional: it must be
  compiled for the host and ABI-compatible with the running Node.
- **wasm** — `web-tree-sitter` with the grammar WASM files vendored under
  `assets/grammars/` (pinned and checksummed). Portable and always installed;
  this is the guaranteed baseline.

Each language selects its backend **independently**, so one process can parse
Go natively while Java falls back to WASM.

## Policy: `ARCHGUARD_PARSER_RUNTIME`

| Value | Behavior |
|-------|----------|
| `auto` (default) | Probe the `(tree-sitter runtime, language grammar)` tuple: import both, bind the grammar, parse a minimal fixture, and validate the root node. Native is used only when the probe passes; otherwise WASM is selected and the fallback reason is recorded in diagnostics. |
| `native` | Require native. A failed probe raises an actionable `ParserInitializationError` naming the language and the remediation. WASM is **never** silently substituted. |
| `wasm` | Never import native modules. The portable backend is used deterministically. |

```bash
# Default: per-language health-checked native-first selection
archguard analyze -s ./src --lang go

# Force the portable backend (e.g. restricted CI without build tools)
ARCHGUARD_PARSER_RUNTIME=wasm archguard analyze -s ./src --lang go

# Require native; fail loudly if it is unavailable or broken
ARCHGUARD_PARSER_RUNTIME=native archguard analyze -s ./src --lang go
```

The same policy can be set on a programmatically constructed config object via
`parserRuntime: 'auto' | 'native' | 'wasm'` (see `GlobalConfig` in
`src/types/config-global.ts`). The environment variable takes precedence.

### Legacy alias: `ARCHGUARD_PARSER_BACKEND`

TASK-38 introduced `ARCHGUARD_PARSER_BACKEND=native|wasm` for forced-WASM test
runs. It is kept as a **deprecated alias**: when `ARCHGUARD_PARSER_RUNTIME` is
unset it maps to the `native`/`wasm` policies, and it is ignored when the
canonical variable is set. New automation should use
`ARCHGUARD_PARSER_RUNTIME`.

## Native module discovery

- Native modules resolve **only from ArchGuard's own package scope** (the
  resolver uses `createRequire` relative to its own module). The analyzed
  project's `node_modules` is never consulted, and global npm locations are
  never scanned.
- An external module root is honored **only when explicitly configured** via
  `ARCHGUARD_NATIVE_MODULE_ROOT=/path/to/root` (the native packages are then
  resolved from `<root>/node_modules`) or the `nativeModuleRoot` config field.
  This is the supported way to point ArchGuard at a trusted, separately
  installed native accelerator.

## Dependency policy

The native runtime and grammar packages are **optional peers**
(`peerDependencies` + `peerDependenciesMeta.optional`), not required
dependencies: a host that wants the native accelerator installs them
explicitly; everyone else gets the WASM baseline. `web-tree-sitter` and the
vendored WASM assets remain required, guaranteed-baseline runtime
dependencies. (The install-time removal of the native packages from
`dependencies`/`bundleDependencies` is handled separately by TASK-41.)

## Fallback semantics

- Fallback lives **inside the runtime resolver**, per language, decided once
  before any extraction begins. A backend is never switched mid-run: parser or
  extractor bugs surface as errors instead of being hidden.
- If the selected backend cannot initialize, the error is an explicit,
  language-specific `ParserInitializationError` — a failed Go/Java/Python/
  C++/Kotlin initialization is never silently analyzed as TypeScript.
- Diagnostics: every selection emits one line
  (`[parser-runtime] <language>: policy=<policy> -> <runtime>` plus the
  fallback reason when native was rejected). With `--verbose`, CLI analysis
  forwards these through the progress reporter (stderr in MCP mode, so MCP
  stdout stays clean); programmatic consumers can read
  `getParserRuntimeDiagnostics()` from
  `src/plugins/shared/parser-runtime.ts`.

## API

```ts
import {
  selectParserBackendFor,
  readParserRuntimePolicy,
  getParserRuntimeDiagnostics,
} from './src/plugins/shared/parser-runtime.js';

const selection = await selectParserBackendFor('go'); // honors env policy
selection.runtime;         // 'native' | 'wasm'
selection.backend;         // ParserBackend — inject into GoPlugin etc.
selection.fallbackReason;  // why native was rejected (auto mode only)
```

Language plugins accept the selected backend via constructor injection, e.g.
`new JavaPlugin(selection.backend)`; `loadPluginForLanguage()` in
`src/cli/analyze/run-analysis.ts` wires this for CLI analysis.
