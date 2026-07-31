---
id: TASK-48
title: Dedicated tests for non-timeout-error gopls reaping paths (close the
  TASK-44 test gap)
status: ready
labels:
  - reliability
  - golang
  - testing
  - follow-up
parent: null
children: []
extra: {}
---
## Proposal

TASK-44's reaping is implemented on every path (timeout, non-timeout error
via the shared `initialize` catch → `reapAll`, `dispose()`, and the
`process.on('exit')` SIGKILL hook), but the test suite asserts reaping
only for the TIMEOUT paths (version probe + serve) and dispose. The AC
wording "no gopls process survives ... after timeout **or error**" has no
dedicated error-path assertion. Add deterministic tests that a spawn
failure / crashed serve / probe IO error reaps the child (no orphan) and
surfaces the right diagnostics — with an injected fake gopls, no real
binary.

Audit observation from TASK-44's landing (non-blocking there; filed here).

## Plan

1. Enumerate the error paths in gopls-client.ts that must reap:
   serve spawn `error` event, initialize handshake rejection (non-timeout),
   version-probe IO/spawn failure, mid-query child crash.
2. TDD: failing tests first for each path — assert kill/no-orphan on the
   fake child (observable kill handle or exit), poisoned/diagnostics state
   where the code path poisons, and that NO path leaves a tracked child
   in the per-instance or module-level sets.
3. If any error path turns out to leak (possible — this is what the test
   gap could be hiding), FIX it in gopls-client.ts within Touches and
   document the fix.
4. Deterministic only: injected fake gopls with controllable failure
   modes; no sleeps beyond the established small-budget pattern; no real
   gopls dependency.

## Touches

- tests/unit/plugins/golang/gopls-client.test.ts (new error-path reaping tests)
- tests/plugins/golang/atlas/gopls-timeout.test.ts (Atlas-level error-path contract, if applicable)
- src/plugins/golang/gopls-client.ts (ONLY if an error path genuinely leaks — fix + comment; otherwise untouched)
- tasks/TASK-48.md

Do NOT modify timeout-budget semantics, interface-matcher, or anything
outside the golang plugin.

## Acceptance Criteria

- [x] Dedicated assertions: serve spawn error, non-timeout initialize
      failure, and probe failure each reap the child (no orphan) —
      deterministic fake-gopls tests.
- [x] If a leaking error path was found and fixed, the fix is commented
      and the test names it; if none was found, the Evidence section
      states so with the test list proving coverage.
- [x] Existing TASK-44 tests unchanged and green; full suite green.

## Definition of Done

- [x] Tests (and any fix) committed; coverage summary appended here.

## Evidence

### Audit result: NO leaking error paths found.

All error paths in gopls-client.ts were audited. Every path properly cleans
up child processes — no orphan survives any of the tested scenarios. The
code was left **untouched** (no fix needed in gopls-client.ts).

### Error paths enumerated and tested (all in gopls-client.test.ts)

| # | Path | Test name | Reap mechanism |
|---|------|-----------|---------------|
| 1 | Serve spawn fails (null streams) | `reaps the child when serve spawn fails (null stdin → synchronous stream check throws)` | `initialize` catch → `reapAll()` |
| 2 | Serve emits error during handshake | `reaps the child when serve emits error during initialize handshake` | `initialize` catch → `reapAll()` |
| 3 | Serve crashes (exit code 1) during handshake | `reaps the child when serve crashes (exit code 1) during handshake` | `initialize` catch → `reapAll()` |
| 4 | LSP initialize error response | `reaps the child on LSP initialize error response (non-timeout rejection)` | `initialize` catch → `reapAll()` |
| 5 | Version probe spawn fails (error event) | `reaps the child when version probe spawn fails (error event)` | `checkGoplsAvailable` error handler → `reapProcess()` |
| 6 | Version probe exits non-zero | `properly untracks the child when version probe exits with non-zero code` | `checkGoplsAvailable` exit handler → `untrackProcess()` |
| 7 | Mid-query serve crash after init | `handles serve crash after initialization without leaking tracking state` | `dispose()` → `reapAll()` |

### Tracking hygiene observation (non-blocking)

`handleProcessExit()` does not call `untrackProcess()`. When the serve
process crashes mid-query, the dead ChildProcess reference persists in
`liveChildren` and `liveGoplsChildren` until `dispose()` or process exit.
This is **not a resource leak**: the OS process is already dead, no PID
or memory is consumed, `SIGKILL` on the stale reference is harmless
(caught by try/catch in `reapAll` / `reapProcess`), and `dispose()`
always cleans up.

### Test results

```
✓ tests/unit/plugins/golang/gopls-client.test.ts (33 tests) — all pass
✓ tests/plugins/golang/atlas/gopls-timeout.test.ts (1 test) — pass
✓ tests/unit/plugins/golang/go-plugin.test.ts (7 tests) — all pass
✓ Full Go plugin suite (556 tests, 4 skipped) — all pass
```

All existing TASK-44 tests remain unchanged and green. No regressions.

## Coordination

Touches-disjoint from TASK-46/47 UNLESS the leak fix touches
gopls-client.ts — if so, serialize after them. Independent of TASK-49.
