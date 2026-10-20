---
id: gap-query-edge-list-leaks-full-relations
title: get_dependencies 的 edge-list 输出把 relations 泄成全图，name 对关系侧不生效，需收窄到查询闭包并支持分页/字段过滤
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

实测 `archguard_get_dependencies({ name, queryFormat:'edge-list' })` 传 package 名或 class 名都返回整图 494k–550k chars，看起来像 `name` 没生效。根因在 `QueryEngine.applyOutputOptions`（`src/core/query/query-engine.ts:353-368`）：edge-list 分支调用 `filterRelationsForScope(this.archJson.relations, scope)`，传的是**整个 scope 的 relations**，而不是查询结果实体集的源/目标闭包。`name` 对实体列表是生效的（BFS 正确），但 `serialize()` 的 relations 字段泄出全图。修法：edge-list 序列化时把 relations 收窄到「返回实体集 ∪ 起始实体」，并为大图提供分页/topN 与字段过滤。

## AC

- [ ] `QueryEngine.applyOutputOptions` 在 `queryFormat='edge-list'` 时，只输出源/目标均落在「返回实体集 ∪ 起始实体」闭包内的 relations，不再整 scope 输出；新增单测在 `tests/unit/core/query/query-engine.test.ts` 断言：一个含 2 个不相连子图的 fixture，`getDependencies('A', 1, edge-list)` 的 relations 只含 A 的邻居、不含另一子图的边
- [ ] `archguard_get_dependencies` 增加 `topN`（及可选字段过滤）参数，超大结果能被截断而不是一次性倒出；`tests/unit/cli/mcp/mcp-server.test.ts` 有对应断言
- [ ] 现有 `output-scope-filter` / `edge-list-serializer` 用例不回归：`npm test -- --run tests/unit/core/query/output-scope-filter.test.ts tests/unit/core/query/edge-list-serializer.test.ts` 绿

## DoD

用 claudecodeui 的 server scope（或等价大 fixture）跑 `archguard_get_dependencies({ name:'ClaudeResidentHostDriver', queryFormat:'edge-list', depth:1 })`，返回的 relations 数量远小于全图且只涉及该实体的依赖闭包——「name 收窄 relations」在真实大图上成立，而非仅单测 fixture 通过。

## Touches

- src/core/query/query-engine.ts
- src/core/query/output-scope-filter.ts
- src/core/query/edge-list-serializer.ts
- src/cli/mcp/mcp-server.ts
- tests/unit/core/query/query-engine.test.ts
- tests/unit/cli/mcp/mcp-server.test.ts
- tasks/gap-query-edge-list-leaks-full-relations.md