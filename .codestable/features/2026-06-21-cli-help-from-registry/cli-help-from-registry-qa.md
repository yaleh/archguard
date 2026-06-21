---
doc_type: feature-qa
feature: 2026-06-21-cli-help-from-registry
status: passed
tested: 2026-06-21
round: 2
---

# cli-help-from-registry QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-design.md`
- Checklist: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-checklist.yaml`
- Review: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-review.md`
- Diff basis: current worktree diff after independent review fixes
- Baseline dirty files: none outside this roadmap work were identified
- Feature type: mixed
- Core evidence gate: actual built CLI subprocess evidence is required for structured help and human help compatibility.

## 2. Verification Matrix

| ID | 来源 | 核心性 | 场景 / 风险 | 证据类型 | 命令或动作 | 期望 | 结果 |
|---|---|---|---|---|---|---|---|
| QA-001 | design required command | supporting | TypeScript compiles | typecheck | `npm run type-check` | exit 0 | pass |
| QA-002 | design required command | supporting | Help and drift unit tests pass | unit | `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/cli-metadata-drift.test.ts` | exit 0 | pass |
| QA-003 | design required command | supporting | Existing CLI command behavior tests still pass | unit | `npm test -- tests/unit/cli/metadata-registry.test.ts tests/unit/cli/command.test.ts tests/unit/cli/commands/query.test.ts` | exit 0 | pass |
| QA-004 | design required command | core-functional | Built CLI can run after ESM import patching | build | `npm run build` | exit 0 | pass |
| QA-005 | design E2E | core-functional | `help --json` emits parseable registry-backed JSON | e2e | `npm run test:e2e -- tests/integration/e2e/cli-structured-help.e2e.test.ts` | exit 0 | pass |
| QA-006 | review focus | core-functional | Built CLI JSON has all 7 commands and query summary mapping | CLI smoke | `node dist/cli/index.js help --json` parsed with Node | `commands=7`, `summary=archguard_summary` | pass |
| QA-007 | review focus | core-functional | Human help remains readable | CLI smoke / E2E | `node dist/cli/index.js help`, `help query`, `--help`, `query --help` | text help, no JSON | pass |

## 3. Command Results

- `npm run type-check` -> exit 0: TypeScript passed.
- `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/cli-metadata-drift.test.ts` -> exit 0: 11 tests passed.
- `npm test -- tests/unit/cli/metadata-registry.test.ts tests/unit/cli/command.test.ts tests/unit/cli/commands/query.test.ts` -> exit 0: 78 tests passed.
- `npm run build` -> exit 0: `tsc`, `tsc-alias`, `scripts/fix-imports.sh`, script compile, and CLI chmod completed.
- `npm run test:e2e -- tests/integration/e2e/cli-structured-help.e2e.test.ts` -> exit 0: 5 built CLI E2E tests passed.
- `node dist/cli/index.js help --json` parse smoke -> exit 0: `{"program":"archguard","schemaVersion":1,"commands":7,"summary":"archguard_summary"}`.

## 4. Scenario Results

- [x] QA-001 typecheck: pass
  - Evidence: command exit 0.
- [x] QA-002 unit help/drift tests: pass
  - Evidence: help command covers JSON-only stdout, human fallback, `help query`, and structured-help extra-arg error; drift covers all business commands bidirectionally.
- [x] QA-003 existing CLI behavior tests: pass
  - Evidence: command/query tests still pass.
- [x] QA-004 build: pass
  - Evidence: build completed and fixed relative ESM imports.
- [x] QA-005 built CLI E2E: pass
  - Evidence: spawned `dist/cli/index.js` for JSON and human help paths.
- [x] QA-006 structured help content: pass
  - Evidence: parsed JSON has 7 business commands and query `--summary` maps to `archguard_summary`.
- [x] QA-007 human help compatibility: pass
  - Evidence: built CLI `help` and `help query` print Commander text; E2E also verifies `--help` and `query --help`.

## 5. Findings

### failed

- none

### blocked

- none

### residual-risk

- Option description text equality is not enforced in this feature; this is a staged migration boundary, not a core QA gap.

## 6. Cleanliness

- Debug output: pass
- Temporary TODO/FIXME/XXX: pass
- Commented-out code: pass
- Unused imports / dead code from this feature: pass
- Out-of-scope files: pass; `scripts/fix-imports.sh` is tied to built CLI E2E evidence.

## 7. Verdict

- Status: passed
- Next: `cs-feat-accept`
