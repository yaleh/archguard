---
id: TASK-43
title: Surface actionable parser-backend errors and effective-runtime
  diagnostics on the analyze paths
labels:
  - ux
  - diagnostics
  - parser
parent: null
children: []
extra: {}
status: done
---
## Proposal

During the meta-cc incident (2026-07-30) the user-facing failure modes were
unactionable at every step:

1. The main pipeline surfaced a raw native-module load failure instead of the
   actionable `ParserInitializationError` (which names the remediation:
   `ARCHGUARD_PARSER_RUNTIME=wasm`, trusted native root, or policy relaxation)
   — because the pipeline bypassed the resolver that throws it.
2. `ARCHGUARD_PARSER_BACKEND=wasm` was silently a no-op on the analyze path;
   nothing told the user their setting was being ignored there, and the
   deprecated alias vs canonical `ARCHGUARD_PARSER_RUNTIME` distinction was
   invisible.
3. There was no default-visible indication of WHICH backend was actually used
   for a language, so "did my fallback work?" required guesswork.

TASK-39 already built the machinery (actionable `ParserInitializationError`,
per-language diagnostics via `getParserRuntimeDiagnostics()`, StderrReporter
routing). This task makes those guarantees hold on every analyze surface and
adds effective-runtime visibility.

## Blocked

Blocked by TASK-31 (pipeline wiring fix) and TASK-42 (single construction
entry) — after those, every construction goes through the resolver, and this
task only standardizes surfacing.

## Plan

1. Verify (test) that a failed language initialization on the CLI analyze,
   MCP analyze, and query paths surfaces `ParserInitializationError`'s
   actionable message — never a raw `ERR_MODULE_NOT_FOUND` stack.
2. Emit a one-line effective-runtime summary per analysis (verbose mode, and
   on any fallback event even non-verbose): language → backend chosen → source
   of choice (default auto / env / config / explicit) → fallback reason when
   applicable.
3. Warn loudly (stderr, once per process) when the deprecated
   `ARCHGUARD_PARSER_BACKEND` alias is in use, and when an env/config runtime
   setting had no effect on a given path (defensive: after TASK-42 there
   should be no such path — assert it).
4. Update README + docs/user-guide/parser-runtime.md so the canonical variable
   is unmistakable and the diagnostic output is documented with examples.
5. Keep MCP protocol stdout clean (diagnostics via StderrReporter only).

## Touches

- src/plugins/shared/parser-runtime.ts (diagnostic source/fallback metadata + once-only alias warning)
- src/plugins/shared/plugin-factory.ts (diagnostic propagation only)
- src/cli/analyze/run-analysis.ts (CLI error/effective-runtime surfacing)
- src/cli/mcp/analyze-tool.ts (MCP actionable error mapping + stderr diagnostics)
- src/cli/processors/arch-json-provider.ts (diagnostic propagation only)
- README.md
- docs/user-guide/parser-runtime.md
- tests/unit/plugins/shared/parser-runtime.test.ts
- tests/unit/cli/analyze/run-analysis-plugin-loading.test.ts
- tests/unit/cli/mcp/analyze-tool.test.ts
- tests/integration/mcp-runtime-diagnostics.test.ts (NEW: stdout cleanliness)
- tasks/TASK-43.md

Do NOT modify worker-pool files, language plugin constructors, Go gopls/Atlas
files, package manifests, or installer files.

## Acceptance Criteria

- [x] CLI analyze with a failed language init prints the actionable
      ParserInitializationError remediation (test per language family).
      (tests/unit/cli/analyze/run-analysis-plugin-loading.test.ts: per-family
      it.each asserts the remediation text — ARCHGUARD_PARSER_RUNTIME,
      ARCHGUARD_NATIVE_MODULE_ROOT, "relax the policy" — and the
      ParserInitializationError identity, never a bare module-not-found stack.)
- [x] MCP analyze error payloads carry the actionable message, and MCP stdout
      remains protocol-clean (guard test).
      (tests/integration/mcp-runtime-diagnostics.test.ts: diagnostics reach
      stderr via StderrReporter and never the MCP payload; error payloads are
      prefixed "Analysis failed (parser initialization):" with the full
      remediation — tests/unit/cli/mcp/analyze-tool.test.ts.)
- [x] Verbose (and fallback-triggered non-verbose) output shows language →
      backend → choice-source → fallback reason.
      (Diagnostic format `[parser-runtime] <lang>: policy=<p> source=<s> ->
      <runtime> (native probe failed: <reason>)`; surfaced via
      runtimeDiagnosticVisible(verbose, selection) = verbose OR fallback;
      wired in run-analysis.ts, arch-json-provider.ts; format + source labels
      tested in tests/unit/plugins/shared/parser-runtime.test.ts.)
- [x] Deprecated-alias usage emits exactly one stderr warning per process.
      (parser-runtime.ts emitDeprecatedAliasWarning + module flag, re-armed by
      the reset test hook; three tests cover once-only, canonical-wins-silently,
      and re-arm behavior.)
