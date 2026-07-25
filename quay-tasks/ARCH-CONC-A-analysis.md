---
id: ARCH-CONC-A-analysis
title: "CONCURRENCY-BATCH A (DIR-049 autonomous ≥2-wide proof): add one focused
  OFFLINE unit test for a currently-undertested PURE function in src/analysis/ —
  touches ONLY tests/unit/analysis/**, disjoint from batch-mate ARCH-CONC-B
  (src/cli)."
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
- tests/unit/analysis/**

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
One half of the autonomous ≥2-wide concurrent batch that proves DIR-049 (the loop-driver, at
`concurrency: 2`, assembles a touches-disjoint batch and dispatches N concurrent audited builds — no
human orchestration). A dispatched background build subagent should: pick ONE genuinely-useful,
currently-undertested PURE function exported under `src/analysis/` (a formatter / calculator / pure
transform — no network, no filesystem writes, no process spawn), add a NEW focused unit test for it
under `tests/unit/analysis/`, and make the full `npx vitest run` suite green.

Touch ONLY `tests/unit/analysis/**` (a new `*.test.ts` there). Do NOT modify `src/`, do NOT touch any
other package/board file, do NOT touch `tests/unit/cli/**` (that is the disjoint batch-mate
ARCH-CONC-B). Reading `src/` is fine.
<!-- SECTION:DESCRIPTION:END -->

## Constraints
- Touch ONLY `tests/unit/analysis/**`; new `*.test.ts`; no `src/` change; offline.
- Full `npx vitest run` suite stays green.

## Acceptance Criteria
- [ ] A new `tests/unit/analysis/**.test.ts` adds ≥2 meaningful assertions for a real pure `src/analysis/` function; `npx vitest run` exits 0 offline.
- [ ] Only files under `tests/unit/analysis/**` were modified (no `src/`, no other subtree), verifiable by `git diff --name-only`.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts.
- [ ] The new test runs green offline within the full suite; scoped to `tests/unit/analysis/**`; assertions genuinely exercise the function.
