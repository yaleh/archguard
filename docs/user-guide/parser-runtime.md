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
canonical variable is set. When the alias is consumed, ArchGuard prints a
stderr warning exactly once per process:

```text
[parser-runtime] WARNING: ARCHGUARD_PARSER_BACKEND is deprecated and will be removed in a future release; use the canonical ARCHGUARD_PARSER_RUNTIME (auto|native|wasm) instead.
```

New automation should use `ARCHGUARD_PARSER_RUNTIME`.

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

A normal ArchGuard install (`npm install @yalehwang/archguard`, or a Claude
npm-source plugin install) is deterministic and portable:

- **Always installed (WASM baseline):** `web-tree-sitter` is a required
  production dependency and the five grammar WASM assets are vendored under
  `assets/grammars/` (pinned and checksummed). Every install can parse Go,
  Java, Python, C++, and Kotlin out of the box.
- **Never installed by ArchGuard:** the native `tree-sitter` Node addon and
  the native grammar packages (`tree-sitter-go`, `tree-sitter-java`,
  `tree-sitter-python`, `tree-sitter-cpp`,
  `@tree-sitter-grammars/tree-sitter-kotlin`) are **not** in `dependencies`,
  `optionalDependencies`, or `bundleDependencies`, and no
  install/preinstall/postinstall/prepack script builds, downloads, or vendors
  them. The runtime and the Go/Java/Python/C++ grammars are declared only as
  **optional peers** (`peerDependencies` + `peerDependenciesMeta.optional`) —
  metadata that tells a compatible host which versions work; npm does not
  install optional peers and does not warn when they are absent. The Kotlin
  grammar is documented for explicit installation instead (see below).

Note the similar package names: `tree-sitter` (npm) is the **native** Node
addon — optional accelerator, never auto-installed. `web-tree-sitter` is the
**WASM** runtime — required, always installed, guaranteed baseline.

### Installing the native accelerator (opt-in)

Native parsing is an opportunistic runtime accelerator, never a requirement:

```bash
# Option 1: host project installs the optional peers alongside ArchGuard
npm install tree-sitter tree-sitter-go   # plus the grammars you need

# Option 2: point ArchGuard at a trusted, separately installed module root
ARCHGUARD_NATIVE_MODULE_ROOT=/opt/archguard-native archguard analyze -s ./src --lang go
```

The optional-peer metadata covers `tree-sitter` and the Go/Java/Python/C++
grammars. The Kotlin grammar (`@tree-sitter-grammars/tree-sitter-kotlin`) is
deliberately **not** declared as a peer: its current release peer-depends on
`tree-sitter@^0.22.4`, which conflicts with the `tree-sitter@^0.25.0` runtime
the other grammars use and would make npm fail consumer installs with
`ERESOLVE`. For native Kotlin parsing, install the grammar explicitly into a
trusted module root (an npm `overrides` entry for `tree-sitter` may be needed
to bypass its stale peer range) and use `ARCHGUARD_NATIVE_MODULE_ROOT`:

```bash
mkdir -p /opt/archguard-native && cd /opt/archguard-native
npm install tree-sitter @tree-sitter-grammars/tree-sitter-kotlin \
  --override tree-sitter@^0.25.0
ARCHGUARD_NATIVE_MODULE_ROOT=/opt/archguard-native archguard analyze -s ./src --lang kotlin
```

In `auto` mode ArchGuard uses native only when the `(runtime, grammar)` tuple
resolves from a trusted scope (ArchGuard's own package scope, or the explicit
`ARCHGUARD_NATIVE_MODULE_ROOT`) **and** passes a real parse health check.
Missing or broken native packages never fail the install or the analysis — the
resolver records a fallback reason and selects WASM. To force a backend:

```bash
ARCHGUARD_PARSER_RUNTIME=wasm   archguard analyze -s ./src --lang go   # always WASM
ARCHGUARD_PARSER_RUNTIME=native archguard analyze -s ./src --lang go   # require native, fail loudly
```

This policy applies to Tree-sitter. `sharp` (image rendering) has its own
platform-package installation policy, tracked separately by TASK-31.

## Fallback semantics

- Fallback lives **inside the runtime resolver**, per language, decided once
  before any extraction begins. A backend is never switched mid-run: parser or
  extractor bugs surface as errors instead of being hidden.
- If the selected backend cannot initialize, the error is an explicit,
  language-specific `ParserInitializationError` — a failed Go/Java/Python/
  C++/Kotlin initialization is never silently analyzed as TypeScript.
- Diagnostics (TASK-43): every selection emits one line —
  `[parser-runtime] <language>: policy=<policy> source=<default|env|config|explicit> -> <runtime>`
  plus `(native probe failed: <reason>)` when native was rejected. The line is
  surfaced in `--verbose` mode AND on any fallback event even non-verbose, so
  "did my fallback work?" never requires guesswork. CLI/MCP analysis routes it
  through the progress reporter (stderr in MCP mode, so MCP protocol stdout
  stays clean); programmatic consumers can read `getParserRuntimeDiagnostics()`
  from `src/plugins/shared/parser-runtime.ts`. Examples:

  ```text
  [parser-runtime] go: policy=auto source=default -> native
  [parser-runtime] java: policy=auto source=env -> wasm (native probe failed: cannot load native tree-sitter runtime ("tree-sitter"): Cannot find module 'tree-sitter')
  [parser-runtime] cpp: policy=wasm source=config -> wasm
  ```

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
selection.source;          // 'default' | 'env' | 'config' | 'explicit' — where the effective policy came from
```

Language plugins accept the selected backend via constructor injection, e.g.
`new JavaPlugin(selection.backend)`; `loadPluginForLanguage()` in
`src/cli/analyze/run-analysis.ts` wires this for CLI analysis.