- [x] README/docs updated; the canonical variable is unambiguous.
      (README runtime section: canonical-setting paragraph + deprecation +
      diagnostics; docs/user-guide/parser-runtime.md: warning text, new
      diagnostic format with examples, selection.source in the API section.)

## Definition of Done

- [x] Tests and docs committed; before/after CLI/MCP error text samples
      appended to this task body (see Evidence).

## Coordination

Independent of TASK-44. Follows TASK-42 structurally but may start once
TASK-31 lands if scoped to surfacing only.

## Evidence (landed 2026-07-30)

### Before/after error text (the meta-cc incident shape)

BEFORE (2026-07-30 incident): a WASM-only install analyzing Go surfaced a raw
`ERR_MODULE_NOT_FOUND: Cannot find package 'tree-sitter'` stack from the
pipeline's direct construction (bypassing the resolver), and
`ARCHGUARD_PARSER_BACKEND=wasm` was silently a no-op on that path with no
indication of which backend actually ran.

AFTER (asserted by the test suite, green on this machine):
```text
Analysis failed (parser initialization): Failed to initialize go parser with native backend:
cannot load native tree-sitter runtime ("tree-sitter"): Cannot find module 'tree-sitter'
Native tree-sitter is required by policy (ARCHGUARD_PARSER_RUNTIME=native). Install the
optional native accelerator packages ("tree-sitter" and "<grammar>") into ArchGuard's own
package scope, or set ARCHGUARD_NATIVE_MODULE_ROOT to a trusted module root containing them,
or relax the policy to ARCHGUARD_PARSER_RUNTIME=auto|wasm.
Previous query state is unchanged.
```
plus, on every analyze surface (stderr; MCP stdout stays protocol-clean):
```text
[parser-runtime] go: policy=auto source=default -> native
[parser-runtime] java: policy=auto source=env -> wasm (native probe failed: cannot load native tree-sitter runtime ("tree-sitter"): ...)
[parser-runtime] WARNING: ARCHGUARD_PARSER_BACKEND is deprecated and will be removed in a future release; use the canonical ARCHGUARD_PARSER_RUNTIME (auto|native|wasm) instead.
```

### REAL vs SIMULATED
- REAL: the resolver/factory/CLI/MCP code paths under test (env handling,
  diagnostic format, source labels, once-only warning, error mapping, stdout
  cleanliness) — exercised by 78 targeted tests, all green
  (tests/unit/plugins/shared/parser-runtime.test.ts,
  tests/unit/cli/analyze/run-analysis-plugin-loading.test.ts,
  tests/unit/cli/mcp/analyze-tool.test.ts,
  tests/integration/mcp-runtime-diagnostics.test.ts); `npx tsc --noEmit` clean.
- SIMULATED: native binding failures are injected via NativeModuleLoaders
  (the established TASK-39 fault-injection pattern); the MCP server object in
  guard tests is the real McpServer with a mocked runAnalysis (same pattern as
  the pre-existing analyze-tool tests).
- The "before" text is the incident record from this task's proposal; the
  "after" text is what the current code produces per the cited tests.

### Notes
- plugin-factory.ts required NO change: onDiagnostic propagation is inherent
  in its options pass-through to selectParserBackendFor (Touches listed it as
  an upper bound; empty diff, no drift).
- Defensive "env/config setting had no effect on a given path" case: after
  TASK-42 every construction goes through the resolver, so the setting always
  takes effect; the effective-runtime line (with source=) makes any future
  regression visible instead of silent.
- Execution deviation: built INLINE by the loop driver after two dispatched
  builders produced zero artifacts in 40-50 minutes each (API contention on
  this shared host); all verification is driver-run and recorded above.

## Loop-driver land evidence (2026-07-30)

- Driver gate: vitest **PASS**, GateEvent e9827951-9217-4d2f-ac8f-0b5e262c7895
  (ok:true, "acceptance passed (exit 0)", cwd=/tmp/wt-archguard-TASK-43,
  committed tree 4e05d2c + a8b5e0d). Two earlier attempts failed on quay
  infra (missing worktree dist/ — parse workers resolve <root>/dist/parser/
  parse-worker.js — and a hung MCP handler), not the diff.
- Direct corroboration (driver-run, full output logged): npx vitest run
  exit 0 — 4424 passed | 12 skipped | 0 failed (289 files, 457s).
- Final fresh-context audit: NO REFUTATION (AC1-5 genuinely tested; additions-
  only test changes; TASK-42 invariants intact; scope exact; evidence matches
  code). One REFUTATION en route (README missing the ARCHGUARD_PARSER_RUNTIME=auto
  example) was fixed in a8b5e0d before land.
- Anti-drift (committed diff c2ce379..HEAD): OK — 11 files, all within the
  declared Touches (plugin-factory.ts declared as upper bound, untouched).
- Merged to master: ab223a6 (--no-ff milestones/archguard/TASK-43).
- Deviation: executed INLINE by the loop driver after two dispatched builders
  produced zero artifacts in 40-50 min each (host API contention from 4-5
  co-tenant sessions); all verification driver-run and recorded.
