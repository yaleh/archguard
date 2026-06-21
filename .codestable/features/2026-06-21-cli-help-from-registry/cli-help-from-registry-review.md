---
doc_type: feature-review
feature: 2026-06-21-cli-help-from-registry
status: passed
reviewed: 2026-06-21
round: 2
---

# cli-help-from-registry 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-design.md`
- Checklist: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-checklist.yaml`
- Implementation evidence: current worktree diff plus passing validation commands listed in QA.
- Diff basis: `git status --short` shows modified `scripts/fix-imports.sh`, `src/cli/index.ts`, and new `src/cli/commands/help.ts`, metadata files, CLI tests, E2E test, and CodeStable reports.
- Baseline dirty files: none outside this roadmap work were identified.

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent `6730e1f4-ebf5-4b2e-ba53-641f8ecd2bcb`
- Raw output: Paseo activity summary reported two blocking gaps and several important findings.
- Merge policy: all findings were locally checked against final code and tests.
- Gate effect: initial blocking findings were fixed before this final review verdict.

Independent reviewer findings merged:

- B1 missing human help snapshot/smoke coverage: fixed by `tests/integration/e2e/cli-structured-help.e2e.test.ts`.
- B2 missing built CLI E2E parse coverage: fixed by the same E2E test, which spawns `node dist/cli/index.js help --json`.
- I1 `archguard help` / `archguard help query` regression: fixed by human help fallback in `src/cli/commands/help.ts`.
- I2/I3/I4 drift test was query-only and one-directional: fixed by bidirectional all-business-command option drift checks and query mapping reverse checks.
- I5 option descriptions remain inline in Commander: accepted for this feature because the design explicitly allowed option registration to remain inline initially; drift checks now prove option existence and MCP mapping, not text equality.
- I6 `scripts/fix-imports.sh` scope: kept and documented because built CLI E2E proved the build path is part of this feature's core evidence; the Perl rewrite makes extension patching cross-platform and handles dynamic imports.

## 2. Diff Summary

- 新增：
  - `src/cli/commands/help.ts`
  - `tests/unit/cli/help-command.test.ts`
  - `tests/unit/cli/cli-metadata-drift.test.ts`
  - `tests/integration/e2e/cli-structured-help.e2e.test.ts`
- 修改：
  - `src/cli/index.ts`
  - `scripts/fix-imports.sh`
  - `.codestable/architecture/ARCHITECTURE.md`
  - feature checklist and reports
- 删除：none
- 未跟踪 / staged：feature deliverables are untracked pending commit
- 风险热点：CLI help behavior and built ESM import path handling

## 3. Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- Consider emitting registry `verification` hints in structured help in a later docs/agent-surface feature.

### learning

- A custom Commander `help` command must preserve `help` and `help <command>` human flows explicitly when it is also used for machine-readable output.
- CLI metadata drift tests need bidirectional checks; otherwise structured help can advertise flags that Commander no longer accepts.

### praise

- The structured help command keeps JSON isolated to `archguard help --json`; default `--help` output remains Commander text.
- The built CLI E2E catches the actual ESM import patching path, not just source-level command factories.

## 4. Test And QA Focus

- QA 必须重点复核：`archguard help --json`, `archguard --help`, `archguard query --help`, `archguard help`, `archguard help query`, all-business-command drift tests, and query MCP mapping checks.
- 建议新增或加强的测试：none for this feature after the E2E and bidirectional drift additions.
- 不能靠 review 完全确认的点：built CLI import path behavior; covered by QA commands.

## 5. Residual Risk

- Option description text still has two sources: Commander inline text and registry metadata. This is a known staged migration choice from the design; this feature enforces option presence and MCP mapping parity, not text identity.
- `help --json <command>` intentionally fails because structured help is whole-catalog JSON only.

## 6. Verdict

- Status: passed
- Next: `cs-feat-qa`
