---
id: TASK-93
title: "TASK-93: 「无法评估」与「合格」同形——intrinsic_dimension / evidence_pack 缺数据时返回看似有效的结果"
status: todo
labels:
  - gap
  - defect
  - mcp
parent: null
children: []
extra: {}
---
## Proposal

两处「没有数据」被表达成「一切正常」的形状：
- `src/cli/mcp/tools/arch-health-tools.ts`：没有 arch-health 历史时返回 `{current:null, history:[], trend:"stable"}`。`trend:"stable"` 与真实的「稳定」无法区分，调用方（含自动化）会读成合格。
- `archguard_get_evidence_pack`（`src/cli/mcp/tools/git-history-evidence-pack-tool.ts`）：请求的文件在 git 数据里找不到时，结果落在 `notFound` 数组，和有数据的结果同处一个响应；实测 `plugin/scripts/driver-runtime.ts` 因 key 是相对源根的而「not found」，调用方容易当成「没有历史风险」。

方案：引入统一的未评估形状：`{evaluated:false, reason:"<机器可读代码>", hint:"<怎么补数据>"}`，取代上述两处的空/默认值。`intrinsic_dimension` 在无历史时返回该形状（不再给 `trend:"stable"`）；`evidence_pack` 在全部 notFound 时返回 `evaluated:false` 并在 hint 里给出 git 数据里实际存在的 key 样例。有数据时的响应形状不变。

<!-- dedup-ref -->
相关但机制不同：TASK-94（git 窗口截断标志）和 TASK-95（git 路径 key 的解析规则）。本任务只统一「未评估」的表达，不改 key 解析规则。TASK-64（intrinsic dimension 的原始实现，已完成）定义了当前形状。

## AC

- [ ] `npx vitest run tests/unit/cli/mcp/tools/arch-health-tools.test.ts` exit 0，新增用例：无历史文件时响应含 `evaluated:false` 与非空 `reason`，且不含 `trend:"stable"`；有历史时响应形状与修复前一致（回归）
- [ ] `npx vitest run tests/unit/cli/mcp/tools/git-history-evidence-pack.test.ts` exit 0，新增用例：请求路径全部 notFound 时响应含 `evaluated:false`，`hint` 含 git 数据里存在的一个真实 key 样例；部分命中时仍返回命中项
- [ ] `npx vitest run tests/unit/analysis/git-history/history-query-evidence-pack.test.ts` exit 0（回归）
- [ ] `grep -rn "trend: 'stable'" src/cli/mcp/tools/arch-health-tools.ts` 只剩 `computeTrend` 内基于两份快照得出的分支
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

对一个从未跑过 arch-health 的真实 `.archguard` 目录调用 `archguard_get_intrinsic_dimension`，得到 `evaluated:false` 加原因，而不是 `stable`；对一个必然 notFound 的路径调用 `archguard_get_evidence_pack`，得到 `evaluated:false` 加可用 key 样例。

## Touches

- `src/cli/mcp/tools/arch-health-tools.ts`
- `src/cli/mcp/tools/git-history-evidence-pack-tool.ts`
- `src/analysis/git-history/history-query.ts`
- `tests/unit/cli/mcp/tools/arch-health-tools.test.ts`
- `tests/unit/cli/mcp/tools/git-history-evidence-pack.test.ts`
- `tasks/TASK-93.md`
