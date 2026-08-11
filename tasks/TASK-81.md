---
id: TASK-81
title: "TASK-81: Run ArchGuard self-analysis and regenerate the architecture
  diagram set"
status: ready
labels:
  - milestone-candidate
  - self-validation
parent: null
children: []
extra: {}
---
# TASK-81: Run ArchGuard self-analysis and regenerate the architecture diagram set

## Proposal

The two-layer loop is cold-starting in the archguard repo with an empty backlog (all 54 prior
tasks done). Seed a real, verifiable first task that exercises the tool's own core analyze path
end-to-end (dogfooding): build ArchGuard, run its self-analysis, and verify the 3-tier diagram set
generates. This is a bounded, self-contained task the inner fast-mode loop can claim and execute
in a worktree.

**选定机制**: `npm run build` → `node dist/cli/index.js analyze -v` (auto-detects project structure
→ overview/package + class/all-classes + method/* diagram set under `.archguard/`), then verify the
key artifacts exist and the analyze exit is 0. `.archguard/` is gitignored (CLAUDE.md output
convention), so the deliverable is the verified-generated set plus the analyze-path evidence — not
a commit of the generated diagrams.

## Acceptance Criteria

- [ ] `npm run build` exits 0 (tsc + tsc-alias + import-fix clean)
- [ ] `node dist/cli/index.js analyze -v` exits 0
- [ ] `.archguard/index.md` and the overview/package diagram are generated
- [ ] Analysis is read-only: no `src/` file was modified; any touched file is lint-clean

## Touches

- `.archguard/` (generated output, gitignored — verified present, not committed)
- `tasks/TASK-81.md` (this task)

## Contract

| Key | Value |
|---|---|
| measure | analyze exit code + presence of `.archguard/index.md` and the package-level diagram |
| band | build exit 0 AND analyze exit 0 AND both artifacts exist |
| invariant | read-only analysis — does not modify `src/`; `.archguard/` stays gitignored |
| invoke | `node dist/cli/index.js analyze -v` (CLAUDE.md Self-Validation) |
| control | non-zero exit or missing artifacts ⇒ task not done (must be honest) |
| resume | evidence recorded in this task body; resume from the build step |

## Definition of Done

- [ ] `npm run build` exits 0
- [ ] `node dist/cli/index.js analyze -v` exits 0
- [ ] `.archguard/index.md` present and lists the generated diagram set
- [ ] overview/package diagram generated (package level)