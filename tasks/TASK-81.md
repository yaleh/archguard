---
id: TASK-81
title: "TASK-81: Run ArchGuard self-analysis and regenerate the architecture
  diagram set"
status: done
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

- [x] `npm run build` exits 0 (tsc + tsc-alias + import-fix clean)
- [x] `node dist/cli/index.js analyze -v` exits 0
- [x] `.archguard/index.md` and the overview/package diagram are generated (current tool layout: `.archguard/output/index.md` + `.archguard/output/task-81/overview/package.*` — see Evidence)
- [x] Analysis is read-only: no `src/` file was modified; any touched file is lint-clean

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

- [x] `npm run build` exits 0
- [x] `node dist/cli/index.js analyze -v` exits 0
- [x] `.archguard/index.md` present and lists the generated diagram set (generated as `.archguard/output/index.md` in the current tool layout)
- [x] overview/package diagram generated (package level)

## Evidence (2026-08-11, outer dispatch tick)

- Build: `npm run build` exit 0 in worktree `task-81` (tsc + tsc-alias + import-fix + runtime-deps all clean).
- Self-analysis: `node dist/cli/index.js analyze -v` exit 0. Generated 11 diagrams, 11/11 successful, 0 failed.
- Index: `.archguard/output/index.md` present, lists the full diagram set (Total Diagrams 11 / Successful 11 / Failed 0).
- Package-level diagram: `.archguard/output/task-81/overview/package.mmd` + `.png` + `.svg` generated (Entities 96, Relations 298). Class-level `task-81/class/all-classes` (772 entities) also generated.
- Read-only: worktree `git status --short` empty after analysis — `src/` byte-identical to master HEAD, `.archguard/` fully gitignored (gitignore:58 `/.archguard/`).
- Lint: `npx eslint src/ --max-warnings 0` → 0 errors, 130 pre-existing warnings, all in `src/` files untouched by this task (baseline condition on master).
- Typecheck: `npx tsc --noEmit` exit 0.
- Tests: full `npx vitest run` = 397 failed / 4625 passed / 150 skipped (5172). All 397 failures are the same family — missing optional native `tree-sitter`/`node-gyp-build` (native-parser backend) — a deliberate environmental condition: TASK-41 (0b1c7122) removed native grammars from the bare install closure ("deterministic WASM baseline"; CI installs them `--no-save` separately). `src/` untouched ⇒ master fails identically; **not a regression from this task**. Task Touches contain no test files, so the tick's scoped `--for-task` gate resolves empty.
- Path note: DoD/AC literally read `.archguard/index.md`, but the current tool emits the index at `.archguard/output/index.md` (output nested under `output/`). The substantive DoD — an index.md listing the generated diagram set plus a package-level diagram — is fully met at the current canonical layout.