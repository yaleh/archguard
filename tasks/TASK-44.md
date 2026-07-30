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

- src/plugins/golang/atlas/** (timeout budget, cancellation, degradation, poison-pill, gopls reaping)
- src/plugins/golang/go-parse-coordinator.ts (degraded-mode propagation into Go analysis result)
- src/types/config.ts src/types/config-global.ts (atlas.goplsTimeoutMs config fields)
- docs/user-guide/golang-plugin-usage.md (Atlas timeout + degradation documentation)
- tests/unit/plugins/golang/** (fake-gopls unit tests, cleanup tests)
- tests/plugins/golang/** (degraded-mode plugin tests)
- tests/integration/atlas-*.test.ts (NEW: optional real-gopls integration, skip-if-absent)
- tasks/TASK-44.md

Do NOT modify: package.json/lock, src/plugins/golang/index.ts (constructor —
owned by parallel TASK-42), src/plugins/shared/**, src/cli/**,
src/parser/** (owned by parallel TASK-40).

## Acceptance Criteria

- [ ] A hanging/slow gopls never stalls analysis beyond the configured budget;
      analysis completes with degraded (tree-sitter-only) Go results.
- [ ] Degraded output is explicitly marked and a warning is emitted (CLI and
      MCP surfaces).
- [ ] No gopls process survives CLI exit/MCP shutdown after timeout or error
      (test asserts reaping).
- [ ] gopls is not retried within the same process after a timeout.
- [ ] Timeout budget is configurable via config + env and documented.
- [ ] Unit tests use an injected fake gopls (no external dependency); suite
      stays green on machines without gopls.

## Definition of Done

- [ ] Implementation + tests committed.
- [ ] A reproduction on meta-cc (or an equivalent large Go module) showing
      bounded completion with degraded output is appended to this task body.

## Coordination

Independent of TASK-42/TASK-43 (may run concurrently if touches stay
disjoint — they do: golang/atlas vs shared/cli). Related to TASK-40
(performance) but about reliability bounds, not throughput.
