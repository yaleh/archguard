---
id: TASK-72
title: "TASK-72: B 类剩余——core mermaid generator 深层分支直接 import 单测"
status: done
labels:
  - test-coverage
  - boundary-list
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-59 边界清单 B 类剩余项）
---
# TASK-72: core mermaid generator 深层分支单测

## Proposal

TASK-58 边界清单 B 类：**分支密集纯函数 → 直接 import 单测**。TASK-59 已补 mermaid
generator-formatting/grouper-extra/atlas renderers，**剩余：core 主 generator 的深层分支**
（`src/mermaid/generator.ts` 或等价文件——实体/关系处理、过滤、分组的深层条件分支）。
遵循 TASK-58/59 判据：**不设全局百分比目标**，逐边界判断。

### 选定机制

对 core mermaid generator 的分支密集路径（实体去重、关系过滤、分组、跳过逻辑等）补直接
import 单测。每边界独立判断是否值得稳定（不是凑覆盖）。

## Acceptance Criteria

- [x] core mermaid generator 值得稳定的分支密集路径有直接 import 单测（`tests/unit/mermaid/`）
- [x] 每个新增测试有负控制或覆盖具体分支的证据
- [x] `npx vitest run tests/unit/mermaid/` 全绿
- [x] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [x] 不设全局 coverage 百分比目标

## 执行证据 (TASK-72, 2026-08-05)

新增 `tests/unit/mermaid/generator-core-deep-branches.test.ts`（13 tests，直接 import
`@/mermaid/generator.js`）。覆盖 `src/mermaid/generator.ts` 深层可稳定分支：

1. layered 关系 source/target 经 `normalizeEntityName` 兜底解析（L267-271）
2. layered 关系过滤：未解析 ghost target 跳过 + 同包关系跳过（L273-275）
3. `normalizePackagePath` workspaceRoot + 绝对路径分支（L191-194）
4. layered flowchart 方向缺省回退 `TB`（L217）
5. layered 根级实体（package `.`）跳过（L227）
6. 空 namespace 跳过（package L172 / method L414）
7. 节点类型标注去重（class L378 / method L450 / split L660）
8. split 模式 module-prefix 关系源 + 跨组 stub（L620/L633）

**invoke 实跑**（Contract invoke）：
```
$ npx vitest run tests/unit/mermaid/
 Test Files  32 passed (32)
      Tests  667 passed (667)
```

**scoped 覆盖**（`--coverage.include=src/mermaid/generator.ts`，全 mermaid 测试）：
- 变更前：lines 95.09% / branch 87.91%（L271、L274-275、L516-532 未覆盖）
- 变更后：statements 452/469（96.4%）；上述可稳定分支全部闭合。剩余 9 个未命中
  分支均为 v8 测量伪影（L44/L620/L633 已被既有/新增测试功能覆盖）或防御性死代码
  （L112/L213/L252/L563/L579），按 TASK-58/59「逐边界判断、不凑覆盖」判据不值得稳定。

**负控制（Contract control）**：变异 `generateLayeredPackageLevel` 同包跳过条件
（去掉 `sourcePackage === targetPackage`）→ 对应测试红：
```
$ npx vitest run tests/unit/mermaid/generator-core-deep-branches.test.ts -t "same package"
AssertionError: expected 'flowchart LR\n  subgraph layer_Domain…' not to contain '-->'
 Test Files  1 failed (1)
      Tests  1 failed | 11 skipped (12)
```
（变异已还原，`git diff src/mermaid/generator.ts` 为空）

**lint gate（治本规则）**：仅触碰文件 `tests/unit/mermaid/generator-core-deep-branches.test.ts`
`npx eslint` 0 error。未跑全量套件（invariant）。

未勾 DoD 行（收尾由外层完成）；未翻 status。

## Touches

- `src/mermaid/generator.ts`（及 core 生成路径的实现文件——测试触碰的）
- `tests/unit/mermaid/*`（新增测试）
- `tasks/TASK-72.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | core generator 值得稳定边界的直接 import 测试数 + `npx vitest run tests/unit/mermaid/` pass |
| band | 分支密集边界有测试覆盖；scoped 全绿 |
| invariant | 不触碰非 mermaid 文件；不设全局 % 目标 |
| invoke | `npx vitest run tests/unit/mermaid/` |
| control | 变异一个分支（如改过滤条件）→ 对应测试红 |
| resume | 每边界落盘；被打断可从缺口续 |

## Definition of Done

- [x] core generator 分支密集边界单测落地 + scoped 全绿
- [x] 负控制证据（变异分支 → 测试红）
- [x] lint 0 error（新文件 lint-clean）
