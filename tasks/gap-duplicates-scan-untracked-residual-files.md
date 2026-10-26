---
id: gap-duplicates-scan-untracked-residual-files
title: detect_duplicates 扫描范围纳入未跟踪残留文件：加 trackedOnly 选项（git ls-files 扫描集）
status: done
labels:
  - gap
  - defect
  - mcp
  - cli
  - query
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`detect_duplicates` 的 `collectSourceFiles`（`src/analysis/duplicates/group.ts:120-153`）只忽略 `node_modules/`、`dist/`、`.d.ts`，既不看 `.gitignore` 也不看 git 跟踪状态，因此未跟踪的非点残留文件（实测 claudecodeui 的 `server/modules/voice/__criterion-falsify-legacy-attempt-id-1276453.ts`）会被当源码扫入、编造重复组（低阈值档 85 组里有 14 组来自它）。

修复方向：`DuplicateOptions` 新增 `trackedOnly`（默认 false，向后兼容），为 true 时扫描集取 `git ls-files`（`--cached --others --exclude-standard`）命中的 .ts 文件；顺带在扫描时排除 `__*` 前缀的残留文件。

<!-- dedup-ref -->
相关但机制不同：`bug-default-exclude-gitignore-archguardignore` 处理的是「被 .gitignore 忽略 / 已跟踪但想手动排除」的目录（gitignore 感知 + .archguardignore）；本任务处理的是「既未跟踪又未被 gitignore」的残留文件（git 跟踪状态感知）。两者互补，不重叠。

## AC

- [x] `archguard_detect_duplicates` 新增 `trackedOnly` 布尔参数（默认 false，向后兼容）；`npx vitest run tests/unit/cli/mcp/tools/duplicate-tools.test.ts` exit 0，断言参数透传
- [x] `trackedOnly:true` 时 `collectSourceFiles` 以 `git ls-files --cached --others --exclude-standard` 命中的 .ts 集合为扫描集；夹具含一个未跟踪 .ts 文件，断言其被排除、其函数不进重复组；`npx vitest run tests/unit/analysis/duplicates/duplicates.test.ts` exit 0
- [x] `trackedOnly:false`（默认）行为不变，现有用例不回归
- [x] `npm run type-check` 通过

## DoD

夹具放一个未跟踪的 `__criterion-*.ts`，`trackedOnly:true` 下 `detect_duplicates` 的 `scannedFiles` 不含它、其函数不进任何重复组；`trackedOnly:false` 下含它——两次 `scannedFiles`/`groups` 机械对比可判。

## Touches

- tasks/gap-duplicates-scan-untracked-residual-files.md
- src/analysis/duplicates/group.ts
- src/analysis/duplicates/types.ts
- src/cli/mcp/tools/duplicate-tools.ts
- tests/unit/analysis/duplicates/duplicates.test.ts
- tests/unit/cli/mcp/tools/duplicate-tools.test.ts

## Blocker

**2026-10-26T05:23:38.409Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: suite red
- run_id：wk-prod-anchor
- session_id：e5873936-717a-4138-b2e1-d9bd33532166
