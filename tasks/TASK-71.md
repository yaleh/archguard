---
id: TASK-71
title: "TASK-71: B 类剩余——kotlin 插件分支密集路径直接 import 单测"
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
# TASK-71: kotlin 插件分支密集路径单测

## Proposal

TASK-58 边界清单（交付物）B 类：**分支密集纯函数 → 直接 import 单测**。TASK-59 已覆盖
parser/shared/atlas/mermaid/analysis，**剩余项包含 kotlin 插件**：
`src/plugins/kotlin/*-extractor.ts`、`*-mapper.ts`、`index.ts`——分支密集但缺少直接 import 单测。
遵循 TASK-58/59 判据：**不设全局百分比目标**，逐模块判断哪些边界值得稳定。

### 选定机制

对 kotlin 插件逐文件分析分支密集路径（extractor 的语法分支、mapper 的映射分支、index 的插件
装配），为**值得稳定**的边界补直接 import 单测。每文件独立判断（不凑数）。

## Acceptance Criteria

- [x] kotlin 插件值得稳定的分支密集路径有直接 import 单测（`tests/unit/plugins/kotlin/`）
- [x] 每个新增测试文件有负控制或覆盖具体分支的证据（不是空转）
- [x] `npx vitest run tests/unit/plugins/kotlin/` 全绿
- [x] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [x] 不设全局 coverage 百分比目标（按模块判断）

## Execution Evidence (TASK-71, 2026-08-05)

**新增测试文件（6 个，tests/unit/plugins/kotlin/）：**
- `kotlin-type-extractor-extra.test.ts`（9 tests）——空串/空白/裸 `?` 早退、非 primitive 外层泛型保留、嵌套泛型深度
- `dependency-extractor-extra.test.ts`（10 tests）——无版本坐标、单段坐标跳过、非 test scope→runtime、前导空白
- `archjson-mapper-extra.test.ts`（10 tests）——`abstract_class`→`isAbstract`、member 无类型分支、全限定 superType 解析
- `function-builder-extra.test.ts`（7 tests）——可空返回/参数、lambda 返回类型、protected 可见性
- `class-builder-extra.test.ts`（6 tests）——object superTypes、可空/泛型字段类型、带参注解、命名 companion
- `index-extra.test.ts`（9 tests）——`@Ignore`/`@Disabled` 跳过、import 过滤、断言均分余数、custom regex、`@RepeatedTest`、e2e hint、glob 优先级

**invoke 实跑（AC3）：**
```
$ npx vitest run tests/unit/plugins/kotlin/
 Test Files  15 passed (15)
      Tests  186 passed (186)   # 基线 135 + 新增 51
```

**负控制（Contract control，DoD 证据在 outer 收尾时使用）：**
变异 `src/plugins/kotlin/kotlin-type-extractor.ts` L81 `if (!KOTLIN_PRIMITIVE_TYPES.has(outerName))` → `if (true)` 后，
`kotlin-type-extractor-extra.test.ts` 2 个用例红 + `kotlin-type-extractor.test.ts` 2 个用例红
（`expected [ 'Map', 'Order' ] to deeply equal [ 'Order' ]` 等）；回滚后全绿。测试真抓分支。

**lint（AC4）：** `npx eslint` scoped 6 个新文件 → `0 errors`（12 warnings 均为既有测试文件同款
`as any`/`explicit-function-return-type` 模式）。

## Touches

- `src/plugins/kotlin/*`（extractor/mapper/index——测试触碰的实现文件）
- `tests/unit/plugins/kotlin/*`（新增测试）
- `tasks/TASK-71.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | kotlin 插件值得稳定边界的直接 import 测试数 + `npx vitest run tests/unit/plugins/kotlin/` pass |
| band | 分支密集边界有测试覆盖；scoped 全绿 |
| invariant | 不触碰非 kotlin 文件；不设全局 % 目标 |
| invoke | `npx vitest run tests/unit/plugins/kotlin/` |
| control | 变异一个分支（如改 mapper 映射条件）→ 对应测试红（测试真抓分支） |
| resume | 每文件落盘；被打断可从缺口续 |

## Definition of Done

- [ ] kotlin 分支密集边界单测落地 + scoped 全绿
- [ ] 负控制证据（变异分支 → 测试红）
- [ ] lint 0 error（新文件 lint-clean）
