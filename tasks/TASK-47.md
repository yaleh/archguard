---
id: TASK-47
title: Honor custom --config paths in the gopls budget config read (eliminate
  the cwd-only caveat)
status: ready
labels:
  - reliability
  - golang
  - follow-up
parent: null
children: []
extra: {}
---
## Proposal

TASK-44's remediation wired `atlas.goplsTimeoutMs` through
`readGoplsTimeoutFromConfigFile`, which reads `archguard.config.json` from
`process.cwd()` only. A user who runs `archguard analyze --config
/path/to/custom.json` gets their startup-budget setting silently ignored —
the docs disclose this caveat, but the honest fix is to honor the resolved
configuration. The loaded config is already in scope at plugin
construction time (GoPlugin receives `PluginInitConfig`, and index.ts reads
`config.languageSpecific`); the budget resolution should consume the same
source rather than re-reading a cwd-relative file.

Audit observation from TASK-44's landing (non-blocking there; filed here).

## Plan

1. Investigate the minimal plumbing: what reaches GoPlugin.initialize
   (PluginInitConfig shape in src/core/interfaces/language-plugin.ts;
   what the CLI's ConfigLoader resolves for --config; whether the loaded
   GlobalConfig/atlas section can flow through createLanguagePlugin →
   GoPlugin → GoplsInterfaceResolver → GoplsClient).
2. Implement the minimal honest option: prefer passing the resolved
   `atlas` config section (or config-file path) through the existing
   construction path over any new ambient mechanism. Keep env precedence
   intact (env > resolved config > cwd-file > 120s default — or collapse
   to env > resolved config > default once the resolved config supersedes
   the cwd read; document the final chain).
3. Tests first: budget set in a non-cwd config file (or programmatic
   config) reaches GoplsClient mechanically (degraded-reason proof like
   TASK-44's "budget of 200ms" pattern); env still wins; default intact.
4. Update docs: replace the custom-`--config` caveat with the real
   behavior and the final precedence chain.

## Touches

- src/plugins/golang/gopls-client.ts (budget resolution consumes passed config)
- src/plugins/golang/gopls-interface-resolver.ts (options propagation)
- src/plugins/golang/index.ts (pass resolved config into resolver)
- src/core/interfaces/language-plugin.ts (ONLY if PluginInitConfig needs the atlas section — minimal additive change)
- src/plugins/shared/plugin-factory.ts (ONLY if propagation requires it — diagnostic-style pass-through)
- docs/user-guide/golang-plugin-usage.md
- tests/unit/plugins/golang/gopls-client.test.ts
- tests/unit/plugins/golang/go-plugin.test.ts
- tasks/TASK-47.md

Do NOT change selection semantics, startup-budget default, or non-Go
languages. If the minimal plumbing would require touching ConfigLoader or
CLI argument handling, STOP and re-scope this task before editing.

## Acceptance Criteria

- [x] `atlas.goplsTimeoutMs` set in a custom `--config` file (or
      programmatically supplied config) reaches GoplsClient (mechanical
      test proof, not a docs claim).
- [x] Documented precedence chain matches code exactly; env override
      still wins; default 120s intact when nothing is set.
- [x] No behavior change for the cwd-config and env-only paths (existing
      tests green, no weakened assertions).
- [x] Docs updated; full suite green.

## Definition of Done

- [x] Tests + docs committed; before/after behavior summary appended.

## Before/After Behavior Summary (TASK-47, 2026-07-31)

**Before:** `GoPlugin.initialize` always called `resolveEffectiveGoplsTimeoutMs()`,
which reads `archguard.config.json` from `process.cwd()` only. A user who ran
`archguard analyze --config /path/to/custom.json` with `atlas.goplsTimeoutMs`
in that file got their setting silently ignored. The docs disclosed this caveat
and advised using the env variable workaround.

**After:** `GoPlugin.initialize` checks `PluginInitConfig.languageSpecific` for
the resolved configuration's `atlas.goplsTimeoutMs`. When present, it wins over
the cwd-file read. The CLI's `arch-json-provider.ts` passes
`diagram.languageSpecific` (already in scope) into `plugin.initialize`. The
precedence chain is: `ARCHGUARD_GOPLS_TIMEOUT_MS` (env) > `atlas.goplsTimeoutMs`
(resolved config, honours --config) > 120s default. When no resolved config is
available (e.g. programmatic plugins not using the CLI path), the plugin falls
back to `resolveEffectiveGoplsTimeoutMs()` (cwd-file read) for backward
compatibility.

**Files changed:**
- `src/core/interfaces/language-plugin.ts`: added `languageSpecific` to `PluginInitConfig`
- `src/plugins/golang/index.ts`: read budget from `config.languageSpecific?.atlas?.goplsTimeoutMs`
- `src/plugins/golang/gopls-client.ts`: updated scope note on `readGoplsTimeoutFromConfigFile`
- `src/cli/processors/arch-json-provider.ts`: pass `languageSpecific` in `plugin.initialize` for Go
- `docs/user-guide/golang-plugin-usage.md`: removed --config caveat, documented new precedence
- `tests/unit/plugins/golang/go-plugin.test.ts`: 3 new tests (resolved config, env wins, cwd fallback)
- `tasks/TASK-47.md`: this summary

## Coordination

Overlaps TASK-46 on gopls-client.ts / docs / tests — serialize, do not
batch. Independent of TASK-48/49.
