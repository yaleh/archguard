---
id: gap-query-relation-type-filter
title: get_dependencies/get_dependents 无法按关系类型过滤：BFS 邻接混入
  call/composition，工具描述还声称不含 call 边
status: ready
labels:
  - gap
  - query
  - mcp
parent: null
children: []
extra:
  schema: execution
---
---
id: gap-query-relation-type-filter
title: get_dependencies/get_dependents 无法按关系类型过滤：BFS 邻接混入
  call/composition，工具描述还声称不含 call 边
status: ready
labels:
  - gap
  - query
  - mcp
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：`archguard_get_dependencies` / `archguard_get_dependents` 无法只取某类关系。
- `src/core/query/arch-index-builder.ts:77-86` 把**所有**内部关系类型都 push 进 `dependencies` / `dependents` 邻接表；
- `src/core/query/relation-query-service.ts:147-176` 的 `bfs` 直接沿邻接表走，调用方无法要求“只走 inheritance/composition”；
- 与此同时 `src/cli/mcp/mcp-server.ts:471` 的工具描述写着「call graph edges are not included — only class-level structural relations」，与邻接表的实际内容不符（call 边也在里面）；
- edge-list 输出每条边只有 `from / to / type`（`EdgeListField`），即使拿到全量混合边，也没有服务端过滤能力。

对下游（Architecture tab / UML 视图）这意味着：想画继承/组合，必须自己遍历全图再筛；而默认得到的图里 call 边可能占绝对多数（quay 当前内部边里 call 6,100 / 10,493）。

**修复方向**：
1. `RelationQueryService.getDependencies(entityName, depth, relationTypes?)` 与 `getDependents(...)` 增加可选 `relationTypes: readonly RelationType[]`：
   - 省略时行为与现在完全一致（沿 `index.dependencies` / `dependents`，保持顺序与深度语义）；
   - 提供时，仅沿 `index.relationsByType` 中这些类型的边做 BFS（dependency 方向 source→target，dependents 方向反向），不读取未选类型的邻接。
2. MCP 两个工具新增 `relationTypes` 参数（enum 取 `RelationType` 全集），透传到服务层；未知值由 zod 拒绝。
3. `QueryMethodOptions` 增加 `relationTypes`，`applyOutputOptions` 的 edge-list 分支在提供该参数时只序列化同类型的关系，保证 `entities` 与 `relations` 口径一致。
4. 修正工具描述：默认包含全部内部关系类型（含 call），`relationTypes` 可收窄；删除“call edges are not included”的错误说法。
5. 明确边界：`relationsByType` 里的 call 边是类级（不含 `sourceMethod`/`targetMethod`），本任务不做方法级字段。

## AC

- [x] 夹具同时含 dependency / call / composition / inheritance 四类边：`getDependencies(name, 1, ['inheritance'])` 只返回 inheritance 目标；省略 `relationTypes` 时返回结果与修复前逐项一致（顺序也一致）
- [x] `getDependents` 对称通过：按类型过滤只返回对应方向、对应类型的邻居
- [x] MCP `archguard_get_dependencies` / `archguard_get_dependents` 的 schema 接受 `relationTypes`（合法枚举），非法值被拒绝；省略时行为不变
- [x] `queryFormat=edge-list` + `relationTypes` 时，`relations` 只包含所选类型，`entities` 仍覆盖对应闭包
- [x] 工具描述修正：不再声称默认结果不含 call 边；明确「默认全部内部类型，可用 relationTypes 收窄」
- [x] 真实数据（claudecodeui `93e0a992` 副本）：对存在继承边的实体分别用默认与 `['inheritance']` 查询，默认结果包含 dependency/call/composition，过滤结果只含继承；同时记录外部端点不在结果里（外部关系保留是独立任务，不属于本 AC）
- [x] 不破坏现有调用：CLI `query --deps-of/--used-by` 与 cognitive-summary 的现有调用（不传第三参）结果不变
- [x] `bash scripts/test.sh --for-task gap-query-relation-type-filter` 与 `npm run type-check` 通过

## DoD

不是「多了一个可选参数」就算完成。要在 claudecodeui scope 的真实副本上各跑一次默认查询与带 `relationTypes` 的查询，给出返回实体数量与边类型的逐项对照，证明过滤确实只沿所选类型走（而不是查完再筛），并证明默认路径完全没变；同时在 MCP 层用真实调用展示合法/非法参数的行为。

## Touches

- tasks/gap-query-relation-type-filter.md
- src/core/query/relation-query-service.ts
- src/core/query/query-engine.ts
- src/cli/mcp/mcp-server.ts
- tests/unit/core/query/relation-query-service.test.ts
- tests/unit/cli/query/query-engine.test.ts
- tests/unit/cli/mcp/mcp-server.test.ts
