---
id: gap-query-stale-snapshot-warning
title: 查询带 stale/HEAD 信号：generatedAt 落后于 git HEAD 时显式提示重跑 analyze
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

快照静默过期：`scopeInfo.generatedAt` 落后于当前 git HEAD 时，查询不报 stale；git ownership 的窗口也停在旧日期，调用方无法区分「读数来自旧树」还是「当前树」。修法：查询返回带 staleness 信号（`generatedAt` vs git HEAD sha），或提供 `--check-stale` / `archguard_summary` 里的 stale 标记，过期时给出重跑 `archguard_analyze` 的提示。

## AC

- [ ] 每个 scope 查询结果（或 `archguard_summary`/`scopeInfo`）包含 staleness 字段，比较 `generatedAt` 与当前 git HEAD（无 git 时标 `not-checked`）；新增用例到 `tests/unit/cli/mcp/mcp-server.test.ts`
- [ ] 一个 `generatedAt` 早于 HEAD 的 scope 被标 stale 且带「重跑 analyze」提示，新鲜的 scope 不被标
- [ ] 现有 summary/scopeInfo 用例不回归

## DoD

在已前进过 HEAD 的工作树里，查询任一 scope 能看到 stale 标记与当前 HEAD vs snapshot 的对应关系——「读数是不是旧的」可机械判断，而非靠人肉比对 generatedAt。

## Touches

- src/cli/mcp/mcp-server.ts
- src/cli/query/engine-loader.ts
- tests/unit/cli/mcp/mcp-server.test.ts
- tasks/gap-query-stale-snapshot-warning.md