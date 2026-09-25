---
id: TASK-90
title: "TASK-90: 全局 scope key 选取——没有 primary scope 的运行沿用旧 globalScopeKey，查询读到过期数据"
status: todo
labels:
  - gap
  - defect
  - query
parent: null
children: []
extra: {}
---
## Proposal

不传 `scope` 的 MCP 查询读 `manifest.globalScopeKey`。`src/cli/query/query-artifacts.ts` 的 `persistQueryScopes` 选 key 的优先级是：本次运行的 `role==='primary'` scope → 旧 manifest 的 `globalScopeKey`（只要它仍在合并列表里）→ `selectGlobalScopeKey`（entityCount 最大的 parsed scope）。带 `sources` 的运行属于 partial run，通常没有 primary，于是旧 key 被永远沿用：实测 `globalScopeKey` 停在 09-06 的 scope，默认 `summary` 得 446 实体，显式指定新 scope 得 810。

根因是「主 scope」没有明确定义，只有「谁先写进 manifest」。方案：没有 primary 时不再沿用旧 key，改为对合并后的 scope 列表重新执行 `selectGlobalScopeKey`（最宽的 parsed scope）；有 primary 时行为不变。同时给 manifest 的每个 scope 条目补 `generatedAt`（当前只有 manifest 整体一个时间戳），让「哪个 scope 是新的」可以从数据判断。

<!-- dedup-ref -->
相关但机制不同：TASK-89（多 source 静默丢弃）、TASK-91（查询响应回显所用 scope）。本任务只改选取规则和 manifest 字段，不改任何查询工具的响应形状。

## AC

- [ ] `npx vitest run tests/unit/cli/query/query-artifacts.test.ts` exit 0，新增用例：先写入大 scope（primary），再以无 primary 的运行写入小 scope，globalScopeKey 仍指向较宽的 scope；再写入更宽的无 primary scope，globalScopeKey 切换到它
- [ ] 同一测试文件新增用例：旧 globalScopeKey 对应的 scope 在合并列表中已比新 scope 窄时，不再被沿用
- [ ] 同一测试文件新增用例：有 primary 时仍以 primary 为准（回归）
- [ ] `npx vitest run tests/unit/cli/query/query-manifest.test.ts` exit 0，`QueryScopeEntry` 含 `generatedAt`，旧 manifest（无该字段）仍可读
- [ ] `npx vitest run tests/unit/cli/query/engine-loader.test.ts` exit 0（回归）
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

在一个真实 `.archguard` 目录上复现过原问题（先分析大目录、再对子目录做 partial run），修复后不传 scope 的 `archguard_summary` 返回的是较宽 scope 的实体数，而不是旧 scope 的；旧版本写出的 manifest 在新代码下仍可加载。

## Touches

- `src/cli/query/query-artifacts.ts`
- `src/cli/query/query-manifest.ts`
- `src/cli/analyze/run-analysis.ts`
- `tests/unit/cli/query/query-artifacts.test.ts`
- `tests/unit/cli/query/query-manifest.test.ts`
- `tasks/TASK-90.md`
