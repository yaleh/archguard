---
id: TASK-43
title: Surface actionable parser-backend errors and effective-runtime diagnostics on the analyze paths
labels:
  - ux
  - diagnostics
  - parser
parent: null
children: []
extra: {}
status: ready
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

- [ ] CLI analyze with a failed language init prints the actionable
      ParserInitializationError remediation (test per language family).
- [ ] MCP analyze error payloads carry the actionable message, and MCP stdout
      remains protocol-clean (guard test).
- [ ] Verbose (and fallback-triggered non-verbose) output shows language →
      backend → choice-source → fallback reason.
- [ ] Deprecated-alias usage emits exactly one stderr warning per process.
- [ ] README/docs updated; the canonical variable is unambiguous.

## Definition of Done

- [ ] Tests and docs committed; before/after CLI/MCP error text samples
      appended to this task body.

## Coordination

Independent of TASK-44. Follows TASK-42 structurally but may start once
TASK-31 lands if scoped to surfacing only.
