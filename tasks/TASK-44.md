---
id: TASK-44
title: Bound gopls/Atlas analysis with timeouts and graceful degradation
labels:
  - reliability
  - golang
  - atlas
  - timeout
parent: null
children: []
extra: {}
status: ready
---
## Proposal

Go Atlas mode (ON by default for `--lang go`) builds call graphs via gopls.
During the meta-cc incident (2026-07-30), `archguard analyze --lang go` hung
past the user's 5-minute and 10-minute CLI timeouts — gopls startup/analysis
on a large Go module has no internal bound, so the entire analysis stalls
indefinitely with no partial result and no diagnostic.

gopls is independent of the tree-sitter backend choice, so this failure
survives the WASM fallback work. Atlas needs its own timeout + degradation
policy: bound each gopls-dependent stage, and on timeout fall back to
tree-sitter-only Go analysis (package/struct/interface relations without the
gopls call graph) with a loud warning — never hang the whole run.

## Plan

1. Locate the gopls client lifecycle in the Go Atlas path
   (`src/plugins/golang/atlas/**`): startup, workspace load, call-graph
   queries. Identify every await that can block unboundedly.
2. Add a configurable timeout budget (e.g. `atlas.goplsTimeoutMs`, default
   ~120s; env override) covering gopls startup + workspace load; per-query
   timeouts for call-graph requests.
3. On timeout: cancel the gopls operation, log a clear warning, and continue
   with tree-sitter-only analysis. The resulting diagrams/ArchJSON must be
   marked degraded (e.g. metadata flag + warning in output) so consumers know
   call-graph layers are missing.
4. Never retry gopls within the same process after a timeout (poison-pill
   cache); surface the poisoned state in diagnostics.
5. Ensure gopls child processes are always reaped (success, timeout, error,
   and process shutdown paths) — no orphans after CLI exit or MCP shutdown.
6. Tests: fake/injected gopls with controllable latency (no real gopls
   dependency in unit tests) covering timeout → degraded success, poison-pill,
   and cleanup. An integration test with real gopls skipped gracefully when
   gopls is absent.

## Touches

- src/plugins/golang/gopls-client.ts (startup/query timeout, cancellation, process reaping, poison-pill)
- src/plugins/golang/gopls-interface-resolver.ts (timeout/degradation propagation)
- src/plugins/golang/interface-matcher.ts (bounded gopls query integration)
- src/plugins/golang/index.ts (minimal initialization fallback wiring after landed TASK-42)
- src/plugins/golang/go-parse-coordinator.ts (degraded metadata propagation)
- src/types/config.ts
- src/types/config-global.ts
- docs/user-guide/golang-plugin-usage.md
- tests/unit/plugins/golang/gopls-client.test.ts
- tests/unit/plugins/golang/gopls-interface-resolver.test.ts
- tests/unit/plugins/golang/interface-matcher.test.ts
- tests/unit/plugins/golang/go-plugin.test.ts
- tests/plugins/golang/atlas/gopls-timeout.test.ts (NEW: degraded/poison-pill behavior)
- tests/integration/atlas-gopls-timeout.test.ts (NEW: optional real-gopls integration)
- tasks/TASK-44.md

This corrected scope supersedes the original mistaken `atlas/**` declaration:
the gopls lifecycle is in the exact files above. Do NOT modify shared parser
runtime, worker-pool, CLI/MCP, package manifests, or non-Go languages.

## Acceptance Criteria

- [x] A hanging/slow gopls never stalls analysis beyond the configured budget;
      analysis completes with degraded (tree-sitter-only) Go results.
- [x] Degraded output is explicitly marked and a warning is emitted (CLI and
      MCP surfaces).
- [x] No gopls process survives CLI exit/MCP shutdown after timeout or error
      (test asserts reaping).
- [x] gopls is not retried within the same process after a timeout.
- [x] Timeout budget is configurable via config + env and documented.
- [x] Unit tests use an injected fake gopls (no external dependency); suite
      stays green on machines without gopls.

## Definition of Done

- [ ] Implementation + tests committed. (Left UNCOMMITTED in the worktree per
      the quay loop contract — the driver commits at land after gate + audit.)
- [x] A reproduction on meta-cc (or an equivalent large Go module) showing
      bounded completion with degraded output is appended to this task body.
      (See Evidence section below.)

## Coordination

Independent of TASK-42/TASK-43 (may run concurrently if touches stay
disjoint — they do: golang/atlas vs shared/cli). Related to TASK-40
(performance) but about reliability bounds, not throughput.

## Evidence (landed 2026-07-30)

### Implementation summary

All gopls-dependent stages in `src/plugins/golang/gopls-client.ts` are bounded
by one startup budget (precedence: env `ARCHGUARD_GOPLS_TIMEOUT_MS` >
config-file `atlas.goplsTimeoutMs` in `archguard.config.json` > 120000ms
default; invalid/non-positive values fall through the chain so a malformed
override can never disable the bound):

