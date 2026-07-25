---
id: TASK-EXP-A-clean
title: "EXPERIMENT (DIR-048 dispatched+audit, SUCCESS path): add one focused
  OFFLINE unit test for a currently-undertested PURE function in src/ — small,
  real, gate-green, honestly meets AC → adversarial audit finds NO refutation →
  lands done."
status: done
labels:
  - experiment
  - dir-048-proof
parent: null
children: []
extra:
  acceptance: npx vitest run
---
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This is the SUCCESS-path half of the DIR-048 archguard proof (dispatched execution + adversarial audit are now the portable loop-driver defaults). A dispatched background build subagent should: pick ONE genuinely-useful, currently-undertested PURE function exported somewhere under `src/` (a formatter / parser / small math or lookup helper — no network, no filesystem side effects, no process spawn), add a NEW focused unit test for it under `tests/unit/`, and make the whole vitest suite green.

The task is deliberately SMALL and honestly completable: after `npx vitest run` passes, a fresh-context adversarial auditor reading the diff against the AC below should find NO refutation, so the task lands `done`. This proves, end-to-end on a real foreign codebase: (a) the build ran in a background subagent (not inline), and (b) an independent auditor verified it before land.
<!-- SECTION:DESCRIPTION:END -->

## Constraints
- Touch ONLY `tests/**` (add a new `tests/unit/**.test.ts`). Do NOT modify `src/`. Reading `src/` is fine.
- The new test must run OFFLINE and PASS; keep the full suite green.
- Pick a REAL pure function that genuinely lacks direct coverage — not a trivial re-test of something already covered.

## Acceptance Criteria
- [ ] A new `tests/unit/**.test.ts` file adds ≥2 meaningful assertions for a real pure `src/` function; `npx vitest run` exits 0 offline (full suite green).
- [ ] Only files under `tests/**` were modified (no `src/`), verifiable by `git diff --name-only`.

## Definition of Done
- [ ] The new test runs green offline as part of the full suite (real object, not a stub); scoped to `tests/**`; the assertions genuinely exercise the chosen function's real behavior.
