---
id: TASK-75
title: "TASK-75: A 类——输出格式契约 E2E 稳定化（ArchJSON/mermaid/SVG 渲染）"
status: done
labels:
  - test-coverage
  - boundary-list
  - e2e
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-58 边界清单 A 类，分批第三批）
---
# TASK-75: 输出格式契约 E2E 稳定化

## Proposal

TASK-58 边界清单 **A 类（用户可见契约 → 端到端）**：输出格式契约 = ArchJSON schema、mermaid
输出、SVG/PNG 渲染（tests/integration/mermaid/e2e 已覆盖）。接口变更必须被 E2E 守住。本任务
「保持 + 稳定」：审计现有输出格式 E2E 覆盖，补缺口的契约断言。

**分批裁定（外层 2026-08-05）**：A 类第三批 = 输出格式契约（TASK-73 CLI、TASK-74 config 已落地）。

### 选定机制

审计 ArchJSON/mermaid/SVG 渲染的 E2E 覆盖；对缺口补契约断言（ArchJSON schema 字段、mermaid
关键结构、渲染产物存在性/内容）。每输出格式独立判断。

## Acceptance Criteria

- [x] 输出格式关键契约有 E2E 断言（ArchJSON schema / mermaid 结构 / 渲染产物）
- [x] 每个新增/修改断言有具体契约依据
- [x] `npx vitest run tests/integration/mermaid/` 全绿
- [x] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [x] 不设全局 coverage 百分比目标

## Execution Evidence (TASK-75, 2026-08-05)

实现范围：只改两个测试文件（`tests/integration/mermaid/e2e.test.ts`、
`tests/integration/archjson-schema-version.test.ts`）。`src/mermaid/*`、`src/types/index.ts`
只读审计，零改动。不设全局 coverage 目标（沿用 vitest.config.ts 既有阈值，未触碰）。

新增/修改断言（每项标注契约依据，src 只读审计）：
- **SVG 渲染契约**（e2e.test.ts「should generate complete diagram」）：`viewBox` 几何属性、
  `class="classDiagram"` 根标记、至少一个实体名渲染为 SVG 文本（renderer.ts:38-71，mermaid.render
  输出实证含 `<svg ... class="classDiagram" ... viewBox="-8 -8 W H">`）。
- **PNG 渲染契约**（同上）：产物非空 + 8 字节 PNG 签名 `89504e470d0a1a0a`（renderer.ts:112-159）。
- **mermaid 结构契约**（新测试「should emit mermaid class-level structure contract」）：
  - 首行 `classDiagram`（generator.ts:291）；
  - classDef 语义块 `classDef classNode fill:#f6f8fa,stroke:#d0d7de,color:#24292f`
    （generator.ts:293-297 / generator-formatting.ts:3-11）；
  - 成员渲染 `+publicMethod(id: string): void`、`-privateField: number`、`#protectedHelper()`
    （generator-formatting.ts:101-142 可见性符号/参数/返回类型）；
  - 节点类型标注 `class Parent:::classNode`、`class Service:::interface`
    （generator.ts:371-381，entityTypeToClassDef）；
  - 五类关系标记 `<|--`/`<|..`/`*--`/`o--`/`-->`（generator-formatting.ts:153-165）。
- **ArchJSON schema 契约**（archjson-schema-version.test.ts 新增 3 条）：
  - 每个 entity 必填字段 id/name/type/sourceLocation.file/members（types/index.ts:132-146）；
  - 每个 relation 必填 id/source/target/type ∈ RelationType 七值
    （types/index.ts:202-232）；
  - sourceFiles 非空字符串数组。

invoke 实跑（worktree task-75，node_modules symlink 复用主仓）：

```
$ npx vitest run tests/integration/mermaid/
 ✓ tests/integration/mermaid/e2e.test.ts (8 tests) 25978ms
 ✓ ... (mermaid e2e 8 passed)
 Test Files  1 passed | 1 skipped (2)
      Tests  8 passed | 1 skipped (9)
 # 1 skipped = render-worker-pool.integration.test.ts（ARCH_TEST_WORKERS 未设，默认跳过）

$ npx vitest run tests/integration/archjson-schema-version.test.ts
 ✓ tests/integration/archjson-schema-version.test.ts (6 tests) 3935ms
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npx eslint tests/integration/mermaid/e2e.test.ts tests/integration/archjson-schema-version.test.ts
# 0 errors, 0 warnings, exit 0
```

control 依据：断言锚定具体输出结构（classDef 行、成员行、关系标记、viewBox/class 标记、
PNG 签名）——改任一输出结构，对应 E2E 红。

## Touches

- `tests/integration/mermaid/*`（E2E 测试）
- `tests/integration/*archjson*` / `*render*`（相关 E2E）
- `tasks/TASK-75.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 输出格式契约 E2E 断言数 + `npx vitest run tests/integration/mermaid/` pass |
| band | 关键输出契约有 E2E 断言；scoped 全绿 |
| invariant | 不改造输出实现（只审计 + 补断言）；不设全局 % |
| invoke | `npx vitest run tests/integration/mermaid/e2e.test.ts` |
| control | 改一个输出结构（如 mermaid 标题/层级）→ 对应 E2E 红 |
| resume | 每格式落盘；被打断可从缺口续 |

## Definition of Done

- [x] 输出格式契约 E2E 断言补全 + scoped 全绿
- [x] 契约依据证据
- [x] lint 0 error（新文件 lint-clean）
