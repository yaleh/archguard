---
id: TASK-33
title: Identify and stabilize the pre-existing flaky test
status: ready
labels:
  - test
  - flaky
parent: null
children: []
extra: {}
---
## Proposal

During TASK-30's build on 2026-07-29, one full `npx vitest run` produced a
single transient failure (4078/4079 passed) that did not recur in two
subsequent runs, and the failing test's identity was not captured (output
not saved). The suite otherwise passes consistently (4079 passed | 11
skipped). A silent flake undermines the vitest gate's meaning — any future
gate failure could be dismissed as "probably the flake".

## Plan

1. Run the full suite repeatedly (e.g. 10 consecutive runs, saving each
   output; note TASK-32 raises the gate timeout — use a `timeoutMs`/CLI
   timeout of ≥300s per run until TASK-32 lands).
2. If the flake reproduces: identify the test, root-cause it (timing,
   shared mutable state, fs/order assumptions, worker races), and fix the
   test or the code it exercises.
3. If it does NOT reproduce in 10 runs: record that fact as evidence and
   add a CI-friendly retry-or-report mechanism only if cheap; otherwise
   close with the evidence.
4. Do not blanket-skip tests to make the problem disappear.

## Touches

- tasks/TASK-33.md
- .gitignore
- .agents/skills/project-semantics-discovery/references/archguard-project-semantics.json
- tests/integration/parallel-diagrams.test.ts

The task was removed from the prior active batch before expanding this touch set.
The reproduced failure was a dependency-readiness/tracking defect: the required
skill fixture existed in the main working tree but was excluded by the broad
`archguard*.json` ignore rule. The declaration now includes the narrow ignore
exception and fixture. A later full-suite run identified the original timing
flake exactly: `tests/integration/parallel-diagrams.test.ts` asserted that three
parallel operations finished within an arbitrary 400 ms wall-clock threshold;
under concurrent load they took 440 ms even though completion time cannot prove
or disprove overlap. The expanded declaration includes that exact test so it can
replace elapsed-time inference with deterministic concurrency evidence. Product
code remains out of scope.

## Acceptance Criteria

- [ ] Either (a) the flaky test is identified by name, root-caused, and
      fixed, with ≥5 consecutive full-suite runs passing (evidence:
      pass counts per run appended to this task body); or (b) 10
      consecutive full runs pass with zero failures and the evidence is
      recorded in this task body.
- [ ] No test is skipped or weakened solely to avoid the flake.

## Definition of Done

- [ ] Fix (if any) committed to a milestone branch (merge to master
      pending human-steered merge).
- [ ] Run evidence (per-run results, test name + root cause if found)
      appended to this task body.