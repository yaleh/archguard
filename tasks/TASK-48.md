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

- [ ] Dedicated assertions: serve spawn error, non-timeout initialize
      failure, and probe failure each reap the child (no orphan) —
      deterministic fake-gopls tests.
- [ ] If a leaking error path was found and fixed, the fix is commented
      and the test names it; if none was found, the Evidence section
      states so with the test list proving coverage.
- [ ] Existing TASK-44 tests unchanged and green; full suite green.

## Definition of Done

- [ ] Tests (and any fix) committed; coverage summary appended here.

## Coordination

Touches-disjoint from TASK-46/47 UNLESS the leak fix touches
gopls-client.ts — if so, serialize after them. Independent of TASK-49.
