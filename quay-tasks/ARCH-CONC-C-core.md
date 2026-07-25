---
id: ARCH-CONC-C-core
title: "CONCURRENCY-BATCH C (DIR-049 autonomous ≥2-wide proof, re-attempt on
  0.3.12): add one focused OFFLINE unit test for a currently-undertested PURE
  function in src/core/ — touches ONLY tests/unit/core/**, disjoint from
  batch-mate ARCH-CONC-B (src/cli)."
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
- tests/unit/core/**

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fresh disjoint mate for ARCH-CONC-B, re-attempting the autonomous ≥2-wide concurrent batch on plugin
0.3.12 (which now ships the DIR-044 scheduler scripts). A dispatched background build subagent should:
pick ONE genuinely-useful, currently-undertested PURE function exported under `src/core/` (a pure
transform / validator / lookup — no network, no filesystem writes, no process spawn), add a NEW focused
unit test for it under `tests/unit/core/`, and make the full `npx vitest run` suite green.

Touch ONLY `tests/unit/core/**` (a new `*.test.ts` there). Do NOT modify `src/`, do NOT touch any other
package/board file, do NOT touch `tests/unit/cli/**` (that is the disjoint batch-mate ARCH-CONC-B).
Reading `src/` is fine.
<!-- SECTION:DESCRIPTION:END -->

## Constraints
- Touch ONLY `tests/unit/core/**`; new `*.test.ts`; no `src/` change; offline.
- Full `npx vitest run` suite stays green.

## Acceptance Criteria
- [ ] A new `tests/unit/core/**.test.ts` adds ≥2 meaningful assertions for a real pure `src/core/` function; `npx vitest run` exits 0 offline.
- [ ] Only files under `tests/unit/core/**` were modified (no `src/`, no other subtree), verifiable by `git diff --name-only`.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts.
- [ ] The new test runs green offline within the full suite; scoped to `tests/unit/core/**`; assertions genuinely exercise the function.
