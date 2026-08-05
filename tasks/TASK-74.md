---
id: TASK-74
title: "TASK-74: A 类——config 语义 E2E 稳定化（archguard.config.json 加载与字段行为）"
status: done
labels:
  - test-coverage
  - boundary-list
  - e2e
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-58 边界清单 A 类，分批第二批）
---
# TASK-74: config 语义 E2E 稳定化

## Proposal

TASK-58 边界清单 **A 类（用户可见契约 → 端到端）**：`archguard.config.json` 加载与字段行为
（src/cli/config-loader、config-*）是用户入口契约——配置字段语义、默认值、覆盖、非法配置的
报错都应被 E2E 守住。已有集成测试基础（`tests/integration/custom-config-path.test.ts` 等），
本任务「保持 + 稳定」：审计现有覆盖，补缺口的契约断言。

**分批裁定（外层 2026-08-05）**：A 类分多批，本任务第二批 = config 语义（TASK-73 CLI 命令族
是第一批）。TASK-73 落地后派发。

### 选定机制

审计 config 加载/字段行为的现有 E2E 覆盖；对缺口补契约断言（如自定义 config 路径、字段默认值
与覆盖、非法 config 的退出码/报错信息）。每字段独立判断，不凑数。

## Acceptance Criteria

- [x] config 加载关键契约有 E2E 断言（自定义路径、默认值、覆盖、非法 config 报错）
- [x] 每个新增/修改断言有具体契约依据
- [x] `npx vitest run tests/integration/` 中 config 相关全绿
- [x] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [x] 不设全局 coverage 百分比目标

## Execution Evidence (TASK-74, 2026-08-05)

实现范围：只改 `tests/integration/custom-config-path.test.ts`（新增 3 个 describe 块 + 10 条断言）。
`src/cli/config-loader.ts` 只读审计，零改动。

新增断言（每项标注契约依据行号）：
- **默认值**（无 config 文件）：workDir/format/mermaid/exclude/cli/cache/concurrency/verbose/diagrams
  全字段断言（config-loader.ts:141-275 schema defaults；:397-412 resolveDirectoryDefaults）。
- **workDir 派生目录**：outputDir=workDir/output、cache.dir=workDir/cache（:397-412）。
- **默认搜索**：configDir 下 archguard.config.json 优先（:482-501）。
- **覆盖语义**：嵌套 mermaid 递归合并保留 sibling、数组整体替换不合并、未被覆盖的文件字段保留
  （:420-448 deepMerge）。
- **非法 config 报错**：非法 format/diagram level/字段类型 → `Configuration validation failed:` +
  `  - <field.path>: <issue.message>` 格式（:361-374）；文件内非法值经自定义路径同样报错。

invoke 实跑（worktree task-74，node_modules symlink 复用主仓）：

```
$ npx vitest run tests/integration/custom-config-path.test.ts
 ✓ tests/integration/custom-config-path.test.ts (17 tests) 183ms
 Test Files  1 passed (1)
      Tests  17 passed (17)

$ npx vitest run tests/integration/cli/user-entry-contract.test.ts   # config 相邻 E2E，同批全绿
 ✓ tests/integration/cli/user-entry-contract.test.ts (7 tests) 2405ms
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ npx eslint tests/integration/custom-config-path.test.ts           # lint gate
# 0 errors, 0 warnings, exit 0
```

审计确认的关键行为（写成断言）：
- 默认 outputDir 为 `.archguard/output`（`path.join('./.archguard','output')` 规范化掉 `./`），
  非 `./.archguard/output`——断言按实际契约写。
- zod v4 枚举报错 `Invalid option: expected one of "mermaid"|"json"`；类型报错
  `Invalid input: expected number, received string`。

## Touches

- `tests/integration/*config*`（E2E 测试）
- `src/cli/config-loader.ts` / `config-*`（测试触碰的入口——只读审计，不改造）
- `tasks/TASK-74.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | config 契约 E2E 断言数 + config 相关 scoped 测试 pass |
| band | 关键 config 契约有 E2E 断言；scoped 全绿 |
| invariant | 不改造 config 实现（只审计 + 补测试断言）；不设全局 % |
| invoke | `npx vitest run tests/integration/custom-config-path.test.ts` |
| control | 改一个 config 字段的默认值/报错 → 对应 E2E 红 |
| resume | 每字段落盘；被打断可从缺口续 |

## Definition of Done

- [x] config 契约 E2E 断言补全 + scoped 全绿
- [x] 契约依据证据
- [x] lint 0 error（新文件 lint-clean）
