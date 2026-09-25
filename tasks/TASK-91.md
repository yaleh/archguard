---
id: TASK-91
title: "TASK-91: 查询响应回显所用 scope（key/sources/generatedAt），多 scope 且未指定时给出警告"
status: todo
labels:
  - gap
  - mcp
  - query
parent: null
children: []
extra: {}
---
## Proposal

当前查询类 MCP 工具（summary、find_entity、get_dependencies/dependents、package_metrics 等）的响应里看不出用的是哪个 scope、分析于何时。调用方在存在多个 scope 且没传 `scope` 时，会拿全局 scope 的结果当成「整个项目」，出错也发现不了（实测因此得到 446 与 810 两个不同的实体数）。

方案：`src/cli/query/engine-loader.ts` 的 `loadEngine` 返回已解析的 scope 元信息（key、sources、generatedAt）；经 `src/cli/mcp/mcp-server.ts` 的共享响应路径，在 JSON 响应里加统一的 `scopeInfo` 字段。manifest 有多个 scope 且调用方没传 `scope` 时，`scopeInfo` 附 `warning` 字段，列出可选 scope 的 key 与实体数。不改各工具已有字段，只加字段（向后兼容）。

<!-- dedup-ref -->
相关但机制不同：TASK-90 修全局 key 的选取规则；本任务不改选取，只让选取结果对调用方可见。两者独立，先后落地都行。

## AC

- [ ] `npx vitest run tests/unit/cli/query/engine-loader.test.ts` exit 0，新增用例：`loadEngine` 返回的元信息含 key、sources、generatedAt
- [ ] `npx vitest run tests/unit/cli/mcp/mcp-server.test.ts` exit 0，新增用例：summary 与 find_entity 的响应含 `scopeInfo`；manifest 有 2 个 scope 且未传 `scope` 时含 `warning`，传了 `scope` 时不含
- [ ] 既有 mcp 测试全绿：`npx vitest run tests/unit/cli/mcp` exit 0
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

通过真实 MCP 服务对一个含两个 scope 的 `.archguard` 分别调用带与不带 `scope` 的 `archguard_summary`，响应里能直接读出所用 scope 的 key、sources、生成时间，未指定 scope 时收到警告；既有 MCP 调用方不因新增字段而失败。

## Touches

- `src/cli/query/engine-loader.ts`
- `src/cli/mcp/mcp-server.ts`
- `tests/unit/cli/query/engine-loader.test.ts`
- `tests/unit/cli/mcp/mcp-server.test.ts`
- `tasks/TASK-91.md`
