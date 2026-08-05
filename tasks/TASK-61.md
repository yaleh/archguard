---
id: TASK-61
title: "TASK-61: 恢复 types↔analysis 环的回归守卫测试到 master"
status: done
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

- [x] `tests/types/no-analysis-imports.test.ts` 存在于 master（scoped 测试绿）
- [x] 守卫断言「src/types 不 import src/analysis」，与 master 的 `fitness-rules.ts` 路径兼容
- [x] 负控制验证：故意引入 types→analysis import 时守卫变红（输出贴入任务体）
- [x] 不触碰 `src/types/fitness-rules.ts` 等实现文件（纯测试落地）

## Definition of Done

- [x] `npx vitest run tests/types/no-analysis-imports.test.ts` 退出码 0
- [x] 负控制输出已贴入任务体（证明守卫抓得住回归）
- [x] 守卫文件已提交到 master（随任务 fan-in 合并）

## Evidence

执行 2026-08-05（worktree `archguard-worktrees/task-61`，branch `task/TASK-61`）。

**Scoped 测试绿（守卫存在且通过）：**

```
 RUN  v3.2.4 /home/yale/work/archguard-worktrees/task-61

 ✓ tests/types/no-analysis-imports.test.ts (2 tests) 15ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  07:48:33
   Duration  1.95s (transform 245ms, setup 0ms, collect 235ms, tests 15ms, environment 1ms, prepare 322ms)

EXIT: 0
```

**负控制（回归证明，守卫必须红）：** 临时在 `src/types/index.ts` 末尾加
`import type {} from "@/analysis/metric-vector-builder";` 桩，守卫立刻变红并精确报出违规行：

```
 RUN  v3.2.4 /home/yale/work/archguard-worktrees/task-61

 ❯ tests/types/no-analysis-imports.test.ts (2 tests | 1 failed) 50ms
   ✓ ARCH-INVERSION-001: src/types must not import from src/analysis > should have at least one .ts file in src/types 5ms
   × ARCH-INVERSION-001: src/types must not import from src/analysis > should have no imports crossing into src/analysis from src/types 40ms
     → expected [ Array(1) ] to deeply equal []

AssertionError: expected [ Array(1) ] to deeply equal []
- Expected
+ Received

- []
+ [
+   "/home/yale/work/archguard-worktrees/task-61/src/types/index.ts:328: import type {} from \"@/analysis/metric-vector-builder\";",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)

EXIT: 1
```

**撤销桩后守卫恢复绿：**

```
 RUN  v3.2.4 /home/yale/work/archguard-worktrees/task-61

 ✓ tests/types/no-analysis-imports.test.ts (2 tests) 26ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  07:48:55
   Duration  1.71s (transform 294ms, setup 0ms, collect 309ms, tests 26ms, environment 1ms, prepare 426ms)

EXIT: 0
```

**守卫断言（相对 e086e65 原版的适配说明）：** 原版断言已是通用结构检查（不引用分支专用
`src/types/fitness.ts`），与 master 的 `fitness-rules.ts` 方案天然兼容。按对抗评审加固了匹配正则，
使其覆盖所有「import 进 src/analysis」的形式（同一断言、更完整，未新增脆断言）：

- alias：`from '@/analysis/...'` 及裸 index 形式 `from '@/analysis'`
- relative：任意深度的 `../analysis/...`
- side-effect：`import '@/analysis/...'`
- dynamic：`import('@/analysis/...')`

同时保留非空守卫 `tsFiles.length > 0`（防空转），且对当前 `src/types` 全量扫描 0 误报
（grep 验证 `src/types` 无任何 `@/analysis` import，环保持已破状态）。

## Touches

- tests/types/no-analysis-imports.test.ts (new)
- tasks/TASK-61.md
