---
id: gap-duplicates-per-scope-persistence
title: detect_duplicates 按 scope 分目录持久化：manifest 记 scopeKey/label，避免不同 scope 互相覆盖
status: ready
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

`detect_duplicates` 按 scope 分别运行时结果互相覆盖：`persistDuplicates`（`src/analysis/duplicates/persistence.ts:23-31`）固定写 `.archguard/query/duplicates/{manifest,groups}.json`，与 scope 无关；`DuplicateManifest`（`src/analysis/duplicates/types.ts`）只有 `sources` 字段、没有 scope key。实测（claudecodeui）：依次跑 scope=server 与 scope=src，目录里只剩最后一次 src 的结果，server 被静默覆盖，落盘那份被当成「全项目重复很少」的证据。这是 TASK-102（duplicates v1）的后续缺陷。

修复方向：
1. 持久化按 scope 分目录：`query/duplicates/<scopeKey>/manifest.json` + `groups.json`；`scopeKey` 与 query manifest 的 `QueryScopeEntry.key` 同源（8-hex 源 hash，`hashSources`）。
2. manifest 新增 `scopeKey` 与 `label` 字段；顶目录新增 `query/duplicates/index.json`，entries 列出各 scopeKey 的 label/sources/generatedAt，消费方先读 index 再按 scopeKey 读分组。
3. 旧的扁平 `duplicates/{manifest,groups}.json` 不再写；`loadDuplicates` 改为按 scopeKey 读取。
4. 顺带补文档盲区说明：工具描述注明「仅精确结构克隆（Type-1/2），单语句/极小函数（低于 minStatements/minTokens 下限）不覆盖」。

## AC

- [x] `persistDuplicates` 写入 `query/duplicates/<scopeKey>/manifest.json` 与 `groups.json`，manifest 含 `scopeKey` 与 `label` 字段；`npx vitest run tests/unit/analysis/duplicates/duplicates.test.ts` exit 0，新增用例断言两个不同 scope 各自成目录、互不覆盖
- [x] 顶目录 `query/duplicates/index.json` 存在，`entries` 列出每个已写 scopeKey 的 label/sources/generatedAt，与磁盘目录一一对应；单测机械断言该一致性
- [x] 旧的扁平 `query/duplicates/manifest.json` / `groups.json` 不再被写；`loadDuplicates` 按 scopeKey 读取，无 scopeKey 参数时的行为在测试中写清
- [x] `archguard_detect_duplicates` 工具描述补充盲区说明「仅精确结构克隆（Type-1/2），单语句/极小函数不覆盖」；`npx vitest run tests/unit/cli/mcp/tools/duplicate-tools.test.ts` exit 0（现有用例不回归）
- [x] `npm run type-check` 通过

## DoD

合成夹具跑两次 `detect_duplicates`（两个不同 scope key）后，`query/duplicates/` 下并存两个 `<scopeKey>/` 目录，各自 manifest 的 `scopeKey` 正确、`index.json` 列出两者——「结果是否互相覆盖」可机械验证，而非靠人肉比对。

## Touches

- tasks/gap-duplicates-per-scope-persistence.md
- src/analysis/duplicates/persistence.ts
- src/analysis/duplicates/types.ts
- src/analysis/duplicates/group.ts
- src/cli/mcp/tools/duplicate-tools.ts
- tests/unit/analysis/duplicates/duplicates.test.ts
- tests/unit/cli/mcp/tools/duplicate-tools.test.ts