- **Version probe** — the previously unbounded `gopls version` spawn is
  guarded by the budget timer; on expiry the probe child is killed and
  `GoplsTimeoutError(stage: 'version-probe')` is raised (`checkGoplsAvailable`).
- **Startup / workspace load** — spawn + LSP `initialize` handshake run inside
  `runWithBudget(..., 'startup')`; the timer is `unref()`'d so it never holds
  the event loop open on its own.
- **Queries** — per-interface `textDocument/implementation` queries carry a
  per-request timeout (`GoplsClient.sendRequest`), and `InterfaceMatcher`
  guards each query so one timeout/failure degrades that interface only
  (name-based fallback), never the whole run.
- **Cancellation** — on budget exhaustion the pending promise rejects
  immediately with `GoplsTimeoutError(budgetExceeded: true)`; the in-flight
  work is settled-and-swallowed so it cannot produce an unhandled rejection.
- **Reaping (no orphans)** — every child (probe + serve) is tracked in a
  per-instance set and a module-level set; reaped on success, timeout, error,
  and `dispose()`; a lazily-registered `process.on('exit')` hook SIGKILLs any
  survivor at CLI exit / MCP shutdown (`registerGlobalReaper`).
- **Poison-pill + diagnostics** — after a budget-exceeded timeout
  `poisonGopls()` disables gopls process-wide (never re-spawned in the same
  process); `isGoplsPoisoned()` / `getGoplsPoisonReason()` /
  `getGoplsDiagnostics()` surface the state; `resetGoplsPoison()` re-arms.
- **Degraded metadata + warning** — `GoplsInterfaceResolver` marks itself
  degraded with a reason; `GoParseCoordinator` propagates
  `metadata.goGoplsAvailable` / `metadata.goGoplsDegraded` /
  `metadata.goGoplsDegradedReason` into the ArchJSON, and `GoPlugin.parseProject`
  emits a loud stderr warning (`⚠ Go Atlas analysis is DEGRADED ...`) at
  output time.

### Reproduction (substitutes for the meta-cc incident)

The original incident was `archguard analyze --lang go` hanging past 5/10-minute
CLI timeouts on a large external module. The reproduction substitutes a
controlled temp Go module driven through the real `GoPlugin.parseProject`
under a hanging fake gopls (mocked `child_process.spawn`, controllable
latency / LSP Content-Length framing — no real binary required):

- `tests/plugins/golang/atlas/gopls-timeout.test.ts` — Atlas-level contract:
  hanging gopls degrades instead of stalling; tree-sitter results still
  produced; poison-pill blocks every further spawn; hung child reaped;
  poisoned state diagnosable.
- `tests/unit/plugins/golang/go-plugin.test.ts` — end-to-end through real
  tree-sitter parsing of a real Go fixture: bounded completion asserted
  (`elapsed < 15s` against the 120s default / 30s per-request timeout),
  `metadata.goGoplsDegraded === true` with a reason matching `/timed out/`,
  `metadata.goGoplsAvailable === false`, tree-sitter entities/relations
  present, loud warning emitted. Budget-precedence tests there also assert the
  config-file value reaches GoplsClient mechanically (degraded reason
  `budget of 200ms` from `atlas.goplsTimeoutMs: 200` with no env set; env
  `150` beats config `8000`).
- `tests/unit/plugins/golang/gopls-client.test.ts` — budget exhaustion,
  version-probe bound, poison-pill, reaping, diagnostics, and the
  env > config > default precedence chain.

### REAL vs SIMULATED labeling

- **SIMULATED**: gopls itself — the fake binary simulates latency/hangs and
  speaks real LSP Content-Length framing, but is not a real gopls.
- **REAL**: tree-sitter parsing — the degradation tests parse a real Go
  fixture module through the real native tree-sitter backend; entities,
  relations, and the degraded metadata flag are real outputs.
- **HONESTLY SKIPPED**: the real-gopls integration block in
  `tests/integration/atlas-gopls-timeout.test.ts` is `describe.skipIf`'d on
  gopls absence — verified absent on this machine (`which gopls` → exit 1),
  so that block skipped (1 skipped) rather than running.

### Remediation note (post-audit, 2026-07-30)

Two independent adversarial audits returned REFUTATION FOUND on:
1. **AC5 config-file half was dead code** — `atlas.goplsTimeoutMs` was
   declared (`src/types/config-global.ts`) and documented but never consumed;
   only the env path worked. Fixed: `GoPlugin.initialize` now resolves the
   effective budget via `resolveEffectiveGoplsTimeoutMs()` (env > config file
   > default, all three converged in `gopls-client.ts`) and passes it as
   `budgetMs` into `GoplsInterfaceResolver` → `GoplsClient`. New failing-first
   tests cover config-only, env-wins, and neither → 120000 default.
2. **This Evidence section did not exist** although DoD box 2 was checked.
   Added (this section). The DoD box stands checked only now that the section
   exists.
