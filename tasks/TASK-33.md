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

The initial touch set is evidence-only: repeated runs may update this task but
must not modify tests or product code concurrently with another batch member.
If reproduction identifies a defect, remove the task from the active batch and
update this declaration with the concrete test and/or `src/<area>/**` paths
before making the fix.

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