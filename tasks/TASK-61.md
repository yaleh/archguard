---
id: TASK-61
title: "TASK-61: 恢复 types↔analysis 环的回归守卫测试到 master"
status: todo
labels:
  - defect
  - test
  - hygiene
parent: null
children: []
extra:
  schema: v1
---
# TASK-61: 恢复 types↔analysis 环的回归守卫测试到 master

## Proposal

DIR-001（types↔analysis 双向依赖环）已修但**回归守卫缺失**。核实证据（2026-08-05 内层冷启动）：

- 环修复在 master 上是 `fd0733c`（fix(types): break types↔analysis bidirectional dependency
  cycle）——把 FitnessConfig 提升到 `src/types/fitness-rules.ts`，提交信息声明「cycle eliminated，
  4068 tests pass」。
- **但 `fd0733c` 只动 3 个源文件（`src/analysis/fitness/rule-types.ts`、`src/types/config-global.ts`、
  `src/types/fitness-rules.ts`），未加任何测试。**
- 唯一存在的守卫 `tests/types/no-analysis-imports.test.ts` 由 `e086e65` 创建（含在
  `milestones/archguard/ARCH-INVERSION-001` 分支），该分支是被替代的备选方案，**从未合并到 master**
  ——`git merge-base --is-ancestor e086e65 master` = NO。
- 现状：环已被破（`grep "@/analysis" src/types/` → 0 文件），但**没有任何自动化守卫**防止环回归。
  若有人重新在 `src/types/` 里引入对 `@/analysis` 的 import，环会静默复发。

### 选定机制

把 `tests/types/no-analysis-imports.test.ts` 从 `milestones/archguard/ARCH-INVERSION-001` 分支
移植到 master（`git show e086e65:tests/types/no-analysis-imports.test.ts` 取内容），核对其断言与
master 现状兼容（master 的方案是 `fitness-rules.ts`，分支方案是 `fitness.ts`——守卫断言的是「types
不 import analysis」，与具体提升到哪个文件无关，应兼容）。若断言引用了分支专用路径，调整为 master
路径后落地。跑 scoped 测试验证守卫有效 + 用负控制证明它抓得住复发。

## Contract

measure   `npx vitest run tests/types/no-analysis-imports.test.ts` 的退出码 + passed 数
band      退出码 0、测试全过（守卫存在且绿）
invariant 守卫断言只针对「src/types 不 import src/analysis」，不引入其他脆断言
invoke    `npx vitest run tests/types/no-analysis-imports.test.ts`
control   临时在 src/types 里加一个 `import '@analysis/...'` 的桩 → 守卫必须红（证明抓得住复发）
resume    守卫落地且 scoped 绿即写盘进度；被打断可从「已 git show 到内容」处续

## 任务

1. `git show e086e65:tests/types/no-analysis-imports.test.ts > /tmp/guard.ts` 取分支守卫内容。
2. 核对断言与 master 路径兼容（分支用 `src/types/fitness.ts`，master 是 `src/types/fitness-rules.ts`；
   断言若引用前者需改为后者或改为不依赖具体文件名）。兼容后落到 `tests/types/no-analysis-imports.test.ts`。
3. 跑 `npx vitest run tests/types/no-analysis-imports.test.ts` → 绿。
4. 负控制：临时在 `src/types/` 某文件加 `import type {} from "@/analysis/..."` 桩 → 守卫红 →
   撤销桩 → 守卫绿。贴负控制输出为证据。
5. 报告：守卫已落地 master，DIR-001 的 AC1 从「仅一次验证」升级为「持续守卫」。

## Acceptance Criteria

- [ ] `tests/types/no-analysis-imports.test.ts` 存在于 master（scoped 测试绿）
- [ ] 守卫断言「src/types 不 import src/analysis」，与 master 的 `fitness-rules.ts` 路径兼容
- [ ] 负控制验证：故意引入 types→analysis import 时守卫变红（输出贴入任务体）
- [ ] 不触碰 `src/types/fitness-rules.ts` 等实现文件（纯测试落地）

## Definition of Done

- [ ] `npx vitest run tests/types/no-analysis-imports.test.ts` 退出码 0
- [ ] 负控制输出已贴入任务体（证明守卫抓得住回归）
- [ ] 守卫文件已提交到 master（随任务 fan-in 合并）

## Touches

- tests/types/no-analysis-imports.test.ts (new)
- tasks/TASK-61.md
