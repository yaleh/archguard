---
id: ARCH-CONC-B-cli
title: "CONCURRENCY-BATCH B (DIR-049 autonomous ≥2-wide proof): add one focused
  OFFLINE unit test for a currently-undertested PURE function in src/cli/ —
  touches ONLY tests/unit/cli/**, disjoint from batch-mate ARCH-CONC-A
  (src/analysis)."
status: done
labels:
  - experiment
  - dir-049-proof
parent: null
children: []
extra:
  schema: v1
---
## Touches
- tests/unit/cli/**

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The other half of the autonomous ≥2-wide concurrent batch proving DIR-049. A dispatched background
build subagent should: pick ONE genuinely-useful, currently-undertested PURE function exported under
`src/cli/` (an argument/format/parse helper — no network, no filesystem writes, no process spawn), add
a NEW focused unit test for it under `tests/unit/cli/`, and make the full `npx vitest run` suite green.

Touch ONLY `tests/unit/cli/**` (a new `*.test.ts` there). Do NOT modify `src/`, do NOT touch any other
package/board file, do NOT touch `tests/unit/analysis/**` (that is the disjoint batch-mate
ARCH-CONC-A). Reading `src/` is fine.
<!-- SECTION:DESCRIPTION:END -->

## Constraints
- Touch ONLY `tests/unit/cli/**`; new `*.test.ts`; no `src/` change; offline.
- Full `npx vitest run` suite stays green.

## Acceptance Criteria
- [ ] A new `tests/unit/cli/**.test.ts` adds ≥2 meaningful assertions for a real pure `src/cli/` function; `npx vitest run` exits 0 offline.
- [ ] Only files under `tests/unit/cli/**` were modified (no `src/`, no other subtree), verifiable by `git diff --name-only`.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts.
- [ ] The new test runs green offline within the full suite; scoped to `tests/unit/cli/**`; assertions genuinely exercise the function.
